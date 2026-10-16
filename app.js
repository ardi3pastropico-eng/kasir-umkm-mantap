/* ============================================================
   KASIR UMKM MANTAP — app.js
   Berisi: API, PIN, Kasir, Produk, Pembelian, Riwayat,
           Pengaturan, QRIS, Printer Bluetooth
   ============================================================ */

// ============================================================
//   KONFIGURASI
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbwAXN70v0OfqkUuP9iTHGhQnZXz9yRTXGIr4Ks00-YF3KNzeAcs6fJuwlRnA1RV7PUH/exec';

// ============================================================
//   STATE
// ============================================================
let DB = {
  pengaturan: {},
  produk: [],
  penjualan: [],
  pembelian: [],
  cart: [],
  pbItems: [],
  currentPay: { method: 'cash', total: 0, cash: 0, change: 0 },
  lastTrx: null,
  filterRiwayat: 'semua'
};
let btDevice = null, btChar = null;
let pinBuffer = '';

// ============================================================
//   API WRAPPER
// ============================================================
async function api(action, payload = {}) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    return await res.json();
  } catch (e) {
    console.error('API error:', e);
    return { ok: false, message: 'Gagal koneksi ke server. Cek internet.' };
  }
}

// ============================================================
//   HELPERS
// ============================================================
const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const pad3 = (n) => ('000' + n).slice(-3);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = (d) => d.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' });
const fmtTime = (d) => d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });

function toast(msg, dur = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), dur);
}

function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ============================================================
//   PIN
// ============================================================
function setupPinInput() {
  const input = document.getElementById('pinInput');
  const dots = document.querySelectorAll('#pinDots span');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
    dots.forEach((d, i) => d.classList.toggle('active', i < input.value.length));
    document.getElementById('pinError').textContent = '';
    if (input.value.length === 4) setTimeout(submitPin, 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPin();
  });
  setTimeout(() => input.focus(), 300);
}

async function submitPin() {
  const pin = document.getElementById('pinInput').value;
  if (pin.length !== 4) return;
  const btn = document.getElementById('btnPinSubmit');
  btn.disabled = true;
  btn.textContent = 'Memeriksa...';
  const res = await api('cekPin', { pin });
  btn.disabled = false;
  btn.textContent = 'Masuk';
  if (res.ok) {
    document.getElementById('pinScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initApp();
  } else {
    document.getElementById('pinError').textContent = res.message || 'PIN salah';
    document.getElementById('pinInput').value = '';
    document.querySelectorAll('#pinDots span').forEach(d => d.classList.remove('active'));
    document.getElementById('pinInput').focus();
  }
}

// ============================================================
//   INIT APP (setelah PIN benar)
// ============================================================
async function initApp() {
  toast('Memuat data...', 1000);
  await Promise.all([
    loadPengaturan(),
    loadProduk(),
    loadAntrian()
  ]);
  renderProducts();
  renderCart();
  renderProdukList();
  renderPbProdukSelect();
  renderQueue();
}

async function loadPengaturan() {
  const res = await api('getPengaturan');
  if (res.ok) {
    DB.pengaturan = res.data || {};
    document.getElementById('storeTitle').textContent = DB.pengaturan.nama_toko || 'Kasir';
    document.getElementById('set_storeName').value = DB.pengaturan.nama_toko || '';
    document.getElementById('set_storeAddr').value = DB.pengaturan.alamat || '';
    document.getElementById('set_footer').value = DB.pengaturan.footer || '';
    document.getElementById('set_qris').value = DB.pengaturan.qris || '';
    document.getElementById('set_pin').value = DB.pengaturan.pin || '1234';
  }
}

async function loadProduk() {
  const res = await api('getProduk');
  if (res.ok) DB.produk = res.data || [];
}

async function loadAntrian() {
  const res = await api('nextAntrian');
  if (res.ok) {
    DB.pengaturan.nomor_antrian = res.data.nomor;
    document.getElementById('set_queue').value = res.data.angka;
  }
}

// ============================================================
//   TAB NAVIGASI
// ============================================================
function switchView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === v));
  document.getElementById('footerBar').style.display = v === 'kasir' ? 'flex' : 'none';
  if (v === 'produk') renderProdukList();
  if (v === 'riwayat') loadRiwayat();
  if (v === 'pembelian') renderPbProdukSelect();
}

