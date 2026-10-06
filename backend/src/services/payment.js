/**
 * Abstraksi payment gateway.
 *
 *  - simulator : mode demo. Backend menampilkan halaman pembayaran sendiri (QRIS / nomor VA /
 *                e-wallet) dengan tombol "Simulasikan bayar". Tidak ada uang sungguhan.
 *  - midtrans  : Midtrans Snap. Mendukung QRIS, Virtual Account (BCA, BNI, BRI, Mandiri, Permata),
 *                GoPay & ShopeePay. Status dikonfirmasi lewat webhook + cek status API.
 */
const crypto = require('node:crypto');
const config = require('../config');
const { HttpError, sqlDate } = require('../utils');

const METHODS = {
  qris: {
    label: 'QRIS',
    description: 'Scan pakai aplikasi bank atau e-wallet apa saja',
    channels: [{ code: 'qris', label: 'QRIS (semua bank & e-wallet)' }],
  },
  bank_transfer: {
    label: 'Transfer Bank',
    description: 'Transfer lewat Virtual Account',
    channels: [
      { code: 'bca', label: 'BCA Virtual Account' },
      { code: 'bni', label: 'BNI Virtual Account' },
      { code: 'bri', label: 'BRI Virtual Account' },
      { code: 'mandiri', label: 'Mandiri Bill Payment' },
      { code: 'permata', label: 'Permata Virtual Account' },
    ],
  },
  ewallet: {
    label: 'E-Wallet',
    description: 'Bayar langsung dari dompet digital',
    channels: [
      { code: 'gopay', label: 'GoPay' },
      { code: 'shopeepay', label: 'ShopeePay' },
    ],
  },
};

function validateMethod(method, channel) {
  const m = METHODS[method];
  if (!m) throw new HttpError(400, 'Metode pembayaran tidak dikenal');
  const ch = channel || m.channels[0].code;
  if (!m.channels.some((c) => c.code === ch)) throw new HttpError(400, 'Channel pembayaran tidak dikenal');
  return ch;
}

function expiryDate(minutes) {
  return sqlDate(new Date(Date.now() + minutes * 60 * 1000));
}

// ---------------------------------------------------------------- simulator
const simulator = {
  name: 'simulator',
  async create(order, { expiryMinutes }) {
    return {
      provider: 'simulator',
      ref: 'SIM-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      url: `${config.publicUrl}/pay/${order.code}`,
      expires_at: expiryDate(expiryMinutes),
    };
  },
  async status() {
    return null; // status hanya berubah lewat tombol simulasi
  },
};

// ---------------------------------------------------------------- midtrans
const MIDTRANS_ENABLED = {
  qris: ['other_qris'],
  bca: ['bca_va'],
  bni: ['bni_va'],
  bri: ['bri_va'],
  mandiri: ['echannel'],
  permata: ['permata_va'],
  gopay: ['gopay'],
  shopeepay: ['shopeepay'],
};

function midtransBase(kind) {
  const prod = config.payment.midtrans.isProduction;
  if (kind === 'snap') return prod ? 'https://app.midtrans.com/snap/v1' : 'https://app.sandbox.midtrans.com/snap/v1';
  return prod ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
}

function midtransAuth() {
  return 'Basic ' + Buffer.from(config.payment.midtrans.serverKey + ':').toString('base64');
}

const midtrans = {
  name: 'midtrans',
  async create(order, { items, customer, expiryMinutes }) {
    if (!config.payment.midtrans.serverKey) throw new HttpError(500, 'MIDTRANS_SERVER_KEY belum diisi');
    const item_details = items.map((i) => ({
      id: String(i.product_id ?? i.name).slice(0, 50),
      name: i.name.slice(0, 50),
      price: i.price,
      quantity: i.quantity,
    }));
    if (order.delivery_fee > 0) item_details.push({ id: 'ONGKIR', name: 'Ongkos Kirim', price: order.delivery_fee, quantity: 1 });

    const body = {
      transaction_details: { order_id: order.code, gross_amount: order.total },
      item_details,
      customer_details: { first_name: customer.name, phone: customer.phone || undefined, email: customer.email || undefined },
      enabled_payments: MIDTRANS_ENABLED[order.payment_channel],
      expiry: { unit: 'minutes', duration: expiryMinutes },
      callbacks: { finish: `${config.publicUrl}/pay/${order.code}/finish` },
    };
    const res = await fetch(`${midtransBase('snap')}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: midtransAuth() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(502, 'Gagal membuat pembayaran: ' + (data.error_messages || [res.statusText]).join(', '));
    }
    return { provider: 'midtrans', ref: data.token, url: data.redirect_url, expires_at: expiryDate(expiryMinutes) };
  },

  /** Ambil status terbaru langsung dari Midtrans (fallback bila webhook belum masuk). */
  async status(order) {
    if (!config.payment.midtrans.serverKey) return null;
    const res = await fetch(`${midtransBase('api')}/${encodeURIComponent(order.code)}/status`, {
      headers: { Accept: 'application/json', Authorization: midtransAuth() },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || String(data.status_code) === '404') return null;
    return mapMidtransStatus(data);
  },

  verifySignature(n) {
    const expected = crypto
      .createHash('sha512')
      .update(`${n.order_id}${n.status_code}${n.gross_amount}${config.payment.midtrans.serverKey}`)
      .digest('hex');
    const given = String(n.signature_key || '');
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  },
};

/** Terjemahkan transaction_status Midtrans -> paid | pending | expired | failed */
function mapMidtransStatus(n) {
  const s = n.transaction_status;
  if (s === 'settlement' || (s === 'capture' && (n.fraud_status ?? 'accept') === 'accept')) return { state: 'paid', ref: n.transaction_id };
  if (s === 'expire') return { state: 'expired' };
  if (s === 'cancel' || s === 'deny' || s === 'failure') return { state: 'failed' };
  if (s === 'refund' || s === 'partial_refund') return { state: 'refunded' };
  return { state: 'pending' };
}

function provider(name = config.payment.provider) {
  return name === 'midtrans' ? midtrans : simulator;
}

module.exports = { METHODS, validateMethod, provider, midtrans, simulator, mapMidtransStatus };
