/* ==========================================================
   WARUNG PO — Client (SPA) untuk GitHub Pages.
   Data diambil dari Apps Script (JSON) lewat fetch.
   ========================================================== */

/* >>> GANTI dengan URL /exec dari deployment Apps Script Anda <<< */
const API_URL = 'PASTE_URL_EXEC_DI_SINI';

const AppState = {
  view: 'login',
  menu: [],
  periode: '',
  cart: {},          // { idMenu: jumlah }
  custWa: '',
  custNama: '',
  orders: [],
  category: 'Semua',
  token: null,       // token sesi admin (memori, bukan URL)
  role: null,
  admin: { view: 'dashboard', orders: [], filter: {}, menu: [] },
  busyCount: 0
};

const LS = {
  menuKey: 'wpo_menu_v1',
  cartKey: 'wpo_cart_v1',
  formKey: 'wpo_form_v1',
  waKey: 'wpo_wa_v1',
  menuTtl: 10 * 60 * 1000
};

/* ---------- utilitas ---------- */

const $ = id => document.getElementById(id);
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* penyimpanan penuh atau diblokir */ } }

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('toastHost').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** Indikator tipis di atas layar saat ada permintaan server berjalan. */
function busy(delta) {
  AppState.busyCount = Math.max(0, AppState.busyCount + delta);
  $('syncBar').classList.toggle('is-on', AppState.busyCount > 0);
}

/* ---------- pemetaan aksi -> permintaan ke server ---------- */

/** Tiap aksi mengubah argumen posisi menjadi { token, data } untuk dikirim ke API. */
const API = {
  getBootstrap: () => ({}),
  placeOrder: ([p]) => ({ data: p }),
  getMyOrders: ([wa]) => ({ data: { wa: wa } }),
  submitPaymentProof: ([p]) => ({ data: p }),
  adminLogin: ([pin]) => ({ data: { pin: pin } }),
  adminLogout: ([t]) => ({ token: t }),
  adminDashboard: ([t]) => ({ token: t }),
  adminListOrders: ([t, f]) => ({ token: t, data: { filter: f } }),
  adminSetOrderStatus: ([t, id, s]) => ({ token: t, data: { id: id, status: s } }),
  adminListMenu: ([t]) => ({ token: t }),
  adminSaveProduct: ([t, p]) => ({ token: t, data: { produk: p } }),
  adminDeleteProduct: ([t, id]) => ({ token: t, data: { id: id } }),
  adminRecordPayment: ([t, p]) => ({ token: t, data: { pembayaran: p } }),
  adminFinanceSummary: ([t]) => ({ token: t }),
  adminProductionByDate: ([t]) => ({ token: t }),
  adminLabelsByDate: ([t, tgl]) => ({ token: t, data: { tanggal: tgl } })
};

/**
 * Pengganti google.script.run. Mengirim POST berisi JSON sebagai text/plain
 * supaya browser tidak mengirim permintaan awal (preflight CORS).
 */
async function callServer(fn, args, onOk, onErr) {
  busy(1);
  let res;
  try {
    const m = API[fn](args || []);
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: fn, token: m.token || '', data: m.data || {} })
    });
    res = await resp.json();
  } catch (err) {
    busy(-1);
    toast('Koneksi ke server gagal. Coba lagi.', 'bad');
    if (onErr) onErr(err);
    return;
  }
  busy(-1);
  if (res && res.success) {
    if (onOk) onOk(res.data, res.message);
    return;
  }
  if (res && res.message && /Sesi berakhir/.test(res.message)) return logoutAdminSilently();
  toast((res && res.message) || 'Terjadi kesalahan.', 'bad');
  if (onErr) onErr(res);
}

/* ---------- navigasi SPA ---------- */

function navigateTo(view) {
  if (view === 'admin' && !AppState.token) view = 'login';
  AppState.view = view;
  // Sembunyikan semua layar. Class dan atribut `hidden` dipasang bersamaan.
  document.querySelectorAll('.view').forEach(v => { v.classList.add('hidden'); v.hidden = true; });
  const target = $('view-' + (view === 'admin' ? 'admin' : view));
  if (target) { target.classList.remove('hidden'); target.hidden = false; }
  window.scrollTo(0, 0);

  if (view === 'catalog') { renderCatalog(); }
  if (view === 'cart') { renderCart(); }
  if (view === 'myOrders') { loadMyOrders(); }
  updateCartBar();
}

/* ---------- inisialisasi ---------- */

document.addEventListener('DOMContentLoaded', () => {
  AppState.cart = lsGet(LS.cartKey) || {};
  restoreForm();
  const cached = lsGet(LS.menuKey);
  if (cached && Date.now() - cached.at < LS.menuTtl) {
    applyMenu(cached.data);      // tampil instan dari cache
  }
  loadBootstrap();               // segarkan di latar
  const wa = lsGet(LS.waKey);
  if (wa) { AppState.custWa = wa.wa; AppState.custNama = wa.nama || ''; }
  navigateTo(wa ? 'catalog' : 'login');
  $('fWa').value = AppState.custWa || $('fWa').value;
  $('fTgl').min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  $('fTgl').addEventListener('input', () => saveForm());
  ['fNama', 'fWa', 'fJam', 'fCatatan'].forEach(id => $(id).addEventListener('input', debounce(saveForm, 250)));
  // Tutup laci dengan tombol Esc
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
});

function loadBootstrap() {
  callServer('getBootstrap', [], data => {
    lsSet(LS.menuKey, { at: Date.now(), data: data });
    applyMenu(data);
  });
}

