/* Panel Admin Harum Group — SPA tanpa build step. */
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
  const PAY = { qris: 'QRIS', bank_transfer: 'Transfer Bank', ewallet: 'E-Wallet' };

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
  window.addEventListener('hashchange', route);
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
  async function renderDashboard(el) {
    const s = (await api('/admin/stats')).data;
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
      ${s.paymentProvider === 'simulator' ? `<div class="card" style="background:#FEF3C7;color:#92400E"><b>Mode Simulasi Pembayaran aktif.</b> Untuk menerima pembayaran sungguhan (QRIS, Transfer, E-Wallet) isi <code>PAYMENT_PROVIDER=midtrans</code> dan kunci Midtrans di file <code>.env</code>.</div>` : ''}
      <div class="stats">
        <div class="stat"><div class="label">Omzet Hari Ini</div><div class="value">${rp(s.today.revenue)}</div><div class="sub">${s.today.orders} pesanan dibayar</div></div>
        <div class="stat"><div class="label">Omzet Bulan Ini</div><div class="value">${rp(s.month.revenue)}</div><div class="sub">${s.month.orders} pesanan dibayar</div></div>
        <div class="stat"><div class="label">Perlu Diproses</div><div class="value" style="color:var(--accent)">${(s.byStatus.paid || 0) + (s.byStatus.processing || 0)}</div><div class="sub"><a href="#/orders">Lihat pesanan →</a></div></div>
        <div class="stat"><div class="label">Menunggu Bayar</div><div class="value">${s.byStatus.pending_payment || 0}</div><div class="sub">${s.customers} pelanggan terdaftar</div></div>
      </div>
      <div class="cols">
        <div class="card"><h3>Penjualan 7 Hari Terakhir</h3>
          <div class="bars">${days
            .map((d) => `<div class="bar" title="${rp(d.revenue)}"><b>${d.revenue ? (d.revenue / 1000).toFixed(0) + 'rb' : ''}</b><div class="fill" style="height:${(d.revenue / max) * 100}%"></div><small>${d.label}</small></div>`)
            .join('')}</div>
        </div>
        <div class="card"><h3>Penjualan per Lini Bisnis</h3>
          ${s.byCategory.map((c) => `<div class="list-row"><span>${c.icon} ${esc(c.name)}</span><b>${rp(c.revenue)}</b></div>`).join('')}
        </div>
      </div>
      <div class="cols">
        <div class="card"><h3>Produk Terlaris</h3>
          ${s.topProducts.length ? s.topProducts.map((p, i) => `<div class="list-row"><span>${i + 1}. ${esc(p.name)}</span><span><b>${p.qty}</b> terjual · ${rp(p.revenue)}</span></div>`).join('') : '<div class="empty">Belum ada penjualan</div>'}
        </div>
        <div class="card"><h3>⚠️ Stok Menipis</h3>
          ${s.lowStock.length ? s.lowStock.map((p) => `<div class="list-row"><span>${esc(p.name)}</span><b style="color:${p.stock ? 'var(--warn)' : 'var(--danger)'}">${p.stock} ${esc(p.unit)}</b></div>`).join('') : '<div class="empty">Semua stok aman 👍</div>'}
        </div>
      </div>`;
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
            <td>${PAY[o.payment_method]} <small class="muted">${o.payment_method === 'qris' ? '' : esc(o.payment_channel.toUpperCase())}</small><br><small class="muted">${o.payment_status === 'paid' ? '✓ Lunas' : o.payment_status}</small></td>
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
        <dt>Pembayaran</dt><dd>${PAY[o.payment_method]}${o.payment_method === 'qris' ? '' : ` (${esc(o.payment_channel.toUpperCase())})`} · <b>${o.payment_status === 'paid' ? 'LUNAS ' + dt(o.paid_at) : o.payment_status}</b></dd>
        ${o.payment_ref ? `<dt>Ref. bayar</dt><dd><code>${esc(o.payment_ref)}</code></dd>` : ''}
      </dl>
      <div class="table-wrap" style="margin-top:16px"><table>
        <thead><tr><th>Produk</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead><tbody>
        ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${rp(i.price)}</td><td class="num">${i.quantity} ${esc(i.unit)}</td><td class="num">${rp(i.subtotal)}</td></tr>`).join('')}
        <tr><td colspan="3" class="num">Subtotal</td><td class="num">${rp(o.subtotal)}</td></tr>
        <tr><td colspan="3" class="num">Ongkir</td><td class="num">${o.delivery_fee ? rp(o.delivery_fee) : 'Gratis'}</td></tr>
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
      <div class="card table-wrap"><table><thead><tr><th>Produk</th><th>Kategori</th><th class="num">Harga</th><th class="num">Stok</th><th>Status</th><th></th></tr></thead>
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
          <td class="num"><input type="number" min="0" value="${p.stock}" data-stock="${p.id}" style="width:90px;margin:0 0 0 auto;text-align:right;${p.stock <= 10 ? 'border-color:var(--warn)' : ''}"></td>
          <td>${p.is_active ? '<span class="badge s-completed">Aktif</span>' : '<span class="badge s-cancelled">Nonaktif</span>'}</td>
          <td class="num"><button class="btn sm" data-edit="${p.id}">Ubah</button></td></tr>`
            )
            .join('')
        : '<tr><td colspan="6" class="empty">Tidak ada produk</td></tr>';
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
          <label>Harga (Rp)<input name="price" type="number" min="0" required value="${p.price ?? ''}"></label>
          <label>Stok<input name="stock" type="number" min="0" value="${p.stock ?? 0}"></label>
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
    el.innerHTML = `<div class="toolbar"><span class="muted">Kategori = lini bisnis Harum Group yang tampil di aplikasi.</span><div class="spacer"></div><button class="btn primary" id="cat-add">+ Tambah Kategori</button></div>
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
  async function renderSettings(el) {
    const s = (await api('/admin/settings')).data;
    el.innerHTML = `<form id="set-form">
      <div class="card"><h3>Profil Toko</h3>
        <div class="grid2">
          <label>Nama usaha<input name="store_name" value="${esc(s.store_name)}"></label>
          <label>Slogan<input name="store_tagline" value="${esc(s.store_tagline)}"></label>
          <label>No WhatsApp toko<input name="store_phone" value="${esc(s.store_phone)}"></label>
          <label>Jam buka<input name="opening_hours" value="${esc(s.opening_hours)}"></label>
        </div>
        <label>Alamat toko (untuk ambil sendiri)<textarea name="store_address" rows="2">${esc(s.store_address)}</textarea></label>
        <label class="check"><input type="checkbox" name="is_open" ${s.is_open ? 'checked' : ''}> Toko buka (menerima pesanan)</label>
      </div>
      <div class="card"><h3>Pengiriman & Pembayaran</h3>
        <label class="check"><input type="checkbox" name="delivery_enabled" ${s.delivery_enabled ? 'checked' : ''}> Layanan antar</label>
        <label class="check"><input type="checkbox" name="pickup_enabled" ${s.pickup_enabled ? 'checked' : ''}> Ambil di toko</label>
        <div class="grid2">
          <label>Ongkos kirim (Rp)<input type="number" min="0" name="delivery_fee" value="${s.delivery_fee}"></label>
          <label>Gratis ongkir mulai belanja (Rp, 0 = tidak ada)<input type="number" min="0" name="free_delivery_min" value="${s.free_delivery_min}"></label>
          <label>Minimal belanja (Rp)<input type="number" min="0" name="min_order" value="${s.min_order}"></label>
          <label>Batas waktu bayar (menit)<input type="number" min="5" name="payment_expiry_minutes" value="${s.payment_expiry_minutes}"></label>
        </div>
      </div>
      <button class="btn primary">Simpan Pengaturan</button>
    </form>`;
    $('#set-form').onsubmit = guard(async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = Object.fromEntries(new FormData(f));
      for (const k of ['is_open', 'delivery_enabled', 'pickup_enabled']) body[k] = f[k].checked;
      await api('/admin/settings', { method: 'PUT', body });
      toast('Pengaturan disimpan');
    });
  }

  // ------------------------------------------------------------ boot
  if (token) start();
  else showLogin();
})();
