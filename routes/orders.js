const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { Resend } = require('resend');

function emailLogo() {
  return `
    <div style="text-align:center;padding:32px 0 20px;background:#0a0a0a;">
      <div style="font-family:Georgia,serif;font-size:40px;line-height:1;">
        <span style="font-style:italic;color:#b8860b;">El</span><span style="color:#ffffff;letter-spacing:3px;">bnam</span>
      </div>
      <div style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#b8860b;letter-spacing:3px;margin-top:6px;">Curated for the Discerning</div>
    </div>`;
}

function itemCardHtml(item) {
  const imgBlock = item.image
    ? `<img src="${item.image}" alt="${item.name}" width="80" height="100" style="object-fit:cover;border-radius:2px;display:block;" />`
    : `<div style="width:80px;height:100px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:28px;">👗</div>`;
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eeeeee;vertical-align:top;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:88px;padding-right:12px;">${imgBlock}</td>
          <td style="vertical-align:top;">
            <div style="font-family:Georgia,serif;font-size:14px;font-weight:600;color:#0a0a0a;margin-bottom:3px;">${item.name}</div>
            <div style="font-size:11px;color:#888;margin-bottom:4px;">${item.category || ''} · Size: ${item.size} · Qty: ${item.qty}</div>
            <div style="font-size:13px;font-weight:600;color:#b8860b;">PKR ${(item.price * item.qty).toLocaleString()}</div>
          </td>
        </tr></table>
      </td>
    </tr>`;
}

async function buildItemsWithImages(items) {
  return Promise.all(items.map(async item => {
    let image = '';
    if (item.productId) {
      const p = await Product.findById(item.productId).select('image images').lean().catch(() => null);
      if (p) image = (p.images && p.images.length) ? p.images[0] : (p.image || '');
    }
    return { ...item.toObject ? item.toObject() : item, image };
  }));
}

const STATUS_LABELS = {
  Confirmed:  { subject: 'Order Confirmed — Elbnam', headline: 'Your Order is Confirmed! ✓', color: '#2e7d32', body: 'Great news! Your order has been confirmed and will be dispatched soon.' },
  Delivered:  { subject: 'Order Delivered — Elbnam', headline: 'Order Delivered 🎉',          color: '#1565c0', body: 'Your order has been delivered. We hope you love your new Elbnam pieces!' },
  Cancelled:  { subject: 'Order Cancelled — Elbnam', headline: 'Order Cancelled',              color: '#c62828', body: 'Your order has been cancelled. If you have any questions, please contact us on WhatsApp.' },
  Processing: { subject: 'Order Processing — Elbnam', headline: 'Order is Being Processed',   color: '#b8860b', body: 'Your order is currently being processed. We will update you soon.' },
};

async function sendOrderEmail(order) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.FROM_EMAIL || 'orders@elbnam.com';
    const adminTo = process.env.ADMIN_EMAIL || 'akashashahid07@gmail.com';

    const itemsWithImages = await buildItemsWithImages(order.items);
    const itemRows = itemsWithImages.map(itemCardHtml).join('');
    const total = `PKR ${order.total.toLocaleString()}`;

    const adminHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
  <tr><td>${emailLogo()}</td></tr>
  <tr><td style="padding:28px 32px 0;">
    <div style="font-size:18px;font-weight:600;color:#0a0a0a;margin-bottom:4px;">New Order Received</div>
    <div style="font-size:12px;color:#888;margin-bottom:20px;">${new Date(order.createdAt || Date.now()).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})}</div>
    <table width="100%" cellpadding="8" cellspacing="0" style="background:#fdf8ee;border:1px solid #f5e8c0;font-size:13px;margin-bottom:24px;">
      <tr><td style="color:#888;width:30%;">Customer</td><td style="font-weight:600;">${order.customerName}</td></tr>
      <tr><td style="color:#888;">Phone</td><td>${order.phone}</td></tr>
      <tr><td style="color:#888;">Email</td><td>${order.email || '—'}</td></tr>
      <tr><td style="color:#888;">Address</td><td>${order.address}</td></tr>
      <tr><td style="color:#888;">Payment</td><td>${order.payment}</td></tr>
    </table>
    <div style="font-size:10px;letter-spacing:3px;color:#b8860b;text-transform:uppercase;margin-bottom:12px;">Items</div>
    <table width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr><td style="font-size:15px;font-weight:600;padding:12px 0;border-top:2px solid #0a0a0a;">Total</td><td align="right" style="font-size:15px;font-weight:600;color:#b8860b;padding:12px 0;border-top:2px solid #0a0a0a;">${total}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">Elbnam — Lahore, Pakistan · +92 310 4508143</td></tr>
</table></td></tr></table></body></html>`;

    await resend.emails.send({ from: `Elbnam Orders <${from}>`, to: adminTo, subject: `New Order — ${order.customerName}`, html: adminHtml });

    if (order.email) {
      const customerHtml = buildCustomerHtml(order, itemRows, total, null);
      await resend.emails.send({ from: `Elbnam <${from}>`, to: order.email, subject: 'Order Confirmed — Elbnam', html: customerHtml });
    }
  } catch (err) {
    console.log('Email error (non-fatal):', err.message);
  }
}

