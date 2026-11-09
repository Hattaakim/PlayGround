window.KK = window.KK || {};
(function (KK) {
  const GRID = 24;
  const TILE_W = 64, TILE_H = 32;

  const zones = {
    zone_r: {
      name: 'Zona Perumahan', cat: 'infra', kind: 'zone-r', cost: 45, maint: 0,
      w: 1, h: 1, art: 'lot_r', zoneColor: '#4fae62', letter: 'R',
      desc: 'Rumah warga akan tumbuh di sini. Butuh akses jalan, listrik, dan air.',
      cap: [0, 6, 14, 24, 40], powerUse: [0, 1.5, 3, 5.5, 9], waterUse: [0, 1, 2, 4, 7],
      maxLevel: 4, previewLevel: 2, tag: 'Rumah'
    },
    zone_c: {
      name: 'Zona Komersial', cat: 'infra', kind: 'zone-c', cost: 65, maint: 0,
      w: 1, h: 1, art: 'lot_c', zoneColor: '#3b8fd4', letter: 'C',
      desc: 'Toko, kafe, dan kantor. Menyediakan lapangan kerja dan pemasukan pajak.',
      jobs: [0, 4, 10, 18], powerUse: [0, 2, 4, 7], waterUse: [0, 1, 2, 4],
      maxLevel: 3, previewLevel: 2, tag: 'Toko'
    },
    zone_i: {
      name: 'Zona Industri', cat: 'infra', kind: 'zone-i', cost: 80, maint: 0,
      w: 1, h: 1, art: 'lot_i', zoneColor: '#d9a03c', letter: 'I',
      desc: 'Pabrik dan gudang. Banyak lapangan kerja, tapi menimbulkan polusi.',
      jobs: [0, 6, 14, 24], powerUse: [0, 4, 8, 14], waterUse: [0, 2, 4, 7],
      maxLevel: 3, previewLevel: 2, tag: 'Pabrik', pollution: [0, 4, 9, 15], pollutionRadius: 3
    }
  };

  const DEFS = {
    road: {
      name: 'Jalan', cat: 'infra', kind: 'road', cost: 12, maint: 0.25, w: 1, h: 1,
      art: 'road', desc: 'Jalan penghubung. Semua bangunan butuh akses jalan.', tag: 'Infra'
    },
    ...zones,
    power_plant: {
      name: 'Pembangkit Uap', cat: 'utility', kind: 'utility', cost: 520, maint: 16,
      w: 2, h: 2, art: 'powerplant', powerSupply: 260, pollution: 6, pollutionRadius: 3,
      desc: 'Memasok listrik untuk 260 unit. Menghasilkan sedikit polusi.', tag: '+260 ⚡', previewLevel: 1
    },
    water_tower: {
      name: 'Menara Air', cat: 'utility', kind: 'utility', cost: 180, maint: 5,
      w: 1, h: 1, art: 'watertower', waterSupply: 170, powerUse: 3,
      desc: 'Memasok air bersih untuk 170 unit. Butuh listrik.', tag: '+170 💧', previewLevel: 1
    },
    solar: {
      name: 'Taman Surya', cat: 'utility', kind: 'utility', cost: 900, maint: 9,
      w: 2, h: 2, art: 'solar', powerSupply: 190, unlockPop: 200,
      desc: 'Energi bersih tanpa polusi. Sedikit lebih mahal.', tag: '+190 ⚡', previewLevel: 1
    },
    police: {
      name: 'Pos Polisi', cat: 'service', kind: 'service', cost: 200, maint: 8,
      w: 1, h: 1, art: 'police', powerUse: 3, waterUse: 2, jobs: 6, radius: 5, happy: 4,
      desc: 'Menjaga keamanan warga di sekitarnya.', tag: 'Aman', previewLevel: 1
    },
    fire: {
      name: 'Pemadam Kebakaran', cat: 'service', kind: 'service', cost: 210, maint: 8,
      w: 1, h: 1, art: 'fire', powerUse: 3, waterUse: 2, jobs: 6, radius: 4, happy: 2,
      desc: 'Melindungi kota dari kebakaran.', tag: 'Siaga', previewLevel: 1
    },
    school: {
      name: 'Sekolah Dasar', cat: 'service', kind: 'service', cost: 450, maint: 14,
      w: 2, h: 2, art: 'school', powerUse: 6, waterUse: 4, jobs: 12, radius: 6, happy: 6,
      unlockPop: 50, desc: 'Pendidikan membuka pertumbuhan rumah ke level 3.', tag: 'Edukasi', previewLevel: 1
    },
    hospital: {
      name: 'Rumah Sakit', cat: 'service', kind: 'service', cost: 700, maint: 22,
      w: 2, h: 2, art: 'hospital', powerUse: 10, waterUse: 8, jobs: 20, radius: 7, happy: 5,
      unlockPop: 150, desc: 'Layanan kesehatan untuk rumah level 4 dan warga bahagia.', tag: 'Sehat', previewLevel: 1
    },
    small_park: {
      name: 'Taman Kecil', cat: 'fun', kind: 'fun', cost: 55, maint: 1,
      w: 1, h: 1, art: 'smallpark', radius: 2, happy: 3, waterUse: 1,
      desc: 'Sedikit hijau untuk tetangga. Murah dan cepat.', tag: '+3 😊', previewLevel: 1
    },
    park: {
      name: 'Taman Kota', cat: 'fun', kind: 'fun', cost: 140, maint: 3,
      w: 2, h: 2, art: 'park', radius: 4, happy: 7, waterUse: 1,
      desc: 'Paru-paru kota. Menaikkan kebahagiaan dan nilai hunian.', tag: '+7 😊', previewLevel: 1
    },
    plaza: {
      name: 'Alun-Alun', cat: 'fun', kind: 'fun', cost: 260, maint: 5,
      w: 2, h: 2, art: 'plaza', radius: 4, happy: 6, waterUse: 1,
      unlockPop: 30, desc: 'Tempat warga berkumpul, berjualan, dan bersantai.', tag: '+6 😊', previewLevel: 1
    },
    fountain: {
      name: 'Air Mancur', cat: 'fun', kind: 'fun', cost: 90, maint: 2,
      w: 1, h: 1, art: 'fountain', radius: 2, happy: 2, waterUse: 1,
      desc: 'Dekorasi air yang menyejukkan mata.', tag: '+2 😊', previewLevel: 1
    },
    ferris: {
      name: 'Kincir Ria', cat: 'fun', kind: 'fun', cost: 600, maint: 12,
      w: 2, h: 2, art: 'ferris', radius: 6, happy: 10, powerUse: 8, jobs: 10,
      unlockPop: 120, desc: 'Ikon rekreasi kota. Warga datang dari jauh untuk naik.', tag: '+10 😊', previewLevel: 1
    },
    stadium: {
      name: 'Stadion Kota', cat: 'fun', kind: 'fun', cost: 1500, maint: 30,
      w: 3, h: 3, art: 'stadium', radius: 8, happy: 12, powerUse: 20, waterUse: 10, jobs: 40,
      unlockPop: 350, desc: 'Pusat kebanggaan kota. Menarik massa dan lapangan kerja.', tag: '+12 😊', previewLevel: 1
    },
    museum: {
      name: 'Museum Kota', cat: 'fun', kind: 'fun', cost: 780, maint: 16,
      w: 2, h: 2, art: 'museum', radius: 6, happy: 8, powerUse: 7, jobs: 16,
      unlockPop: 100, desc: 'Ruang sejarah dan budaya yang memperkaya kehidupan warga.', tag: '+8 😊', previewLevel: 1
    },
    bus_terminal: {
      name: 'Terminal Bus', cat: 'transport', kind: 'service', cost: 540, maint: 13,
      w: 2, h: 2, art: 'busterminal', radius: 5, happy: 5, powerUse: 6, waterUse: 2, jobs: 14,
      unlockPop: 80, desc: 'Menghubungkan lingkungan kota dengan transportasi umum.', tag: 'Transit', previewLevel: 1
    },
    airport: {
      name: 'Bandara Kota', cat: 'transport', kind: 'service', cost: 3200, maint: 48,
      w: 5, h: 4, art: 'airport', radius: 10, happy: 10, powerUse: 28, waterUse: 12, jobs: 72,
      unlockPop: 500, desc: 'Bandara regional dengan landasan pacu dan terminal. Membuka banyak lapangan kerja.', tag: '72 kerja', previewLevel: 1
    },
    monument: {
      name: 'Monumen Kota', cat: 'fun', kind: 'fun', cost: 300, maint: 2,
      w: 1, h: 1, art: 'monument', radius: 4, happy: 4,
      unlockPop: 80, desc: 'Simbol identitas kotamu. Menambah kebanggaan warga.', tag: '+4 😊', previewLevel: 1
    },
    wind_turbine: {
      name: 'Turbin Angin', cat: 'utility', kind: 'utility', cost: 680, maint: 7,
      w: 2, h: 2, art: 'solar', powerSupply: 125, unlockPop: 100,
      desc: 'Pembangkit angin bersih untuk menambah pasokan listrik kota.', tag: '+125 ⚡', previewLevel: 1
    },
    water_pump: {
      name: 'Pompa Air', cat: 'utility', kind: 'utility', cost: 320, maint: 9,
      w: 2, h: 2, art: 'watertower', waterSupply: 95, powerUse: 4,
      unlockPop: 80, desc: 'Memompa air bersih untuk kawasan yang terus berkembang.', tag: '+95 💧', previewLevel: 1
    },
    clinic: {
      name: 'Klinik Warga', cat: 'service', kind: 'service', cost: 360, maint: 12,
      w: 2, h: 2, art: 'hospital', powerUse: 5, waterUse: 4, jobs: 9, radius: 4, happy: 4,
      unlockPop: 60, desc: 'Layanan kesehatan dasar yang dekat dengan permukiman.', tag: 'Sehat', previewLevel: 1
    },
    library: {
      name: 'Perpustakaan', cat: 'service', kind: 'service', cost: 390, maint: 11,
      w: 2, h: 2, art: 'school', powerUse: 4, waterUse: 2, jobs: 8, radius: 5, happy: 4,
      unlockPop: 80, desc: 'Ruang belajar dan membaca untuk warga segala usia.', tag: 'Belajar', previewLevel: 1
    },
    garden: {
      name: 'Kebun Komunitas', cat: 'fun', kind: 'fun', cost: 95, maint: 2,
      w: 2, h: 2, art: 'park', radius: 3, happy: 4, waterUse: 2,
      desc: 'Ruang hijau bersama untuk berkebun dan bersantai.', tag: '+4 😊', previewLevel: 1
    },
    tree: {
      name: 'Pohon Rindang', cat: 'decor', kind: 'decor', cost: 15, maint: 0,
      w: 1, h: 1, art: 'tree', radius: 1, happy: 0.5, decor: true,
      desc: 'Menambah keasrian. Bisa ditanam di mana saja.', tag: 'Hijau', previewLevel: 1
    },
    flowers: {
      name: 'Taman Bunga', cat: 'decor', kind: 'decor', cost: 25, maint: 0.2,
      w: 1, h: 1, art: 'flowers', radius: 1, happy: 1, decor: true,
      desc: 'Warna-warni kecil yang membuat warga tersenyum.', tag: '+1 😊', previewLevel: 1
    },
    lamp: {
      name: 'Lampu Jalan', cat: 'decor', kind: 'decor', cost: 35, maint: 0.4,
      w: 1, h: 1, art: 'streetlamp', radius: 2, happy: 0.5, decor: true,
      desc: 'Menerangi malam dan membuat jalan terasa aman.', tag: 'Terang', previewLevel: 1
    },
    rock: {
      name: 'Batu', cat: 'decor', kind: 'decor', cost: 0, maint: 0,
      w: 1, h: 1, art: 'rock', decor: true, hidden: true, desc: 'Batu besar. Bisa dibersihkan dengan alat bongkar.', previewLevel: 1
    }
  };

  const CATS = [
    { id: 'infra', name: 'Jalan & Zona', icon: 'road', eyebrow: 'FONDASI KOTA', blurb: 'Bangun jalan, lalu cat zona. Bangunan akan tumbuh sendiri jika warganya betah.' },
    { id: 'utility', name: 'Utilitas', icon: 'bolt', eyebrow: 'DAYA KOTA', blurb: 'Listrik dan air adalah nyawa kota. Tanpa keduanya, tak ada yang tumbuh.' },
    { id: 'service', name: 'Layanan', icon: 'heart', eyebrow: 'WARGA TERLAYANI', blurb: 'Sekolah, rumah sakit, polisi, dan damkar menjaga warga tetap aman dan bahagia.' },
    { id: 'fun', name: 'Rekreasi', icon: 'ferris', eyebrow: 'HIDUP LEBIH SERU', blurb: 'Taman, alun-alun, kincir ria. Kota yang menyenangkan menarik lebih banyak warga.' },
    { id: 'transport', name: 'Transportasi', icon: 'road', eyebrow: 'KOTA TERHUBUNG', blurb: 'Terminal dan bandara membuka akses perjalanan serta lapangan kerja baru.' },
    { id: 'decor', name: 'Dekorasi', icon: 'tree', eyebrow: 'DETAIL KECIL', blurb: 'Pohon, bunga, dan lampu jalan untuk kota yang cantik dan nyaman.' }
  ];

  const MISSIONS = [
    { id: 'roads', label: 'Bangun 5 petak jalan', reward: 150, check: s => s.roadCount >= 5, tip: 'Pilih Jalan di menu kiri, lalu klik peta.' },
    { id: 'homes', label: 'Cat 4 zona perumahan', reward: 200, check: s => s.zoneCount >= 4, tip: 'Zona harus menempel pada jalan.' },
    { id: 'utilities', label: 'Bangun pembangkit & menara air', reward: 400, check: s => s.hasPower && s.hasWater, tip: 'Cari di kategori Utilitas.' },
    { id: 'pop25', label: 'Capai 25 penduduk', reward: 350, check: s => s.population >= 25, tip: 'Rumah akan terisi jika ada listrik, air, dan jalan.' },
    { id: 'park', label: 'Bangun Taman Kota', reward: 250, check: s => s.hasPark, tip: 'Taman menaikkan kebahagiaan.' },
    { id: 'pop100', label: 'Capai 100 penduduk', reward: 600, check: s => s.population >= 100, tip: 'Tambahkan zona komersial untuk lapangan kerja.' },
    { id: 'school', label: 'Bangun sekolah', reward: 500, check: s => s.hasSchool, tip: 'Sekolah terbuka di 50 penduduk.' },
    { id: 'pop300', label: 'Capai 300 penduduk', reward: 900, check: s => s.population >= 300, tip: 'Perluas zona dan tingkatkan layanan.' },
    { id: 'stadium', label: 'Bangun Stadion Kota', reward: 1200, check: s => s.hasStadium, tip: 'Stadion terbuka di 350 penduduk.' },
    { id: 'metro', label: 'Jadilah Kota Metropolitan — 1.000 warga', reward: 5000, check: s => s.population >= 1000, tip: 'Terus tumbuh, terus layani warga.' }
  ];

  const DAILY_CHALLENGES = [
    { id: 'daily_roads', title: 'Jalan untuk Semua', desc: 'Bangun 3 petak jalan.', target: 3, reward: 120, matches: ['road'] },
    { id: 'daily_green', title: 'Kota Lebih Hijau', desc: 'Tanam 3 pohon atau bunga.', target: 3, reward: 100, matches: ['tree', 'flowers'] },
    { id: 'daily_homes', title: 'Rumah Baru', desc: 'Cat 2 zona perumahan.', target: 2, reward: 140, matches: ['zone_r'] },
    { id: 'daily_utility', title: 'Layanan Dasar', desc: 'Bangun 1 utilitas kota.', target: 1, reward: 160, matches: ['power_plant', 'water_tower', 'solar', 'wind_turbine', 'water_pump'] },
    { id: 'daily_recreation', title: 'Ruang Bersama', desc: 'Bangun 1 fasilitas rekreasi.', target: 1, reward: 130, matches: ['small_park', 'park', 'plaza', 'fountain', 'ferris', 'stadium', 'monument', 'garden'] },
    { id: 'daily_service', title: 'Warga Terlayani', desc: 'Bangun 1 layanan warga.', target: 1, reward: 150, matches: ['police', 'fire', 'school', 'hospital', 'clinic', 'library'] }
  ];

  const POLICIES = [
    { id: 'parkprog', name: 'Program Taman Kota', cost: 5, happiness: 4, desc: 'Subsidi perawatan taman. +4 kebahagiaan.' },
    { id: 'recycle', name: 'Daur Ulang Warga', cost: 7, happiness: 2, pollution: 6, desc: 'Kurangi polusi pabrik. +2 kebahagiaan.' },
    { id: 'nightmarket', name: 'Pasar Malam', cost: 4, happiness: 2, commerce: 0.1, desc: '+10% pendapatan komersial, +2 kebahagiaan.' },
    { id: 'bus', name: 'Bus Kota Gratis', cost: 9, happiness: 3, desc: 'Transportasi umum murah. +3 kebahagiaan.' }
  ];

  const EVENTS = [
    {
      id: 'festival', icon: 'ferris', title: 'Festival Kota', text: 'Warga mengusulkan festival akhir pekan di alun-alun. Musik, kuliner, dan kembang api kecil-kecilan.',
      choices: [
        { label: 'Danai festival', note: 'Biaya $300 · +8 kebahagiaan', cost: 300, apply: s => { s.moodBoost += 8; } },
        { label: 'Tunda tahun depan', note: '-6 kebahagiaan', apply: s => { s.moodBoost -= 6; } }
      ]
    },
    {
      id: 'investor', icon: 'coin', title: 'Investor Gudang', text: 'Sebuah perusahaan logistik ingin membuka gudang besar. Uangnya menggiurkan, tapi warga khawatir bising.',
      choices: [
        { label: 'Terima investasi', note: '+$900 · -4 kebahagiaan', apply: s => { s.money += 900; s.moodBoost -= 4; } },
        { label: 'Tolak dengan sopan', note: '+3 kebahagiaan', apply: s => { s.moodBoost += 3; } }
      ]
    },
    {
      id: 'flood', icon: 'drop', title: 'Hujan Deras', text: 'Saluran air tersumbat dan beberapa jalan tergenang. Warga menunggu respons walikota.',
      choices: [
        { label: 'Kerahkan tim darurat', note: '-$200 · +6 kebahagiaan', cost: 200, apply: s => { s.moodBoost += 6; } },
        { label: 'Biarkan surut sendiri', note: '-8 kebahagiaan', apply: s => { s.moodBoost -= 8; } }
      ]
    },
    {
      id: 'contest', icon: 'trophy', title: 'Lomba Kota Bersih', text: 'Provinsi mengadakan penilaian kota bersih. Warga bersemangat membersihkan lingkungan.',
      choices: [
        { label: 'Ikut lomba', note: '+$500 hadiah · +4 kebahagiaan', cost: 150, apply: s => { s.money += 500; s.moodBoost += 4; } },
        { label: 'Lewati saja', note: 'Tidak ada perubahan', apply: s => {} }
      ]
    },
    {
      id: 'night', icon: 'moon', title: 'Malam Minggu Ramai', text: 'Pusat kota dipenuhi pengunjung. Pedagang kaki lima butuh izin mendadak.',
      choices: [
        { label: 'Beri izin & fasilitas', note: '-$120 · +5 kebahagiaan · +$250 pajak', cost: 120, apply: s => { s.money += 250; s.moodBoost += 5; } },
        { label: 'Tertibkan seperti biasa', note: '-2 kebahagiaan', apply: s => { s.moodBoost -= 2; } }
      ]
    },
    {
      id: 'donor', icon: 'heart', title: 'Donatur Anonim', text: 'Seorang perantau sukses ingin menyumbang untuk kotanya. Ia bertanya apa yang paling dibutuhkan.',
      choices: [
        { label: 'Terima untuk kas kota', note: '+$700', apply: s => { s.money += 700; } },
        { label: 'Minta untuk taman baru', note: '+5 kebahagiaan', apply: s => { s.moodBoost += 5; } }
      ]
    }
  ];

  const HOUSE_PALETTES = [
    { wall: '#f4e2c2', roof: '#d9614c', trim: '#fff8eb' },
    { wall: '#e7efd9', roof: '#3f8f8a', trim: '#f8fff4' },
    { wall: '#f6d7c8', roof: '#5b6bb0', trim: '#fff6f2' },
    { wall: '#efe6cf', roof: '#b45f3f', trim: '#fffdf5' },
    { wall: '#dcebf1', roof: '#cf6b49', trim: '#ffffff' }
  ];
  const SHOP_PALETTES = [
    { wall: '#f6ead1', awn: '#e6563d', sign: '#0e7c72' },
    { wall: '#e9eff6', awn: '#2f83c7', sign: '#d9614c' },
    { wall: '#f3e2e5', awn: '#c14b7c', sign: '#3f6f8a' },
    { wall: '#e8f0df', awn: '#e2a12c', sign: '#6b4a8a' }
  ];
  const FACTORY_PALETTES = [
    { wall: '#b9aa96', roof: '#8b7d6b', accent: '#d9614c' },
    { wall: '#a9b4b3', roof: '#778583', accent: '#d9a03c' },
    { wall: '#c4b39c', roof: '#8e7d66', accent: '#3f8f8a' }
  ];

  for (const id of Object.keys(DEFS)) DEFS[id].id = id;

  KK.GRID = GRID;
  KK.TILE_W = TILE_W;
  KK.TILE_H = TILE_H;
  KK.DEFS = DEFS;
  KK.CATS = CATS;
  KK.MISSIONS = MISSIONS;
  KK.DAILY_CHALLENGES = DAILY_CHALLENGES;
  KK.POLICIES = POLICIES;
  KK.EVENTS = EVENTS;
  KK.HOUSE_PALETTES = HOUSE_PALETTES;
  KK.SHOP_PALETTES = SHOP_PALETTES;
  KK.FACTORY_PALETTES = FACTORY_PALETTES;
  KK.catById = id => CATS.find(c => c.id === id);
  KK.defById = id => DEFS[id];
})(window.KK);
