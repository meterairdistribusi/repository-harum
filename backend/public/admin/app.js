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
    ws?.close();
    localStorage.removeItem('harum_admin_token');
    showLogin();
  }
  $$('[data-logout]').forEach(
    (b) =>
      (b.onclick = () => {
        if (confirm('Keluar dari panel admin?')) logout();
      })
  );

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
    connectRealtime();
  }

  // ------------------------------------------------------------ router
  const PAGES = {
    dashboard: ['Dashboard', renderDashboard],
    orders: ['Pesanan', renderOrders],
    products: ['Sub Menu & Stok', renderProducts],
    categories: ['Kategori', renderCategories],
    banners: ['Banner Promo', renderBanners],
    expenses: ['Biaya Operasional', renderExpenses],
    customers: ['Pelanggan', renderCustomers],
    reports: ['Laporan', renderReports],
    data: ['Data & Backup', renderData],
    settings: ['Pengaturan Toko', renderSettings],
  };

  function route() {
    const name = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
    const [title, render] = PAGES[name] || PAGES.dashboard;
    $('#page-title').textContent = title;
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
    setMenu(false);
    closeModal();
    $('#page').innerHTML = '<div class="empty">Memuat…</div>';
    guard(render)($('#page'));
  }
  window.addEventListener('hashchange', () => {
    if (token && me) route(); // abaikan saat masih di halaman login
  });
  // Menu samping di HP/tablet: buka-tutup dengan tombol ☰, tutup dengan ketuk area gelap
  function setMenu(open) {
    $('#sidebar').classList.toggle('open', open);
    $('#backdrop').hidden = !open;
  }
  $('#menu-toggle').onclick = () => setMenu(!$('#sidebar').classList.contains('open'));
  $('#backdrop').onclick = () => setMenu(false);

  // Badge "perlu diproses" (cadangan bila koneksi realtime terputus: cek tiap 60 detik)
  async function refreshBadge() {
    try {
      const s = (await api('/admin/stats')).data;
      const n = (s.byStatus.paid || 0) + (s.byStatus.processing || 0);
      const b = $('#pending-badge');
      b.hidden = !n;
      b.textContent = n;
    } catch {}
  }
  async function pollPending() {
    if (!token) return;
    await refreshBadge();
    setTimeout(pollPending, 60000);
  }

  function beep() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  // Sinkronisasi realtime: pesanan baru & perubahan katalog langsung tampil
  let ws = null;
  let wsRetry = 1000;
  let refreshTimer = null;
  const currentPage = () => (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const softRefresh = (pages) => {
    if (!pages.includes(currentPage()) || !$('#modal').hidden) return; // jangan ganggu form yang sedang diisi
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(route, 300);
  };
  function connectRealtime() {
    if (!token || ws) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      wsRetry = 1000;
      $('#live').classList.add('on');
    };
    ws.onclose = () => {
      ws = null;
      $('#live').classList.remove('on');
      if (token) setTimeout(connectRealtime, (wsRetry = Math.min(wsRetry * 2, 30000)));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'order') {
        refreshBadge();
        const isNew = m.status === 'paid' || (m.status === 'processing' && m.payment_method === 'cash' && m.payment_status === 'unpaid');
        if (isNew) {
          toast(`🔔 Pesanan baru ${m.code} · ${rp(m.total)}${m.payment_method === 'cash' ? ' (tunai)' : ''}`);
          beep();
        }
        if (currentPage() === 'orders') loadOrders().catch(() => {});
        softRefresh(['dashboard']);
      }
      if (m.type === 'catalog') softRefresh(m.scope === 'store' ? ['settings'] : ['products', 'categories', 'banners']);
    };
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
        <div class="stat"><div class="label">Omzet Hari Ini</div><div class="value">${rp(s.today.revenue)}</div><div class="sub">${s.today.orders} pesanan · laba bersih <b class="${s.today.profit < 0 ? 'neg' : 'pos'}">${rp(s.today.profit)}</b></div></div>
        <div class="stat"><div class="label">Laba Bersih Bulan Ini</div><div class="value ${s.month.profit < 0 ? 'neg' : 'pos'}">${rp(s.month.profit)}</div>
          <div class="sub">Omzet ${rp(s.month.revenue)} − modal ${rp(s.month.cost)} − biaya operasional <a href="#/expenses">${rp(s.month.expenses)}</a></div></div>
        <div class="stat"><div class="label">Perlu Diproses</div><div class="value" style="color:var(--accent)">${(s.byStatus.paid || 0) + (s.byStatus.processing || 0)}</div><div class="sub"><a href="#/orders">Lihat pesanan →</a></div></div>
        <div class="stat"><div class="label">Menunggu Bayar</div><div class="value">${s.byStatus.pending_payment || 0}</div><div class="sub">${s.customers} pelanggan terdaftar</div></div>
      </div>
      <div class="cols">
        <div class="card">
          <div class="card-head"><h3>Omzet & Laba Bersih per Bulan</h3>
            <select id="year-select">${s.years.map((y) => `<option ${+y === dashYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
          <div class="chart-box"><canvas id="line-chart" aria-label="Grafik omzet dan profit per bulan"></canvas></div>
          <div class="chart-foot">Tahun ${dashYear}: omzet <b>${rp(s.year.revenue)}</b> − modal ${rp(s.year.cost)} − biaya operasional ${rp(s.year.expenses)} = laba bersih <b class="${s.year.profit < 0 ? 'neg' : 'pos'}">${rp(s.year.profit)}</b></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Laba Bersih vs Modal</h3>
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
            { label: 'Laba bersih', data: series('profit'), borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,.10)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 4, pointHoverRadius: 7, borderWidth: 3 },
            { label: 'Biaya operasional', data: series('expenses'), borderColor: '#F97316', borderDash: [6, 4], fill: false, cubicInterpolationMode: 'monotone', pointRadius: 3, pointHoverRadius: 6, borderWidth: 2 },
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
                  const spent = m.cost + m.expenses;
                  return [`Modal (HPP): ${rp(m.cost)}`, `Laba kotor: ${rp(m.gross_profit)}`, `Margin bersih: ${spent ? pct(m.profit / spent) + ' dari modal + biaya' : '-'}`, `${m.orders} pesanan`];
                },
              },
            },
          },
          scales: {
            y: { beginAtZero: true, ticks: { callback: (v) => short(v) }, grid: { color: (c) => (c.tick.value === 0 ? '#94A3B8' : '#EEF2F7') } },
            x: { grid: { display: false } },
          },
        },
      })
    );

    // Donat berlubang — porsi modal (HPP), biaya operasional & laba bersih dari omzet
    const drawDonut = () => {
      const src = donutPeriod === 'month' ? s.month : donutPeriod === 'year' ? s.year : s.allTime;
      const empty = !src.revenue && !src.expenses;
      const loss = src.profit < 0;
      $('#donut-center').innerHTML = empty
        ? '<span class="muted">Belum ada<br>data</span>'
        : `<b class="${loss ? 'neg' : 'pos'}">${pct(src.margin_on_cost)}</b><small>${loss ? 'rugi' : 'laba bersih'} dari<br>modal + biaya</small>`;
      $('#donut-foot').innerHTML = empty
        ? ''
        : `Omzet <b>${rp(src.revenue)}</b> − modal <b>${rp(src.cost)}</b> − biaya operasional <b>${rp(src.expenses)}</b><br>= laba bersih <b class="${loss ? 'neg' : 'pos'}">${rp(src.profit)}</b> (${pct(src.revenue ? src.profit / src.revenue : null)} dari omzet)`;
      const labels = empty ? ['Kosong'] : ['Modal (HPP)', 'Biaya operasional', loss ? 'Rugi' : 'Laba bersih'];
      const data = empty ? [1] : [src.cost, src.expenses, Math.abs(src.profit)];
      const colors = empty ? ['#E2E8F0'] : ['#0EA5E9', '#F97316', loss ? '#DC2626' : '#16A34A'];
      if (charts[1]) {
        Object.assign(charts[1].data, { labels });
        Object.assign(charts[1].data.datasets[0], { data, backgroundColor: colors });
        charts[1].options.plugins.tooltip.enabled = !empty;
        charts[1].update();
        return;
      }
      charts.push(
        new Chart($('#donut-chart'), {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
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
                    const src2 = donutPeriod === 'month' ? s.month : donutPeriod === 'year' ? s.year : s.allTime;
                    const spent = src2.cost + src2.expenses;
                    return ` ${rp(c.parsed)}${spent ? ' · ' + pct(c.parsed / spent) : ''}`;
                  },
                  afterLabel: () => '   dari modal + biaya operasional',
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
    box.innerHTML = `<table class="stack"><thead><tr><th>Kode</th><th>Waktu</th><th>Pelanggan</th><th>Pengiriman</th><th>Pembayaran</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
      ${r.data
        .map(
          (o) => `<tr class="clickable" data-id="${o.id}">
            <td class="s-head"><b>${esc(o.code)}</b> <small class="muted">${o.item_count} item</small></td>
            <td data-label="Waktu">${dt(o.created_at)}</td>
            <td data-label="Pelanggan"><span>${esc(o.recipient || o.customer_name)}<br><small class="muted">${esc(o.phone)}</small></span></td>
            <td data-label="Kirim">${o.delivery_method === 'delivery' ? '🛵 Diantar' : '🏪 Ambil di toko'}</td>
            <td data-label="Bayar"><span>${PAY[o.payment_method]} <small class="muted">${esc(channelOf(o))}</small><br><small class="muted">${o.payment_status === 'paid' ? '✓ Lunas' : o.payment_status}</small></span></td>
            <td class="num" data-label="Total"><b>${rp(o.total)}</b></td>
            <td class="s-status">${badge(o.status)}</td></tr>`
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

  // ------------------------------------------------------------ sub menu (produk)
  let categoriesCache = [];
  const catThumb = (c) => (c.image_url ? `<img class="thumb" src="${esc(c.image_url)}" alt="">` : `<div class="thumb" style="background:${esc(c.color || '#E0F2FE')}">${c.icon || '🧊'}</div>`);
  const priceText = (p) => (p.has_variants && p.price !== p.price_max ? `${rp(p.price)} – ${rp(p.price_max)}` : rp(p.price));

  async function renderProducts(el) {
    const [prods, cats] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
    categoriesCache = cats.data;
    el.innerHTML = `
      <div class="toolbar">
        <input id="prod-q" placeholder="Cari sub menu…">
        <select id="prod-cat"><option value="">Semua kategori</option>${cats.data.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('')}</select>
        <div class="spacer"></div><button class="btn primary" id="prod-add">+ Tambah Sub Menu</button>
      </div>
      <p class="muted" style="margin-top:-6px">Sub menu = isi tiap kategori (mis. menu makanan, jenis es). Tiap sub menu bisa punya <b>pilihan</b> seperti ukuran, rasa, atau porsi — masing-masing dengan harga, modal & stok sendiri. Maksimal 4 foto per sub menu.</p>
      <div id="prod-list"></div>`;

    const draw = () => {
      const q = $('#prod-q').value.toLowerCase();
      const cat = $('#prod-cat').value;
      const rows = prods.data.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!cat || String(p.category_id) === cat));
      $('#prod-list').innerHTML = rows.length
        ? rows
            .map((p) => {
              const photos = p.images.length ? p.images.map((u) => `<img src="${esc(u)}" alt="">`).join('') : `<div class="ph">${p.category_icon}</div>`;
              const body = p.variants.length
                ? `<table class="vt"><thead><tr><th>${esc(p.option_label || 'Pilihan')}</th><th class="num">Harga</th><th class="num">Modal</th><th class="num">Untung</th><th class="num">Stok</th></tr></thead><tbody>
                  ${p.variants
                    .map(
                      (v) => `<tr class="${v.is_active ? '' : 'off'}"><td>${esc(v.name)}${v.is_active ? '' : ' <small class="muted">(nonaktif)</small>'}</td><td class="num">${rp(v.price)}</td>
                      <td class="num">${v.cost_price ? rp(v.cost_price) : '<span class="badge s-pending_payment">Belum diisi</span>'}</td>
                      <td class="num">${v.cost_price ? `<b class="pos">${rp(v.price - v.cost_price)}</b>` : '-'}</td>
                      <td class="num"><input type="number" min="0" value="${v.stock}" data-vstock="${v.id}" class="stock-input ${v.stock <= 10 ? 'low' : ''}"></td></tr>`
                    )
                    .join('')}</tbody></table>`
                : `<div class="single"><span>Harga <b>${rp(p.price)}</b> / ${esc(p.unit)}</span><span>Modal ${p.cost_price ? rp(p.cost_price) : '<span class="badge s-pending_payment">Belum diisi</span>'}</span>
                    ${p.cost_price ? `<span>Untung <b class="pos">${rp(p.price - p.cost_price)}</b></span>` : ''}
                    <label class="inline">Stok <input type="number" min="0" value="${p.stock}" data-stock="${p.id}" class="stock-input ${p.stock <= 10 ? 'low' : ''}"></label></div>`;
              return `<div class="card prod-card ${p.is_active ? '' : 'inactive'}">
                <div class="photos">${photos}</div>
                <div class="prod-main">
                  <div class="prod-head"><div><b class="prod-name">${esc(p.name)}</b>${p.is_featured ? ' ⭐' : ''} ${p.is_active ? '' : '<span class="badge s-cancelled">Disembunyikan</span>'}
                    <div class="muted">${p.category_icon} ${esc(p.category_name)} · ${priceText(p)}</div></div>
                    <button class="btn sm" data-edit="${p.id}">Ubah</button></div>
                  ${body}
                </div></div>`;
            })
            .join('')
        : '<div class="card empty">Tidak ada sub menu</div>';
      $$('[data-edit]').forEach((b) => (b.onclick = () => productForm(prods.data.find((p) => p.id == b.dataset.edit))));
      $$('[data-stock]').forEach(
        (i) =>
          (i.onchange = guard(async () => {
            await api(`/admin/products/${i.dataset.stock}/stock`, { method: 'PATCH', body: { stock: Number(i.value) } });
            toast('Stok diperbarui');
          }))
      );
      $$('[data-vstock]').forEach(
        (i) =>
          (i.onchange = guard(async () => {
            await api(`/admin/variants/${i.dataset.vstock}/stock`, { method: 'PATCH', body: { stock: Number(i.value) } });
            toast('Stok diperbarui');
          }))
      );
    };
    $('#prod-q').oninput = draw;
    $('#prod-cat').onchange = draw;
    $('#prod-add').onclick = () => productForm();
    draw();
  }

  const MAX_PHOTOS = 4;

  function productForm(p = {}) {
    // Foto: daftar campuran foto lama {path,url} dan file baru {file,url}
    let photos = (p.image_paths || []).map((path, i) => ({ path, url: p.images[i] }));
    let variants = (p.variants || []).map((v) => ({ ...v }));
    const card = openModal(`
      <h3>${p.id ? 'Ubah Sub Menu' : 'Tambah Sub Menu'}</h3>
      <form id="prod-form">
        <label>Foto produk asli (maks ${MAX_PHOTOS}, JPG/PNG, foto pertama jadi sampul)</label>
        <div class="photo-grid" id="photo-grid"></div>
        <input type="file" id="photo-input" accept="image/*" multiple hidden>
        <div class="grid2">
          <label>Nama sub menu<input name="name" required value="${esc(p.name)}" placeholder="Contoh: Es Kristal Tabung / Nasi Ayam Geprek"></label>
          <label>Kategori<select name="category_id" required>${categoriesCache.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
        </div>
        <label>Deskripsi<textarea name="description" rows="2">${esc(p.description)}</textarea></label>
        <label>Satuan<input name="unit" value="${esc(p.unit || 'pcs')}" placeholder="pcs / pack / cup / porsi" style="max-width:240px"></label>

        <div class="variant-box">
          <div class="variant-head"><b>Pilihan</b>
            <input name="option_label" value="${esc(p.option_label || '')}" placeholder="Nama pilihan: Ukuran / Rasa / Porsi" style="max-width:260px;margin:0">
            <button type="button" class="btn sm" id="add-variant">+ Tambah pilihan</button></div>
          <p class="muted" style="margin:6px 0 10px">Kosongkan bila sub menu ini tidak punya pilihan.</p>
          <div id="variant-rows"></div>
        </div>

        <div class="grid2" id="single-price">
          <label>Harga jual (Rp)<input name="price" type="number" min="0" value="${p.has_variants ? '' : p.price ?? ''}"></label>
          <label>Harga modal / HPP (Rp)<input name="cost_price" type="number" min="0" value="${p.has_variants ? '' : p.cost_price ?? ''}" placeholder="Biaya bahan + produksi per satuan"></label>
          <label>Stok<input name="stock" type="number" min="0" value="${p.has_variants ? 0 : p.stock ?? 0}"></label>
          <div class="margin-preview" id="margin-preview"></div>
        </div>

        <label class="check"><input type="checkbox" name="is_active" ${p.id === undefined || p.is_active ? 'checked' : ''}> Tampilkan di aplikasi</label>
        <label class="check"><input type="checkbox" name="is_featured" ${p.is_featured ? 'checked' : ''}> ⭐ Unggulan (tampil di beranda)</label>
        <div class="modal-actions">
          ${p.id ? '<button type="button" class="btn danger" id="prod-del" style="margin-right:auto">Hapus</button>' : ''}
          <button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button>
        </div>
      </form>`);

    const drawPhotos = () => {
      $('#photo-grid').innerHTML =
        photos.map((ph, i) => `<div class="photo"><img src="${esc(ph.url)}" alt="">${i === 0 ? '<span class="cover">Sampul</span>' : ''}
          <div class="photo-actions">${i > 0 ? `<button type="button" data-left="${i}" title="Jadikan lebih awal">◀</button>` : ''}<button type="button" data-rm="${i}" title="Hapus">✕</button></div></div>`).join('') +
        (photos.length < MAX_PHOTOS ? `<button type="button" class="photo add" id="photo-add">＋<small>Tambah foto<br>${photos.length}/${MAX_PHOTOS}</small></button>` : '');
      $$('[data-rm]', card).forEach((b) => (b.onclick = () => (photos.splice(+b.dataset.rm, 1), drawPhotos())));
      $$('[data-left]', card).forEach((b) => (b.onclick = () => {
        const i = +b.dataset.left;
        [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
        drawPhotos();
      }));
      if ($('#photo-add')) $('#photo-add').onclick = () => $('#photo-input').click();
    };
    $('#photo-input').onchange = (e) => {
      const files = [...e.target.files];
      const room = MAX_PHOTOS - photos.length;
      if (files.length > room) toast(`Maksimal ${MAX_PHOTOS} foto — ${files.length - room} foto tidak ditambahkan`, true);
      files.slice(0, room).forEach((file) => photos.push({ file, url: URL.createObjectURL(file) }));
      e.target.value = '';
      drawPhotos();
    };

    const drawVariants = () => {
      $('#variant-rows').innerHTML = variants.length
        ? `<table class="vt edit"><thead><tr><th>Nama pilihan</th><th>Harga jual</th><th>Modal (HPP)</th><th>Stok</th><th>Aktif</th><th></th></tr></thead><tbody>
          ${variants
            .map(
              (v, i) => `<tr><td><input data-v="${i}" data-k="name" value="${esc(v.name)}" placeholder="1 kg / Pedas / Jumbo"></td>
              <td><input data-v="${i}" data-k="price" type="number" min="0" value="${v.price ?? ''}"></td>
              <td><input data-v="${i}" data-k="cost_price" type="number" min="0" value="${v.cost_price ?? ''}"></td>
              <td><input data-v="${i}" data-k="stock" type="number" min="0" value="${v.stock ?? 0}"></td>
              <td class="c"><input type="checkbox" data-v="${i}" data-k="is_active" ${v.is_active !== false ? 'checked' : ''}></td>
              <td><button type="button" class="btn sm danger" data-vrm="${i}">✕</button></td></tr>`
            )
            .join('')}</tbody></table>`
        : '';
      $('#single-price').hidden = variants.length > 0;
      $$('[data-v]', card).forEach((inp) => {
        inp.oninput = inp.onchange = () => {
          const v = variants[+inp.dataset.v];
          v[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? '' : +inp.value) : inp.value;
        };
      });
      $$('[data-vrm]', card).forEach((b) => (b.onclick = () => (variants.splice(+b.dataset.vrm, 1), drawVariants())));
    };
    $('#add-variant').onclick = () => {
      variants.push({ name: '', price: '', cost_price: '', stock: 0, is_active: true });
      drawVariants();
      $$('[data-k=name]', card).pop()?.focus();
    };

    const showMargin = () => {
      const price = +$('[name=price]', card).value || 0;
      const cost = +$('[name=cost_price]', card).value || 0;
      $('#margin-preview').innerHTML = cost && price ? `Untung per ${esc($('[name=unit]', card).value || 'pcs')}: <b class="${price >= cost ? 'pos' : 'neg'}">${rp(price - cost)}</b> (${pct((price - cost) / cost)} dari modal)` : '<span class="muted">Isi harga modal agar laba di dashboard akurat</span>';
    };
    ['price', 'cost_price', 'unit'].forEach((n) => ($(`[name=${n}]`, card).oninput = showMargin));
    showMargin();
    drawPhotos();
    drawVariants();

    $('#prod-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!variants.length && f.price.value === '') return toast('Isi harga jual, atau tambahkan pilihan', true);
      if (variants.some((v) => !String(v.name).trim() || v.price === '')) return toast('Lengkapi nama & harga setiap pilihan', true);
      const fd = new FormData();
      for (const n of ['name', 'category_id', 'description', 'unit', 'option_label', 'price', 'cost_price', 'stock']) fd.set(n, f[n].value);
      fd.set('is_active', f.is_active.checked ? '1' : '0');
      fd.set('is_featured', f.is_featured.checked ? '1' : '0');
      let n = 0;
      fd.set('image_order', JSON.stringify(photos.map((ph) => (ph.path ? 'old:' + ph.path : 'new:' + n++))));
      photos.filter((ph) => ph.file).forEach((ph) => fd.append('images', ph.file));
      fd.set('variants', JSON.stringify(variants.map((v) => ({ id: v.id, name: v.name, price: +v.price || 0, cost_price: +v.cost_price || 0, stock: +v.stock || 0, is_active: v.is_active !== false }))));
      await api('/admin/products' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', form: fd });
      closeModal();
      toast('Sub menu disimpan — aplikasi pelanggan langsung diperbarui');
      route();
    });
    if (p.id)
      $('#prod-del').onclick = guard(async () => {
        if (!confirm(`Hapus sub menu "${p.name}"? Riwayat pesanan tetap tersimpan.`)) return;
        await api('/admin/products/' + p.id, { method: 'DELETE' });
        closeModal();
        toast('Sub menu dihapus');
        route();
      });
  }

  // ------------------------------------------------------------ kategori
  async function renderCategories(el) {
    const r = await api('/admin/categories');
    el.innerHTML = `<div class="toolbar"><span class="muted">Kategori tampil di beranda aplikasi. Unggah 1 gambar untuk menggantikan ikon.</span><div class="spacer"></div><button class="btn primary" id="cat-add">+ Tambah Kategori</button></div>
      <div class="card table-wrap"><table><thead><tr><th>Kategori</th><th>Deskripsi</th><th class="num">Sub menu</th><th class="num">Urutan</th><th></th></tr></thead><tbody>
      ${r.data
        .map(
          (c) => `<tr><td><div class="prod">${catThumb(c)}<b>${esc(c.name)}</b></div></td>
        <td class="muted">${esc(c.description)}</td><td class="num">${c.product_count}</td><td class="num">${c.sort_order}</td>
        <td class="num"><button class="btn sm" data-edit="${c.id}">Ubah</button></td></tr>`
        )
        .join('')}</tbody></table></div>`;
    $('#cat-add').onclick = () => categoryForm();
    $$('[data-edit]').forEach((b) => (b.onclick = () => categoryForm(r.data.find((c) => c.id == b.dataset.edit))));
  }

  function categoryForm(c = {}) {
    const card = openModal(`<h3>${c.id ? 'Ubah' : 'Tambah'} Kategori</h3><form id="cat-form">
      <div class="cat-image-row">
        <div id="cat-prev">${catThumb(c).replace('class="thumb"', 'class="img-preview"')}</div>
        <div><label>Gambar kategori (1 gambar, menggantikan ikon)<input type="file" name="image" accept="image/*"></label>
        ${c.image_url ? '<label class="check"><input type="checkbox" name="remove_image"> Hapus gambar (kembali ke ikon)</label>' : ''}</div>
      </div>
      <label>Nama<input name="name" required value="${esc(c.name)}"></label>
      <div class="grid2"><label>Ikon cadangan (emoji)<input name="icon" value="${esc(c.icon || '🧊')}"></label>
      <label>Warna latar<input name="color" type="color" value="${esc(c.color || '#E0F2FE')}" style="height:42px"></label></div>
      <label>Deskripsi<textarea name="description" rows="2">${esc(c.description)}</textarea></label>
      <label>Urutan tampil<input name="sort_order" type="number" value="${c.sort_order ?? 0}"></label>
      <div class="modal-actions">${c.id ? '<button type="button" class="btn danger" id="cat-del" style="margin-right:auto">Hapus</button>' : ''}
      <button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`);
    $('[name=image]', card).onchange = (e) => {
      const f = e.target.files[0];
      if (f) $('#cat-prev').innerHTML = `<img class="img-preview" src="${URL.createObjectURL(f)}">`;
    };
    $('#cat-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (e.target.remove_image) fd.set('remove_image', e.target.remove_image.checked ? '1' : '0');
      if (!fd.get('image')?.size) fd.delete('image');
      await api('/admin/categories' + (c.id ? '/' + c.id : ''), { method: c.id ? 'PUT' : 'POST', form: fd });
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

  // ------------------------------------------------------------ biaya operasional
  let expenseMonth = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  async function renderExpenses(el) {
    const r = await api('/admin/expenses?month=' + expenseMonth);
    const label = new Date(expenseMonth + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    el.innerHTML = `
      <div class="toolbar">
        <input type="month" id="exp-month" value="${expenseMonth}" style="max-width:200px">
        <div class="spacer"></div>
        <button class="btn" id="exp-copy">⧉ Salin biaya bulan lalu</button>
        <button class="btn primary" id="exp-add">+ Catat Biaya</button>
      </div>
      <p class="muted" style="margin-top:-6px">Biaya operasional (gaji, listrik, sewa, bensin, kemasan, dll.) mengurangi laba. Laba bersih = omzet − modal (HPP) − biaya operasional.</p>
      <div class="cols">
        <div class="card table-wrap"><h3>Pengeluaran ${esc(label)}</h3>
          ${r.data.length
            ? `<table><thead><tr><th>Tanggal</th><th>Jenis biaya</th><th>Keterangan</th><th class="num">Nominal</th><th></th></tr></thead><tbody>
            ${r.data.map((x) => `<tr><td>${new Date(x.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</td><td>${esc(x.category)}</td><td class="muted">${esc(x.description)}</td><td class="num"><b>${rp(x.amount)}</b></td><td class="num"><button class="btn sm" data-edit="${x.id}">Ubah</button></td></tr>`).join('')}
            <tr><td colspan="3" class="num"><b>Total</b></td><td class="num"><b class="neg">${rp(r.total)}</b></td><td></td></tr></tbody></table>`
            : '<div class="empty">Belum ada biaya tercatat bulan ini</div>'}
        </div>
        <div class="card"><h3>Per Jenis Biaya</h3>
          ${r.byCategory.length ? r.byCategory.map((c) => `<div class="list-row"><span>${esc(c.category)}</span><span><b>${rp(c.total)}</b> <small class="muted">${pct(c.total / r.total)}</small></span></div>`).join('') : '<div class="empty">-</div>'}
          <div class="list-row" style="margin-top:6px"><b>Total</b><b class="neg">${rp(r.total)}</b></div>
        </div>
      </div>`;
    $('#exp-month').onchange = (e) => {
      expenseMonth = e.target.value || expenseMonth;
      route();
    };
    $('#exp-add').onclick = () => expenseForm({}, r.categories);
    $$('[data-edit]').forEach((b) => (b.onclick = () => expenseForm(r.data.find((x) => x.id == b.dataset.edit), r.categories)));
    $('#exp-copy').onclick = guard(async () => {
      if (!confirm(`Salin semua biaya bulan sebelumnya ke ${label}? (cocok untuk biaya rutin seperti gaji & sewa)`)) return;
      const x = await api('/admin/expenses/copy-previous', { method: 'POST', body: { month: expenseMonth } });
      toast(x.copied ? `${x.copied} biaya disalin` : 'Bulan lalu tidak ada biaya');
      route();
    });
  }

  function expenseForm(x = {}, categories = []) {
    const today = new Date().toLocaleDateString('sv-SE');
    openModal(`<h3>${x.id ? 'Ubah' : 'Catat'} Biaya Operasional</h3><form id="exp-form">
      <div class="grid2">
        <label>Tanggal<input type="date" name="date" required value="${esc(x.date || (today.startsWith(expenseMonth) ? today : expenseMonth + '-01'))}"></label>
        <label>Nominal (Rp)<input type="number" min="0" name="amount" required value="${x.amount ?? ''}"></label>
      </div>
      <label>Jenis biaya<input name="category" list="exp-cats" required value="${esc(x.category || '')}" placeholder="Pilih atau ketik sendiri"></label>
      <datalist id="exp-cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>Keterangan (opsional)<input name="description" value="${esc(x.description || '')}" placeholder="Contoh: gaji 2 karyawan, token listrik"></label>
      <div class="modal-actions">${x.id ? '<button type="button" class="btn danger" id="exp-del" style="margin-right:auto">Hapus</button>' : ''}
      <button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`);
    $('#exp-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      await api('/admin/expenses' + (x.id ? '/' + x.id : ''), { method: x.id ? 'PUT' : 'POST', body });
      closeModal();
      expenseMonth = body.date.slice(0, 7);
      toast('Biaya disimpan');
      route();
    });
    if (x.id)
      $('#exp-del').onclick = guard(async () => {
        if (!confirm('Hapus catatan biaya ini?')) return;
        await api('/admin/expenses/' + x.id, { method: 'DELETE' });
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
        ? `<table class="stack"><thead><tr><th>Nama</th><th>No HP</th><th>Email</th><th>Terdaftar</th><th class="num">Pesanan</th><th class="num">Total Belanja</th><th></th></tr></thead><tbody>
          ${r.data
            .map(
              (c) => `<tr><td class="s-head"><b>${esc(c.name)}</b></td><td data-label="No HP">${esc(c.phone)}</td><td data-label="Email">${esc(c.email || '-')}</td><td data-label="Terdaftar">${dt(c.created_at)}</td>
            <td class="num" data-label="Pesanan">${c.order_count}</td><td class="num" data-label="Total belanja">${rp(c.total_spent)}</td>
            <td class="num s-status">${c.phone ? `<a class="btn sm" target="_blank" href="https://wa.me/${esc(c.phone.replace(/^0/, '62'))}">WhatsApp</a>` : ''}</td></tr>`
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

  // ------------------------------------------------------------ unduh file (laporan & backup)
  async function downloadFile(path, fallbackName) {
    const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) {
      logout();
      throw new Error('Sesi berakhir');
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Gagal mengunduh');
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return name;
  }

  // ------------------------------------------------------------ laporan
  const REPORTS = [
    ['laba-rugi', '📈 Laba Rugi', 'Omzet, modal (HPP), laba kotor, biaya operasional & laba bersih per bulan'],
    ['penjualan', '🧾 Penjualan', 'Daftar semua pesanan: waktu, pelanggan, isi pesanan, cara bayar, status & total'],
    ['produk', '📦 Produk Terjual', 'Jumlah terjual, omzet, modal & laba kotor per sub menu / pilihan'],
    ['biaya', '💸 Biaya Operasional', 'Rincian biaya per tanggal & total per jenis biaya'],
    ['lengkap', '📚 Laporan Lengkap', 'Semua laporan di atas dalam satu file'],
  ];
  const iso = (d) => d.toLocaleDateString('sv-SE');
  const PRESETS = {
    'Hari ini': () => [new Date(), new Date()],
    'Bulan ini': () => [new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()],
    'Bulan lalu': () => [new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), new Date(new Date().getFullYear(), new Date().getMonth(), 0)],
    '3 bulan': () => [new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1), new Date()],
    'Tahun ini': () => [new Date(new Date().getFullYear(), 0, 1), new Date()],
  };
  let reportRange = PRESETS['Bulan ini']().map(iso);

  async function renderReports(el) {
    el.innerHTML = `
      <div class="card">
        <h3>Periode laporan</h3>
        <div class="chips" id="presets">${Object.keys(PRESETS).map((k) => `<button class="chip" data-preset="${k}">${k}</button>`).join('')}</div>
        <div class="grid2 narrow">
          <label>Dari tanggal<input type="date" id="rep-from" value="${reportRange[0]}"></label>
          <label>Sampai tanggal<input type="date" id="rep-to" value="${reportRange[1]}"></label>
        </div>
      </div>
      <div class="report-grid">
        ${REPORTS.map(
          ([type, title, desc]) => `<div class="card report-card">
            <h3>${title}</h3><p class="muted">${desc}</p>
            <div class="report-actions">
              <button class="btn xlsx" data-type="${type}" data-format="xlsx">⬇ Excel</button>
              <button class="btn pdf" data-type="${type}" data-format="pdf">⬇ PDF</button>
            </div></div>`
        ).join('')}
      </div>
      <p class="muted">File Excel bisa diolah lagi (rumus, filter); PDF siap dicetak atau dikirim. Laba bersih = omzet − modal (HPP) − biaya operasional.</p>`;
    const sync = () => (reportRange = [$('#rep-from').value, $('#rep-to').value]);
    $('#rep-from').onchange = $('#rep-to').onchange = sync;
    $$('[data-preset]').forEach(
      (b) =>
        (b.onclick = () => {
          const [a, z] = PRESETS[b.dataset.preset]().map(iso);
          $('#rep-from').value = a;
          $('#rep-to').value = z;
          sync();
          $$('[data-preset]').forEach((x) => x.classList.toggle('active', x === b));
        })
    );
    $$('[data-format]').forEach(
      (b) =>
        (b.onclick = guard(async () => {
          sync();
          const label = b.textContent;
          b.disabled = true;
          b.textContent = 'Menyiapkan…';
          try {
            const q = new URLSearchParams({ from: reportRange[0], to: reportRange[1], format: b.dataset.format });
            const name = await downloadFile(`/admin/reports/${b.dataset.type}?${q}`, `laporan.${b.dataset.format}`);
            toast('Terunduh: ' + name);
          } finally {
            b.disabled = false;
            b.textContent = label;
          }
        }))
    );
  }

  // ------------------------------------------------------------ data & backup
  async function renderData(el) {
    const d = (await api('/admin/demo-data')).data;
    let lastBackup = null;
    try {
      lastBackup = localStorage.getItem('harum_last_backup');
    } catch {}
    const hasDemo = d.orders || d.expenses || d.demo_user;
    el.innerHTML = `
      <div class="card">
        <h3>💾 Backup data</h3>
        <p class="muted">Simpan salinan seluruh data (pesanan, sub menu, foto, pelanggan, biaya, pengaturan) ke file <b>.zip</b>. Simpan file ini di Google Drive / laptop. Lakukan rutin, misalnya setiap akhir hari.</p>
        <div class="data-row"><button class="btn primary" id="do-backup">⬇ Unduh Backup Sekarang</button>
          <span class="muted">${lastBackup ? 'Backup terakhir dari perangkat ini: ' + esc(lastBackup) : 'Belum pernah backup dari perangkat ini'}</span></div>
      </div>
      <div class="card">
        <h3>♻️ Pulihkan dari backup</h3>
        <p class="muted">Gunakan bila server bermasalah / data hilang. <b>Semua data saat ini akan diganti</b> dengan isi file backup.</p>
        <p class="muted" style="font-size:13px">Catatan Render paket gratis: data kembali ke awal setiap server tidur (15 menit tanpa pengunjung) atau di-deploy ulang. Unduh backup setelah mengubah data, lalu pulihkan di sini bila data kembali ke awal.</p>
        <div class="data-row"><input type="file" id="restore-file" accept=".zip,application/zip"><button class="btn danger" id="do-restore">Pulihkan Data</button></div>
      </div>
      <div class="card">
        <h3>🧪 Data contoh (dummy)</h3>
        ${
          hasDemo
            ? `<p>Masih ada data contoh: <b>${d.orders}</b> pesanan, <b>${d.expenses}</b> catatan biaya${d.demo_user ? ', dan akun pelanggan demo (081200000000)' : ''}.</p>`
            : '<p class="pos"><b>✓ Tidak ada data pesanan/biaya contoh.</b></p>'
        }
        <label class="check"><input type="checkbox" id="demo-catalog"> Kosongkan juga katalog contoh (${d.categories} kategori, ${d.products} sub menu, ${d.banners} banner) agar bisa diisi produk asli</label>
        <button class="btn danger" id="do-demo" ${hasDemo ? '' : ''}>Hapus Data Contoh</button>
      </div>
      <div class="card danger-zone">
        <h3>⚠️ Mulai dari nol</h3>
        <p class="muted">Hapus <b>semua</b> pesanan (${d.all_orders}) dan biaya operasional (${d.all_expenses}). Katalog, foto & pengaturan tetap. Disarankan unduh backup dulu.</p>
        <label class="check"><input type="checkbox" id="reset-customers"> Hapus juga semua akun pelanggan (${d.customers})</label>
        <div class="data-row"><input id="reset-confirm" placeholder="Ketik HAPUS untuk konfirmasi" style="max-width:260px"><button class="btn danger" id="do-reset">Hapus Semua Transaksi</button></div>
      </div>`;

    $('#do-backup').onclick = guard(async () => {
      const name = await downloadFile('/admin/backup', 'harum-market-backup.zip');
      try {
        localStorage.setItem('harum_last_backup', new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }));
      } catch {}
      toast('Backup tersimpan: ' + name);
      route();
    });
    $('#do-restore').onclick = guard(async () => {
      const file = $('#restore-file').files[0];
      if (!file) return toast('Pilih file backup (.zip) dulu', true);
      if (!confirm(`Pulihkan data dari "${file.name}"?\n\nSemua data saat ini akan DIGANTI dengan isi backup.`)) return;
      const fd = new FormData();
      fd.append('backup', file);
      const r = await api('/admin/restore', { method: 'POST', form: fd });
      alert(`Data berhasil dipulihkan dari backup ${new Date(r.manifest.created_at).toLocaleString('id-ID')}:\n${r.counts.orders} pesanan, ${r.counts.products} sub menu, ${r.counts.customers} pelanggan, ${r.photos} foto.`);
      try {
        await api('/auth/me');
        route();
      } catch {
        /* akun admin di backup berbeda -> diminta masuk lagi */
      }
    });
    $('#do-demo').onclick = guard(async () => {
      const catalog = $('#demo-catalog').checked;
      if (!confirm(`Hapus data contoh${catalog ? ' DAN seluruh katalog contoh (kategori, sub menu, banner)' : ''}?\nPesanan & data asli Anda tidak ikut terhapus.`)) return;
      const r = await api('/admin/demo-data/remove', { method: 'POST', body: { catalog } });
      toast(`Dihapus: ${r.orders} pesanan contoh, ${r.expenses} biaya contoh${catalog ? `, ${r.products} sub menu` : ''}`);
      route();
    });
    $('#do-reset').onclick = guard(async () => {
      const confirmText = $('#reset-confirm').value.trim();
      if (confirmText !== 'HAPUS') return toast('Ketik HAPUS (huruf besar) untuk konfirmasi', true);
      const r = await api('/admin/reset', { method: 'POST', body: { confirm: confirmText, customers: $('#reset-customers').checked } });
      toast(`Dihapus: ${r.orders} pesanan, ${r.expenses} biaya${r.customers ? `, ${r.customers} pelanggan` : ''}`);
      route();
    });
  }

  // ------------------------------------------------------------ boot
  if (token) start();
  else showLogin();
})();