// ============================================================
//   KASIR — PRODUK & KERANJANG
// ============================================================
function renderQueue() {
  document.getElementById('queueNo').textContent = pad3(DB.pengaturan.nomor_antrian || 1);
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (!DB.produk.length) {
    grid.innerHTML = '<div class="empty">Belum ada produk.<br>Tambahkan di tab Produk.</div>';
    return;
  }
  grid.innerHTML = DB.produk.map(p => `
    <div class="product-item" onclick="addToCart(${p.id})">
      <div class="name">${escapeHtml(p.nama)}</div>
      <div class="price">${rupiah(p.harga)}</div>
    </div>
  `).join('');
}

function addToCart(id) {
  const p = DB.produk.find(x => x.id === id);
  if (!p) return;
  const found = DB.cart.find(c => c.id === id);
  if (found) found.qty++;
  else DB.cart.push({ id: p.id, nama: p.nama, harga: p.harga, qty: 1 });
  renderCart();
}

function changeQty(idx, delta) {
  DB.cart[idx].qty += delta;
  if (DB.cart[idx].qty <= 0) DB.cart.splice(idx, 1);
  renderCart();
}

function renderCart() {
  const list = document.getElementById('cartList');
  const total = DB.cart.reduce((s, i) => s + i.harga * i.qty, 0);
  document.getElementById('grandTotal').textContent = rupiah(total);
  document.getElementById('btnBayar').disabled = DB.cart.length === 0;
  const totalQty = DB.cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('cartCount').textContent = DB.cart.length ? `(${totalQty})` : '';

  if (!DB.cart.length) {
    list.innerHTML = '<div class="empty">Keranjang kosong</div>';
    return;
  }
  list.innerHTML = DB.cart.map((i, idx) => `
    <div class="cart-item">
      <div class="info">
        <div class="nm">${escapeHtml(i.nama)}</div>
        <div class="pr">${rupiah(i.harga)}</div>
      </div>
      <div class="qty-ctrl">
        <button onclick="changeQty(${idx},-1)">−</button>
        <span class="qty">${i.qty}</span>
        <button onclick="changeQty(${idx},1)">+</button>
      </div>
      <div class="subtotal">${rupiah(i.harga * i.qty)}</div>
    </div>
  `).join('');
}

// ============================================================
//   PEMBAYARAN
// ============================================================
function openPayModal() {
  if (!DB.cart.length) return;
  const total = DB.cart.reduce((s, i) => s + i.harga * i.qty, 0);
  DB.currentPay = { method: 'cash', total, cash: 0, change: 0 };
  document.getElementById('payTotal').textContent = rupiah(total);
  document.getElementById('cashInput').value = '';
  document.getElementById('changeText').value = 'Rp 0';
  selectPayMethod('cash');
  openModal('modalBayar');
}

function selectPayMethod(method) {
  DB.currentPay.method = method;
  document.querySelectorAll('.pay-method').forEach(el =>
    el.classList.toggle('active', el.dataset.method === method));
  document.getElementById('cashPanel').style.display = method === 'cash' ? 'block' : 'none';
  document.getElementById('qrisPanel').style.display = method === 'qris' ? 'block' : 'none';
  if (method === 'qris') generateQRIS();
}

function fillCash(v) {
  const input = document.getElementById('cashInput');
  input.value = v === 'exact' ? DB.currentPay.total : v;
  updateChange();
}

function updateChange() {
  const cash = parseInt(document.getElementById('cashInput').value) || 0;
  const change = cash - DB.currentPay.total;
  DB.currentPay.cash = cash;
  DB.currentPay.change = change;
  const el = document.getElementById('changeText');
  if (change >= 0) {
    el.value = rupiah(change);
    el.style.color = '#10b981';
  } else {
    el.value = 'Kurang ' + rupiah(-change);
    el.style.color = '#ef4444';
  }
}

document.addEventListener('input', e => {
  if (e.target.id === 'cashInput') updateChange();
});

