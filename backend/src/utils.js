class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (err) {
    next(err);
  }
};

/** Validasi field wajib sederhana. */
function required(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
  if (missing.length) throw new HttpError(400, `Data belum lengkap: ${missing.join(', ')}`, { missing });
}

function toInt(v, def = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
}

function normalizePhone(phone) {
  if (!phone) return phone;
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+62')) p = '0' + p.slice(3);
  else if (p.startsWith('62')) p = '0' + p.slice(2);
  return p;
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-');
}

function rupiah(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function orderCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `HRM-${ymd}-${rand}`;
}

/** Format datetime SQLite (UTC, "YYYY-MM-DD HH:MM:SS"). */
function sqlDate(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { HttpError, asyncHandler, required, toInt, toBool, normalizePhone, slugify, rupiah, orderCode, sqlDate };
