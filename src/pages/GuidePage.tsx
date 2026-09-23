import { useMemo } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../utils/cn'

interface GuideSection {
  title: string
  intro: string
  items: string[]
}

interface GuideFaqItem {
  question: string
  answer: string
}

interface GuideGlossaryItem {
  term: string
  meaning: string
}

interface GuideProfile {
  heroTitle: string
  heroDescription: string
  quickSummary: Array<{ label: string; value: string }>
  menuGuide: GuideSection[]
  workflowGuide: GuideSection[]
  safetyGuide: GuideSection[]
  faqGuide: GuideFaqItem[]
  glossaryGuide: GuideGlossaryItem[]
}

const kasirGuide: GuideProfile = {
  heroTitle: 'Panduan lengkap kasir untuk menjalankan POS dengan cepat, rapi, dan jujur.',
  heroDescription:
    'Halaman ini menjelaskan fungsi aplikasi dari sudut pandang kasir: cara memulai transaksi, menerima pembayaran, memperbaiki salah input, dan menjaga stok tetap sesuai dengan kondisi toko.',
  quickSummary: [
    { label: 'Fokus utama', value: 'Melayani transaksi dengan benar dan mencatat semua aktivitas lewat sistem.' },
    { label: 'Menu utama', value: 'Kasir, Dashboard, dan Panduan.' },
    { label: 'Prinsip kerja', value: 'Kalau salah input, koreksi lewat alur yang tersedia. Jangan transaksi di luar sistem.' },
  ],
  menuGuide: [
    {
      title: 'Menu Kasir',
      intro: 'Ini adalah halaman kerja utama kasir setiap hari.',
      items: [
        'Cari produk lewat nama, SKU, atau barcode lalu masukkan ke keranjang.',
        'Periksa jumlah item, diskon, PPN, dan total sebelum menekan proses pembayaran.',
        'Untuk tunai, isi uang diterima agar sistem menghitung kembalian otomatis.',
        'Untuk transfer atau QRIS, transaksi akan masuk ke status menunggu konfirmasi sebelum dianggap lunas.',
      ],
    },
    {
      title: 'Menu Dashboard',
      intro: 'Dashboard membantu kasir melihat kondisi toko hari ini secara cepat.',
      items: [
        'Lihat jumlah transaksi hari ini dan penjualan hari ini.',
        'Perhatikan notifikasi stok menipis agar bisa memberi tahu admin lebih cepat.',
        'Gunakan daftar transaksi terbaru untuk memastikan transaksi yang baru dibuat sudah tercatat.',
      ],
    },
    {
      title: 'Menu Panduan',
      intro: 'Panduan adalah buku petunjuk kerja kasir di dalam aplikasi.',
      items: [
        'Baca kembali alur transaksi jika kasir baru masih belajar.',
        'Gunakan panduan ini saat bingung membedakan transaksi tunai dan non tunai.',
        'Jadikan panduan ini standar kerja supaya semua kasir menjalankan proses yang sama.',
      ],
    },
  ],
  workflowGuide: [
    {
      title: 'Alur transaksi tunai',
      intro: 'Ikuti urutan ini supaya pembayaran tunai langsung beres dalam satu langkah.',
      items: [
        'Masukkan semua produk yang dibeli customer ke keranjang.',
        'Cek lagi qty tiap produk agar tidak ada yang dobel atau kurang scan.',
        'Pilih metode bayar Tunai lalu isi nominal uang diterima.',
        'Setelah total dan kembalian benar, proses pembayaran dan cetak struk.',
      ],
    },
    {
      title: 'Alur transaksi transfer atau QRIS',
      intro: 'Transaksi non tunai tidak langsung dianggap lunas sampai dananya benar-benar masuk.',
      items: [
        'Masukkan produk ke keranjang seperti biasa.',
        'Pilih metode bayar Transfer atau QRIS.',
        'Simpan transaksi jika customer belum selesai bayar atau dana belum terkonfirmasi.',
        'Tunggu konfirmasi dana masuk sebelum transaksi dicetak sebagai pembayaran selesai.',
      ],
    },
    {
      title: 'Kalau kasir salah input',
      intro: 'Kesalahan input boleh diperbaiki, tapi harus lewat jalur yang jelas supaya admin bisa menelusuri.',
      items: [
        'Kalau belum disimpan, perbaiki langsung di keranjang.',
        'Kalau transaksi pending sudah terlanjur dibuat, batalkan lewat tombol batal dan isi alasan pembatalan.',
        'Setelah dibatalkan, buat ulang transaksi yang benar.',
        'Jangan menghapus bukti atau membuat nota manual di luar sistem.',
      ],
    },
  ],
  safetyGuide: [
    {
      title: 'Aturan kejujuran kasir',
      intro: 'Aplikasi ini memang dibuat supaya transaksi dan stok bisa ditelusuri oleh admin.',
      items: [
        'Setiap transaksi yang dibuat akan tercatat dengan user kasir dan waktu kejadian.',
        'Pembatalan transaksi pending sekarang wajib memakai alasan.',
        'Cetak ulang struk juga masuk log audit.',
        'Perubahan stok dan koreksi penting bisa dibandingkan oleh admin dengan kondisi toko.',
      ],
    },
    {
      title: 'Hal yang tidak boleh dilakukan',
      intro: 'Supaya data toko tetap bersih, kasir perlu menghindari beberapa kebiasaan ini.',
      items: [
        'Jangan menerima pembayaran tanpa membuat transaksi di aplikasi.',
        'Jangan membuat nota palsu atau menulis transaksi di luar sistem lalu menganggapnya sah.',
        'Jangan membatalkan transaksi tanpa alasan yang jujur dan jelas.',
        'Kalau menemukan stok tidak cocok, laporkan ke admin, jangan disembunyikan.',
      ],
    },
  ],
  faqGuide: [
    {
      question: 'Kalau barang tidak ketemu saat discan bagaimana?',
      answer:
        'Cek dulu barcode dan nama barang. Kalau tetap tidak muncul, panggil admin karena kemungkinan barang belum didaftarkan atau sudah nonaktif.',
    },
    {
      question: 'Kalau customer bayar QRIS tapi dana belum masuk bagaimana?',
      answer:
        'Simpan sebagai transaksi pending. Jangan anggap lunas dan jangan serahkan struk lunas sebelum pembayaran benar-benar terkonfirmasi.',
    },
    {
      question: 'Kalau salah qty setelah transaksi disimpan bagaimana?',
      answer:
        'Gunakan alur pembatalan dengan alasan yang jelas, lalu buat transaksi baru yang benar. Jangan diamkan data yang salah.',
    },
  ],
  glossaryGuide: [
    { term: 'Pending payment', meaning: 'Transaksi sudah dicatat, tapi uangnya belum dikonfirmasi masuk.' },
    { term: 'Audit', meaning: 'Catatan jejak aktivitas siapa melakukan apa dan kapan.' },
    { term: 'Adjustment stok', meaning: 'Perubahan stok manual saat stok fisik dan stok sistem tidak sama.' },
    { term: 'Cetak ulang struk', meaning: 'Mencetak kembali nota yang sudah pernah dibuat sebelumnya.' },
  ],
}