async function confirmPayment() {
  if (DB.currentPay.method === 'cash') {
    if (DB.currentPay.cash < DB.currentPay.total) {
      toast('Uang belum cukup'); return;
    }
  }
  const trx = {
    nama_pembeli: document.getElementById('buyerName').value.trim() || '-',
    tanggal: fmtDate(new Date()) + ' ' + fmtTime(new Date()),
    metode: DB.currentPay.method,
    total: DB.currentPay.total,
    bayar: DB.currentPay.cash,
    kembali: DB.currentPay.change,
    items: DB.cart.map(i => ({ id: i.id, nama: i.nama, harga: i.harga, qty: i.qty }))
  };
  const btn = document.querySelector('#modalBayar .btn-success');
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  const res = await api('simpanPenjualan', trx);
  btn.disabled = false; btn.textContent = 'Konfirmasi & Cetak';
  if (res.ok) {
    trx.no_antrian = res.data.no_antrian;
    DB.lastTrx = trx;
    DB.pengaturan.nomor_antrian = parseInt(res.data.no_antrian) + 1;
    renderQueue();
    closeModal('modalBayar');
    showStruk(trx);
  } else {
    toast(res.message || 'Gagal simpan');
  }
}

function resetTransaksi() {
  DB.cart = [];
  document.getElementById('buyerName').value = '';
  renderCart();
}

// ============================================================
//   QRIS
// ============================================================
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function parseTLV(str) {
  const arr = []; let i = 0;
  while (i < str.length - 3) {
    const tag = str.substr(i, 2);
    const len = parseInt(str.substr(i + 2, 2), 10);
    if (isNaN(len)) break;
    arr.push({ tag, value: str.substr(i + 4, len) });
    i += 4 + len;
  }
  return arr;
}

function makeDynamicQRIS(staticStr, amount) {
  if (!staticStr || staticStr.length < 20) return null;
  try {
    const base = staticStr.slice(0, -8);
    const tlvs = parseTLV(base);
    const map = {};
    tlvs.forEach(t => { if (t.tag !== '63') map[t.tag] = t.value; });
    map['01'] = '12';
    map['54'] = String(Math.round(amount));
    const order = ['00','01','02','03','51','52','53','54','55','56','57','58','59','60','61','62','64'];
    let result = '';
    order.forEach(tag => {
      if (map[tag] !== undefined) {
        result += tag + String(map[tag].length).padStart(2, '0') + map[tag];
      }
    });
    result += '6304';
    return result + crc16(result);
  } catch (e) { return null; }
}

function generateQRIS() {
  const qrEl = document.getElementById('qrcode');
  qrEl.innerHTML = '';
  const qrisStr = DB.pengaturan.qris;
  let payload;
  if (qrisStr && qrisStr.length > 20) {
    payload = makeDynamicQRIS(qrisStr, DB.currentPay.total);
  }
  if (!payload) payload = 'QRIS belum diset. Atur di menu Pengaturan.';
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrEl, { text: payload, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  } else {
    qrEl.textContent = 'QR library gagal dimuat';
  }
}

// ============================================================
//   STRUK
// ============================================================
function buildStrukText(trx) {
  const W = 32;
  const line = '-'.repeat(W);
  const padR = (l, r) => {
    l = String(l); r = String(r);
    if (l.length + r.length >= W) return l.slice(0, W - r.length - 1) + ' ' + r;
    return l + ' '.repeat(W - l.length - r.length) + r;
  };
  const center = (t) => {
    t = String(t);
    if (t.length >= W) return t;
    return ' '.repeat(Math.floor((W - t.length) / 2)) + t;
  };
  const L = [];
  L.push(center((DB.pengaturan.nama_toko || 'TOKO').toUpperCase()));
  if (DB.pengaturan.alamat) L.push(center(DB.pengaturan.alamat));
  L.push(line);
  L.push(padR('No. Antrian', trx.no_antrian || '-'));
  L.push(padR('Pembeli', trx.nama_pembeli));
  L.push(padR('Tanggal', trx.tanggal));
  L.push(line);
  trx.items.forEach(it => {
    L.push(it.nama);
    L.push(padR(`  ${it.qty} x ${rupiah(it.harga)}`, rupiah(it.harga * it.qty)));
  });
  L.push(line);
  L.push(padR('TOTAL', rupiah(trx.total)));
  if (trx.metode === 'cash') {
    L.push(padR('Tunai', rupiah(trx.bayar)));
    L.push(padR('Kembali', rupiah(trx.kembali)));
  } else {
    L.push(padR('Metode', 'QRIS'));
  }
  L.push(line);
  L.push(center(DB.pengaturan.footer || 'Terima kasih'));
  L.push(''); L.push('');
  return L.join('\n');
}

