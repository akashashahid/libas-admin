const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  externalId: { type: String, default: null },
  customerName: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  email: { type: String, default: '' },
  items: [{
    productId: String,
    name: String,
    category: String,
    size: String,
    qty: Number,
    price: Number
  }],
  total: { type: Number, required: true },
  payment: { type: String, default: 'COD' },
  status: { type: String, enum: ['Pending', 'Confirmed', 'Delivered', 'Cancelled'], default: 'Pending' }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
