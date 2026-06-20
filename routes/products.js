const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Product = require('../models/Product');
const dotenv = require('dotenv');
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

async function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'libas-co' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    ).end(buffer);
  });
}

router.get('/', async (req, res) => {
  try {
    const products = await Product.find().sort({ position: 1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.array('images', 5), async (req, res) => {
  try {
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.buffer);
        imageUrls.push(url);
      }
    }
    const sizes = req.body.sizes ? req.body.sizes.split(',').map(s => s.trim()).filter(Boolean) : [];
    let sizeStock = {};
    if (req.body.sizeStock) {
      try { sizeStock = JSON.parse(req.body.sizeStock); } catch(e) {}
    }
    const stockValues = Object.values(sizeStock);
    const inStock = stockValues.length === 0 || stockValues.some(v => v > 0);
    const product = new Product({
      name: req.body.name,
      category: req.body.category,
      subcategory: req.body.subcategory || '',
      price: req.body.price,
      originalPrice: req.body.originalPrice || undefined,
      image: imageUrls[0] || '',
      images: imageUrls,
      label: req.body.label || '',
      sizes,
      sizeStock,
      inStock
    });
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', upload.array('images', 5), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    let imageUrls = product.images && product.images.length ? product.images : (product.image ? [product.image] : []);
    if (req.files && req.files.length > 0) {
      imageUrls = [];
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.buffer);
        imageUrls.push(url);
      }
    }
    const sizes = req.body.sizes ? req.body.sizes.split(',').map(s => s.trim()).filter(Boolean) : product.sizes;
    let sizeStock = product.sizeStock ? Object.fromEntries(product.sizeStock) : {};
    if (req.body.sizeStock) {
      try { sizeStock = JSON.parse(req.body.sizeStock); } catch(e) {}
    }
    const stockValues = Object.values(sizeStock);
    const inStock = stockValues.length === 0 ? product.inStock : stockValues.some(v => v > 0);
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name: req.body.name || product.name,
        category: req.body.category || product.category,
        subcategory: req.body.subcategory || product.subcategory,
        price: req.body.price || product.price,
        originalPrice: req.body.originalPrice || product.originalPrice,
        image: imageUrls[0] || product.image,
        images: imageUrls,
        label: req.body.label !== undefined ? req.body.label : product.label,
        sizes,
        sizeStock,
        inStock
      },
      { new: true }
    );
    res.json({ success: true, product: updatedProduct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert by name — supports inventory CSV import
router.post('/import', async (req, res) => {
  try {
    const { name, category, subcategory, price, originalPrice, sizes, label, available } = req.body;
    if (!name || !price) return res.json({ success: false, message: 'Name and price required' });

    const sizeList = Array.isArray(sizes)
      ? sizes
      : (sizes ? String(sizes).split(',').map(s => s.trim()).filter(Boolean) : []);

    const totalAvailable = parseInt(available) || 0;
    const sizeStock = {};
    if (sizeList.length > 0) {
      const perSize = Math.floor(totalAvailable / sizeList.length);
      const remainder = totalAvailable % sizeList.length;
      sizeList.forEach((s, i) => { sizeStock[s] = perSize + (i === 0 ? remainder : 0); });
    }
    const inStock = Object.values(sizeStock).some(v => v > 0) || (sizeList.length === 0 && totalAvailable > 0);

    // Upsert: find existing product by exact name (case-insensitive)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Product.findOne({ name: new RegExp(`^${escaped}$`, 'i') });

    if (existing) {
      const updatedProduct = await Product.findByIdAndUpdate(
        existing._id,
        {
          category: category ? category.toLowerCase() : existing.category,
          subcategory: subcategory || existing.subcategory,
          price: Number(price),
          originalPrice: originalPrice ? Number(originalPrice) : existing.originalPrice,
          label: label !== undefined ? label : existing.label,
          sizes: sizeList.length ? sizeList : existing.sizes,
          sizeStock: sizeList.length ? sizeStock : Object.fromEntries(existing.sizeStock || new Map()),
          inStock
        },
        { new: true }
      );
      return res.json({ success: true, updated: true, product: updatedProduct });
    }

    // Create new (no image — must be added via Edit)
    const product = new Product({
      name,
      category: category ? category.toLowerCase() : 'mens',
      subcategory: subcategory || '',
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : undefined,
      image: '', images: [],
      label: label || '',
      sizes: sizeList,
      sizeStock,
      inStock
    });
    await product.save();
    res.json({ success: true, updated: false, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/reorder', async (req, res) => {
  try {
    const { order } = req.body;
    for (const item of order) {
      await Product.findByIdAndUpdate(item.id, { position: item.position });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
