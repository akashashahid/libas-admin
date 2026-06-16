const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');

// GET all orders
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new order — validates stock, saves order, then deducts stock
router.post('/', async (req, res) => {
  try {
    const items = req.body.items || [];

    // Validate stock for all items first
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

    // Deduct stock after successful order save
    for (const item of items) {
      if (item.productId && item.size && item.qty) {
        const product = await Product.findById(item.productId);
        if (product && product.sizeStock) {
          const current = product.sizeStock.get(item.size) ?? 0;
          product.sizeStock.set(item.size, Math.max(0, current - item.qty));
          // Recompute inStock: true if any size still has stock
          const anyInStock = product.sizes.some(s => (product.sizeStock.get(s) ?? 0) > 0);
          product.inStock = anyInStock;
          await product.save();
        }
      }
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update order status
router.put('/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE order
router.delete('/:id', async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
