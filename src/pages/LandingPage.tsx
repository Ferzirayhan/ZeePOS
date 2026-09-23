import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { BrandMark } from '../components/app/BrandMark'

interface DemoItem {
  id: string
  name: string
  category: string
  price: number
  qty: number
}

export function LandingPage() {
  const { session, user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'coffee' | 'retail' | 'fashion' | 'grosir' | 'online'>('coffee')
  const [demoMethod, setDemoMethod] = useState<'qris' | 'tunai' | 'transfer'>('qris')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  // Interactive Live POS Simulator State
  const [demoItems, setDemoItems] = useState<DemoItem[]>([
    { id: '1', name: 'Iced Aren Latte', category: 'Coffee', price: 22000, qty: 2 },
    { id: '2', name: 'Butter Croissant', category: 'Pastry', price: 18000, qty: 1 },
    { id: '3', name: 'Earl Grey Milk Tea', category: 'Tea', price: 20000, qty: 1 },
  ])

  const updateDemoQty = (id: string, delta: number) => {
    setDemoItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const nextQty = Math.max(0, item.qty + delta)
            return { ...item, qty: nextQty }
          }
          return item
        })
        .filter((item) => item.qty > 0),
    )
  }

  const demoSubtotal = demoItems.reduce((acc, item) => acc + item.price * item.qty, 0)
  const demoDiscount = demoSubtotal > 50000 ? 5000 : 0
  const demoTotal = Math.max(0, demoSubtotal - demoDiscount)

  const businessSolutions = {
    coffee: {
      tag: 'RESTORAN, KAFE & MINUMAN',
      title: 'Restoran, Coffee Shop & Kafe',
      headline: 'Antrean kasir cepat, pesanan dapur & nomor meja akurat.',
      image: '/hero-resto.jpg',
      badge: 'Resto & Kafe Ready',
      points: [
        { icon: 'bolt', title: 'Tap & Bayar Kilat', desc: 'Desain kasir gesit untuk jam ramai restoran, kafe, dan kedai minuman.' },
        { icon: 'table_restaurant', title: 'Nomor Meja & Catatan Koki', desc: 'Input nomor meja dan instruksi dapur (less sugar, pedas, tanpa bawang) pada struk.' },
        { icon: 'account_balance_wallet', title: 'Rekap Kas & Shift Barista/Kasir', desc: 'Hitung modal laci awal dan selisih uang fisik saat pergantian shift.' },
        { icon: 'qr_code_2', title: 'QRIS & Multi Payment', desc: 'Pelanggan bayar QRIS / Transfer / Tunai instan dengan verifikasi pending.' },
      ],
    },
    retail: {
      tag: 'MINIMARKET & KELONTONG',
      title: 'Minimarket & Retail',
      headline: 'Ribuan stok terpantau rapi tanpa takut selisih.',
      image: '/hero-dashboard.jpg',
      badge: 'Barcode Scanner Ready',
      points: [
        { icon: 'barcode_scanner', title: 'Scan Barcode Seketika', desc: 'Langsung hubungkan scanner barcode USB atau wireless tanpa install driver.' },
        { icon: 'notifications_active', title: 'Alarm Stok Menipis', desc: 'Tahu persis kapan harus reorder barang sebelum persediaan habis.' },
        { icon: 'layers', title: 'Multi-Satuan Barang', desc: 'Bisa jual eceran satuan pcs, pack, hingga dus karton sekaligus.' },
        { icon: 'history', title: 'Riwayat Penyesuaian Stok', desc: 'Catat barang rusak, retur supplier, dan inventaris berkala.' },
      ],
    },
    fashion: {
      tag: 'DISTRO & CLOTHING BRAND',
      title: 'Distro & Butik Fashion',
      headline: 'Kelola varian warna dan size dalam satu klik.',
      image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1000&q=80',
      badge: 'Varian SKU Rapi',
      points: [
        { icon: 'sell', title: 'Varian Size & Warna', desc: 'Pisahkan varian S, M, L, XL dan warna baju tanpa bikin katalog berantakan.' },
        { icon: 'percent', title: 'Diskon Flash Sale & Promo', desc: 'Set potongan harga persen atau rupiah saat event tanggal kembar.' },
        { icon: 'print', title: 'Struk Estetik Keren', desc: 'Tampilan nota thermal rapi dengan akun Instagram dan barcode toko.' },
        { icon: 'trending_up', title: 'Katalog Best Seller', desc: 'Lihat koleksi baju atau celana yang paling laku minggu ini.' },
      ],
    },
    grosir: {
      tag: 'GROSIR & AGEN DISTRIBUSI',
      title: 'Grosir & Distributor',
      headline: 'Otomasi harga partai dan pencatatan tonase.',
      image: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1000&q=80',
      badge: 'Tier Diskon Grosir',
      points: [
        { icon: 'price_check', title: 'Tier Diskon Kuantitas', desc: 'Beli 1 lusin lebih murah, beli 1 karton harga otomatis disesuaikan.' },
        { icon: 'calculate', title: 'Pantau HPP & Margin Bersih', desc: 'Setiap barang terjual langsung dihitung selisih profit real-time.' },
        { icon: 'folder_zip', title: 'Repack Barang Karung ke Ecer', desc: 'Pecah kuantitas besar jadi bungkusan kecil tanpa bikin stok error.' },
        { icon: 'receipt', title: 'Format Faktur Penjualan', desc: 'Nomor nota rapi dan urut untuk rekap keuangan bulanan.' },
      ],
    },
    online: {
      tag: 'ONLINE SHOP & SOCIAL COMMERCE',
      title: 'Online Shop & Seller Marketplace',
      headline: 'Kelola pesanan WhatsApp, IG, Tokped & Shopee dari satu sistem.',
      image: 'https://images.unsplash.com/photo-1556742049-0a67daf40d6c?auto=format&fit=crop&w=1000&q=80',
      badge: 'Online Seller Ready',
      points: [
        { icon: 'shopping_bag', title: 'Pencatatan Pesanan Online', desc: 'Input pesanan masuk dari WhatsApp / DM / E-commerce dengan pembayaran Transfer & QRIS.' },
        { icon: 'inventory_2', title: 'Stok Terpusat Real-Time', desc: 'Stok berkurang otomatis saat ada orderan masuk baik online maupun offline.' },
        { icon: 'groups', title: 'Harga Reseller & Dropshipper', desc: 'Atur tier harga khusus untuk Reseller, Agent, atau pembeli eceran online.' },
        { icon: 'file_download', title: 'Export Rekap Excel Bulanan', desc: 'Download laporan transaksi penjualan online untuk pembukuan akuntansi & pajak.' },
      ],
    },
  }

  const features = [
    {
      icon: 'published_with_changes',
      tag: 'INVENTARIS GROSIR',
      title: 'Multi Satuan dan Repack Otomatis',
      desc: 'Jual per dus, pak, pcs, sampai karungan. Repack karung 50kg jadi 50 kantong 1kg tinggal sekali klik, stok otomatis sinkron tanpa bikin pusing.',
    },
    {
      icon: 'account_balance_wallet',
      tag: 'KONTROL KAS',
      title: 'Shift Kasir Anti Selisih',
      desc: 'Set modal awal di laci, catat keluar masuk uang kasir, dan itung uang fisik pas tutup toko. Langsung ketahuan klop atau ada selisih uang.',
    },
    {
      icon: 'pause_circle',
      tag: 'ANTREAN RAMAI',
      title: 'Parkir Pesanan Belanja',
      desc: 'Pembeli mendadak mau ambil barang lain? Parkir dulu pesanannya, layani antrean berikutnya. Gak perlu input ulang dari nol.',
    },
    {
      icon: 'schedule',
      tag: 'PIUTANG',
      title: 'Catatan Tempo dan Bon Pelanggan',
      desc: 'Kasih tempo buat langganan lo lengkap sama jatuh tempo. Sisa utang dan cicilan kecatat rapi, gak bakal ada bon nyelip.',
    },
    {
      icon: 'lock',
      tag: 'PRIVASI OWNER',
      title: 'Modal Toko Terkunci Rapat',
      desc: 'Kasir lo fokus melayani pembeli aja. Harga modal beli (HPP) sama laba bersih toko lo aman terkunci, cuma owner yang bisa liat.',
    },
    {
      icon: 'qr_code_scanner',
      tag: 'HEMAT HARDWARE',
      title: 'Scan Barcode Kamera HP',
      desc: 'Gak usah beli scanner mahal. Pake kamera HP lo langsung buat scan barcode barang, terus cetak struk via printer thermal Bluetooth.',
    },
  ]

  const faqs = [
    {
      q: 'Butuh komputer atau mesin kasir khusus gak?',
      a: 'Gak sama sekali. Lo bisa buka ZeePOS di browser apa aja: laptop, tablet, sampai smartphone yang lagi lo pegang sekarang.',
    },
    {
      q: 'Bisa langsung konek ke printer thermal Bluetooth?',
      a: 'Bisa banget. ZeePOS langsung nyambung ke printer thermal Bluetooth maupun kabel USB tanpa ribet instal driver.',
    },
    {
      q: 'Gimana kalau toko gue punya beberapa kasir dan gantian shift?',
      a: 'Tinggal pake fitur Shift Kasir bawaan. Kasir masukin modal awal pas buka laci, terus pas tutup shift tinggal hitung uang fisik. Langsung ketahuan pas atau ada selisih.',
    },
    {
      q: 'Data omzet sama stok toko gue aman gak?',
      a: 'Aman banget. Data tiap toko dipisah total pakai Row Level Security PostgreSQL. Toko lain gak bakal bisa ngintip transaksi, stok, atau keuntungan lo.',
    },
  ]

  const currentSolution = businessSolutions[activeTab]

  return (
    <div className="min-h-screen scroll-smooth bg-[#fafbfa] text-[#1f2937] font-sans antialiased">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 sm:h-20 max-w-7xl items-center justify-between px-3.5 sm:px-8">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 group shrink-0">
            <BrandMark size="sm" className="sm:hidden" />
            <BrandMark size="md" className="hidden sm:flex" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="font-display text-xl sm:text-2xl font-black tracking-tight text-[#1f2937]">ZeePOS</span>
                <span className="hidden sm:inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#2563eb] border border-blue-200">
                  Cloud
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-500 hidden md:block">Point of Sale untuk Generasi Baru</p>
            </div>
          </Link>

          <nav className="flex items-center gap-1.5 sm:gap-4 shrink-0">
            <a
              href="#solusi"
              className="hidden text-sm font-bold text-slate-600 transition hover:text-[#2563eb] md:block"
            >
              Solusi Usaha
            </a>
            <a
              href="#simulator"
              className="hidden text-sm font-bold text-slate-600 transition hover:text-[#2563eb] md:block"
            >
              Coba Kasir
            </a>
            <a
              href="#fitur"
              className="hidden text-sm font-bold text-slate-600 transition hover:text-[#2563eb] md:block"
            >
              Fitur
            </a>
            <a
              href="#faq"
              className="hidden text-sm font-bold text-slate-600 transition hover:text-[#2563eb] md:block"
            >
              FAQ
            </a>

            {session && user ? (
              <Link
                to="/dashboard"
                className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-black text-[#2563eb] shadow-sm transition hover:bg-blue-100 whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-base">dashboard</span>
                <span>Dashboard</span>
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-base text-[#2563eb]">login</span>
                  <span>Masuk</span>
                </Link>

                <Link
                  to="/register"
                  className="flex items-center gap-1 rounded-xl bg-[#2563eb] px-3.5 py-2 text-xs font-black text-white shadow-md shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] whitespace-nowrap"
                >
                  <span>Coba Gratis</span>
                  <span className="material-symbols-outlined text-sm hidden sm:inline">arrow_forward</span>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 pt-10 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-10">
            {/* Left Headline */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-emerald-50 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-[#2563eb]">
                <span className="flex h-2 w-2 rounded-full bg-[#10b981] animate-ping" />
                Trial 7 Hari Gratis, Langsung Pakai Tanpa Kartu Kredit
              </div>

              <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-black tracking-[-0.04em] text-[#1f2937] leading-[1.08]">
                Bikin kasir toko lo <span className="text-[#2563eb]">sat-set</span> tanpa drama selisih uang.
              </h1>

              <p className="text-base sm:text-xl text-slate-600 font-medium leading-relaxed max-w-2xl">
                Tinggalkan bon kertas yang bikin pusing. ZeePOS bantu catat belanjaan kilat, pecah stok dus ke eceran, rekap uang laci kasir, sampai hitung laba bersih otomatis.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 pt-2">
                <Link
                  to="/register"
                  className="flex items-center justify-center gap-2.5 rounded-2xl bg-[#2563eb] px-8 py-4 font-display text-base font-black text-white shadow-xl shadow-[#2563eb]/25 transition hover:bg-[#1d4ed8] hover:-translate-y-0.5"
                >
                  <span className="material-symbols-outlined text-xl">storefront</span>
                  Mulai Coba 7 Hari Gratis
                </Link>
                <Link
                  to="/login"
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-7 py-4 text-base font-extrabold text-slate-800 transition hover:bg-slate-50 hover:border-slate-300"
                >
                  <span className="material-symbols-outlined text-xl text-[#2563eb]">login</span>
                  Masuk Kasir
                </Link>
              </div>

              {/* Fast Perks */}
              <div className="grid grid-cols-3 gap-4 border-t border-slate-200/80 pt-6">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-black text-[#1f2937]">
                    <span className="material-symbols-outlined text-base text-[#2563eb]">timer</span>
                    Setup 1 Menit
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">Langsung bisa transaksi</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-black text-[#1f2937]">
                    <span className="material-symbols-outlined text-base text-[#2563eb]">wallet</span>
                    Rekap Kas Laci
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">Cegah kebocoran modal</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-black text-[#1f2937]">
                    <span className="material-symbols-outlined text-base text-[#2563eb]">security</span>
                    Data Aman Terisolasi
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">PostgreSQL RLS ketat</p>
                </div>
              </div>
            </div>

            {/* Right Live Interactive Simulator Card */}
            <div id="simulator" className="lg:col-span-5">
              <div className="relative rounded-3xl border border-slate-200/90 bg-white p-6 shadow-2xl shadow-slate-900/8">
                {/* Simulator Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 border border-blue-200 text-[#2563eb]">
                      <span className="material-symbols-outlined text-xl">point_of_sale</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display font-black text-sm text-[#1f2937]">Kopi Titik Temu</p>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-[#2563eb]">
                          Shift 1 Aktif
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">Interaktif : coba tambah & kurang item</p>
                    </div>
                  </div>
                  <span className="flex h-2.5 w-2.5 rounded-full bg-[#10b981]" />
                </div>

                {/* Items in Cart with Live Controls */}
                <div className="mt-4 space-y-2.5">
                  {demoItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3 transition hover:bg-slate-50"
                    >
                      <div>
                        <p className="text-xs font-black text-[#1f2937]">{item.name}</p>
                        <p className="text-[11px] font-semibold text-slate-400">
                          Rp {item.price.toLocaleString('id-ID')} / item
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-0.5 shadow-sm">
                          <button
                            type="button"
                            onClick={() => updateDemoQty(item.id, -1)}
                            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:scale-95"
                            title="Kurangi"
                          >
                            <span className="material-symbols-outlined text-sm">remove</span>
                          </button>
                          <span className="w-5 text-center text-xs font-black text-[#1f2937]">{item.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateDemoQty(item.id, 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:scale-95"
                            title="Tambah"
                          >
                            <span className="material-symbols-outlined text-sm">add</span>
                          </button>
                        </div>
                        <span className="w-20 text-right font-display text-xs font-black text-[#2563eb]">
                          Rp {(item.price * item.qty).toLocaleString('id-ID')}
                        </span>
                      </div>
                    </div>
                  ))}

                  {demoItems.length === 0 && (
                    <div className="py-6 text-center text-xs text-slate-400 font-semibold">
                      Keranjang kosong. Tekan refresh untuk mereset data contoh.
                    </div>
                  )}
                </div>

                {/* Quick Add Helper if empty */}
                {demoItems.length < 3 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDemoItems([
                        { id: '1', name: 'Iced Aren Latte', category: 'Coffee', price: 22000, qty: 2 },
                        { id: '2', name: 'Butter Croissant', category: 'Pastry', price: 18000, qty: 1 },
                        { id: '3', name: 'Earl Grey Milk Tea', category: 'Tea', price: 20000, qty: 1 },
                      ])
                    }
                    className="mt-2 text-center w-full text-[11px] font-black text-[#2563eb] hover:underline"
                  >
                    + Reset Menu Contoh
                  </button>
                )}

                {/* Live Bill Breakdown */}
                <div className="mt-4 border-t border-slate-100 pt-3 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Subtotal Produk</span>
                    <span className="font-bold text-[#1f2937]">Rp {demoSubtotal.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Diskon Pembelian &gt; 50k</span>
                    <span className="font-bold text-red-500">- Rp {demoDiscount.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 text-sm">
                    <span className="font-display font-black text-[#1f2937]">Total Bayar</span>
                    <span className="font-display text-2xl font-black text-[#2563eb]">
                      Rp {demoTotal.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                {/* Payment Method Selector */}
                <div className="mt-4 grid grid-cols-3 gap-1.5">
                  {(['qris', 'tunai', 'transfer'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setDemoMethod(method)}
                      className={`flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-black uppercase tracking-wider transition ${
                        demoMethod === method
                          ? 'bg-[#2563eb] text-white shadow-sm'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {method === 'qris' ? 'qr_code_2' : method === 'tunai' ? 'payments' : 'credit_card'}
                      </span>
                      {method}
                    </button>
                  ))}
                </div>

                {/* Action CTA inside mockup */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link
                    to="/login"
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-3 text-xs font-display font-black text-slate-700 hover:bg-slate-50 transition shadow-sm"
                  >
                    <span className="material-symbols-outlined text-base text-[#2563eb]">login</span>
                    <span>Masuk Kasir</span>
                  </Link>
                  <Link
                    to="/register"
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-[#2563eb] py-3 text-xs font-display font-black uppercase tracking-wider text-white shadow-md shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8]"
                  >
                    <span className="material-symbols-outlined text-base">rocket_launch</span>
                    <span>Trial 7 Hari</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Solutions Tab Section */}
      <section id="solusi" className="scroll-mt-24 border-t border-slate-200/80 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="mx-auto max-w-3xl text-center space-y-3">
            <span className="rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-black uppercase tracking-widest text-[#2563eb] border border-emerald-100">
              Fleksibel Buat Segala Jenis Usaha
            </span>
            <h2 className="font-display text-3xl sm:text-5xl font-black tracking-tight text-[#1f2937]">
              Satu aplikasi kasir, cocok buat alur toko lo.
            </h2>
            <p className="text-base sm:text-lg text-slate-600 font-medium">
              Mau lo jualan kopi, buka toko kelontong, butik baju, sampai agen sembako grosir karungan.
            </p>
          </div>

          {/* Solution Tabs */}
          <div className="mt-10 flex flex-wrap justify-center gap-2.5">
            {[
              { key: 'coffee', label: 'Coffee Shop & Kafe', icon: 'local_cafe' },
              { key: 'retail', label: 'Minimarket & Retail', icon: 'storefront' },
              { key: 'fashion', label: 'Distro & Fashion', icon: 'checkroom' },
              { key: 'grosir', label: 'Grosir & Agen', icon: 'inventory_2' },
              { key: 'online', label: 'Online Shop & Seller', icon: 'shopping_bag' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex items-center gap-2 rounded-2xl px-5 py-3 font-display text-sm font-black transition ${
                  activeTab === tab.key
                    ? 'bg-[#2563eb] text-white shadow-lg shadow-blue-500/20 scale-105'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Solution Active Showcase Card */}
          <div className="mt-12 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/60 p-6 sm:p-10 shadow-sm">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-5">
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-md">
                  <img
                    src={currentSolution.image}
                    alt={currentSolution.title}
                    className="h-80 w-full object-cover sm:h-96"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <span className="rounded-md bg-[#2563eb] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                      {currentSolution.badge}
                    </span>
                    <p className="mt-1 font-display text-lg font-black">{currentSolution.title}</p>
                    <p className="text-xs text-white/80 font-medium">{currentSolution.headline}</p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 space-y-6">
                <div>
                  <span className="text-xs font-black uppercase tracking-widest text-[#2563eb]">
                    {currentSolution.tag}
                  </span>
                  <h3 className="mt-1 font-display text-2xl sm:text-3xl font-black text-[#1f2937]">
                    {currentSolution.headline}
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  {currentSolution.points.map((pt) => (
                    <div key={pt.title} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#2563eb]">
                        <span className="material-symbols-outlined text-lg">{pt.icon}</span>
                      </div>
                      <h4 className="mt-3 font-display font-black text-sm text-[#1f2937]">{pt.title}</h4>
                      <p className="mt-1 text-xs text-slate-500 font-medium leading-relaxed">{pt.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#2563eb] px-6 py-3.5 font-display text-sm font-black text-white shadow-md shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8]"
                  >
                    Buka Toko {currentSolution.title}
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Cara Mulai */}
      <section className="border-t border-slate-200/80 bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="mx-auto max-w-3xl text-center space-y-3">
            <span className="rounded-full bg-blue-50 px-3.5 py-1 text-xs font-black uppercase tracking-widest text-[#2563eb] border border-blue-100">
              Alur Gampang
            </span>
            <h2 className="font-display text-3xl sm:text-5xl font-black tracking-tight text-[#1f2937]">
              Tiga langkah, langsung siap jualan.
            </h2>
            <p className="text-base sm:text-lg text-slate-600 font-medium">
              Gak perlu pasang alat rumit atau instal aplikasi berat. Cukup buka browser dan lo sudah siap layani transaksi toko.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                step: '1',
                icon: 'app_registration',
                title: 'Bikin Akun Toko',
                desc: 'Tinggal isi nama toko dan email lo. Akun pemilik langsung aktif dengan akses dashboard lengkap.',
              },
              {
                step: '2',
                icon: 'category',
                title: 'Atur Produk dan Stok',
                desc: 'Masukin barang pakai satuan dus, pak, atau pcs. Scan barcode pakai kamera HP atau ketik manual.',
              },
              {
                step: '3',
                icon: 'point_of_sale',
                title: 'Buka Kasir dan Gas',
                desc: 'Isi modal awal laci, layani belanjaan tunai atau QRIS, lalu tutup shift dengan rekap uang fisik yang jelas.',
              },
            ].map((item, idx) => (
              <div key={item.step} className="relative rounded-3xl border border-slate-200/80 bg-[#fafbfa] p-7 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-md shadow-blue-500/20">
                    <span className="material-symbols-outlined text-2xl">{item.icon}</span>
                  </div>
                  <span className="font-display text-5xl font-black text-slate-100 select-none">
                    {item.step}
                  </span>
                </div>
                <h3 className="mt-5 font-display text-lg font-black text-[#1f2937]">{item.title}</h3>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{item.desc}</p>
                {idx < 2 && (
                  <span className="material-symbols-outlined absolute -right-4 top-1/2 hidden -translate-y-1/2 text-2xl text-slate-300 md:block">
                    arrow_forward_ios
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#2563eb] px-7 py-3.5 font-display text-sm font-black text-white shadow-md shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] hover:-translate-y-0.5"
            >
              Coba Sekarang, Gratis 7 Hari
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="fitur" className="scroll-mt-24 border-t border-slate-200/80 bg-[#fafbfa] py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="mx-auto max-w-3xl text-center space-y-3">
            <span className="rounded-full bg-slate-100 px-3.5 py-1 text-xs font-black uppercase tracking-widest text-slate-600 border border-slate-200">
              Kekuatan Sistem
            </span>
            <h2 className="font-display text-3xl sm:text-5xl font-black tracking-tight text-[#1f2937]">
              Semua fitur penting, tanpa bloatware rumit.
            </h2>
            <p className="text-base sm:text-lg text-slate-600 font-medium">
              Dirancang ringkas agar siapa saja langsung paham dalam sekali pakai.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((item) => (
              <div
                key={item.title}
                className="group rounded-3xl border border-slate-200/80 bg-white p-7 shadow-sm transition hover:border-[#2563eb] hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-[#2563eb] transition group-hover:bg-[#2563eb] group-hover:text-white">
                    <span className="material-symbols-outlined text-2xl">{item.icon}</span>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {item.tag}
                  </span>
                </div>
                <h3 className="mt-6 font-display text-lg font-black text-[#1f2937]">{item.title}</h3>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Section - Kenapa ZeePOS Unggul */}
      <section className="scroll-mt-24 border-t border-slate-200/80 bg-white py-16 sm:py-28">
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          <div className="text-center space-y-3">
            <span className="rounded-full bg-blue-50 px-3.5 py-1 text-xs font-black uppercase tracking-widest text-[#2563eb] border border-blue-100">
              Perbandingan Nyata
            </span>
            <h2 className="font-display text-2xl sm:text-5xl font-black tracking-tight text-[#1f2937]">
              Kenapa ZeePOS Beda dari POS Biasa?
            </h2>
            <p className="text-sm sm:text-lg text-slate-600 font-medium max-w-2xl mx-auto">
              Banyak aplikasi kasir membatasi fitur atau mematok biaya mahal untuk kebutuhan nyata toko grosir dan retail.
            </p>
          </div>

          {/* Mobile View: Stacked Comparison Cards (Rapi & Bebas Geser Sempit) */}
          <div className="mt-8 space-y-3.5 md:hidden">
            {[
              {
                feature: 'Multi-Satuan & Repack (Dus ke Pcs)',
                conventional: 'Hanya 1 satuan per produk, repack manual',
                zeepos: 'Bebas satuan + Repack stok 1-klik instan',
              },
              {
                feature: 'Shift Kasir & Verifikasi Laci Kas',
                conventional: 'Sering dipungut add-on bulanan mahal',
                zeepos: 'Buka/tutup shift kas laci bawaan tanpa biaya',
              },
              {
                feature: 'Parkir Pesanan Antrean Ramai',
                conventional: 'Harus cancel atau antrean kasir macet',
                zeepos: 'Parkir pesanan tanpa batasan (Hold Cart)',
              },
              {
                feature: 'Jual Tempo & Buku Piutang',
                conventional: 'Catat manual di buku bon kertas terpisah',
                zeepos: 'Jatuh tempo + cicilan terintegrasi laporan',
              },
              {
                feature: 'Privasi Modal (HPP) Toko',
                conventional: 'Kasir sering bisa intip modal barang pemilik',
                zeepos: 'Terkunci ketat di level PostgreSQL RLS',
              },
              {
                feature: 'Kebutuhan Perangkat (Hardware)',
                conventional: 'Wajib beli tablet/mesin kasir jutaan',
                zeepos: 'Cukup gunakan smartphone atau laptop yang ada',
              },
            ].map((item) => (
              <div
                key={item.feature}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="font-display text-sm font-black text-slate-900 mb-3">
                  {item.feature}
                </p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 text-slate-500">
                    <span className="material-symbols-outlined text-base text-rose-500 shrink-0 mt-0.5">
                      cancel
                    </span>
                    <div>
                      <span className="font-bold text-slate-600 block text-[10px] uppercase tracking-wider">
                        POS Biasa
                      </span>
                      <span>{item.conventional}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-xl bg-blue-50/70 p-2.5 text-slate-900 border border-blue-100">
                    <span className="material-symbols-outlined text-base text-emerald-600 shrink-0 mt-0.5">
                      check_circle
                    </span>
                    <div>
                      <span className="font-black text-[#2563eb] block text-[10px] uppercase tracking-wider">
                        ZeePOS
                      </span>
                      <span className="font-bold text-emerald-950">{item.zeepos}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop View: Full Table View */}
          <div className="mt-12 hidden md:block overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-black uppercase tracking-wider text-slate-500">
                  <th className="py-4 px-6">Kebutuhan Operasional Toko</th>
                  <th className="py-4 px-6 text-slate-400">Aplikasi POS Biasa</th>
                  <th className="py-4 px-6 bg-blue-50/60 text-[#2563eb]">ZeePOS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                <tr>
                  <td className="py-4 px-6 font-bold text-slate-900">
                    Jual Multi-Satuan & Repack Otomatis (Dus → Pcs)
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-base text-rose-500">cancel</span>
                      Hanya 1 satuan per produk
                    </span>
                  </td>
                  <td className="py-4 px-6 bg-blue-50/30 font-bold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                      Bebas satuan + Repack 1-klik
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 font-bold text-slate-900">
                    Shift Kasir & Verifikasi Selisih Uang Laci
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-base text-amber-500">remove_circle</span>
                      Sering bayar add-on mahal
                    </span>
                  </td>
                  <td className="py-4 px-6 bg-blue-50/30 font-bold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                      Buka/tutup shift kas laci bawaan
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 font-bold text-slate-900">
                    Parkir Pesanan Antrean Ramai (Hold Cart)
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-base text-rose-500">cancel</span>
                      Harus cancel / antrean macet
                    </span>
                  </td>
                  <td className="py-4 px-6 bg-blue-50/30 font-bold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                      Parkir pesanan tanpa batasan
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 font-bold text-slate-900">
                    Jual Tempo & Buku Piutang Pelanggan
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-base text-rose-500">cancel</span>
                      Catat manual di buku terpisah
                    </span>
                  </td>
                  <td className="py-4 px-6 bg-blue-50/30 font-bold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                      Jatuh tempo + cicilan otomatis
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 font-bold text-slate-900">
                    Privasi Modal (HPP) Terkunci dari Kasir
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-base text-rose-500">cancel</span>
                      Kasir sering bisa intip modal
                    </span>
                  </td>
                  <td className="py-4 px-6 bg-blue-50/30 font-bold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                      Di-lock ketat di level PostgreSQL
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 font-bold text-slate-900">
                    Kebutuhan Perangkat Keras (Hardware)
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-base text-amber-500">error</span>
                      Wajib beli tablet/mesin jutaan
                    </span>
                  </td>
                  <td className="py-4 px-6 bg-blue-50/30 font-bold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
                      Pakai HP smartphone yang ada
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="scroll-mt-24 border-t border-slate-200/80 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-8">
          <div className="text-center space-y-3">
            <span className="rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-black uppercase tracking-widest text-[#2563eb] border border-emerald-100">
              FAQ Santai
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-[#1f2937]">
              Yang Sering Ditanyain
            </h2>
            <p className="text-base text-slate-600 font-medium">
              Hal-hal yang sering ditanyain pemilik toko pas pertama kali nyobain ZeePOS.
            </p>
          </div>

          <div className="mt-12 space-y-3">
            {faqs.map((faq, idx) => (
              <div
                key={faq.q}
                className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden transition"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="flex w-full items-center justify-between p-5 text-left font-display text-sm sm:text-base font-black text-[#1f2937] hover:bg-slate-50 transition"
                >
                  <span>{faq.q}</span>
                  <span className="material-symbols-outlined text-slate-400 transition-transform duration-200">
                    {openFaq === idx ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                  </span>
                </button>
                {openFaq === idx && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-5 text-sm font-medium text-slate-600 leading-relaxed">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modern Bottom Banner CTA */}
      <section className="px-4 pb-20 sm:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl bg-gradient-to-br from-blue-600 to-blue-700 p-8 sm:p-14 text-white shadow-xl shadow-blue-500/20 relative overflow-hidden">
          <div className="relative z-10 max-w-2xl space-y-5">
            <span className="rounded-full bg-[#2563eb] px-3.5 py-1 text-xs font-black uppercase tracking-wider text-white">
              Coba Gratis 7 Hari
            </span>
            <h2 className="font-display text-3xl sm:text-5xl font-black tracking-tight leading-tight text-white">
              Buka kasir digital buat toko lo sekarang juga.
            </h2>
            <p className="text-base sm:text-lg text-blue-100 font-medium">
              Bebas akses semua fitur selama 7 hari tanpa komitmen. Cukup masukin email dan nama toko lo.
            </p>
            <div className="pt-3 flex flex-col sm:flex-row gap-3">
              <Link
                to="/register"
                className="flex items-center justify-center gap-2 rounded-2xl bg-white px-8 py-4 font-display text-base font-black text-[#2563eb] shadow-lg transition hover:bg-blue-50"
              >
                <span className="material-symbols-outlined text-xl">rocket_launch</span>
                Mulai Trial 7 Hari Sekarang
              </Link>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/40 bg-blue-800/40 backdrop-blur-md px-7 py-4 text-base font-extrabold text-white transition hover:bg-blue-800/60"
              >
                <span className="material-symbols-outlined text-xl text-blue-100">login</span>
                Masuk ke Kasir
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-10 sm:py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-3">
              <BrandMark size="sm" />
              <div>
                <p className="font-display text-sm font-black text-[#1f2937]">ZeePOS</p>
                <p className="text-xs text-slate-500 font-medium">Sistem Kasir & Stok Multi-Toko Modern</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-y-3 gap-x-6 text-center sm:flex sm:items-center sm:gap-6 text-xs font-black text-slate-600">
              <a href="#solusi" className="py-1 hover:text-[#2563eb] transition-colors">Solusi</a>
              <a href="#simulator" className="py-1 hover:text-[#2563eb] transition-colors">Simulator</a>
              <a href="#fitur" className="py-1 hover:text-[#2563eb] transition-colors">Fitur</a>
              <a href="#faq" className="py-1 hover:text-[#2563eb] transition-colors">FAQ</a>
              <Link to="/login" className="py-1 hover:text-[#2563eb] transition-colors">Masuk</Link>
              <Link to="/register" className="py-1 text-[#2563eb] hover:underline">Daftar Toko</Link>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400 font-medium">
            <p>© {new Date().getFullYear()} ZeePOS. Sistem kasir dan inventaris cloud untuk efisiensi bisnis retail.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