function showStruk(trx) {
  document.getElementById('strukPreview').textContent = buildStrukText(trx);
  openModal('modalStruk');
}

// ============================================================
//   PRODUK (CRUD)
// ============================================================
function renderProdukList() {
  const el = document.getElementById('produkList');
  if (!DB.produk.length) {
    el.innerHTML = '<div class="empty">Belum ada produk</div>';
    return;
  }
  el.innerHTML = DB.produk.map(p => `
    <div class="cart-item">
      <div class="info">
        <div class="nm">${escapeHtml(p.nama)}</div>
        <div class="pr">${rupiah(p.harga)}</div>
      </div>
      <button class="btn-secondary" style="padding:6px 12px;font-size:13px" onclick="openProductModal(${p.id})">Edit</button>
      <button class="btn-secondary" style="padding:6px 12px;font-size:13px;color:#ef4444" onclick="deleteProduct(${p.id})">Hapus</button>
    </div>
  `).join('');
}

function openProductModal(id) {
  if (id) {
    const p = DB.produk.find(x => x.id === id);
    document.getElementById('produkModalTitle').textContent = 'Edit Produk';
    document.getElementById('p_id').value = p.id;
    document.getElementById('p_name').value = p.nama;
    document.getElementById('p_price').value = p.harga;
  } else {
    document.getElementById('produkModalTitle').textContent = 'Tambah Produk';
    document.getElementById('p_id').value = '';
    document.getElementById('p_name').value = '';
    document.getElementById('p_price').value = '';
  }
  openModal('modalProduk');
}

async function saveProduct() {
  const id = document.getElementById('p_id').value;
  const nama = document.getElementById('p_name').value.trim();
  const harga = parseInt(document.getElementById('p_price').value) || 0;
  if (!nama || harga <= 0) { toast('Isi nama dan harga'); return; }
  const payload = { nama, harga, aktif: 1 };
  if (id) payload.id = parseInt(id);
  const res = await api('simpanProduk', payload);
  if (res.ok) {
    toast('Produk disimpan');
    closeModal('modalProduk');
    await loadProduk();
    renderProducts();
    renderProdukList();
    renderPbProdukSelect();
  } else {
    toast(res.message || 'Gagal');
  }
}

async function deleteProduct(id) {
  if (!confirm('Hapus produk ini?')) return;
  const res = await api('hapusProduk', { id });
  if (res.ok) {
    toast('Produk dihapus');
    await loadProduk();
    renderProducts();
    renderProdukList();
    renderPbProdukSelect();
  }
}

// ============================================================
//   PEMBELIAN
// ============================================================
function renderPbProdukSelect() {
  const sel = document.getElementById('pbProdukSelect');
  sel.innerHTML = '<option value="">-- Pilih Produk --</option>' +
    DB.produk.map(p => `<option value="${p.id}" data-harga="${p.harga}">${escapeHtml(p.nama)}</option>`).join('');
  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    if (opt.dataset.harga) {
      document.getElementById('pbHarga').value = Math.round(parseInt(opt.dataset.harga) * 0.7);
    }
  };
}

function addPbItem() {
  const sel = document.getElementById('pbProdukSelect');
  const id = parseInt(sel.value);
  const qty = parseInt(document.getElementById('pbQty').value) || 1;
  const harga = parseInt(document.getElementById('pbHarga').value) || 0;
  if (!id || qty <= 0 || harga <= 0) { toast('Lengkapi data item'); return; }
  const p = DB.produk.find(x => x.id === id);
  DB.pbItems.push({ id, nama: p.nama, qty, harga });
  renderPbItems();
  document.getElementById('pbQty').value = 1;
  document.getElementById('pbHarga').value = '';
  sel.value = '';
}

