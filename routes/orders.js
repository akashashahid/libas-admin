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

router.put('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.body.status === 'Cancelled' && order.status !== 'Cancelled') {
      for (const item of order.items) {
        if (item.productId && item.size && item.qty) {
          const product = await Product.findById(item.productId);
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
