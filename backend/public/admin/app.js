/* Panel Admin Harum Market — SPA tanpa build step. */
(() => {
  'use strict';

  const API = '/api';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const dt = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

  const STATUS = {
    pending_payment: 'Menunggu Pembayaran',
    paid: 'Sudah Dibayar',
    processing: 'Disiapkan',
    shipping: 'Diantar',
    ready_pickup: 'Siap Diambil',
    completed: 'Selesai',
    cancelled: 'Dibatalkan',
  };
  const ACTION_LABEL = {
    paid: '✓ Tandai Sudah Dibayar',
    processing: '👩‍🍳 Proses Pesanan',
    shipping: '🛵 Kirim Pesanan',
    ready_pickup: '🛍️ Siap Diambil',
    completed: '✅ Selesaikan',
    cancelled: '✕ Batalkan',
  };
  const PAY = { qris: 'QRIS', bank_transfer: 'Transfer Bank', ewallet: 'E-Wallet', cash: '💵 Tunai' };
  const channelOf = (o) => (['qris', 'cash'].includes(o.payment_method) ? '' : o.payment_channel.toUpperCase());

  let token = localStorage.getItem('harum_admin_token');
  let me = null;

  // ------------------------------------------------------------ helpers
  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/auth/login') {
      logout();
      throw new Error('Sesi berakhir');
    }
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
    return data;
  }

  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2800);
  }

  function openModal(html) {
    $('#modal-card').innerHTML = html;
    $('#modal').hidden = false;
    return $('#modal-card');
  }
  function closeModal() {
    $('#modal').hidden = true;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
  });

  const badge = (s) => `<span class="badge s-${s}">${STATUS[s] || s}</span>`;
  const thumb = (url, icon = '🧊') => (url ? `<img class="thumb" src="${esc(url)}" alt="">` : `<div class="thumb">${icon}</div>`);
  const guard = (fn) => async (...a) => {
    try {
      await fn(...a);
    } catch (e) {
      toast(e.message, true);
    }
  };

  // ------------------------------------------------------------ auth
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
  }
  function logout() {
    token = null;
    localStorage.removeItem('harum_admin_token');
    showLogin();
  }
  $('#logout').onclick = logout;

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#login-error').textContent = '';
    try {
      const r = await api('/auth/login', { method: 'POST', body: { login: f.get('login'), password: f.get('password') } });
      if (r.user.role !== 'admin') throw new Error('Akun ini bukan admin');
      token = r.token;
      localStorage.setItem('harum_admin_token', token);
      start();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  async function start() {
    try {
      me = (await api('/auth/me')).user;
      if (me.role !== 'admin') return logout();
    } catch {
      return showLogin();
    }
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#admin-name').textContent = '👤 ' + me.name;
    route();
    pollPending();
  }

  // ------------------------------------------------------------ router
  const PAGES = {
    dashboard: ['Dashboard', renderDashboard],
    orders: ['Pesanan', renderOrders],
    products: ['Produk & Stok', renderProducts],
    categories: ['Kategori', renderCategories],
    banners: ['Banner Promo', renderBanners],
    customers: ['Pelanggan', renderCustomers],
    settings: ['Pengaturan Toko', renderSettings],
  };

  function route() {
    const name = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
    const [title, render] = PAGES[name] || PAGES.dashboard;
    $('#page-title').textContent = title;
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
    $('#sidebar').classList.remove('open');
    closeModal();
    $('#page').innerHTML = '<div class="empty">Memuat…</div>';
    guard(render)($('#page'));
  }
  window.addEventListener('hashchange', () => {
    if (token && me) route(); // abaikan saat masih di halaman login
  });
  $('#menu-toggle').onclick = () => $('#sidebar').classList.toggle('open');

  // Notifikasi pesanan baru (cek tiap 30 detik)
  let lastPaidCount = null;
  async function pollPending() {
    if (!token) return;
    try {
      const s = (await api('/admin/stats')).data;
      const toProcess = s.byStatus.paid || 0;
      const b = $('#pending-badge');
      b.hidden = !toProcess;
      b.textContent = toProcess;
      if (lastPaidCount !== null && toProcess > lastPaidCount) {
        toast('🔔 Ada pesanan baru yang sudah dibayar!');
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          osc.frequency.value = 880;
          osc.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.25);
        } catch {}
      }
      lastPaidCount = toProcess;
    } catch {}
    setTimeout(pollPending, 30000);
  }

  // ------------------------------------------------------------ dashboard
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const pct = (x) => (x === null || x === undefined ? '-' : (x * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%');
  const short = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
    if (a >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    if (a >= 1e3) return (n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' rb';
    return String(n);
  };
  let charts = [];
  let dashYear = null;
  let donutPeriod = 'year';

  async function renderDashboard(el) {
    const s = (await api('/admin/stats' + (dashYear ? '?year=' + dashYear : ''))).data;
    dashYear = s.year.year;
    charts.forEach((c) => c.destroy());
    charts = [];
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('sv-SE');
      const row = s.daily.find((x) => x.day === key);
      days.push({ label: d.toLocaleDateString('id-ID', { weekday: 'short' }), revenue: row ? row.revenue : 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.revenue));
    el.innerHTML = `
      ${s.paymentProvider === 'simulator' ? `<div class="card notice">Mode Simulasi Pembayaran aktif. Untuk menerima pembayaran sungguhan (QRIS, Transfer, E-Wallet) isi <code>PAYMENT_PROVIDER=midtrans</code> dan kunci Midtrans di file <code>.env</code>.</div>` : ''}
      ${s.missingCost ? `<div class="card notice">⚠️ <b>${s.missingCost} produk</b> belum diisi harga modal (HPP), jadi profit belum akurat. <a href="#/products">Lengkapi di menu Produk →</a></div>` : ''}
      <div class="stats">
        <div class="stat"><div class="label">Omzet Hari Ini</div><div class="value">${rp(s.today.revenue)}</div><div class="sub">Profit <b class="pos">${rp(s.today.profit)}</b> · ${s.today.orders} pesanan</div></div>
        <div class="stat"><div class="label">Omzet Bulan Ini</div><div class="value">${rp(s.month.revenue)}</div><div class="sub">Profit <b class="pos">${rp(s.month.profit)}</b> · ${s.month.orders} pesanan</div></div>
        <div class="stat"><div class="label">Perlu Diproses</div><div class="value" style="color:var(--accent)">${(s.byStatus.paid || 0) + (s.byStatus.processing || 0)}</div><div class="sub"><a href="#/orders">Lihat pesanan →</a></div></div>
        <div class="stat"><div class="label">Menunggu Bayar</div><div class="value">${s.byStatus.pending_payment || 0}</div><div class="sub">${s.customers} pelanggan terdaftar</div></div>
      </div>
      <div class="cols">
        <div class="card">
          <div class="card-head"><h3>Omzet & Profit per Bulan</h3>
            <select id="year-select">${s.years.map((y) => `<option ${+y === dashYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
          <div class="chart-box"><canvas id="line-chart" aria-label="Grafik omzet dan profit per bulan"></canvas></div>
          <div class="chart-foot">Tahun ${dashYear}: omzet <b>${rp(s.year.revenue)}</b> · profit <b class="pos">${rp(s.year.profit)}</b> · modal ${rp(s.year.cost)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Keuntungan vs Modal</h3>
            <select id="donut-period">
              <option value="month" ${donutPeriod === 'month' ? 'selected' : ''}>Bulan ini</option>
              <option value="year" ${donutPeriod === 'year' ? 'selected' : ''}>Tahun ${dashYear}</option>
              <option value="allTime" ${donutPeriod === 'allTime' ? 'selected' : ''}>Semua waktu</option>
            </select></div>
          <div class="donut-box"><canvas id="donut-chart" aria-label="Persentase keuntungan terhadap modal"></canvas><div class="donut-center" id="donut-center"></div></div>
          <div class="chart-foot" id="donut-foot"></div>
        </div>
      </div>
      <div class="cols">
        <div class="card"><h3>Penjualan 7 Hari Terakhir</h3>
          <div class="bars">${days
            .map((d) => `<div class="bar" title="${rp(d.revenue)}"><b>${d.revenue ? short(d.revenue) : ''}</b><div class="fill" style="height:${(d.revenue / max) * 100}%"></div><small>${d.label}</small></div>`)
            .join('')}</div>
        </div>
        <div class="card"><h3>Penjualan per Kategori</h3>
          ${s.byCategory.map((c) => `<div class="list-row"><span>${c.icon} ${esc(c.name)}</span><b>${rp(c.revenue)}</b></div>`).join('')}
        </div>
      </div>
      <div class="cols">
        <div class="card"><h3>Produk Terlaris</h3>
          ${s.topProducts.length ? s.topProducts.map((p, i) => `<div class="list-row"><span>${i + 1}. ${esc(p.name)}</span><span><b>${p.qty}</b> terjual · ${rp(p.revenue)} · <span class="pos">untung ${rp(p.profit)}</span></span></div>`).join('') : '<div class="empty">Belum ada penjualan</div>'}
        </div>
        <div class="card"><h3>⚠️ Stok Menipis</h3>
          ${s.lowStock.length ? s.lowStock.map((p) => `<div class="list-row"><span>${esc(p.name)}</span><b style="color:${p.stock ? 'var(--warn)' : 'var(--danger)'}">${p.stock} ${esc(p.unit)}</b></div>`).join('') : '<div class="empty">Semua stok aman 👍</div>'}
        </div>
      </div>`;

    $('#year-select').onchange = (e) => {
      dashYear = +e.target.value;
      route();
    };

    if (!window.Chart) return;
    const tooltip = {
      backgroundColor: '#0F172A',
      padding: 12,
      titleFont: { size: 14, weight: '700' },
      bodyFont: { size: 13 },
      callbacks: { label: (c) => ` ${c.dataset.label}: ${rp(c.parsed.y ?? c.parsed)}` },
    };

    // Grafik garis — data label muncul saat kursor diarahkan / layar disentuh.
    // Bulan yang belum berjalan (tahun ini) tidak digambar agar tidak terlihat seperti penjualan nol.
    const now = new Date();
    const upto = dashYear === now.getFullYear() ? now.getMonth() : dashYear > now.getFullYear() ? -1 : 11;
    const series = (key) => s.monthly.map((m, i) => (i <= upto ? m[key] : null));
    charts.push(
      new Chart($('#line-chart'), {
        type: 'line',
        data: {
          labels: MONTHS,
          datasets: [
            { label: 'Omzet', data: series('revenue'), borderColor: '#0284C7', backgroundColor: 'rgba(2,132,199,.12)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 4, pointHoverRadius: 7, borderWidth: 3 },
            { label: 'Profit', data: series('profit'), borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,.10)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 4, pointHoverRadius: 7, borderWidth: 3 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
          plugins: {
            legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, font: { weight: '600' } } },
            tooltip: {
              ...tooltip,
              callbacks: {
                title: (items) => `${MONTHS[items[0].dataIndex]} ${dashYear}`,
                label: (c) => ` ${c.dataset.label}: ${rp(c.parsed.y)}`,
                afterBody: (items) => {
                  const m = s.monthly[items[0].dataIndex];
                  return [`Modal: ${rp(m.cost)}`, `Margin: ${m.cost ? pct(m.profit / m.cost) + ' dari modal' : '-'}`, `${m.orders} pesanan`];
                },
              },
            },
          },
          scales: {
            y: { beginAtZero: true, ticks: { callback: (v) => short(v) }, grid: { color: '#EEF2F7' } },
            x: { grid: { display: false } },
          },
        },
      })
    );

    // Donat berlubang — porsi modal vs keuntungan
    const drawDonut = () => {
      const src = donutPeriod === 'month' ? s.month : donutPeriod === 'year' ? s.year : s.allTime;
      const profit = Math.max(0, src.profit);
      const empty = !src.revenue;
      $('#donut-center').innerHTML = empty
        ? '<span class="muted">Belum ada<br>penjualan</span>'
        : `<b>${pct(src.margin_on_cost)}</b><small>keuntungan<br>dari modal</small>`;
      $('#donut-foot').innerHTML = empty
        ? ''
        : `Modal <b>${rp(src.cost)}</b> → Omzet <b>${rp(src.revenue)}</b><br>Keuntungan <b class="pos">${rp(src.profit)}</b> (${pct(src.revenue ? src.profit / src.revenue : null)} dari omzet)`;
      const data = empty ? [1] : [src.cost, profit];
      if (charts[1]) {
        charts[1].data.datasets[0].data = data;
        charts[1].data.datasets[0].backgroundColor = empty ? ['#E2E8F0'] : ['#F97316', '#16A34A'];
        charts[1].data.labels = empty ? ['Kosong'] : ['Modal', 'Keuntungan'];
        charts[1].options.plugins.tooltip.enabled = !empty;
        charts[1].update();
        return;
      }
      charts.push(
        new Chart($('#donut-chart'), {
          type: 'doughnut',
          data: { labels: empty ? ['Kosong'] : ['Modal', 'Keuntungan'], datasets: [{ data, backgroundColor: empty ? ['#E2E8F0'] : ['#F97316', '#16A34A'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
            plugins: {
              legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { weight: '600' } } },
              tooltip: {
                ...tooltip,
                enabled: !empty,
                callbacks: {
                  label: (c) => {
                    const total = c.dataset.data.reduce((a, b) => a + b, 0);
                    return ` ${c.label}: ${rp(c.parsed)} (${pct(c.parsed / total)} dari omzet)`;
                  },
                },
              },
            },
          },
        })
      );
    };
    drawDonut();
    $('#donut-period').onchange = (e) => {
      donutPeriod = e.target.value;
      drawDonut();
    };
  }

  // ------------------------------------------------------------ pesanan
  let orderFilter = { status: '', q: '' };
  async function renderOrders(el) {
    el.innerHTML = `
      <div class="chips" id="status-chips">
        ${[['', 'Semua'], ...Object.entries(STATUS)].map(([k, v]) => `<button class="chip ${orderFilter.status === k ? 'active' : ''}" data-status="${k}">${v}</button>`).join('')}
      </div>
      <div class="toolbar"><input id="order-q" placeholder="Cari kode, nama, atau no HP…" value="${esc(orderFilter.q)}"><div class="spacer"></div>
        <button class="btn" id="order-refresh">↻ Muat ulang</button></div>
      <div class="card table-wrap" id="order-table"></div>`;
    $$('#status-chips .chip').forEach((c) =>
      c.addEventListener('click', () => {
        orderFilter.status = c.dataset.status;
        renderOrders(el);
      })
    );
    let t;
    $('#order-q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        orderFilter.q = e.target.value;
        guard(loadOrders)();
      }, 300);
    });
    $('#order-refresh').onclick = guard(loadOrders);
    await loadOrders();
  }

  async function loadOrders() {
    const qs = new URLSearchParams({ status: orderFilter.status, q: orderFilter.q, limit: 200 });
    const r = await api('/admin/orders?' + qs);
    const box = $('#order-table');
    if (!box) return;
    if (!r.data.length) return (box.innerHTML = '<div class="empty">Tidak ada pesanan</div>');
    box.innerHTML = `<table><thead><tr><th>Kode</th><th>Waktu</th><th>Pelanggan</th><th>Pengiriman</th><th>Pembayaran</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
      ${r.data
        .map(
          (o) => `<tr class="clickable" data-id="${o.id}">
            <td><b>${esc(o.code)}</b><br><small class="muted">${o.item_count} item</small></td>
            <td>${dt(o.created_at)}</td>
            <td>${esc(o.recipient || o.customer_name)}<br><small class="muted">${esc(o.phone)}</small></td>
            <td>${o.delivery_method === 'delivery' ? '🛵 Diantar' : '🏪 Ambil di toko'}</td>
            <td>${PAY[o.payment_method]} <small class="muted">${esc(channelOf(o))}</small><br><small class="muted">${o.payment_status === 'paid' ? '✓ Lunas' : o.payment_status}</small></td>
            <td class="num"><b>${rp(o.total)}</b></td>
            <td>${badge(o.status)}</td></tr>`
        )
        .join('')}</tbody></table>`;
    $$('tr[data-id]', box).forEach((tr) => tr.addEventListener('click', guard(() => showOrder(tr.dataset.id))));
  }

  async function showOrder(id) {
    const o = (await api('/admin/orders/' + id)).data;
    const card = openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
        <h3 style="margin:0">${esc(o.code)}</h3>${badge(o.status)}</div>
      <dl class="kv">
        <dt>Waktu pesan</dt><dd>${dt(o.created_at)}</dd>
        <dt>Pelanggan</dt><dd>${esc(o.customer?.name)} · ${esc(o.customer?.phone || '')}</dd>
        <dt>Penerima</dt><dd>${esc(o.recipient)} · <a href="https://wa.me/${esc(o.phone.replace(/^0/, '62'))}" target="_blank">${esc(o.phone)} (WhatsApp)</a></dd>
        <dt>Pengiriman</dt><dd>${o.delivery_method === 'delivery' ? '🛵 Diantar ke: ' + esc(o.address) : '🏪 Ambil di toko'}</dd>
        ${o.notes ? `<dt>Catatan</dt><dd>${esc(o.notes)}</dd>` : ''}
        <dt>Pembayaran</dt><dd>${PAY[o.payment_method]}${channelOf(o) ? ` (${esc(channelOf(o))})` : ''} · <b>${o.payment_status === 'paid' ? 'LUNAS ' + dt(o.paid_at) : o.payment_method === 'cash' ? 'Tagih tunai ' + rp(o.total) + (o.delivery_method === 'delivery' ? ' saat diantar' : ' di kasir') : o.payment_status}</b></dd>
        ${o.payment_ref ? `<dt>Ref. bayar</dt><dd><code>${esc(o.payment_ref)}</code></dd>` : ''}
      </dl>
      <div class="table-wrap" style="margin-top:16px"><table>
        <thead><tr><th>Produk</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead><tbody>
        ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${rp(i.price)}</td><td class="num">${i.quantity} ${esc(i.unit)}</td><td class="num">${rp(i.subtotal)}</td></tr>`).join('')}
        <tr><td colspan="3" class="num">Subtotal</td><td class="num">${rp(o.subtotal)}</td></tr>
        <tr><td colspan="3" class="num">Ongkir${o.distance_km != null ? ` (${String(o.distance_km).replace('.', ',')} km)` : ''}</td><td class="num">${o.delivery_fee ? rp(o.delivery_fee) : 'Gratis'}</td></tr>
        <tr><td colspan="3" class="num"><b>Total</b></td><td class="num"><b>${rp(o.total)}</b></td></tr>
        </tbody></table></div>
      <h3 style="margin-top:18px;font-size:15px">Riwayat</h3>
      <div class="timeline">${o.history.map((h) => `<div><b>${STATUS[h.status]}</b> <small class="muted">${dt(h.created_at)}</small>${h.note ? `<br><small>${esc(h.note)}</small>` : ''}</div>`).join('')}</div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Tutup</button>
        ${o.next_statuses.map((s) => `<button class="btn ${s === 'cancelled' ? 'danger' : 'primary'}" data-next="${s}">${ACTION_LABEL[s]}</button>`).join('')}
      </div>`);
    $$('[data-next]', card).forEach((b) =>
      b.addEventListener(
        'click',
        guard(async () => {
          const s = b.dataset.next;
          let note = '';
          if (s === 'cancelled') {
            note = prompt('Alasan pembatalan:', 'Stok habis');
            if (note === null) return;
            if (o.payment_status === 'paid' && !confirm('Pesanan sudah dibayar. Pastikan dana dikembalikan ke pelanggan. Lanjutkan?')) return;
          }
          if (s === 'paid' && !confirm('Konfirmasi pembayaran sudah diterima secara manual?')) return;
          await api(`/admin/orders/${o.id}/status`, { method: 'POST', body: { status: s, note } });
          toast('Status diperbarui: ' + STATUS[s]);
          await showOrder(o.id);
          loadOrders().catch(() => {});
        })
      )
    );
  }

  // ------------------------------------------------------------ produk
  let categoriesCache = [];
  async function renderProducts(el) {
    const [prods, cats] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
    categoriesCache = cats.data;
    el.innerHTML = `
      <div class="toolbar">
        <input id="prod-q" placeholder="Cari produk…">
        <select id="prod-cat"><option value="">Semua kategori</option>${cats.data.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('')}</select>
        <div class="spacer"></div><button class="btn primary" id="prod-add">+ Tambah Produk</button>
      </div>
      <div class="card table-wrap"><table><thead><tr><th>Produk</th><th>Kategori</th><th class="num">Harga Jual</th><th class="num">Modal (HPP)</th><th class="num">Untung</th><th class="num">Stok</th><th>Status</th><th></th></tr></thead>
      <tbody id="prod-body"></tbody></table></div>`;

    const draw = () => {
      const q = $('#prod-q').value.toLowerCase();
      const cat = $('#prod-cat').value;
      const rows = prods.data.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!cat || String(p.category_id) === cat));
      $('#prod-body').innerHTML = rows.length
        ? rows
            .map(
              (p) => `<tr>
          <td><div class="prod">${thumb(p.image_url, p.category_icon)}<div><b>${esc(p.name)}</b>${p.is_featured ? ' ⭐' : ''}<br><small class="muted">per ${esc(p.unit)}</small></div></div></td>
          <td>${p.category_icon} ${esc(p.category_name)}</td>
          <td class="num">${rp(p.price)}</td>
          <td class="num">${p.cost_price ? rp(p.cost_price) : '<span class="badge s-pending_payment">Belum diisi</span>'}</td>
          <td class="num">${p.cost_price ? `<b class="pos">${rp(p.price - p.cost_price)}</b><br><small class="muted">${pct((p.price - p.cost_price) / p.cost_price)} dari modal</small>` : '-'}</td>
          <td class="num"><input type="number" min="0" value="${p.stock}" data-stock="${p.id}" style="width:90px;margin:0 0 0 auto;text-align:right;${p.stock <= 10 ? 'border-color:var(--warn)' : ''}"></td>
          <td>${p.is_active ? '<span class="badge s-completed">Aktif</span>' : '<span class="badge s-cancelled">Nonaktif</span>'}</td>
          <td class="num"><button class="btn sm" data-edit="${p.id}">Ubah</button></td></tr>`
            )
            .join('')
        : '<tr><td colspan="8" class="empty">Tidak ada produk</td></tr>';
      $$('[data-edit]').forEach((b) => (b.onclick = () => productForm(prods.data.find((p) => p.id == b.dataset.edit))));
      $$('[data-stock]').forEach(
        (i) =>
          (i.onchange = guard(async () => {
            await api(`/admin/products/${i.dataset.stock}/stock`, { method: 'PATCH', body: { stock: Number(i.value) } });
            prods.data.find((p) => p.id == i.dataset.stock).stock = Number(i.value);
            toast('Stok diperbarui');
          }))
      );
    };
    $('#prod-q').oninput = draw;
    $('#prod-cat').onchange = draw;
    $('#prod-add').onclick = () => productForm();
    draw();
  }

  function productForm(p = {}) {
    const card = openModal(`
      <h3>${p.id ? 'Ubah Produk' : 'Tambah Produk'}</h3>
      <form id="prod-form">
        <div id="img-prev">${p.image_url ? `<img class="img-preview" src="${esc(p.image_url)}">` : '<div class="img-preview">📷</div>'}</div>
        <label>Foto produk (JPG/PNG, maks 5MB)<input type="file" name="image" accept="image/*"></label>
        <label>Nama produk<input name="name" required value="${esc(p.name)}"></label>
        <div class="grid2">
          <label>Kategori<select name="category_id" required>${categoriesCache.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
          <label>Satuan<input name="unit" value="${esc(p.unit || 'pcs')}" placeholder="pcs / pack / cup / kg"></label>
          <label>Harga jual (Rp)<input name="price" type="number" min="0" required value="${p.price ?? ''}"></label>
          <label>Harga modal / HPP (Rp)<input name="cost_price" type="number" min="0" value="${p.cost_price ?? ''}" placeholder="Biaya bahan + produksi per satuan"></label>
          <label>Stok<input name="stock" type="number" min="0" value="${p.stock ?? 0}"></label>
          <div class="margin-preview" id="margin-preview"></div>
        </div>
        <label>Deskripsi<textarea name="description" rows="3">${esc(p.description)}</textarea></label>
        <label class="check"><input type="checkbox" name="is_active" ${p.id === undefined || p.is_active ? 'checked' : ''}> Tampilkan di aplikasi</label>
        <label class="check"><input type="checkbox" name="is_featured" ${p.is_featured ? 'checked' : ''}> ⭐ Produk unggulan (tampil di beranda)</label>
        ${p.image_url ? '<label class="check"><input type="checkbox" name="remove_image"> Hapus foto</label>' : ''}
        <div class="modal-actions">
          ${p.id ? '<button type="button" class="btn danger" id="prod-del" style="margin-right:auto">Hapus</button>' : ''}
          <button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button>
        </div>
      </form>`);
    const showMargin = () => {
      const price = +$('[name=price]', card).value || 0;
      const cost = +$('[name=cost_price]', card).value || 0;
      $('#margin-preview').innerHTML = cost && price ? `Untung per ${esc($('[name=unit]', card).value || 'pcs')}: <b class="${price >= cost ? 'pos' : 'neg'}">${rp(price - cost)}</b> (${pct((price - cost) / cost)} dari modal)` : '<span class="muted">Isi harga modal agar profit di dashboard akurat</span>';
    };
    ['price', 'cost_price', 'unit'].forEach((n) => ($(`[name=${n}]`, card).oninput = showMargin));
    showMargin();
    $('[name=image]', card).onchange = (e) => {
      const f = e.target.files[0];
      if (f) $('#img-prev').innerHTML = `<img class="img-preview" src="${URL.createObjectURL(f)}">`;
    };
    $('#prod-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.set('is_active', e.target.is_active.checked ? '1' : '0');
      fd.set('is_featured', e.target.is_featured.checked ? '1' : '0');
      if (e.target.remove_image) fd.set('remove_image', e.target.remove_image.checked ? '1' : '0');
      if (!fd.get('image')?.size) fd.delete('image');
      await api('/admin/products' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', form: fd });
      closeModal();
      toast('Produk disimpan');
      route();
    });
    if (p.id)
      $('#prod-del').onclick = guard(async () => {
        if (!confirm(`Hapus produk "${p.name}"? Riwayat pesanan tetap tersimpan.`)) return;
        await api('/admin/products/' + p.id, { method: 'DELETE' });
        closeModal();
        toast('Produk dihapus');
        route();
      });
  }

  // ------------------------------------------------------------ kategori
  async function renderCategories(el) {
    const r = await api('/admin/categories');
    el.innerHTML = `<div class="toolbar"><span class="muted">Kategori = lini produk yang tampil di aplikasi.</span><div class="spacer"></div><button class="btn primary" id="cat-add">+ Tambah Kategori</button></div>
      <div class="card table-wrap"><table><thead><tr><th>Kategori</th><th>Deskripsi</th><th class="num">Produk</th><th class="num">Urutan</th><th></th></tr></thead><tbody>
      ${r.data
        .map(
          (c) => `<tr><td><div class="prod"><div class="thumb" style="background:${esc(c.color)}">${c.icon}</div><b>${esc(c.name)}</b></div></td>
        <td class="muted">${esc(c.description)}</td><td class="num">${c.product_count}</td><td class="num">${c.sort_order}</td>
        <td class="num"><button class="btn sm" data-edit="${c.id}">Ubah</button></td></tr>`
        )
        .join('')}</tbody></table></div>`;
    $('#cat-add').onclick = () => categoryForm();
    $$('[data-edit]').forEach((b) => (b.onclick = () => categoryForm(r.data.find((c) => c.id == b.dataset.edit))));
  }

  function categoryForm(c = {}) {
    openModal(`<h3>${c.id ? 'Ubah' : 'Tambah'} Kategori</h3><form id="cat-form">
      <label>Nama<input name="name" required value="${esc(c.name)}"></label>
      <div class="grid2"><label>Ikon (emoji)<input name="icon" value="${esc(c.icon || '🧊')}"></label>
      <label>Warna latar<input name="color" type="color" value="${esc(c.color || '#E0F2FE')}" style="height:42px"></label></div>
      <label>Deskripsi<textarea name="description" rows="2">${esc(c.description)}</textarea></label>
      <label>Urutan tampil<input name="sort_order" type="number" value="${c.sort_order ?? 0}"></label>
      <div class="modal-actions">${c.id ? '<button type="button" class="btn danger" id="cat-del" style="margin-right:auto">Hapus</button>' : ''}
      <button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`);
    $('#cat-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      await api('/admin/categories' + (c.id ? '/' + c.id : ''), { method: c.id ? 'PUT' : 'POST', body });
      closeModal();
      toast('Kategori disimpan');
      route();
    });
    if (c.id)
      $('#cat-del').onclick = guard(async () => {
        if (!confirm('Hapus kategori ini?')) return;
        await api('/admin/categories/' + c.id, { method: 'DELETE' });
        closeModal();
        route();
      });
  }

  // ------------------------------------------------------------ banner
  async function renderBanners(el) {
    const r = await api('/admin/banners');
    el.innerHTML = `<div class="toolbar"><span class="muted">Banner tampil bergeser di halaman beranda aplikasi.</span><div class="spacer"></div><button class="btn primary" id="ban-add">+ Tambah Banner</button></div>
      <div class="stats">${r.data
        .map(
          (b) => `<div class="stat" style="background:${esc(b.color)};color:#fff;cursor:pointer;${b.is_active ? '' : 'opacity:.5'}" data-edit="${b.id}">
        ${b.image_url ? `<img src="${esc(b.image_url)}" style="width:100%;height:90px;object-fit:cover;border-radius:10px;margin-bottom:8px">` : ''}
        <div style="font-size:20px;font-weight:800">${esc(b.title)}</div><div style="opacity:.9">${esc(b.subtitle)}</div>
        <small>${b.is_active ? 'Aktif' : 'Nonaktif'} · urutan ${b.sort_order}</small></div>`
        )
        .join('') || '<div class="empty">Belum ada banner</div>'}</div>`;
    $('#ban-add').onclick = () => bannerForm();
    $$('[data-edit]').forEach((b) => (b.onclick = () => bannerForm(r.data.find((x) => x.id == b.dataset.edit))));
  }

  function bannerForm(b = {}) {
    openModal(`<h3>${b.id ? 'Ubah' : 'Tambah'} Banner</h3><form id="ban-form">
      <label>Judul<input name="title" required value="${esc(b.title)}"></label>
      <label>Sub judul<input name="subtitle" value="${esc(b.subtitle)}"></label>
      <label>Gambar (opsional)<input type="file" name="image" accept="image/*"></label>
      <div class="grid2"><label>Warna<input name="color" type="color" value="${esc(b.color || '#0284C7')}" style="height:42px"></label>
      <label>Urutan<input name="sort_order" type="number" value="${b.sort_order ?? 0}"></label></div>
      <label class="check"><input type="checkbox" name="is_active" ${b.id === undefined || b.is_active ? 'checked' : ''}> Aktif</label>
      ${b.image_url ? '<label class="check"><input type="checkbox" name="remove_image"> Hapus gambar</label>' : ''}
      <div class="modal-actions">${b.id ? '<button type="button" class="btn danger" id="ban-del" style="margin-right:auto">Hapus</button>' : ''}
      <button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`);
    $('#ban-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.set('is_active', e.target.is_active.checked ? '1' : '0');
      if (e.target.remove_image) fd.set('remove_image', e.target.remove_image.checked ? '1' : '0');
      if (!fd.get('image')?.size) fd.delete('image');
      await api('/admin/banners' + (b.id ? '/' + b.id : ''), { method: b.id ? 'PUT' : 'POST', form: fd });
      closeModal();
      toast('Banner disimpan');
      route();
    });
    if (b.id)
      $('#ban-del').onclick = guard(async () => {
        if (!confirm('Hapus banner ini?')) return;
        await api('/admin/banners/' + b.id, { method: 'DELETE' });
        closeModal();
        route();
      });
  }

  // ------------------------------------------------------------ pelanggan
  async function renderCustomers(el) {
    el.innerHTML = `<div class="toolbar"><input id="cust-q" placeholder="Cari nama / no HP / email…"></div><div class="card table-wrap" id="cust-table"></div>`;
    const load = guard(async () => {
      const r = await api('/admin/customers?q=' + encodeURIComponent($('#cust-q').value));
      $('#cust-table').innerHTML = r.data.length
        ? `<table><thead><tr><th>Nama</th><th>No HP</th><th>Email</th><th>Terdaftar</th><th class="num">Pesanan</th><th class="num">Total Belanja</th><th></th></tr></thead><tbody>
          ${r.data
            .map(
              (c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.email || '-')}</td><td>${dt(c.created_at)}</td>
            <td class="num">${c.order_count}</td><td class="num">${rp(c.total_spent)}</td>
            <td class="num">${c.phone ? `<a class="btn sm" target="_blank" href="https://wa.me/${esc(c.phone.replace(/^0/, '62'))}">WhatsApp</a>` : ''}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<div class="empty">Belum ada pelanggan</div>';
    });
    let t;
    $('#cust-q').oninput = () => {
      clearTimeout(t);
      t = setTimeout(load, 300);
    };
    await load();
  }

  // ------------------------------------------------------------ pengaturan
  let settingsMap = null;
  async function renderSettings(el) {
    const s = (await api('/admin/settings')).data;
    el.innerHTML = `<form id="set-form">
      <div class="card"><h3>Profil Toko</h3>
        <div class="grid2">
          <label>Nama aplikasi / toko<input name="store_name" value="${esc(s.store_name)}"></label>
          <label>Slogan singkat<input name="store_tagline" value="${esc(s.store_tagline)}"></label>
          <label>No WhatsApp toko<input name="store_phone" value="${esc(s.store_phone)}"></label>
          <label>Jam buka<input name="opening_hours" value="${esc(s.opening_hours)}"></label>
        </div>
        <label>Alamat toko (untuk ambil sendiri)<textarea name="store_address" rows="2">${esc(s.store_address)}</textarea></label>
        <label class="check"><input type="checkbox" name="is_open" ${s.is_open ? 'checked' : ''}> Toko buka (menerima pesanan)</label>
      </div>

      <div class="card"><h3>Pembayaran</h3>
        <label class="check"><input type="checkbox" name="cash_enabled" ${s.cash_enabled ? 'checked' : ''}> 💵 Terima pembayaran tunai (bayar ke kurir / di kasir)</label>
        <p class="muted" style="margin:0 0 12px">QRIS, Transfer Bank & E-Wallet diproses otomatis lewat payment gateway.</p>
        <label style="max-width:320px">Batas waktu bayar online (menit)<input type="number" min="5" name="payment_expiry_minutes" value="${s.payment_expiry_minutes}"></label>
      </div>

      <div class="card"><h3>Pengiriman & Ongkir</h3>
        <label class="check"><input type="checkbox" name="delivery_enabled" ${s.delivery_enabled ? 'checked' : ''}> Layanan antar</label>
        <label class="check"><input type="checkbox" name="pickup_enabled" ${s.pickup_enabled ? 'checked' : ''}> Ambil di toko</label>
        <div class="grid2">
          <label>Gratis ongkir mulai belanja (Rp, 0 = tidak ada)<input type="number" min="0" name="free_delivery_min" value="${s.free_delivery_min}"></label>
          <label>Minimal belanja (Rp)<input type="number" min="0" name="min_order" value="${s.min_order}"></label>
        </div>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="shipping_mode" value="flat" ${s.shipping_mode === 'flat' ? 'checked' : ''}> Ongkir tetap</label>
          <label><input type="radio" name="shipping_mode" value="distance" ${s.shipping_mode === 'distance' ? 'checked' : ''}> 🗺️ Ongkir sesuai jarak tempuh (peta)</label>
        </div>

        <div id="flat-box"><label style="max-width:320px">Ongkos kirim tetap (Rp)<input type="number" min="0" name="delivery_fee" value="${s.delivery_fee}"></label></div>

        <div id="distance-box">
          <div class="grid2">
            <label>Tarif dasar (Rp)<input type="number" min="0" name="shipping_base_fee" value="${s.shipping_base_fee}"></label>
            <label>Tarif dasar berlaku untuk … km pertama<input type="number" min="0" step="0.5" name="shipping_base_km" value="${s.shipping_base_km}"></label>
            <label>Tarif per km berikutnya (Rp)<input type="number" min="0" name="shipping_per_km" value="${s.shipping_per_km}"></label>
            <label>Jarak maksimal pengiriman (km, 0 = tanpa batas)<input type="number" min="0" name="shipping_max_km" value="${s.shipping_max_km}"></label>
          </div>
          <div class="tariff" id="tariff"></div>
          <h3 style="margin-top:8px">Lokasi toko di peta</h3>
          <p class="muted" style="margin-top:0">Jarak dihitung dari titik ini ke titik alamat pelanggan mengikuti rute jalan di peta.</p>
          <div class="map-tools">
            <div class="map-search"><input id="map-q" placeholder="Cari alamat toko…"><button type="button" class="btn" id="map-search">Cari</button></div>
            <button type="button" class="btn" id="my-loc">📍 Lokasi saya</button>
            <div class="seg small">
              <label><input type="radio" name="map_mode" value="store" checked> Atur lokasi toko</label>
              <label><input type="radio" name="map_mode" value="test"> 🧪 Cek ongkir ke titik</label>
            </div>
          </div>
          <div id="map" class="map"></div>
          <div class="map-info" id="map-info"></div>
          <input type="hidden" name="store_lat" value="${s.store_lat ?? ''}"><input type="hidden" name="store_lng" value="${s.store_lng ?? ''}">
        </div>
      </div>
      <button class="btn primary">Simpan Pengaturan</button>
    </form>`;

    const f = $('#set-form');
    const val = (n) => f.elements[n].value;
    const mode = () => f.querySelector('[name=shipping_mode]:checked').value;
    const fee = (km) => +val('shipping_base_fee') + Math.max(0, Math.ceil(km - +val('shipping_base_km') - 1e-9)) * +val('shipping_per_km');

    const drawTariff = () => {
      const max = +val('shipping_max_km');
      const rows = [1, 3, 5, 8, 10, 15].filter((k) => !max || k <= max);
      $('#tariff').innerHTML = `<b>Contoh ongkir:</b> ` + rows.map((k) => `<span class="chip-static">${k} km → ${rp(fee(k))}</span>`).join(' ');
    };
    const toggle = () => {
      $('#flat-box').hidden = mode() !== 'flat';
      $('#distance-box').hidden = mode() !== 'distance';
      if (mode() === 'distance') setTimeout(initMap, 0);
    };
    f.querySelectorAll('[name=shipping_mode]').forEach((r) => (r.onchange = toggle));
    ['shipping_base_fee', 'shipping_base_km', 'shipping_per_km', 'shipping_max_km'].forEach((n) => (f.elements[n].oninput = drawTariff));
    drawTariff();

    // ---- peta (Leaflet + OpenStreetMap)
    let storeMarker = null;
    let testMarker = null;
    const info = (html) => ($('#map-info').innerHTML = html);
    const setStore = (ll) => {
      f.elements.store_lat.value = ll.lat.toFixed(6);
      f.elements.store_lng.value = ll.lng.toFixed(6);
      if (!storeMarker) {
        storeMarker = L.marker(ll, { draggable: true, title: 'Toko' }).addTo(settingsMap).bindTooltip('🏪 Toko', { permanent: true, direction: 'top', offset: [-15, -10] });
        storeMarker.on('dragend', () => setStore(storeMarker.getLatLng()));
      } else storeMarker.setLatLng(ll);
      info(`🏪 Lokasi toko: <b>${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}</b> — jangan lupa klik <b>Simpan Pengaturan</b>.`);
    };
    const testPoint = guard(async (ll) => {
      if (!val('store_lat')) return info('Tentukan lokasi toko terlebih dahulu.');
      if (!testMarker) testMarker = L.circleMarker(ll, { radius: 9, color: '#F97316', fillOpacity: 0.9 }).addTo(settingsMap);
      else testMarker.setLatLng(ll);
      info('Menghitung jarak tempuh…');
      const q = new URLSearchParams({ lat: ll.lat, lng: ll.lng, store_lat: val('store_lat'), store_lng: val('store_lng'), shipping_base_fee: val('shipping_base_fee'), shipping_base_km: val('shipping_base_km'), shipping_per_km: val('shipping_per_km'), shipping_max_km: val('shipping_max_km') });
      const r = (await api('/admin/shipping/preview?' + q)).data;
      info(
        `🧪 Jarak tempuh: <b>${String(r.distance_km).replace('.', ',')} km</b>${r.estimated ? ' (perkiraan — layanan peta tidak terjangkau)' : ` (rute jalan, ${r.source.toUpperCase()})`} → ongkir <b>${rp(r.fee)}</b>` +
          (r.out_of_range ? ' <span class="badge s-cancelled">Di luar jangkauan</span>' : '')
      );
    });

    function initMap() {
      if (!window.L || $('#map')._leaflet_id) return;
      const hasStore = s.store_lat !== null;
      settingsMap = L.map('map').setView(hasStore ? [s.store_lat, s.store_lng] : [-6.2, 106.816], hasStore ? 15 : 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(settingsMap);
      if (hasStore) setStore(L.latLng(s.store_lat, s.store_lng));
      else info('Klik peta untuk menandai lokasi toko.');
      settingsMap.on('click', (e) => (f.querySelector('[name=map_mode]:checked').value === 'store' ? setStore(e.latlng) : testPoint(e.latlng)));
    }
    $('#my-loc').onclick = () =>
      navigator.geolocation?.getCurrentPosition(
        (p) => {
          const ll = L.latLng(p.coords.latitude, p.coords.longitude);
          settingsMap.setView(ll, 17);
          setStore(ll);
        },
        () => toast('Lokasi tidak bisa dibaca dari browser', true)
      );
    const searchMap = guard(async () => {
      const q = $('#map-q').value.trim();
      if (!q) return;
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=id&limit=1&accept-language=id&q=${encodeURIComponent(q)}`).then((x) => x.json());
      if (!r.length) return toast('Alamat tidak ditemukan', true);
      const ll = L.latLng(+r[0].lat, +r[0].lon);
      settingsMap.setView(ll, 17);
      setStore(ll);
    });
    $('#map-search').onclick = searchMap;
    $('#map-q').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // jangan kirim form pengaturan
        searchMap();
      }
    };
    toggle();

    f.onsubmit = guard(async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      delete body.map_mode;
      for (const k of ['is_open', 'delivery_enabled', 'pickup_enabled', 'cash_enabled']) body[k] = f[k].checked;
      if (body.shipping_mode === 'distance' && !body.store_lat) return toast('Tandai lokasi toko di peta terlebih dahulu', true);
      await api('/admin/settings', { method: 'PUT', body });
      toast('Pengaturan disimpan');
    });
  }

  // ------------------------------------------------------------ boot
  if (token) start();
  else showLogin();
})();