function renderPbItems() {
  const el = document.getElementById('pbItemList');
  if (!DB.pbItems.length) {
    el.innerHTML = '<div class="empty">Belum ada item</div>';
    document.getElementById('pbTotal').textContent = 'Rp 0';
    return;
  }
  let total = 0;
  el.innerHTML = DB.pbItems.map((it, idx) => {
    total += it.qty * it.harga;
    return `
      <div class="cart-item">
        <div class="info">
          <div class="nm">${escapeHtml(it.nama)}</div>
          <div class="pr">${it.qty} x ${rupiah(it.harga)}</div>
        </div>
        <div class="subtotal">${rupiah(it.qty * it.harga)}</div>
        <button class="btn-secondary" style="padding:4px 8px;font-size:12px;color:#ef4444" onclick="removePbItem(${idx})">×</button>
      </div>`;
  }).join('');
  document.getElementById('pbTotal').textContent = rupiah(total);
}

function removePbItem(idx) {
  DB.pbItems.splice(idx, 1);
  renderPbItems();
}

async function savePembelian() {
  const supplier = document.getElementById('pbSupplier').value.trim();
  if (!supplier) { toast('Isi nama supplier'); return; }
  if (!DB.pbItems.length) { toast('Tambahkan item dulu'); return; }
  const total = DB.pbItems.reduce((s, i) => s + i.qty * i.harga, 0);
  const payload = {
    supplier,
    tanggal: fmtDate(new Date()) + ' ' + fmtTime(new Date()),
    total,
    catatan: document.getElementById('pbCatatan').value.trim(),
    items: DB.pbItems
  };
  const res = await api('simpanPembelian', payload);
  if (res.ok) {
    toast('Pembelian tersimpan');
    DB.pbItems = [];
    renderPbItems();
    document.getElementById('pbSupplier').value = '';
    document.getElementById('pbCatatan').value = '';
  } else {
    toast(res.message || 'Gagal');
  }
}

// ============================================================
//   RIWAYAT
// ============================================================
function setFilter(f) {
  DB.filterRiwayat = f;
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  loadRiwayat();
}

async function loadRiwayat() {
  const el = document.getElementById('riwayatList');
  el.innerHTML = '<div class="empty">Memuat...</div>';
  const [pj, pb] = await Promise.all([api('getPenjualan'), api('getPembelian')]);
  let items = [];
  if (pj.ok) items = items.concat((pj.data || []).map(x => ({ ...x, tipe: 'penjualan' })));
  if (pb.ok) items = items.concat((pb.data || []).map(x => ({ ...x, tipe: 'pembelian' })));
  items.sort((a, b) => b.id - a.id);
  if (DB.filterRiwayat !== 'semua') items = items.filter(x => x.tipe === DB.filterRiwayat);

  if (!items.length) { el.innerHTML = '<div class="empty">Belum ada transaksi</div>'; return; }

  el.innerHTML = items.map(t => {
    if (t.tipe === 'penjualan') {
      return `
        <div class="riwayat-item">
          <div class="row">
            <div><span class="no">#${t.no_antrian}</span><span class="nm">${escapeHtml(t.nama_pembeli)}</span></div>
            <div class="amt" style="color:#0ea5e9">${rupiah(t.total)}</div>
          </div>
          <div class="tgl">${t.tanggal} • ${t.metode.toUpperCase()}</div>
        </div>`;
    } else {
      return `
        <div class="riwayat-item pembelian">
          <div class="row">
            <div><span class="no">BELI</span><span class="nm">${escapeHtml(t.supplier)}</span></div>
            <div class="amt" style="color:#f59e0b">${rupiah(t.total)}</div>
          </div>
          <div class="tgl">${t.tanggal} ${t.catatan ? '• ' + escapeHtml(t.catatan) : ''}</div>
        </div>`;
    }
  }).join('');
}

