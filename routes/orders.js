const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { Resend } = require('resend');

async function sendOrderEmail(order) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.FROM_EMAIL || 'orders@elbnam.com';
    const adminTo = process.env.ADMIN_EMAIL || 'akashashahid07@gmail.com';
    const itemsList = order.items.map(i =>
      `• ${i.name} (${i.size}) × ${i.qty} — PKR ${(i.price * i.qty).toLocaleString()}`
    ).join('\n');
    await resend.emails.send({
      from: `Elbnam Orders <${from}>`,
      to: adminTo,
      subject: `New Order — ${order.customerName}`,
      text: `New order received!\n\nCustomer: ${order.customerName}\nPhone: ${order.phone}\nEmail: ${order.email || 'N/A'}\nAddress: ${order.address}\n\nItems:\n${itemsList}\n\nTotal: PKR ${order.total.toLocaleString()}\nPayment: ${order.payment}`
    });
    if (order.email) {
      await resend.emails.send({
        from: `Elbnam <${from}>`,
        to: order.email,
        subject: 'Order Confirmed — Elbnam',
        text: `Thank you for your order, ${order.customerName}!\n\nYour order has been received and our team will contact you on WhatsApp to confirm delivery.\n\nOrder Summary:\n${itemsList}\n\nTotal: PKR ${order.total.toLocaleString()}\nPayment: ${order.payment}\nDelivery to: ${order.address}\n\n— Elbnam Team\nWhatsApp: +92 310 4508143`
      });
    }
  } catch (err) {
    console.log('Email error (non-fatal):', err.message);
  }
}

function parseItems(itemsStr) {
  if (!itemsStr) return [];
  return String(itemsStr).split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const segs = part.split(':').map(s => s.trim());
    return { name: segs[0] || '', size: segs[1] || '', qty: parseInt(segs[2]) || 1, price: parseFloat(segs[3]) || 0 };
  });
}

async function deductStock(items) {
  for (const item of items) {
    if (item.productId && item.size && item.qty) {
      const product = await Product.findById(item.productId).catch(() => null);
      if (product && product.sizeStock) {
        const current = product.sizeStock.get(item.size) ?? 0;
        product.sizeStock.set(item.size, Math.max(0, current - item.qty));
        product.inStock = product.sizes.some(s => (product.sizeStock.get(s) ?? 0) > 0);
        product.markModified('sizeStock');
        await product.save();
      }
    }
  }
}

async function restoreStock(items) {
  for (const item of items) {
    if (item.productId && item.size && item.qty) {
      const product = await Product.findById(item.productId).catch(() => null);
      if (product && product.sizeStock) {
        const current = product.sizeStock.get(item.size) ?? 0;
        product.sizeStock.set(item.size, current + item.qty);
        product.inStock = true;
        product.markModified('sizeStock');
        await product.save();
      }
    }
  }
}

router.get('/', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const items = req.body.items || [];
    for (const item of items) {
      if (item.productId && item.size) {
        const product = await Product.findById(item.productId);
        if (product && product.sizeStock && product.sizeStock.size > 0) {
          const available = product.sizeStock.get(item.size) ?? 0;
          if (item.qty > available) {
            return res.status(400).json({
              success: false,
              error: `Only ${available} unit(s) of "${item.name}" in size ${item.size} are available.`
            });
          }
        }
      }
    }
    const order = new Order(req.body);
    await order.save();
    for (const item of items) {
      if (item.productId && item.size && item.qty) {
        const product = await Product.findById(item.productId);
        if (product && product.sizeStock) {
          const current = product.sizeStock.get(item.size) ?? 0;
          product.sizeStock.set(item.size, Math.max(0, current - item.qty));
          product.inStock = product.sizes.some(s => (product.sizeStock.get(s) ?? 0) > 0);
          product.markModified('sizeStock');
          await product.save();
        }
      }
    }
    sendOrderEmail(order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Excel bulk import
router.post('/import', async (req, res) => {
  const rows = req.body.orders || [];
  const results = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    try {
      const { externalId, customerName, phone, email, address, total, payment } = row;
      const status = row.status || 'Pending';
      const isCancelled = status === 'Cancelled';

      if (!customerName || !phone) {
        results.errors.push(`Row "${externalId || '?'}": Missing Customer Name or Phone`);
        continue;
      }

      // Resolve product IDs by name
      const parsedItems = parseItems(row.items);
      for (const item of parsedItems) {
        if (item.name) {
          const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const product = await Product.findOne({ name: new RegExp(`^${escaped}$`, 'i') }).catch(() => null);
          if (product) item.productId = product._id.toString();
        }
      }

      // Dedup by externalId
      if (externalId) {
        const existing = await Order.findOne({ externalId });
        if (existing) {
          if (existing.status === status) {
            results.skipped++;
            continue;
          }
          // Status changed — adjust stock
          const wasCancelled = existing.status === 'Cancelled';
          const nowCancelled = status === 'Cancelled';
          if (!wasCancelled && nowCancelled) await restoreStock(existing.items);
          else if (wasCancelled && !nowCancelled) await deductStock(existing.items);
          existing.status = status;
          await existing.save();
          results.updated++;
          continue;
        }
      }

      // New order
      const order = new Order({
        externalId: externalId || undefined,
        customerName, phone, email: email || '', address,
        items: parsedItems,
        total: parseFloat(total) || 0,
        payment: payment || 'COD',
        status
      });
      await order.save();
      if (!isCancelled) await deductStock(parsedItems);
      results.created++;
    } catch (err) {
      results.errors.push(`Row "${row.externalId || '?'}": ${err.message}`);
    }
  }

  res.json({ success: true, ...results });
});

router.put('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.body.status === 'Cancelled' && order.status !== 'Cancelled') {
      await restoreStock(order.items);
    } else if (req.body.status && req.body.status !== 'Cancelled' && order.status === 'Cancelled') {
      await deductStock(order.items);
    }
    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
