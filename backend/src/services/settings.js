const db = require('../db');

const DEFAULTS = {
  store_name: 'Harum Market',
  store_tagline: 'Es & makanan segar, tinggal pesan',
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
  cash_enabled: '1',
  // Ongkir: 'flat' (tarif tetap) atau 'distance' (berdasarkan jarak tempuh di peta)
  shipping_mode: 'flat',
  store_lat: '',
  store_lng: '',
  shipping_base_fee: '8000',
  shipping_base_km: '2',
  shipping_per_km: '2500',
  shipping_max_km: '15',
};

const NUMERIC = ['delivery_fee', 'free_delivery_min', 'min_order', 'payment_expiry_minutes', 'shipping_base_fee', 'shipping_base_km', 'shipping_per_km', 'shipping_max_km'];
const COORD = ['store_lat', 'store_lng'];
const BOOL = ['is_open', 'delivery_enabled', 'pickup_enabled', 'cash_enabled'];

function all() {
  const rows = db.get().prepare('SELECT key, value FROM settings').all();
  const raw = { ...DEFAULTS };
  for (const r of rows) raw[r.key] = r.value;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (NUMERIC.includes(k)) out[k] = Number(v) || 0;
    else if (COORD.includes(k)) out[k] = v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
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
    if (k === 'shipping_mode' && !['flat', 'distance'].includes(v)) continue;
    const value = COORD.includes(k) && (v === null || v === undefined) ? '' : BOOL.includes(k) ? (v === true || v === '1' || v === 'true' || v === 1 ? '1' : '0') : String(v ?? '');
    stmt.run(k, value);
  }
  return all();
}

/** Data toko untuk aplikasi pelanggan. */
function publicSettings(s = all()) {
  return { ...s, store_location_set: s.store_lat !== null && s.store_lng !== null };
}

module.exports = { all, update, publicSettings, DEFAULTS };