// ============================================================
//   PENGATURAN
// ============================================================
async function saveSettings() {
  const payload = {
    nama_toko: document.getElementById('set_storeName').value.trim() || 'Toko Saya',
    alamat: document.getElementById('set_storeAddr').value.trim(),
    footer: document.getElementById('set_footer').value.trim(),
    qris: document.getElementById('set_qris').value.trim(),
    pin: document.getElementById('set_pin').value.trim() || '1234'
  };
  const res = await api('setPengaturan', payload);
  if (res.ok) {
    DB.pengaturan = { ...DB.pengaturan, ...payload };
    document.getElementById('storeTitle').textContent = payload.nama_toko;
    toast('Pengaturan disimpan');
  } else {
    toast(res.message || 'Gagal simpan');
  }
}

async function resetQueue() {
  if (!confirm('Reset nomor antrian ke 1?')) return;
  const res = await api('resetAntrian');
  if (res.ok) {
    DB.pengaturan.nomor_antrian = 1;
    document.getElementById('set_queue').value = 1;
    renderQueue();
    toast('Antrian direset ke 001');
  }
}

// ============================================================
//   PRINTER BLUETOOTH
// ============================================================
function updateBtStatus(connected, name) {
  const el = document.getElementById('btStatus');
  el.classList.toggle('connected', connected);
  document.getElementById('btText').textContent = connected ? (name || 'Printer').slice(0, 12) : 'Printer';
}

function handleBtClick() {
  if (btChar) {
    if (confirm('Putuskan printer?')) {
      try { btDevice.gatt.disconnect(); } catch (e) {}
      btChar = null; btDevice = null;
      updateBtStatus(false);
    }
  } else {
    connectPrinter();
  }
}

async function connectPrinter() {
  if (!navigator.bluetooth) {
    toast('Browser tidak mendukung Bluetooth'); return;
  }
  try {
    btDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '0000ff00-0000-1000-8000-00805f9b34fb',
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '0000fff0-0000-1000-8000-00805f9b34fb'
      ]
    });
    const server = await btDevice.gatt.connect();
    const services = await server.getPrimaryServices();
    btChar = null;
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) { btChar = c; break; }
      }
      if (btChar) break;
    }
    if (!btChar) throw new Error('Karakteristik write tidak ditemukan');
    updateBtStatus(true, btDevice.name || 'Printer');
    toast('Printer terhubung');
  } catch (e) {
    console.error(e);
    toast('Gagal konek: ' + e.message);
    updateBtStatus(false);
  }
}

async function sendBytes(bytes) {
  if (!btChar) throw new Error('Printer belum terhubung');
  const chunkSize = 100;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    if (btChar.properties.writeWithoutResponse) await btChar.writeValueWithoutResponse(chunk);
    else await btChar.writeValue(chunk);
    await new Promise(r => setTimeout(r, 15));
  }
}

function buildReceiptBytes(text) {
  const enc = new TextEncoder();
  const parts = [];
  const push = (...b) => parts.push(new Uint8Array(b));
  const pushT = (t) => parts.push(enc.encode(t));
  push(0x1B, 0x40);
  push(0x1B, 0x61, 0x01);
  pushT(text + '\n');
  push(0x1B, 0x64, 0x03);
  push(0x1D, 0x56, 0x00);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach(p => { out.set(p, off); off += p.length; });
  return out;
}

async function printStruk() {
  if (!DB.lastTrx) return;
  if (!btChar) { toast('Hubungkan printer dulu'); return; }
  try {
    await sendBytes(buildReceiptBytes(buildStrukText(DB.lastTrx)));
    toast('Struk dicetak');
  } catch (e) { toast('Gagal cetak: ' + e.message); }
}

async function testPrint() {
  if (!btChar) { toast('Hubungkan printer dulu'); return; }
  try {
    await sendBytes(buildReceiptBytes('TEST PRINT\n' + (DB.pengaturan.nama_toko || 'Kasir') + '\nPrinter OK\n'));
    toast('Test print terkirim');
  } catch (e) { toast('Gagal: ' + e.message); }
}

// ============================================================
//   START
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  setupPinInput();
});