function applyMenu(data) {
  AppState.menu = data.menu || [];
  AppState.periode = data.periode || '';
  // buang item di keranjang yang sudah tidak ada/nonaktif
  const ids = new Set(AppState.menu.map(m => m.id));
  Object.keys(AppState.cart).forEach(id => { if (!ids.has(id)) delete AppState.cart[id]; });
  saveCart();
  if (AppState.view === 'catalog') renderCatalog();
  if (AppState.view === 'cart') renderCart();
  updateCartBar();
}

/* ---------- login pelanggan ---------- */

function loginCustomer(e) {
  e.preventDefault();
  const wa = normalizeWa($('custWa').value);
  if (!isWaOk(wa)) return toast('Nomor WhatsApp belum valid.', 'warn');
  AppState.custWa = wa;
  lsSet(LS.waKey, { wa: wa, nama: AppState.custNama });
  navigateTo('myOrders');
}

function enterCatalog() { navigateTo('catalog'); }

/** Menerima 0812…, 812…, 62812…, +62 812… — semuanya jadi 62812… */
function normalizeWa(raw) {
  let s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith('0')) s = '62' + s.slice(1);
  else if (s.startsWith('8')) s = '62' + s;
  return s;
}
const isWaOk = wa => /^62\d{8,13}$/.test(wa);

/* ---------- katalog ---------- */

function renderCatalog() {
  $('poBanner').innerHTML = AppState.periode
    ? `<strong>${esc(AppState.periode)}</strong><span>Pilih menu, isi keranjang, lalu pilih tanggal kirim.</span>`
    : '<strong>Memuat menu…</strong><span class="skel" style="display:block;height:14px;width:60%;margin-top:6px"></span>';

  const cats = ['Semua'].concat([...new Set(AppState.menu.map(m => m.kategori).filter(Boolean))]);
  $('catChips').innerHTML = cats.map(c =>
    `<button class="chip ${c === AppState.category ? 'is-on' : ''}" role="tab" onclick="setCategory('${esc(c)}')">${esc(c)}</button>`
  ).join('');

  const list = AppState.menu.filter(m => AppState.category === 'Semua' || m.kategori === AppState.category);
  if (!AppState.menu.length) {
    $('menuGrid').innerHTML = [1, 2, 3, 4].map(() => '<div class="skel" style="height:240px;border-radius:16px"></div>').join('');
    return;
  }
  if (!list.length) {
    $('menuGrid').innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="ico">🥐</div>Belum ada menu di kategori ini.</div>';
    return;
  }
  $('menuGrid').innerHTML = list.map(productCard).join('');
}

function setCategory(c) { AppState.category = c; renderCatalog(); }

