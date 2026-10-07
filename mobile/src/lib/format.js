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

export const PAYMENT_METHOD = { qris: 'QRIS', bank_transfer: 'Transfer Bank', ewallet: 'E-Wallet', cash: 'Tunai' };

/** "QRIS", "Tunai" atau "Transfer Bank · BCA" */
export function payLabel(o) {
  if (o.payment_method === 'qris' || o.payment_method === 'cash') return PAYMENT_METHOD[o.payment_method];
  return `${PAYMENT_METHOD[o.payment_method]} · ${o.payment_channel.toUpperCase()}`;
}

/** 5.3 -> "5,3 km" */
export const km = (n) => `${String(n).replace('.', ',')} km`;
