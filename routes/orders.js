const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');

router.get('/', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — validate stock for all items first, then save order and decrement
router.post('/', async (req, res) => {
  try {
    const items = req.body.items || [];
    // Step 1: validate all stock before touching anything
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
    // Step 2: save order
    const order = new Order(req.body);
    await order.save();
    // Step 3: decrement stock
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
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT — restore stock when order is cancelled
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