function productCard(m) {
  const qty = AppState.cart[m.id] || 0;
  return `
    <article class="product" data-id="${esc(m.id)}">
      <div class="thumb" aria-hidden="true">${m.foto ? `<img src="${esc(m.foto)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : '🥮'}</div>
      <div class="name">${esc(m.nama)}</div>
      <div class="desc">${esc(m.deskripsi || '')}</div>
      <div class="desc" style="color:#574237;font-weight:600">${esc(m.varian)}</div>
      <div class="price">${rp(m.harga)}</div>
      <div class="row">
        <div class="qty" aria-label="Jumlah ${esc(m.nama)}">
          <button class="bad" aria-label="Kurangi" onclick="changeQty('${esc(m.id)}', -1)">${qty === 1 ? '🗑' : '−'}</button>
          <output id="q-${esc(m.id)}">${qty}</output>
          <button aria-label="Tambah" onclick="changeQty('${esc(m.id)}', 1)">+</button>
        </div>
      </div>
    </article>`;
}

/** Ubah jumlah: langsung di UI + localStorage. Tidak menunggu server. */
function changeQty(id, delta) {
  const next = Math.max(0, Math.min(99, (AppState.cart[id] || 0) + delta));
  if (next === 0) delete AppState.cart[id]; else AppState.cart[id] = next;
  saveCart();
  const out = $('q-' + id);
  if (out) {
    out.textContent = next;
    const btn = out.parentElement.firstElementChild;
    btn.textContent = next === 1 ? '🗑' : '−';
  }
  updateCartBar();
  if (AppState.view === 'cart') renderCart();
}

function saveCart() { lsSet(LS.cartKey, AppState.cart); }

function cartLines() {
  return Object.keys(AppState.cart).map(id => {
    const m = AppState.menu.find(x => x.id === id);
    return m ? { m: m, jumlah: AppState.cart[id], subtotal: m.harga * AppState.cart[id] } : null;
  }).filter(Boolean);
}

function cartTotals() {
  const lines = cartLines();
  return { lines: lines, count: lines.reduce((s, l) => s + l.jumlah, 0), total: lines.reduce((s, l) => s + l.subtotal, 0) };
}

function updateCartBar() {
  const t = cartTotals();
  const bar = $('cartBar');
  const showBar = t.count > 0 && AppState.view === 'catalog';
  bar.classList.toggle('hidden', !showBar);
  $('cartCount').textContent = t.count;
  $('cartBarCount').textContent = t.count + ' item';
  $('cartBarTotal').textContent = rp(t.total);
  $('navCartDot').classList.toggle('hidden', t.count === 0);
}

/* ---------- keranjang & checkout ---------- */

function renderCart() {
  const t = cartTotals();
  if (!t.lines.length) {
    $('cartLines').innerHTML = `<div class="empty"><div class="ico">🛒</div>Keranjang masih kosong.<div style="margin-top:12px"><button class="btn btn-primary" onclick="navigateTo('catalog')">Pilih Menu</button></div></div>`;
    $('btnPlace').disabled = true;
  } else {
    $('cartLines').innerHTML = t.lines.map(l => `
      <div class="card line-item">
        <div class="thumb-s" aria-hidden="true">🥮</div>
        <div class="info">
          <strong>${esc(l.m.nama)}</strong>
          <div class="hint">${esc(l.m.varian)} · ${rp(l.m.harga)}</div>
          <div class="sub">${rp(l.subtotal)}</div>
        </div>
        <div class="qty">
          <button class="${l.jumlah === 1 ? 'bad' : ''}" aria-label="Kurangi" onclick="changeQty('${esc(l.m.id)}', -1); renderCart()">${l.jumlah === 1 ? '🗑' : '−'}</button>
          <output>${l.jumlah}</output>
          <button aria-label="Tambah" onclick="changeQty('${esc(l.m.id)}', 1); renderCart()">+</button>
        </div>
      </div>`).join('');
    $('btnPlace').disabled = false;
  }
  $('sumSub').textContent = rp(t.total);
  $('sumTotal').textContent = rp(t.total);
  updateCartBar();
}

function saveForm() {
  lsSet(LS.formKey, { nama: $('fNama').value, wa: $('fWa').value, tgl: $('fTgl').value, jam: $('fJam').value, catatan: $('fCatatan').value });
}

function restoreForm() {
  const f = lsGet(LS.formKey) || {};
  if (f.nama) $('fNama').value = f.nama;
  if (f.wa) $('fWa').value = f.wa;
  if (f.tgl) $('fTgl').value = f.tgl;
  if (f.jam) $('fJam').value = f.jam;
  if (f.catatan) $('fCatatan').value = f.catatan;
}

function submitOrder() {
  const t = cartTotals();
  const nama = $('fNama').value.trim();
  const wa = normalizeWa($('fWa').value);
  const tgl = $('fTgl').value;
  if (!t.lines.length) return toast('Keranjang masih kosong.', 'warn');
  if (nama.length < 2) return toast('Isi nama lengkap Anda.', 'warn');
  if (!isWaOk(wa)) return toast('Nomor WhatsApp belum valid.', 'warn');
  if (!tgl) return toast('Pilih tanggal kirim.', 'warn');

  const payload = {
    nama: nama, wa: wa, tanggalKirim: tgl, waktuKirim: $('fJam').value,
    catatan: $('fCatatan').value,
    items: t.lines.map(l => ({ idMenu: l.m.id, jumlah: l.jumlah }))
  };

  // Optimistic: tombol langsung terkunci, pesanan disimpan di server di latar.
  const btn = $('btnPlace');
  btn.disabled = true; btn.textContent = 'Mengirim…';
  callServer('placeOrder', [payload], () => {
    AppState.cart = {}; saveCart();
    AppState.custWa = wa; AppState.custNama = nama;
    lsSet(LS.waKey, { wa: wa, nama: nama });
    toast('Pesanan terkirim. Notifikasi WA sudah dijadwalkan.', 'ok');
    btn.textContent = 'Kirim Pesanan';
    navigateTo('myOrders');
  }, () => { btn.disabled = false; btn.textContent = 'Kirim Pesanan'; });
}

/* ---------- pesanan saya ---------- */

function loadMyOrders() {
  if (!AppState.custWa) {
    $('myOrdersList').innerHTML = `<div class="empty"><div class="ico">🔎</div>Masukkan nomor WhatsApp untuk melihat pesanan.<div style="margin-top:12px"><button class="btn btn-primary" onclick="navigateTo('login')">Masuk</button></div></div>`;
    return;
  }
  if (!AppState.orders.length) {
    $('myOrdersList').innerHTML = '<div class="skel" style="height:180px"></div>';
  }
  callServer('getMyOrders', [AppState.custWa], list => {
    AppState.orders = list || [];
    renderMyOrders();
  });
}

function renderMyOrders() {
  const list = AppState.orders;
  if (!list.length) {
    $('myOrdersList').innerHTML = `<div class="empty"><div class="ico">🧾</div>Belum ada pesanan.<div style="margin-top:12px"><button class="btn btn-primary" onclick="navigateTo('catalog')">Pesan Sekarang</button></div></div>`;
    return;
  }
  $('myOrdersList').innerHTML = list.slice().reverse().map(o => {
    const pct = o.total ? Math.min(100, Math.round((o.dibayar / o.total) * 100)) : 0;
    const bayarPill = { 'Lunas': 'pill-ok', 'DP': 'pill-warn', 'Cicil': 'pill-warn', 'Belum Bayar': 'pill-bad' }[o.statusBayar] || 'pill-neutral';
    const items = o.items.map(it => `<li><span>${it.jumlah}× ${esc(it.nama)} <span class="hint">${esc(it.varian)}</span></span><span class="mono">${rp(it.subtotal)}</span></li>`).join('');
    return `
      <article class="card order-card">
        <div class="order-head">
          <div>
            <div class="order-id">${esc(o.id)}</div>
            <div class="order-meta">Kirim ${esc(o.tanggalKirim)}${o.waktuKirim ? ' · ' + esc(o.waktuKirim) : ''}</div>
          </div>
          <span class="pill ${bayarPill}">${esc(o.statusBayar)}</span>
        </div>
        <ul class="order-items">${items}</ul>
        <div class="progress" aria-label="Sudah dibayar ${pct}%"><span style="width:${pct}%"></span></div>
        <div class="pay-line"><span>Sudah dibayar <strong class="mono">${rp(o.dibayar)}</strong></span><span>Sisa <strong class="mono">${rp(o.sisa)}</strong></span></div>
        <div class="pay-line" style="margin-top:6px"><span class="hint">Status pesanan</span><span class="pill pill-neutral">${esc(o.statusPesanan)}</span></div>
        ${o.sisa > 0 && o.statusPesanan !== 'Batal' ? `<button class="btn btn-ghost btn-block" style="margin-top:12px" onclick="openProofSheet('${esc(o.id)}')">Unggah Bukti Transfer</button>` : ''}
      </article>`;
  }).join('');
}

/* ---------- sheet (laci/modal) ---------- */

function openSheet(title, bodyHtml, footHtml) {
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = bodyHtml;
  $('sheetFoot').innerHTML = footHtml || '';
  $('sheetBackdrop').classList.add('is-on');
  $('sheet').classList.add('is-on');
}

function closeSheet() {
  $('sheetBackdrop').classList.remove('is-on');
  $('sheet').classList.remove('is-on');
}

/* ---------- unggah bukti transfer ---------- */

function openProofSheet(idPesanan) {
  const o = AppState.orders.find(x => x.id === idPesanan);
  if (!o) return;
  const body = `
    <div class="hint">${esc(o.id)} · Tagihan sisa <strong class="mono">${rp(o.sisa)}</strong></div>
    <label class="dropzone" id="dz" style="display:block;margin-top:12px">
      <div class="up" aria-hidden="true">⬆️</div>
      <div><strong>Ketuk untuk pilih foto struk / bukti transfer</strong></div>
      <div class="hint">JPG atau PNG, maksimal 5MB</div>
      <input id="proofFile" type="file" accept="image/jpeg,image/png" hidden onchange="previewProof(this)">
      <div id="proofPrev"></div>
    </label>
    <label class="field-label" for="proofAmt" style="margin-top:14px">Jumlah ditransfer</label>
    <div class="input-prefix"><span class="prefix">Rp</span><input id="proofAmt" class="input mono" type="number" inputmode="numeric" min="1" max="${o.sisa}" value="${o.sisa}"></div>
    <p class="hint">Admin memverifikasi bukti dalam 1×24 jam kerja.</p>`;
  const foot = `<button class="btn btn-ghost" onclick="closeSheet()">Batal</button>
                <button id="btnProof" class="btn btn-primary" onclick="submitProof('${esc(o.id)}')">Kirim Bukti</button>`;
  openSheet('Unggah Bukti Transfer', body, foot);
  window.__proof = null;
}

/** Baca file lokal jadi base64. Ukuran dicek dulu supaya tidak membebani server. */
function previewProof(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { toast('Ukuran file melebihi 5MB.', 'warn'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    window.__proof = { base64: reader.result, mime: f.type, name: f.name };
    $('proofPrev').innerHTML = `<img src="${reader.result}" alt="Pratinjau bukti">`;
  };
  reader.readAsDataURL(f);
}

function submitProof(idPesanan) {
  const amount = Math.round(Number($('proofAmt').value) || 0);
  const o = AppState.orders.find(x => x.id === idPesanan);
  if (!o) return;
  if (amount <= 0 || amount > o.sisa) return toast('Jumlah harus antara 1 dan ' + rp(o.sisa) + '.', 'warn');
  const btn = $('btnProof');
  btn.disabled = true; btn.textContent = 'Mengunggah…';
  const f = window.__proof || {};
  callServer('submitPaymentProof', [{
    idPesanan: idPesanan, wa: AppState.custWa, jumlah: amount,
    fileBase64: f.base64 || '', mime: f.mime || '', fileName: f.name || ''
  }], () => {
    closeSheet();
    toast('Bukti pembayaran terkirim.', 'ok');
    loadMyOrders();
  }, () => { btn.disabled = false; btn.textContent = 'Kirim Bukti'; });
}

/* ==========================================================
   ADMIN
   ========================================================== */

const ADMIN_NAV = [
  { id: 'dashboard', label: 'Dashboard', ico: '▦', roles: ['owner', 'asisten'] },
  { id: 'orders',    label: 'Pesanan',   ico: '🧾', roles: ['owner', 'asisten'] },
  { id: 'menu',      label: 'Menu',      ico: '🥮', roles: ['owner', 'asisten'] },
  { id: 'production',label: 'Dapur',     ico: '🍳', roles: ['owner', 'asisten'] },
  { id: 'labels',    label: 'Label',     ico: '🏷', roles: ['owner', 'asisten'] },
  { id: 'finance',   label: 'Keuangan',  ico: '💰', roles: ['owner'] }
];

function showAuthTab(tab) {
  const cust = tab === 'cust';
  $('formCust').classList.toggle('hidden', !cust);
  $('formAdmin').classList.toggle('hidden', cust);
  $('tabCust').classList.toggle('is-on', cust);
  $('tabAdmin').classList.toggle('is-on', !cust);
}

function loginAdmin(e) {
  e.preventDefault();
  const pin = $('adminPin').value.trim();
  if (pin.length < 6) return toast('PIN harus 6 digit.', 'warn');
  callServer('adminLogin', [pin], d => {
    AppState.token = d.token;
    AppState.role = d.role;
    $('adminPin').value = '';
    $('adminRole').textContent = d.role === 'owner' ? 'Masuk sebagai Pemilik' : 'Masuk sebagai Asisten (akses terbatas)';
    renderAdminNav();
    navigateTo('admin');
    setAdminView('dashboard');
  });
}

function renderAdminNav() {
  const items = ADMIN_NAV.filter(n => n.roles.indexOf(AppState.role) > -1);
  const html = items.map(n =>
    `<button class="${n.id === AppState.admin.view ? 'is-on' : ''}" onclick="setAdminView('${n.id}')"><span aria-hidden="true">${n.ico}</span><br>${n.label}</button>`
  ).join('');
  $('adminNav').innerHTML = html;
  let bar = document.querySelector('.bottom-admin');
  if (!bar) {
    bar = document.createElement('nav');
    bar.className = 'bottom-admin';
    bar.setAttribute('aria-label', 'Menu admin');
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<div class="side-nav">${html}<button onclick="adminLogout()">⎋<br>Keluar</button></div>`;
}

