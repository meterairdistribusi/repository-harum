/**
 * Laporan untuk diunduh dari panel admin, dalam format Excel (.xlsx) atau PDF.
 *
 * Jenis laporan:
 *  - laba-rugi : per bulan — omzet, modal (HPP), laba kotor, biaya operasional, laba bersih
 *  - penjualan : daftar pesanan
 *  - produk    : penjualan per sub menu / pilihan
 *  - biaya     : daftar biaya operasional + total per jenis
 *  - lengkap   : semua di atas dalam satu file
 */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../db');
const settings = require('./settings');
const { HttpError } = require('../utils');

const SALE = `('paid','processing','shipping','ready_pickup','completed')`;
const TYPES = {
  'laba-rugi': 'Laporan Laba Rugi',
  penjualan: 'Laporan Penjualan',
  produk: 'Laporan Penjualan per Produk',
  biaya: 'Laporan Biaya Operasional',
  lengkap: 'Laporan Lengkap',
};
const STATUS = {
  pending_payment: 'Menunggu Pembayaran',
  paid: 'Dibayar',
  processing: 'Disiapkan',
  shipping: 'Diantar',
  ready_pickup: 'Siap Diambil',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};
const PAY = { qris: 'QRIS', bank_transfer: 'Transfer Bank', ewallet: 'E-Wallet', cash: 'Tunai' };
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const rp = (n) => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const pct = (x) => (x === null || !Number.isFinite(x) ? '-' : (x * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** Validasi & normalisasi rentang tanggal (default: awal bulan ini s/d hari ini). */
function range(q) {
  const today = new Date().toLocaleDateString('sv-SE');
  const from = isDate(q.from) ? q.from : today.slice(0, 8) + '01';
  const to = isDate(q.to) ? q.to : today;
  if (from > to) throw new HttpError(400, 'Tanggal awal harus sebelum tanggal akhir');
  return { from, to };
}

// ------------------------------------------------------------------ data
function profitLoss({ from, to }) {
  const d = db.get();
  const sales = d
    .prepare(
      `SELECT strftime('%Y-%m', o.created_at, 'localtime') AS ym, COUNT(DISTINCT o.id) AS orders,
              COALESCE(SUM(i.subtotal),0) AS revenue, COALESCE(SUM(i.cost_price * i.quantity),0) AS cost
       FROM orders o JOIN order_items i ON i.order_id = o.id
       WHERE o.status IN ${SALE} AND date(o.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY ym`
    )
    .all(from, to)
    .map(db.plain);
  const exp = d
    .prepare(`SELECT substr(date, 1, 7) AS ym, SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY ym`)
    .all(from, to)
    .map(db.plain);
  const months = [...new Set([...sales.map((r) => r.ym), ...exp.map((r) => r.ym)])].sort();
  const rows = months.map((ym) => {
    const s = sales.find((r) => r.ym === ym) || { orders: 0, revenue: 0, cost: 0 };
    const expenses = exp.find((r) => r.ym === ym)?.total || 0;
    const gross = s.revenue - s.cost;
    const net = gross - expenses;
    const [y, m] = ym.split('-').map(Number);
    return { period: `${MONTHS[m - 1]} ${y}`, orders: s.orders, revenue: s.revenue, cost: s.cost, gross, expenses, net, margin: s.cost + expenses ? net / (s.cost + expenses) : null };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const total = { period: 'TOTAL', orders: sum('orders'), revenue: sum('revenue'), cost: sum('cost'), gross: sum('gross'), expenses: sum('expenses'), net: sum('net') };
  total.margin = total.cost + total.expenses ? total.net / (total.cost + total.expenses) : null;
  return { rows, total };
}

function salesList({ from, to }) {
  const rows = db
    .get()
    .prepare(
      `SELECT o.*, u.name AS customer_name, datetime(o.created_at, 'localtime') AS local_time,
              (SELECT group_concat(i.quantity || 'x ' || i.name, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_text
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE date(o.created_at, 'localtime') BETWEEN ? AND ? ORDER BY o.created_at`
    )
    .all(from, to)
    .map(db.plain);
  const valid = rows.filter((o) => SALE.includes(`'${o.status}'`));
  return {
    rows,
    total: { count: valid.length, subtotal: valid.reduce((a, o) => a + o.subtotal, 0), delivery: valid.reduce((a, o) => a + o.delivery_fee, 0), total: valid.reduce((a, o) => a + o.total, 0) },
  };
}

function productSales({ from, to }) {
  const rows = db
    .get()
    .prepare(
      `SELECT i.name, SUM(i.quantity) AS qty, i.unit, SUM(i.subtotal) AS revenue, SUM(i.cost_price * i.quantity) AS cost
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status IN ${SALE} AND date(o.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY i.name, i.unit ORDER BY revenue DESC`
    )
    .all(from, to)
    .map(db.plain)
    .map((r) => ({ ...r, gross: r.revenue - r.cost }));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { rows, total: { qty: sum('qty'), revenue: sum('revenue'), cost: sum('cost'), gross: sum('gross') } };
}

function expenseList({ from, to }) {
  const d = db.get();
  const rows = d.prepare('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date, id').all(from, to).map(db.plain);
  const byCategory = d
    .prepare('SELECT category, SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC')
    .all(from, to)
    .map(db.plain);
  return { rows, byCategory, total: rows.reduce((a, r) => a + r.amount, 0) };
}

/** Kumpulkan semua bagian laporan sesuai jenisnya. */
function build(type, query) {
  if (!TYPES[type]) throw new HttpError(400, 'Jenis laporan tidak dikenal');
  const r = range(query);
  const want = (t) => type === t || type === 'lengkap';
  return {
    type,
    title: TYPES[type],
    store: settings.all().store_name,
    from: r.from,
    to: r.to,
    printedAt: new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' }),
    profitLoss: want('laba-rugi') ? profitLoss(r) : null,
    sales: want('penjualan') ? salesList(r) : null,
    products: want('produk') ? productSales(r) : null,
    expenses: want('biaya') ? expenseList(r) : null,
  };
}

// ------------------------------------------------------------------ tabel bersama
/** Definisi tabel per bagian: { title, columns: [{header, key, width, money, pct, align}], rows, total } */
function sections(rep) {
  const out = [];
  if (rep.profitLoss) {
    out.push({
      title: 'Laba Rugi per Bulan',
      note: 'Laba bersih = omzet - modal (HPP) - biaya operasional. Omzet tidak termasuk ongkos kirim.',
      columns: [
        { header: 'Periode', key: 'period', width: 16 },
        { header: 'Pesanan', key: 'orders', width: 9, align: 'right' },
        { header: 'Omzet', key: 'revenue', width: 15, money: true },
        { header: 'Modal (HPP)', key: 'cost', width: 15, money: true },
        { header: 'Laba Kotor', key: 'gross', width: 15, money: true },
        { header: 'Biaya Operasional', key: 'expenses', width: 17, money: true },
        { header: 'Laba Bersih', key: 'net', width: 15, money: true },
        { header: 'Margin*', key: 'margin', width: 9, pct: true },
      ],
      rows: rep.profitLoss.rows,
      total: rep.profitLoss.total,
      footnote: '*Margin = laba bersih / (modal + biaya operasional)',
    });
  }
  if (rep.sales) {
    out.push({
      title: 'Daftar Pesanan',
      columns: [
        { header: 'Waktu', key: 'local_time', width: 17 },
        { header: 'Kode', key: 'code', width: 20 },
        { header: 'Pelanggan', key: 'recipient', width: 18 },
        { header: 'Isi Pesanan', key: 'items_text', width: 34 },
        { header: 'Bayar', key: 'pay', width: 12 },
        { header: 'Status', key: 'status_label', width: 15 },
        { header: 'Subtotal', key: 'subtotal', width: 13, money: true },
        { header: 'Ongkir', key: 'delivery_fee', width: 11, money: true },
        { header: 'Total', key: 'total', width: 13, money: true },
      ],
      rows: rep.sales.rows.map((o) => ({ ...o, recipient: o.recipient || o.customer_name, pay: PAY[o.payment_method] || o.payment_method, status_label: STATUS[o.status] || o.status })),
      total: { local_time: `TOTAL (${rep.sales.total.count} pesanan valid)`, subtotal: rep.sales.total.subtotal, delivery_fee: rep.sales.total.delivery, total: rep.sales.total.total },
      footnote: 'Total hanya menghitung pesanan yang sudah dibayar / diproses (tidak termasuk dibatalkan & menunggu bayar).',
    });
  }
  if (rep.products) {
    out.push({
      title: 'Penjualan per Produk',
      columns: [
        { header: 'Produk / Pilihan', key: 'name', width: 34 },
        { header: 'Terjual', key: 'qty', width: 9, align: 'right' },
        { header: 'Satuan', key: 'unit', width: 9 },
        { header: 'Omzet', key: 'revenue', width: 15, money: true },
        { header: 'Modal (HPP)', key: 'cost', width: 15, money: true },
        { header: 'Laba Kotor', key: 'gross', width: 15, money: true },
      ],
      rows: rep.products.rows,
      total: { name: 'TOTAL', ...rep.products.total },
    });
  }
  if (rep.expenses) {
    out.push({
      title: 'Biaya Operasional',
      columns: [
        { header: 'Tanggal', key: 'date', width: 12 },
        { header: 'Jenis Biaya', key: 'category', width: 22 },
        { header: 'Keterangan', key: 'description', width: 34 },
        { header: 'Nominal', key: 'amount', width: 15, money: true },
      ],
      rows: rep.expenses.rows,
      total: { date: 'TOTAL', amount: rep.expenses.total },
    });
    out.push({
      title: 'Biaya Operasional per Jenis',
      columns: [
        { header: 'Jenis Biaya', key: 'category', width: 26 },
        { header: 'Total', key: 'total', width: 15, money: true },
        { header: 'Porsi', key: 'share', width: 10, pct: true },
      ],
      rows: rep.expenses.byCategory.map((c) => ({ ...c, share: rep.expenses.total ? c.total / rep.expenses.total : null })),
      total: { category: 'TOTAL', total: rep.expenses.total, share: rep.expenses.total ? 1 : null },
    });
  }
  return out;
}

// ------------------------------------------------------------------ Excel
async function toXlsx(rep) {
  const wb = new ExcelJS.Workbook();
  wb.creator = rep.store;
  wb.created = new Date();
  for (const sec of sections(rep)) {
    const ws = wb.addWorksheet(sec.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });
    ws.columns = sec.columns.map((c) => ({ key: c.key, width: c.width + 2 }));
    ws.mergeCells(1, 1, 1, sec.columns.length);
    ws.getCell(1, 1).value = `${rep.store} — ${sec.title}`;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF075985' } };
    ws.getCell(2, 1).value = `Periode: ${fmtDate(rep.from)} s/d ${fmtDate(rep.to)}`;
    ws.getCell(3, 1).value = sec.note || `Dicetak: ${rep.printedAt}`;
    ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF64748B' } };
    const header = ws.getRow(5);
    sec.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
      cell.alignment = { vertical: 'middle', horizontal: c.money || c.pct || c.align === 'right' ? 'right' : 'left', wrapText: true };
    });
    header.height = 22;
    const fmt = (c) => (c.money ? '"Rp"#,##0;[Red]-"Rp"#,##0' : c.pct ? '0.0%' : undefined);
    sec.rows.forEach((r) => {
      const row = ws.addRow(Object.fromEntries(sec.columns.map((c) => [c.key, r[c.key] ?? (c.money ? 0 : '')])));
      sec.columns.forEach((c, i) => {
        if (fmt(c)) row.getCell(i + 1).numFmt = fmt(c);
        if (c.key === 'items_text') row.getCell(i + 1).alignment = { wrapText: true, vertical: 'top' };
      });
    });
    if (!sec.rows.length) ws.addRow({ [sec.columns[0].key]: 'Tidak ada data pada periode ini' });
    if (sec.total) {
      const row = ws.addRow(Object.fromEntries(sec.columns.map((c) => [c.key, sec.total[c.key] ?? null])));
      row.font = { bold: true };
      sec.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (fmt(c)) cell.numFmt = fmt(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
        cell.border = { top: { style: 'thin', color: { argb: 'FF0284C7' } } };
      });
    }
    if (sec.footnote) {
      ws.addRow([]);
      ws.addRow([sec.footnote]).font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ PDF
function toPdf(rep) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: rep.sales ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: `${rep.store} - ${rep.title}`, Author: rep.store } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

    // Kop laporan
    doc.fillColor('#075985').font('Helvetica-Bold').fontSize(18).text(rep.store, left, 36);
    doc.fillColor('#0F172A').fontSize(13).text(rep.title);
    doc.font('Helvetica').fontSize(10).fillColor('#475569').text(`Periode: ${fmtDate(rep.from)} s/d ${fmtDate(rep.to)}    Dicetak: ${rep.printedAt}`);
    doc.moveDown(0.6);

    // Ringkasan angka utama
    if (rep.profitLoss) {
      const t = rep.profitLoss.total;
      const boxes = [
        ['Omzet', rp(t.revenue), '#0284C7'],
        ['Modal (HPP)', rp(t.cost), '#0EA5E9'],
        ['Biaya Operasional', rp(t.expenses), '#F97316'],
        ['Laba Bersih', rp(t.net), t.net < 0 ? '#DC2626' : '#16A34A'],
      ];
      const w = (usable() - 3 * 8) / 4;
      const y = doc.y;
      boxes.forEach(([label, value, color], i) => {
        const x = left + i * (w + 8);
        doc.roundedRect(x, y, w, 46, 6).fillAndStroke('#F8FAFC', '#E2E8F0');
        doc.fillColor('#64748B').font('Helvetica').fontSize(8.5).text(label, x + 8, y + 8, { width: w - 16 });
        doc.fillColor(color).font('Helvetica-Bold').fontSize(12).text(value, x + 8, y + 22, { width: w - 16 });
      });
      doc.y = y + 58;
      doc.x = left;
    }

    for (const sec of sections(rep)) {
      const totalWidth = sec.columns.reduce((a, c) => a + c.width, 0);
      const cols = sec.columns.map((c) => ({ ...c, w: (c.width / totalWidth) * usable() }));
      const fontSize = cols.length > 7 ? 7.5 : 8.5;
      const cellText = (c, r, isTotal) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') return isTotal || !c.money ? '' : rp(0);
        if (c.money) return rp(v);
        if (c.pct) return pct(v);
        return String(v);
      };
      const rowHeight = (r, isTotal) => {
        doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
        return Math.max(...cols.map((c) => doc.heightOfString(cellText(c, r, isTotal), { width: c.w - 8 }))) + 8;
      };
      const drawHeader = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(fontSize);
        const h = Math.max(...cols.map((c) => doc.heightOfString(c.header, { width: c.w - 8 }))) + 10;
        doc.rect(left, y, usable(), h).fill('#0284C7');
        let x = left;
        for (const c of cols) {
          doc.fillColor('#FFFFFF').text(c.header, x + 4, y + 5, { width: c.w - 8, align: c.money || c.pct || c.align === 'right' ? 'right' : 'left' });
          x += c.w;
        }
        doc.y = y + h;
      };
      const drawRow = (r, i, isTotal) => {
        const h = rowHeight(r, isTotal);
        if (doc.y + h > bottom()) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        if (isTotal) doc.rect(left, y, usable(), h).fill('#E0F2FE');
        else if (i % 2) doc.rect(left, y, usable(), h).fill('#F8FAFC');
        let x = left;
        doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
        for (const c of cols) {
          const neg = (c.money && Number(r[c.key]) < 0) || (c.pct && Number(r[c.key]) < 0);
          doc.fillColor(neg ? '#DC2626' : '#0F172A').text(cellText(c, r, isTotal), x + 4, y + 4, { width: c.w - 8, align: c.money || c.pct || c.align === 'right' ? 'right' : 'left' });
          x += c.w;
        }
        doc.y = y + h;
      };

      if (doc.y + 80 > bottom()) doc.addPage();
      doc.x = left;
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(12).text(sec.title, left, doc.y);
      if (sec.note) doc.font('Helvetica').fontSize(8.5).fillColor('#64748B').text(sec.note);
      doc.moveDown(0.3);
      drawHeader();
      if (!sec.rows.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B').text('Tidak ada data pada periode ini', left + 4, doc.y + 6);
        doc.moveDown(0.5);
      }
      sec.rows.forEach((r, i) => drawRow(r, i, false));
      if (sec.total) drawRow(sec.total, 0, true);
      if (sec.footnote) doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#64748B').text(sec.footnote, left, doc.y + 4);
      doc.moveDown(1.2);
    }

    // Nomor halaman
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // supaya teks kaki halaman tidak memicu halaman baru
      doc.font('Helvetica').fontSize(8).fillColor('#94A3B8').text(`${rep.store} - ${rep.title} - halaman ${i + 1} dari ${range.count}`, left, doc.page.height - 28, { width: usable(), align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { TYPES, build, toXlsx, toPdf, range };