const adminGuide: GuideProfile = {
  heroTitle: 'Panduan lengkap admin untuk mengelola toko, tim kasir, stok, dan laporan.',
  heroDescription:
    'Halaman ini menjelaskan fungsi aplikasi dari sudut pandang admin: mengatur master data, memantau kasir, melihat audit, memperbaiki kesalahan input, dan membaca laporan operasional toko.',
  quickSummary: [
    { label: 'Fokus utama', value: 'Menjaga data tetap akurat, stok cocok, dan semua aktivitas kasir bisa ditelusuri.' },
    { label: 'Menu utama', value: 'Dashboard, Produk, Stok, Laporan, Audit, Pengaturan, dan Panduan.' },
    { label: 'Prinsip kerja', value: 'Semua koreksi harus lewat sistem, bukan lewat catatan luar atau kesepakatan lisan saja.' },
  ],
  menuGuide: [
    {
      title: 'Menu Dashboard',
      intro: 'Dashboard adalah tempat admin memantau kondisi toko secara cepat.',
      items: [
        'Lihat penjualan hari ini, jumlah transaksi, dan produk yang paling laku.',
        'Pantau transaksi terbaru dan notifikasi stok menipis.',
        'Gunakan dashboard untuk melihat apakah toko berjalan normal sebelum masuk ke halaman detail lain.',
      ],
    },
    {
      title: 'Menu Produk',
      intro: 'Menu Produk dipakai untuk mengelola katalog barang yang dijual.',
      items: [
        'Tambah produk baru lengkap dengan SKU, barcode, kategori, harga beli, dan harga jual.',
        'Edit produk aktif tanpa harus menghapus histori transaksi lama.',
        'Lihat riwayat harga beli dan harga jual untuk mengetahui perubahan margin dari waktu ke waktu.',
      ],
    },
    {
      title: 'Menu Stok',
      intro: 'Menu Stok dipakai untuk mengawasi jumlah stok aktual di sistem.',
      items: [
        'Cari produk yang stoknya habis atau menipis.',
        'Lakukan penyesuaian stok dengan alasan yang jelas saat ada selisih fisik.',
        'Gunakan histori stok untuk melihat siapa yang terakhir mengubah stok dan kapan perubahannya terjadi.',
      ],
    },
    {
      title: 'Menu Laporan',
      intro: 'Laporan membantu admin membaca performa toko dan memeriksa transaksi.',
      items: [
        'Lihat total penjualan, jumlah transaksi, pending payment, HPP, laba kotor, dan margin.',
        'Gunakan tabel riwayat transaksi untuk memeriksa nota satu per satu.',
        'Export Excel untuk kebutuhan rekap luar atau pengecekan manual tambahan.',
      ],
    },
    {
      title: 'Menu Audit',
      intro: 'Menu Audit adalah alat utama untuk memantau perilaku kasir dan perubahan penting di sistem.',
      items: [
        'Lihat transaksi dibuat, dibatalkan, pembayaran dikonfirmasi, stok diadjust, harga diubah, dan struk dicetak ulang.',
        'Filter audit berdasarkan tanggal dan jenis aktivitas.',
        'Gunakan halaman ini saat ada kecurigaan manipulasi stok, transaksi fiktif, atau pembatalan yang tidak wajar.',
      ],
    },
    {
      title: 'Menu Pengaturan',
      intro: 'Pengaturan berisi konfigurasi toko dan akun operasional.',
      items: [
        'Atur identitas toko, footer/header struk, dan informasi pembayaran.',
        'Kelola akun user admin dan kasir dari Supabase Auth serta tabel profiles.',
        'Gunakan test print untuk mengecek printer sebelum toko dipakai operasional.',
      ],
    },
  ],
  workflowGuide: [
    {
      title: 'Alur harian admin',
      intro: 'Ini alur yang paling aman untuk mengecek toko setiap hari.',
      items: [
        'Pagi hari: cek dashboard, produk stok menipis, dan apakah ada transaksi pending dari sebelumnya.',
        'Saat operasional: pantau audit bila ada transaksi batal berulang atau adjustment stok mencurigakan.',
        'Sore atau tutup toko: cocokkan transaksi, pending payment, dan stok produk penting dengan kondisi lapangan.',
      ],
    },
    {
      title: 'Kalau kasir salah input',
      intro: 'Kesalahan input tidak perlu ditutup-tutupi, tapi harus dibenerkan dengan alur yang jelas.',
      items: [
        'Kalau transaksi belum final, minta kasir perbaiki sebelum diproses.',
        'Kalau transaksi pending sudah salah, minta kasir batalkan dengan alasan lalu buat ulang.',
        'Kalau stok fisik beda, lakukan adjustment stok dari menu stok dengan keterangan yang spesifik.',
        'Jangan menyuruh kasir mengakali data supaya kelihatan cocok.',
      ],
    },
    {
      title: 'Kalau curiga ada kebohongan',
      intro: 'Gunakan bukti sistem, bukan hanya ingatan atau cerita lisan.',
      items: [
        'Buka menu Audit dan cari transaksi dibatalkan, cetak ulang struk, serta perubahan harga atau stok yang tidak biasa.',
        'Bandingkan audit dengan laporan transaksi dan histori stok.',
        'Lihat user mana yang paling sering punya pembatalan atau koreksi.',
        'Cocokkan hasil sistem dengan stok fisik dan uang masuk nyata.',
      ],
    },
  ],
  safetyGuide: [
    {
      title: 'Apa saja yang sekarang bisa ditrack',
      intro: 'Semakin banyak proses dipaksa lewat sistem, semakin sulit data dimanipulasi.',
      items: [
        'Siapa yang membuat transaksi.',
        'Siapa yang membatalkan transaksi dan apa alasannya.',
        'Siapa yang mengubah harga beli atau harga jual.',
        'Siapa yang melakukan penyesuaian stok.',
        'Siapa yang mencetak ulang struk.',
      ],
    },
    {
      title: 'Batasan penting yang tetap perlu disiplin toko',
      intro: 'Sistem membantu, tapi operasional toko tetap butuh aturan yang konsisten.',
      items: [
        'Semua transaksi harus masuk aplikasi. Kalau ada transaksi di luar sistem, audit tidak akan bisa menolong.',
        'Stok fisik tetap perlu dicek berkala lewat stok opname sederhana.',
        'Password akun admin dan kasir jangan dipakai bergantian.',
        'Kalau ada aturan baru di toko, masukkan ke SOP dan samakan dengan alur di aplikasi.',
      ],
    },
  ],
  faqGuide: [
    {
      question: 'Kalau kasir bilang salah input, apa yang harus admin lakukan?',
      answer:
        'Minta kasir jelaskan kesalahannya, lihat transaksi di sistem, lalu arahkan pembatalan atau koreksi lewat alur resmi. Jangan perbaiki diam-diam tanpa jejak.',
    },
    {
      question: 'Kalau stok fisik dan sistem beda, apa yang harus dilakukan?',
      answer:
        'Lakukan pengecekan barang, lihat histori stok dan audit, lalu buat penyesuaian stok dengan alasan yang spesifik.',
    },
    {
      question: 'Kalau curiga ada transaksi palsu atau bohong, mulai dari mana?',
      answer:
        'Buka menu Audit, cocokkan dengan laporan transaksi, lihat pembatalan, perubahan harga, adjustment stok, dan cetak ulang struk yang tidak biasa.',
    },
  ],
  glossaryGuide: [
    { term: 'HPP', meaning: 'Harga pokok penjualan, yaitu total biaya barang yang terjual.' },
    { term: 'Laba kotor', meaning: 'Selisih antara penjualan dan harga pokok barang yang terjual.' },
    { term: 'Margin', meaning: 'Persentase keuntungan dibanding nilai penjualan.' },
    { term: 'Riwayat harga', meaning: 'Catatan perubahan harga beli dan harga jual dari waktu ke waktu.' },
  ],
}