function setAdminView(v) {
  AppState.admin.view = v;
  const label = ADMIN_NAV.find(n => n.id === v);
  $('adminTitle').textContent = label ? label.label : 'Dashboard';
  renderAdminNav();
  refreshAdmin();
}

function refreshAdmin() {
  const v = AppState.admin.view;
  const content = $('adminContent');
  content.innerHTML = '<div class="skel" style="height:140px"></div><div class="skel" style="height:220px"></div>';
  if (v === 'dashboard') return loadDashboard();
  if (v === 'orders') return loadOrders();
  if (v === 'menu') return loadMenuAdmin();
  if (v === 'production') return loadProduction();
  if (v === 'labels') return loadLabels();
  if (v === 'finance') return loadFinance();
}

function adminLogout() {
  if (AppState.token) callServer('adminLogout', [AppState.token], () => {}, () => {});
  AppState.token = null; AppState.role = null;
  closeSheet();
  const bar = document.querySelector('.bottom-admin');
  if (bar) bar.remove();
  navigateTo('login');
  showAuthTab('admin');
  toast('Anda sudah keluar.', 'ok');
}

function logoutAdminSilently() {
  AppState.token = null; AppState.role = null;
  navigateTo('login');
  showAuthTab('admin');
  toast('Sesi berakhir. Silakan masuk lagi.', 'warn');
}

