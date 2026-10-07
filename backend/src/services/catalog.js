/**
 * Katalog: Kategori -> Sub menu (produk, maks 4 foto) -> Pilihan opsional
 * (mis. ukuran 1 kg / 5 kg, porsi biasa / jumbo) dengan harga, modal & stok sendiri.
 */
const db = require('../db');
const { absUrl } = require('../media');

const MAX_IMAGES = 4;

function parseImages(p) {
  try {
    const arr = JSON.parse(p.images || '[]');
    if (Array.isArray(arr) && arr.length) return arr.filter(Boolean).slice(0, MAX_IMAGES);
  } catch {}
  return p.image_url ? [p.image_url] : [];
}

/** Ambil pilihan untuk banyak produk sekaligus: Map(product_id -> [variant]). */
function variantsFor(productIds, { includeInactive = false } = {}) {
  const map = new Map();
  if (!productIds.length) return map;
  const rows = db
    .get()
    .prepare(
      `SELECT * FROM product_variants WHERE product_id IN (${productIds.map(() => '?').join(',')})
       ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY sort_order, id`
    )
    .all(...productIds)
    .map(db.plain);
  for (const v of rows) {
    if (!map.has(v.product_id)) map.set(v.product_id, []);
    map.get(v.product_id).push({ ...v, is_active: !!v.is_active });
  }
  return map;
}

/**
 * Bentuk data produk untuk API.
 * admin=false: harga modal disembunyikan (rahasia toko).
 */
function shape(req, p, variants = [], { admin = false } = {}) {
  const images = parseImages(p);
  const active = variants.filter((v) => v.is_active);
  const priced = active.length ? active : null;
  const out = {
    ...p,
    images: images.map((u) => absUrl(req, u)),
    image_url: absUrl(req, images[0] || ''),
    ...(p.category_image !== undefined ? { category_image: absUrl(req, p.category_image) } : {}),
    is_active: !!p.is_active,
    is_featured: !!p.is_featured,
    has_variants: !!priced,
    price: priced ? Math.min(...priced.map((v) => v.price)) : p.price,
    price_max: priced ? Math.max(...priced.map((v) => v.price)) : p.price,
    stock: priced ? priced.reduce((a, v) => a + v.stock, 0) : p.stock,
    variants: (admin ? variants : active).map((v) => (admin ? v : stripCost(v))),
  };
  if (admin) out.image_paths = images;
  else delete out.cost_price;
  return out;
}

// eslint-disable-next-line no-unused-vars
const stripCost = ({ cost_price, ...rest }) => rest;

module.exports = { MAX_IMAGES, parseImages, variantsFor, shape };