function SectionCard({ section }: { section: GuideSection }) {
  return (
    <article className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
        Tutorial
      </p>
      <h3 className="mt-2 text-[18px] font-extrabold text-[#1b1e20]">{section.title}</h3>
      <p className="mt-3 text-sm leading-7 text-[#52627d]">{section.intro}</p>
      <div className="mt-4 space-y-2">
        {section.items.map((item, index) => (
          <div key={item} className="flex gap-3 rounded-[16px] bg-[#f8fbfb] px-4 py-3 text-sm leading-7 text-[#52627d]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eff6ff] text-xs font-extrabold text-[#2563eb]">
              {index + 1}
            </span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

function FaqCard({ item }: { item: GuideFaqItem }) {
  return (
    <article className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
        FAQ
      </p>
      <h3 className="mt-2 text-[18px] font-extrabold text-[#1b1e20]">{item.question}</h3>
      <p className="mt-3 text-sm leading-7 text-[#52627d]">{item.answer}</p>
    </article>
  )
}

function GlossaryCard({ item }: { item: GuideGlossaryItem }) {
  return (
    <article className="rounded-[18px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
        Istilah Sederhana
      </p>
      <h3 className="mt-2 text-[18px] font-extrabold text-[#1b1e20]">{item.term}</h3>
      <p className="mt-3 text-sm leading-7 text-[#52627d]">{item.meaning}</p>
    </article>
  )
}

export function GuidePage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const user = useAuthStore((state) => state.user)

  const guide = useMemo(() => {
    if (user?.role === 'admin') {
      return adminGuide
    }

    return kasirGuide
  }, [user?.role])

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pt-[calc(env(safe-area-inset-top,0px)+4.75rem)] transition-[margin] duration-200 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="min-h-screen bg-white md:rounded-l-[24px]">
        <header className="border-b border-[#eef1f1] px-4 py-4 sm:px-6">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
            Panduan Aplikasi
          </h1>
          <p className="mt-1 text-sm font-medium text-[#8b9895]">
            {user?.role === 'admin'
              ? 'Panduan operasional lengkap untuk admin toko.'
              : 'Panduan operasional lengkap untuk kasir toko.'}
          </p>
        </header>

        <div className="space-y-6 bg-[#f7f9f9] px-4 py-4 sm:px-6 sm:py-6">
          <section className="rounded-[20px] bg-[linear-gradient(135deg,#2563eb,#1e3a8a)] p-6 text-white shadow-[0_14px_40px_rgba(37,99,235,0.20)]">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">
              Penjelasan Aplikasi
            </p>
            <h2 className="mt-2 max-w-4xl text-[24px] font-extrabold tracking-[-0.03em]">
              {guide.heroTitle}
            </h2>
            <p className="mt-3 max-w-4xl text-sm font-medium leading-7 text-white/82">
              {guide.heroDescription}
            </p>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {guide.quickSummary.map((item) => (
              <div
                key={item.label}
                className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]"
              >
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  {item.label}
                </p>
                <p className="mt-3 text-sm leading-7 text-[#52627d]">{item.value}</p>
              </div>
            ))}
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-[20px] font-extrabold text-[#1b1e20]">Fungsi Setiap Menu</h2>
              <p className="mt-1 text-sm text-[#8b9895]">
                Bagian ini menjelaskan fungsi halaman yang akan sering dipakai oleh {user?.role === 'admin' ? 'admin' : 'kasir'}.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {guide.menuGuide.map((section) => (
                <SectionCard key={section.title} section={section} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-[20px] font-extrabold text-[#1b1e20]">Tutorial Alur Kerja</h2>
              <p className="mt-1 text-sm text-[#8b9895]">
                Ikuti langkah-langkah ini supaya operasional toko berjalan rapi dan data tetap sinkron.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {guide.workflowGuide.map((section) => (
                <SectionCard key={section.title} section={section} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-[20px] font-extrabold text-[#1b1e20]">Aturan Aman dan Kontrol</h2>
              <p className="mt-1 text-sm text-[#8b9895]">
                Bagian ini penting supaya pemilik toko tahu apa yang memang bisa diawasi dari sistem dan apa yang tetap perlu disiplin operasional.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {guide.safetyGuide.map((section) => (
                <SectionCard key={section.title} section={section} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-[20px] font-extrabold text-[#1b1e20]">FAQ Cepat</h2>
              <p className="mt-1 text-sm text-[#8b9895]">
                Pertanyaan yang paling sering muncul saat aplikasi mulai dipakai sehari-hari.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              {guide.faqGuide.map((item) => (
                <FaqCard key={item.question} item={item} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-[20px] font-extrabold text-[#1b1e20]">Istilah Sederhana</h2>
              <p className="mt-1 text-sm text-[#8b9895]">
                Penjelasan singkat untuk istilah yang sering muncul di aplikasi supaya lebih mudah dipahami orang non-teknis.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {guide.glossaryGuide.map((item) => (
                <GlossaryCard key={item.term} item={item} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
