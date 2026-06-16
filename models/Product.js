const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, enum: ['mens', 'kids', 'festive'], required: true },
  subcategory: { type: String, default: '' },
  price: { type: Number, required: true },
  originalPrice: { type: Number },
  image: { type: String },
  images: [String],
  label: { type: String, enum: ['New', 'Sale', 'Hot', ''], default: '' },
  sizes: [String],
  sizeStock: { type: Map, of: Number, default: {} },
  position: { type: Number, default: 0 },
  inStock: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);