/* ---------- dashboard ---------- */

function loadDashboard() {
  callServer('adminDashboard', [AppState.token], d => {
    const kpi = (label, value, cls) => `<div class="kpi ${cls || ''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
    const reminders = (d.pengingatKirim || []).map(r =>
      `<div class="list-row"><div class="main"><strong>${esc(r.tanggal)}</strong><span class="stat-line">${r.jumlah} pesanan akan dikirim</span></div><span class="pill pill-neutral">${r.jumlah}</span></div>`
    ).join('') || '<div class="empty">Tidak ada pengiriman dalam 7 hari ke depan.</div>';
    const unpaid = (d.belumLunasDaftar || []).map(o =>
      `<div class="list-row" onclick="openOrderSheet('${esc(o.id)}')" style="cursor:pointer"><div class="main"><strong>${esc(o.nama)}</strong><span class="stat-line">Kirim ${esc(o.tanggalKirim)} · ${esc(o.statusBayar)}</span></div><span class="mono" style="color:var(--bad);font-weight:700">${rp(o.sisa)}</span></div>`
    ).join('') || '<div class="empty">Semua pesanan sudah lunas. 🎉</div>';

    $('adminContent').innerHTML = `
      <div class="kpi-grid">
        ${kpi('Pesanan hari ini', d.pesananHariIni)}
        ${kpi('Pesanan minggu ini', d.pesananMingguIni)}
        ${AppState.role === 'owner' ? kpi('Belum lunas', d.belumLunas, 'warn') : ''}
        ${AppState.role === 'owner' ? kpi('Total piutang', rp(d.totalPiutang), 'bad') : ''}
      </div>
      <div class="card"><h3 class="card-title">Pengingat kirim (7 hari)</h3><div class="list">${reminders}</div></div>
      ${AppState.role === 'owner' ? `<div class="card"><h3 class="card-title">Pelanggan belum lunas</h3><div class="list">${unpaid}</div></div>` : ''}
      <div class="card"><h3 class="card-title">Pesanan terbaru</h3><div class="list">${(d.terbaru || []).map(o =>
        `<div class="list-row" onclick="openOrderSheet('${esc(o.id)}')" style="cursor:pointer"><div class="main"><strong>${esc(o.nama)}</strong><span class="stat-line mono">${esc(o.id)} · kirim ${esc(o.tanggalKirim)}</span></div><span class="pill pill-neutral">${esc(o.statusPesanan)}</span></div>`
      ).join('') || '<div class="empty">Belum ada pesanan.</div>'}</div></div>`;
  });
}

/* ---------- daftar pesanan ---------- */

function loadOrders() {
  const f = AppState.admin.filter;
  callServer('adminListOrders', [AppState.token, f], d => {
    AppState.admin.orders = d.orders || [];
    AppState.role = d.role;
    renderOrders();
  });
}

function renderOrders() {
  const f = AppState.admin.filter;
  const owner = AppState.role === 'owner';
  const bayarOpts = owner ? `
      <select class="input" onchange="setFilter('statusBayar', this.value)" aria-label="Status bayar">
        <option value="">Semua status bayar</option>
        ${['Belum Bayar', 'DP', 'Cicil', 'Lunas'].map(s => `<option ${f.statusBayar === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>` : '';
  const rows = AppState.admin.orders.map(o => `
      <tr style="cursor:pointer" onclick="openOrderSheet('${esc(o.id)}')">
        <td class="mono">${esc(o.id)}</td>
        <td><strong>${esc(o.nama)}</strong><div class="hint mono">${esc(o.wa)}</div></td>
        <td>${esc(o.tanggalKirim)}${o.waktuKirim ? '<div class="hint">' + esc(o.waktuKirim) + '</div>' : ''}</td>
        <td>${o.items.map(it => `${it.jumlah}× ${esc(it.nama)}`).join('<br>')}</td>
        <td><span class="pill pill-neutral">${esc(o.statusPesanan)}</span></td>
        ${owner ? `<td class="mono">${rp(o.total)}</td><td>${bayarPill(o.statusBayar)}</td>` : ''}
      </tr>`).join('');

  $('adminContent').innerHTML = `
    <div class="card">
      <div class="filters">
        <div><label class="field-label">Dari tanggal kirim</label><input class="input" type="date" value="${esc(f.dari || '')}" onchange="setFilter('dari', this.value)"></div>
        <div><label class="field-label">Sampai</label><input class="input" type="date" value="${esc(f.sampai || '')}" onchange="setFilter('sampai', this.value)"></div>
        <select class="input" onchange="setFilter('statusPesanan', this.value)" aria-label="Status pesanan">
          <option value="">Semua status pesanan</option>
          ${['Baru', 'Diproses', 'Siap Kirim', 'Dikirim', 'Selesai', 'Batal'].map(s => `<option ${f.statusPesanan === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        ${bayarOpts}
      </div>
      <input class="input" style="margin-top:8px" type="search" placeholder="Cari nama atau nomor WA" value="${esc(f.cari || '')}" oninput="setFilterDebounced(this.value)">
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Pelanggan</th><th>Tgl kirim</th><th>Rincian</th><th>Status</th>${owner ? '<th>Total</th><th>Bayar</th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${owner ? 7 : 5}"><div class="empty">Tidak ada pesanan yang cocok.</div></td></tr>`}</tbody>
    </table></div>`;
}

function bayarPill(s) {
  const cls = { 'Lunas': 'pill-ok', 'DP': 'pill-warn', 'Cicil': 'pill-warn', 'Belum Bayar': 'pill-bad' }[s] || 'pill-neutral';
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}

function setFilter(key, val) {
  AppState.admin.filter[key] = val || '';
  loadOrders();
}
const setFilterDebounced = debounce(v => setFilter('cari', v), 300);

/** Detail pesanan + ubah status + catat pembayaran (owner). */
function openOrderSheet(id) {
  const o = AppState.admin.orders.find(x => x.id === id);
  if (!o) return;
  const owner = AppState.role === 'owner';
  const itemsHtml = o.items.map(it => `<li><span>${it.jumlah}× ${esc(it.nama)} <span class="hint">${esc(it.varian)}</span></span></li>`).join('');
  const statuses = ['Baru', 'Diproses', 'Siap Kirim', 'Dikirim', 'Selesai', 'Batal'];
  const pembayaran = owner && o.pembayaran ? o.pembayaran.map(p =>
    `<div class="pay-line" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span>${esc(p.tanggal)} · ${esc(p.metode)}${p.buktiUrl ? ` · <a href="${esc(p.buktiUrl)}" target="_blank" rel="noopener">bukti</a>` : ''}</span><span class="mono">${rp(p.jumlah)}</span></div>`
  ).join('') : '';
  const bayarBlok = owner ? `
    <div class="card" style="margin-top:12px;background:var(--cart)">
      <div class="pay-line"><span>Total</span><strong class="mono">${rp(o.total)}</strong></div>
      <div class="pay-line"><span>Sudah dibayar</span><strong class="mono" style="color:var(--ok)">${rp(o.dibayar)}</strong></div>
      <div class="pay-line"><span>Sisa</span><strong class="mono" style="color:var(--bad)">${rp(o.sisa)}</strong></div>
      <div style="margin-top:8px">${pembayaran}</div>
      ${o.sisa > 0 ? `
      <label class="field-label" for="payAmt" style="margin-top:12px">Catat pembayaran</label>
      <div class="input-prefix"><span class="prefix">Rp</span><input id="payAmt" class="input mono" type="number" min="1" max="${o.sisa}" value="${o.sisa}"></div>
      <select id="payMetode" class="input" style="margin-top:8px">
        ${['Tunai', 'Transfer', 'Saat Terima', 'Gajian', 'DP'].map(m => `<option>${m}</option>`).join('')}
      </select>` : '<div class="hint" style="margin-top:8px">Pesanan ini sudah lunas.</div>'}
    </div>` : '';

  const body = `
    <div class="order-id">${esc(o.id)}</div>
    <div class="hint">${esc(o.nama)} · ${esc(o.wa)}</div>
    <div class="hint">Kirim ${esc(o.tanggalKirim)}${o.waktuKirim ? ' · ' + esc(o.waktuKirim) : ''}</div>
    <ul class="order-items">${itemsHtml}</ul>
    ${o.catatan ? `<div class="hint">Catatan: ${esc(o.catatan)}</div>` : ''}
    <label class="field-label" for="stSel" style="margin-top:12px">Status pesanan</label>
    <select id="stSel" class="input">${statuses.map(s => `<option ${s === o.statusPesanan ? 'selected' : ''}>${s}</option>`).join('')}</select>
    ${bayarBlok}
    <div class="card" style="margin-top:12px">
      <div class="card-title">Kirim pesan ke pelanggan</div>
      <p class="hint" style="margin:0 0 8px">Tombol membuka WhatsApp dengan pesan siap kirim. Anda tinggal menekan kirim.</p>
      ${waButtonsHtml(o)}
    </div>`;

  const foot = `<button class="btn btn-ghost" onclick="saveOrderStatus('${esc(o.id)}')">Simpan Status</button>
    ${owner && o.sisa > 0 ? `<button class="btn btn-primary" onclick="recordPayment('${esc(o.id)}')">Catat Bayar</button>` : `<button class="btn btn-primary" onclick="closeSheet()">Tutup</button>`}`;
  openSheet('Detail Pesanan', body, foot);
}

/* ---------- WhatsApp manual lewat wa.me (gratis, tanpa API) ---------- */

/** Membuat link wa.me. Nomor harus format 62..., teks dikodekan agar aman di URL. */
function waLink(nomor, pesan) {
  return 'https://wa.me/' + String(nomor).replace(/\D/g, '') + '?text=' + encodeURIComponent(pesan);
}

/** Template pesan untuk pelanggan. Bisa diubah langsung di file ini. */
const WA_TEMPLATES = {
  konfirmasi: o => `Halo Kak ${o.nama}, pesanan ${o.id} sudah kami terima untuk dikirim ${o.tanggalKirim}${o.waktuKirim ? ' (' + o.waktuKirim + ')' : ''}.${o.total ? ' Total ' + rp(o.total) + '.' : ''} Terima kasih sudah memesan di Warung PO Ibu Siti 🙏`,
  pengingat: o => `Halo Kak ${o.nama}, pengingat: pesanan ${o.id} akan dikirim ${o.tanggalKirim}${o.waktuKirim ? ' (' + o.waktuKirim + ')' : ''}. Mohon pastikan ada yang menerima ya. Terima kasih 🙏`,
  tagihan: o => `Halo Kak ${o.nama}, untuk pesanan ${o.id} masih ada sisa pembayaran ${rp(o.sisa)}. Bisa dilunasi sebelum tanggal kirim ${o.tanggalKirim}? Terima kasih 🙏`,
  lunas: o => `Terima kasih Kak ${o.nama}! Pembayaran pesanan ${o.id} sudah LUNAS. Sampai jumpa di tanggal kirim ${o.tanggalKirim} 🥮`
};

/** Tombol-tombol kirim WA untuk satu pesanan. Dibuka di tab baru. */
function waButtonsHtml(o) {
  const kind = [
    ['konfirmasi', 'Konfirmasi'],
    ['pengingat', 'Pengingat'],
    ...(o.sisa > 0 ? [['tagihan', 'Tagihan']] : []),
    ...(o.sisa <= 0 && o.total > 0 ? [['lunas', 'Terima kasih']] : [])
  ];
  return `<div class="wa-row">${kind.map(([k, label]) =>
    `<a class="btn btn-ghost" href="${esc(waLink(o.wa, WA_TEMPLATES[k](o)))}" target="_blank" rel="noopener">WA: ${label}</a>`
  ).join('')}</div>`;
}

function saveOrderStatus(id) {
  const status = $('stSel').value;
  callServer('adminSetOrderStatus', [AppState.token, id, status], () => {
    toast('Status diperbarui.', 'ok');
    closeSheet();
    loadOrders();
  });
}

function recordPayment(id) {
  const jumlah = Math.round(Number($('payAmt').value) || 0);
  const metode = $('payMetode').value;
  if (jumlah <= 0) return toast('Jumlah harus lebih dari 0.', 'warn');
  callServer('adminRecordPayment', [AppState.token, { idPesanan: id, jumlah: jumlah, metode: metode }], () => {
    toast('Pembayaran tercatat.', 'ok');
    closeSheet();
    loadOrders();
  });
}

/* ---------- menu & harga ---------- */

function loadMenuAdmin() {
  callServer('adminListMenu', [AppState.token], list => {
    AppState.admin.menu = list || [];
    renderMenuAdmin();
  });
}

function renderMenuAdmin() {
  const owner = AppState.role === 'owner';
  const rows = AppState.admin.menu.map(m => `
    <div class="list-row">
      <div class="main"><strong>${esc(m.nama)}</strong><span class="stat-line">${esc(m.varian)} · ${esc(m.kategori)}</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="mono" style="font-weight:700;color:var(--primary)">${rp(m.harga)}</span>
        <label class="pill ${m.aktif ? 'pill-ok' : 'pill-neutral'}" style="cursor:pointer">
          <input type="checkbox" ${m.aktif ? 'checked' : ''} onchange="toggleProduct('${esc(m.id)}', this.checked)" aria-label="Aktifkan ${esc(m.nama)}" style="margin:0 4px 0 0">${m.aktif ? 'Aktif' : 'Nonaktif'}
        </label>
        <button class="btn btn-ghost" style="min-height:40px" onclick="openProductSheet('${esc(m.id)}')">Ubah</button>
      </div>
    </div>`).join('');
  $('adminContent').innerHTML = `
    <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="openProductSheet()">+ Tambah Produk</button></div>
    <div class="list">${rows || '<div class="empty">Belum ada produk.</div>'}</div>`;
}

function toggleProduct(id, aktif) {
  const m = AppState.admin.menu.find(x => x.id === id);
  if (!m) return;
  saveProduct(Object.assign({}, m, { aktif: aktif }), () => loadMenuAdmin());
}

function openProductSheet(id) {
  const m = id ? AppState.admin.menu.find(x => x.id === id) : { nama: '', kategori: 'Kue Kering', varian: '', harga: '', aktif: true, periode: AppState.periode, slotMax: 0, deskripsi: '' };
  if (!m) return;
  const owner = AppState.role === 'owner';
  const body = `
    <label class="field-label" for="pNama">Nama produk</label>
    <input id="pNama" class="input" value="${esc(m.nama)}">
    <label class="field-label" for="pKat" style="margin-top:10px">Kategori</label>
    <input id="pKat" class="input" value="${esc(m.kategori)}">
    <label class="field-label" for="pVar" style="margin-top:10px">Varian &amp; kemasan</label>
    <input id="pVar" class="input" value="${esc(m.varian)}" placeholder="Contoh: Toples Bulat 500g">
    <label class="field-label" for="pHarga" style="margin-top:10px">Harga satuan</label>
    <div class="input-prefix"><span class="prefix">Rp</span><input id="pHarga" class="input mono" type="number" min="1" value="${esc(m.harga)}"></div>
    <label class="field-label" for="pSlot" style="margin-top:10px">Kuota slot (0 = tanpa batas)</label>
    <input id="pSlot" class="input mono" type="number" min="0" value="${esc(m.slotMax)}">
    <label class="field-label" for="pDesk" style="margin-top:10px">Deskripsi singkat</label>
    <textarea id="pDesk" class="input" rows="2">${esc(m.deskripsi)}</textarea>
    <label class="checklist-item" style="margin-top:12px"><input id="pAktif" type="checkbox" ${m.aktif ? 'checked' : ''}> Tampilkan di katalog pelanggan</label>`;
  const foot = `<button class="btn btn-ghost" onclick="closeSheet()">Batal</button>
    <button class="btn btn-primary" onclick="submitProductForm('${esc(id || '')}')">Simpan</button>`;
  openSheet(id ? 'Ubah Produk' : 'Produk Baru', body + (owner && id ? `<button class="btn btn-danger btn-block" style="margin-top:14px" onclick="deleteProduct('${esc(id)}')">Hapus produk</button>` : ''), foot);
}

function submitProductForm(id) {
  saveProduct({
    id: id || '',
    nama: $('pNama').value.trim(),
    kategori: $('pKat').value.trim(),
    varian: $('pVar').value.trim(),
    harga: $('pHarga').value,
    slotMax: $('pSlot').value,
    deskripsi: $('pDesk').value.trim(),
    periode: AppState.periode,
    aktif: $('pAktif').checked
  }, () => { closeSheet(); loadMenuAdmin(); });
}

function saveProduct(p, after) {
  callServer('adminSaveProduct', [AppState.token, p], () => {
    toast('Produk tersimpan.', 'ok');
    lsSet(LS.menuKey, null);
    if (after) after();
  });
}

function deleteProduct(id) {
  if (!confirm('Hapus produk ini? Tindakan tidak bisa dibatalkan.')) return;
  callServer('adminDeleteProduct', [AppState.token, id], () => {
    toast('Produk dihapus.', 'ok');
    closeSheet();
    loadMenuAdmin();
  });
}

/* ---------- dapur & label ---------- */

function loadProduction() {
  callServer('adminProductionByDate', [AppState.token], days => {
    AppState.admin.production = days || [];
    $('adminContent').innerHTML = (days || []).map(d => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 class="card-title">${esc(d.tanggal)}</h3><span class="pill pill-neutral">${d.pesanan} pesanan</span>
        </div>
        <div class="table-wrap" style="margin-top:8px"><table>
          <thead><tr><th>Produk &amp; varian</th><th style="text-align:right">Jumlah</th></tr></thead>
          <tbody>${Object.keys(d.produk).sort().map(k => `<tr><td>${esc(k)}</td><td class="mono" style="text-align:right;font-weight:700">${d.produk[k]}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`).join('') || '<div class="empty"><div class="ico">🍳</div>Belum ada pesanan untuk dibuat.</div>';
  });
}

function loadLabels() {
  const dates = (AppState.admin.production || []).map(d => d.tanggal);
  const pilih = AppState.admin.labelDate || dates[0] || '';
  $('adminContent').innerHTML = `
    <div class="card">
      <label class="field-label" for="lblDate">Tanggal kirim</label>
      <select id="lblDate" class="input" onchange="AppState.admin.labelDate=this.value; loadLabelsFor(this.value)">
        ${dates.map(d => `<option ${d === pilih ? 'selected' : ''}>${esc(d)}</option>`).join('') || '<option>Belum ada tanggal</option>'}
      </select>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="printLabels()">Cetak A4 (16 label)</button>
      </div>
    </div>
    <div id="labelSheet"></div>`;
  if (pilih) loadLabelsFor(pilih);
}

function loadLabelsFor(tanggal) {
  callServer('adminLabelsByDate', [AppState.token, tanggal], list => {
    const cells = (list || []).map(o => `
      <div class="label-cell">
        <div class="lbl-id">${esc(o.id)}</div>
        <div class="lbl-name">${esc(o.nama)}</div>
        <div class="lbl-items">${o.items.map(esc).join('<br>')}</div>
        <div class="lbl-foot">Kirim ${esc(tanggal)}${o.waktuKirim ? ' · ' + esc(o.waktuKirim) : ''}</div>
      </div>`).join('');
    $('labelSheet').innerHTML = `<div class="label-page" id="labelPage">${cells || '<div class="empty">Tidak ada label untuk tanggal ini.</div>'}</div>`;
  });
}

function printLabels() {
  const style = document.createElement('style');
  style.id = 'printStyle';
  style.textContent = `
    @media print {
      body { background:#fff !important; }
      body * { visibility: hidden; }
      #labelPage, #labelPage * { visibility: visible; }
      #labelPage { position:absolute; left:0; top:0; width:210mm; }
      .label-cell { border:1px dashed #9E9E9E; }
    }`;
  document.head.appendChild(style);
  window.print();
  setTimeout(() => style.remove(), 500);
}

/* ---------- keuangan (owner) ---------- */

function loadFinance() {
  callServer('adminFinanceSummary', [AppState.token], d => {
    const rowsStatus = Object.keys(d.perStatus || {}).map(k =>
      `<div class="list-row"><div class="main"><strong>${bayarPill(k)}</strong></div><div class="mono">${d.perStatus[k].jumlah} pesanan · sisa ${rp(d.perStatus[k].nilai)}</div></div>`
    ).join('') || '<div class="empty">Belum ada data pembayaran.</div>';
    $('adminContent').innerHTML = `
      <div class="kpi-grid">
        ${kpi2('Total tagihan', rp(d.totalTagihan))}
        ${kpi2('Sudah diterima', rp(d.totalDiterima), 'ok')}
        ${kpi2('Sisa piutang', rp(d.sisaPiutang), 'bad')}
      </div>
      <div class="card"><h3 class="card-title">Status pembayaran</h3><div class="list">${rowsStatus}</div></div>`;
  });
}

function kpi2(label, value, cls) {
  return `<div class="kpi ${cls === 'bad' ? 'bad' : ''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}
