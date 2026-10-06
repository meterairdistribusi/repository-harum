const db = require('../db');

const DEFAULTS = {
  store_name: 'Harum Group',
  store_tagline: 'Segar dari hulu hingga hilir',
  store_phone: '081234567890',
  store_address: 'Jl. Contoh No. 1, Indonesia',
  opening_hours: '07.00 - 21.00',
  is_open: '1',
  delivery_enabled: '1',
  pickup_enabled: '1',
  delivery_fee: '10000',
  free_delivery_min: '150000',
  min_order: '10000',
  payment_expiry_minutes: '60',
};

const NUMERIC = ['delivery_fee', 'free_delivery_min', 'min_order', 'payment_expiry_minutes'];
const BOOL = ['is_open', 'delivery_enabled', 'pickup_enabled'];

function all() {
  const rows = db.get().prepare('SELECT key, value FROM settings').all();
  const raw = { ...DEFAULTS };
  for (const r of rows) raw[r.key] = r.value;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (NUMERIC.includes(k)) out[k] = Number(v) || 0;
    else if (BOOL.includes(k)) out[k] = v === '1' || v === 'true';
    else out[k] = v;
  }
  return out;
}

function update(values) {
  const stmt = db.get().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS)) continue;
    const value = BOOL.includes(k) ? (v === true || v === '1' || v === 'true' || v === 1 ? '1' : '0') : String(v ?? '');
    stmt.run(k, value);
  }
  return all();
}

/** Ongkir: gratis bila subtotal >= batas gratis ongkir. */
function deliveryFee(subtotal, method, s = all()) {
  if (method !== 'delivery') return 0;
  if (s.free_delivery_min > 0 && subtotal >= s.free_delivery_min) return 0;
  return s.delivery_fee;
}

module.exports = { all, update, deliveryFee, DEFAULTS };
