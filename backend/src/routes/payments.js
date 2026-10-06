const express = require('express');
const QRCode = require('qrcode');
const orders = require('../services/orders');
const payment = require('../services/payment');
const settings = require('../services/settings');
const { HttpError, asyncHandler, rupiah } = require('../utils');

// ================================================================ webhook (API)
const api = express.Router();

/** Notifikasi HTTP dari Midtrans. Set URL ini di dashboard Midtrans: {PUBLIC_URL}/api/payments/midtrans/notification */
api.post(
  '/midtrans/notification',
  asyncHandler(async (req, res) => {
    const n = req.body || {};
    if (!payment.midtrans.verifySignature(n)) throw new HttpError(403, 'Signature tidak valid');
    const order = orders.findByCode(n.order_id);
    if (!order) return res.json({ ok: true, ignored: true });
    if (Number(n.gross_amount) !== order.total) throw new HttpError(400, 'Nominal tidak cocok');
    orders.applyPaymentState(order, payment.mapMidtransStatus(n));
    res.json({ ok: true });
  })
);

// ================================================================ halaman pembayaran (HTML)
const pages = express.Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, body) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--brand:#0284C7;--brand-dark:#075985;--ok:#16A34A;--ink:#0F172A;--muted:#64748B;--bg:#F0F9FF;--card:#fff;--line:#E2E8F0}
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);font-size:17px}
  .wrap{max-width:440px;margin:0 auto;padding:20px 16px 40px}
  .card{background:var(--card);border-radius:20px;padding:20px;box-shadow:0 4px 20px rgba(2,132,199,.08);margin-bottom:16px}
  h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted);font-size:15px}
  .total{font-size:32px;font-weight:800;color:var(--brand-dark);margin:8px 0}
  .qr{display:block;margin:12px auto;width:100%;max-width:260px;border-radius:12px;border:1px solid var(--line)}
  .va{font-size:26px;font-weight:800;letter-spacing:2px;text-align:center;padding:14px;border:2px dashed var(--brand);border-radius:14px;margin:12px 0;background:#F0F9FF}
  .btn{display:block;width:100%;padding:16px;border:0;border-radius:14px;font-size:18px;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;margin-top:10px}
  .btn-primary{background:var(--brand);color:#fff}.btn-ok{background:var(--ok);color:#fff}.btn-ghost{background:#E0F2FE;color:var(--brand-dark)}
  ol{padding-left:20px;line-height:1.6}.badge{display:inline-block;background:#FEF3C7;color:#92400E;border-radius:999px;padding:4px 10px;font-size:13px;font-weight:700}
  .center{text-align:center}.big-icon{font-size:72px}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

const BANK_PREFIX = { bca: '12345', bni: '8808', bri: '26215', mandiri: '89608', permata: '8528' };

function vaNumber(order) {
  const digits = String(order.phone || '').replace(/\D/g, '').slice(-8).padStart(8, '0');
  return (BANK_PREFIX[order.payment_channel] || '9999') + digits + String(order.id).padStart(3, '0').slice(-3);
}

pages.get(
  '/:code',
  asyncHandler(async (req, res) => {
    let order = orders.findByCode(req.params.code);
    if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan');
    if (order.payment_provider !== 'simulator') return res.redirect(order.payment_url || `/pay/${order.code}/finish`);
    order = await orders.refresh(order);
    if (order.status !== 'pending_payment') return res.redirect(`/pay/${order.code}/finish`);

    const store = settings.all();
    const method = payment.METHODS[order.payment_method];
    const channel = method.channels.find((c) => c.code === order.payment_channel);
    let detail = '';
    if (order.payment_method === 'qris') {
      const qr = await QRCode.toDataURL(`SIMULASI-QRIS|${store.store_name}|${order.code}|${order.total}`, { margin: 1, width: 520 });
      detail = `<img class="qr" src="${qr}" alt="QRIS">
        <ol><li>Buka aplikasi m-banking atau e-wallet (GoPay, OVO, DANA, ShopeePay, LinkAja, dll).</li>
        <li>Pilih menu <b>Scan / Bayar QR</b>.</li><li>Scan kode QR di atas dan konfirmasi pembayaran.</li></ol>`;
    } else if (order.payment_method === 'bank_transfer') {
      const va = vaNumber(order);
      detail = `<div class="muted">Nomor ${esc(channel.label)}</div><div class="va" id="va">${va}</div>
        <button class="btn btn-ghost" onclick="navigator.clipboard&&navigator.clipboard.writeText('${va}');this.textContent='✓ Tersalin'">Salin Nomor</button>
        <ol><li>Buka m-banking / ATM ${esc(order.payment_channel.toUpperCase())}.</li><li>Pilih <b>Transfer &gt; Virtual Account</b>.</li>
        <li>Masukkan nomor di atas, pastikan nominal <b>${rupiah(order.total)}</b>, lalu konfirmasi.</li></ol>`;
    } else {
      detail = `<div class="center big-icon">📱</div>
        <p class="center">Anda akan diarahkan ke aplikasi <b>${esc(channel.label)}</b> untuk menyelesaikan pembayaran.</p>`;
    }

    res.send(
      layout(
        'Pembayaran ' + order.code,
        `<div class="card center"><span class="badge">MODE SIMULASI</span>
          <h1 style="margin-top:12px">${esc(method.label)} · ${esc(channel.label)}</h1>
          <div class="muted">Pesanan ${esc(order.code)}</div>
          <div class="total">${rupiah(order.total)}</div>
          <div class="muted">Bayar sebelum <b id="exp"></b></div></div>
        <div class="card">${detail}</div>
        <form method="post" action="/pay/${esc(order.code)}/simulate">
          <button class="btn btn-ok" type="submit">✓ Simulasikan Pembayaran Berhasil</button></form>
        <p class="muted center" style="margin-top:16px">Mode simulasi untuk uji coba — tidak ada uang yang ditarik.<br>Aktifkan Midtrans untuk pembayaran sungguhan.</p>
        <script>document.getElementById('exp').textContent=new Date('${order.payment_expires_at}Z'.replace(' ','T')).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})</script>`
      )
    );
  })
);

pages.post('/:code/simulate', (req, res) => {
  const order = orders.findByCode(req.params.code);
  if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan');
  if (order.payment_provider !== 'simulator') throw new HttpError(403, 'Simulasi hanya untuk mode simulator');
  if (order.status === 'pending_payment') orders.markPaid(order.id, order.payment_ref, 'Pembayaran berhasil (simulasi)');
  res.redirect(`/pay/${order.code}/finish`);
});

/** Halaman akhir. Aplikasi mobile mendeteksi URL ini lalu menutup WebView. */
pages.get(
  '/:code/finish',
  asyncHandler(async (req, res) => {
    let order = orders.findByCode(req.params.code);
    if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan');
    order = await orders.refresh(order);
    const paid = order.payment_status === 'paid';
    res.send(
      layout(
        'Status Pembayaran',
        `<div class="card center"><div class="big-icon">${paid ? '✅' : order.status === 'cancelled' ? '❌' : '⏳'}</div>
          <h1>${paid ? 'Pembayaran Berhasil' : order.status === 'cancelled' ? 'Pesanan Dibatalkan' : 'Menunggu Pembayaran'}</h1>
          <div class="muted">${esc(order.code)}</div><div class="total">${rupiah(order.total)}</div>
          <p class="muted">Silakan kembali ke aplikasi Harum Group.</p></div>`
      )
    );
  })
);

module.exports = { api, pages };
