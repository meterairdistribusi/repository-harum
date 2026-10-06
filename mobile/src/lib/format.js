export const rupiah = (n) => 'Rp' + Math.round(Number(n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-10-06 13:58:54" (UTC dari server) -> "6 Okt 2026, 20.58" waktu lokal */
export function dateTime(s) {
  if (!s) return '-';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export function parseServerDate(s) {
  return s ? new Date(String(s).replace(' ', 'T') + 'Z') : null;
}

export const PAYMENT_METHOD = { qris: 'QRIS', bank_transfer: 'Transfer Bank', ewallet: 'E-Wallet' };

/** "QRIS" atau "Transfer Bank · BCA" */
export function payLabel(o) {
  return o.payment_method === 'qris' ? 'QRIS' : `${PAYMENT_METHOD[o.payment_method]} · ${o.payment_channel.toUpperCase()}`;
}
