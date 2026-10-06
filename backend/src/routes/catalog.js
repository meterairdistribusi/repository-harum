const express = require('express');
const db = require('../db');
const settings = require('../services/settings');
const payment = require('../services/payment');
const { HttpError, toInt } = require('../utils');
const { absUrl } = require('../media');

const router = express.Router();

// cost_price (harga modal) rahasia toko — tidak dikirim ke pelanggan
const productOut = (req) => ({ cost_price, ...p }) => ({ ...p, image_url: absUrl(req, p.image_url), is_active: !!p.is_active, is_featured: !!p.is_featured });

router.get('/categories', (req, res) => {
  const rows = db
    .get()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
       FROM categories c ORDER BY c.sort_order, c.id`
    )
    .all()
    .map(db.plain);
  res.json({ data: rows });
});

router.get('/products', (req, res) => {
  const where = ['p.is_active = 1'];
  const params = [];
  if (req.query.category) {
    where.push('(c.slug = ? OR c.id = ?)');
    params.push(String(req.query.category), toInt(req.query.category, -1));
  }
  if (req.query.q) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.query.featured === '1' || req.query.featured === 'true') where.push('p.is_featured = 1');
  const rows = db
    .get()
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon, c.color AS category_color
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE ${where.join(' AND ')} ORDER BY p.is_featured DESC, p.name`
    )
    .all(...params)
    .map(db.plain)
    .map(productOut(req));
  res.json({ data: rows });
});

router.get('/products/:id', (req, res) => {
  const p = db.plain(
    db
      .get()
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon, c.color AS category_color
         FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.is_active = 1`
      )
      .get(toInt(req.params.id))
  );
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
  res.json({ data: productOut(req)(p) });
});

router.get('/banners', (req, res) => {
  const rows = db
    .get()
    .prepare('SELECT * FROM banners WHERE is_active = 1 ORDER BY sort_order, id')
    .all()
    .map(db.plain)
    .map((b) => ({ ...b, image_url: absUrl(req, b.image_url) }));
  res.json({ data: rows });
});

router.get('/store', (_req, res) => {
  const s = settings.all();
  res.json({
    data: {
      ...settings.publicSettings(s),
      shipping_mode: s.shipping_mode === 'distance' && s.store_lat !== null ? 'distance' : 'flat',
      payment_methods: payment.enabledMethods(s),
    },
  });
});

module.exports = router;