async function sendStatusEmail(order, newStatus) {
  if (!process.env.RESEND_API_KEY || !order.email) return;
  const info = STATUS_LABELS[newStatus];
  if (!info) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.FROM_EMAIL || 'orders@elbnam.com';
    const itemsWithImages = await buildItemsWithImages(order.items);
    const itemRows = itemsWithImages.map(itemCardHtml).join('');
    const total = `PKR ${order.total.toLocaleString()}`;
    const html = buildCustomerHtml(order, itemRows, total, info);
    await resend.emails.send({ from: `Elbnam <${from}>`, to: order.email, subject: info.subject, html });
  } catch (err) {
    console.log('Status email error (non-fatal):', err.message);
  }
}

function buildCustomerHtml(order, itemRows, total, statusInfo) {
  const headline = statusInfo ? statusInfo.headline : `Thank you, ${order.customerName}!`;
  const headlineColor = statusInfo ? statusInfo.color : '#0a0a0a';
  const bodyText = statusInfo ? statusInfo.body : 'Your order has been received. Our team will contact you on WhatsApp to confirm delivery details.';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
  <tr><td>${emailLogo()}</td></tr>
  <tr><td style="padding:28px 32px 0;">
    <div style="font-size:20px;font-weight:600;color:${headlineColor};margin-bottom:8px;">${headline}</div>
    <p style="font-size:13px;color:#555;line-height:1.8;margin-bottom:24px;">${bodyText}</p>
    <div style="font-size:10px;letter-spacing:3px;color:#b8860b;text-transform:uppercase;margin-bottom:12px;">Your Order</div>
    <table width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr><td style="font-size:15px;font-weight:600;padding:12px 0;border-top:2px solid #0a0a0a;">Total</td><td align="right" style="font-size:15px;font-weight:600;color:#b8860b;padding:12px 0;border-top:2px solid #0a0a0a;">${total}</td></tr>
    </table>
    <table width="100%" cellpadding="8" cellspacing="0" style="background:#f8f8f8;border:1px solid #eee;margin-top:20px;font-size:13px;">
      <tr><td style="color:#888;width:30%;">Delivery to</td><td>${order.address}</td></tr>
      <tr><td style="color:#888;">Payment</td><td>${order.payment}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:28px 32px;text-align:center;">
    <a href="https://wa.me/923104508143" style="display:inline-block;background:#b8860b;color:#ffffff;padding:12px 28px;font-size:11px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;">WhatsApp Us</a>
  </td></tr>
  <tr><td style="padding:16px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;">Elbnam — Lahore, Pakistan · +92 310 4508143</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendWhatsApp(phone, message) {
  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from) return;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:+92${phone.replace(/^0/,'')}`, Body: message });
  await fetch(url, { method:'POST', headers:{ Authorization:'Basic '+Buffer.from(`${sid}:${auth}`).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded' }, body }).catch(e => console.log('WhatsApp error:',e.message));
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
            return res.status(400).json({ success: false, error: `Only ${available} unit(s) of "${item.name}" in size ${item.size} are available.` });
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

router.post('/import', async (req, res) => {
  const rows = req.body.orders || [];
  const results = { created: 0, updated: 0, skipped: 0, errors: [] };
  for (const row of rows) {
    try {
      const { externalId, customerName, phone, email, address, total, payment } = row;
      const status = row.status || 'Pending';
      const isCancelled = status === 'Cancelled';
      if (!customerName || !phone) { results.errors.push(`Row "${externalId||'?'}": Missing Customer Name or Phone`); continue; }
      const parsedItems = parseItems(row.items);
      for (const item of parsedItems) {
        if (item.name) {
          const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const product = await Product.findOne({ name: new RegExp(`^${escaped}$`, 'i') }).catch(() => null);
          if (product) item.productId = product._id.toString();
        }
      }
      if (externalId) {
        const existing = await Order.findOne({ externalId });
        if (existing) {
          if (existing.status === status) { results.skipped++; continue; }
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
      const order = new Order({ externalId: externalId || undefined, customerName, phone, email: email||'', address, items: parsedItems, total: parseFloat(total)||0, payment: payment||'COD', status });
      await order.save();
      if (!isCancelled) await deductStock(parsedItems);
      results.created++;
    } catch (err) {
      results.errors.push(`Row "${row.externalId||'?'}": ${err.message}`);
    }
  }
  res.json({ success: true, ...results });
});

router.put('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const newStatus = req.body.status;
    if (newStatus === 'Cancelled' && order.status !== 'Cancelled') {
      await restoreStock(order.items);
    } else if (newStatus && newStatus !== 'Cancelled' && order.status === 'Cancelled') {
      await deductStock(order.items);
    }
    const updated = await Order.findByIdAndUpdate(req.params.id, { status: newStatus }, { new: true });
    // Send status notification email + WhatsApp
    sendStatusEmail(updated, newStatus);
    if (updated.phone) {
      const statusMsgs = {
        Confirmed:  `✅ *Elbnam* — Your order has been *Confirmed*! We'll dispatch it soon.\n\nOrder Total: PKR ${updated.total.toLocaleString()}\nDelivery: ${updated.address}\n\nQuestions? Reply here or WhatsApp us: +92 310 4508143`,
        Delivered:  `🎉 *Elbnam* — Your order has been *Delivered*! We hope you love it.\n\nThank you for shopping with Elbnam. 💛`,
        Cancelled:  `❌ *Elbnam* — Your order has been *Cancelled*.\n\nIf you have questions, WhatsApp us: +92 310 4508143`,
        Processing: `⏳ *Elbnam* — Your order is now being *Processed*. We'll update you shortly.`,
      };
      if (statusMsgs[newStatus]) sendWhatsApp(updated.phone, statusMsgs[newStatus]);
    }
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
