window.KK = window.KK || {};
(function (KK) {
  const GRID = KK.GRID, DEFS = KK.DEFS, W = KK.TILE_W, H = KK.TILE_H;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const clamp = KK.render.clamp, lerp = KK.render.lerp;
  const SAVE_KEY = 'kotakita.save.v2';
  const THEME_KEY = 'kotakita.theme.v1';

  function setTheme(theme, persist = true) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const button = $('#themeBtn');
    if (button) {
      const label = isDark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';
      button.innerHTML = icon(isDark ? 'sun' : 'moon');
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(isDark));
    }
    if (persist) {
      try { localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light'); } catch (e) {}
    }
  }

  const canvas = $('#scene');
  const ctx = canvas.getContext('2d');
  const heroCanvas = $('#heroCanvas');
  const heroCtx = heroCanvas.getContext('2d');
  const cam = { x: 0, y: GRID * 16, zoom: .8 };
  let viewW = innerWidth, viewH = innerHeight, dpr = 1;
  let state = null;
  let soundOn = true;
  let audio = null;
  let uiTimer = 0, simAcc = 0, last = performance.now(), running = false;
  let activeCategory = 'infra';
  let hoverTile = null;
  let heroTime = 0, heroRaf = 0, heroWorld = null, heroLast = 0, heroCam = { x: -150, y: 290, zoom: 1 };
  let dragState = null;
  let toastTimes = [];
  const notificationHistory = [];

  // ---------- audio ----------
  function ac() {
    if (!soundOn) return null;
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, type, gain, slide) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), a.currentTime + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(gain || .05, a.currentTime + .012);
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + .02);
  }
  const sfx = {
    click: () => tone(520, .05, 'sine', .025),
    place: () => { tone(340, .07, 'triangle', .05); setTimeout(() => tone(520, .09, 'triangle', .04), 55); },
    error: () => tone(150, .12, 'sawtooth', .035, 100),
    demolish: () => tone(220, .12, 'triangle', .04, 90),
    coin: () => { tone(880, .07, 'sine', .04); setTimeout(() => tone(1180, .12, 'sine', .035), 60); },
    reward: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .18, 'sine', .04), i * 80)); },
    unlock: () => { [440, 660, 880].forEach((f, i) => setTimeout(() => tone(f, .22, 'triangle', .04), i * 100)); },
    win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, .4, 'sine', .05), i * 120)); },
    chime: () => tone(660, .12, 'sine', .025)
  };

  // ---------- utils ----------
  function fmt(n) { return Math.round(n).toLocaleString('id-ID'); }
  function money(n) { return (n < 0 ? '-$' : '$') + fmt(Math.abs(n)); }
  function idx(x, y) { return y * (state ? state.gridSize : GRID) + x; }
  function inBounds(x, y) { const size = state ? state.gridSize : GRID; return x >= 0 && y >= 0 && x < size && y < size; }
  const MAX_GRID_SIZE = 64;
  function expansionCost() { return 2500 + Math.max(0, (state.gridSize - GRID) / 8) * 5500; }
  function expandCity() {
    if (!state) return;
    if (state.gridSize >= MAX_GRID_SIZE) { toast('Kota sudah mencapai batas perluasan.', 'info', 'info'); return; }
    const cost = expansionCost();
    if (state.money < cost) { sfx.error(); toast(`Kas tidak cukup. Perlu ${money(cost)} untuk memperluas kota.`, 'bad', 'coin'); return; }
    const oldSize = state.gridSize, newSize = Math.min(MAX_GRID_SIZE, oldSize + 8);
    const grid = Array.from({ length: newSize * newSize }, () => ({ terrain: 'grass', road: false, b: null }));
    for (let y = 0; y < oldSize; y++) {
      for (let x = 0; x < oldSize; x++) grid[y * newSize + x] = state.grid[y * oldSize + x];
    }
    state.money -= cost;
    state.gridSize = newSize;
    state.grid = grid;
    recalc();
    updateAll();
    clampCam();
    saveGame(true);
    sfx.unlock();
    toast(`Kota diperluas menjadi ${newSize} × ${newSize}!`, 'good', 'unlock');
  }
  function tileAt(x, y) { return inBounds(x, y) ? state.grid[idx(x, y)] : null; }
  function uid() { state.uid = (state.uid || 0) + 1; return state.uid; }
  function defOf(b) { return DEFS[b.defId]; }
  function nearestUnlock() {
    let best = null;
    for (const id in DEFS) {
      const d = DEFS[id];
      if (d.hidden || !d.unlockPop) continue;
      if (d.unlockPop > state.maxPop && (!best || d.unlockPop < best.unlockPop)) best = d;
    }
    return best;
  }
  function mayorTitle(pop) {
    if (pop >= 1000) return 'Walikota Legenda';
    if (pop >= 600) return 'Walikota Utama';
    if (pop >= 300) return 'Walikota Madya';
    if (pop >= 100) return 'Walikota Muda';
    if (pop >= 30) return 'Walikota Pemula';
    return 'Walikota Baru';
  }
  const PERIOD_DAYS = { day: 1, week: 7, month: 30 };
  const PERIOD_LABELS = { day: 'Hari', week: 'Minggu', month: 'Bulan' };
  const BASE_TICK_SECONDS = 12;
  function periodScale() { return (PERIOD_DAYS[state.period] || PERIOD_DAYS.week) / 7; }
  function tickInterval() {
    const days = PERIOD_DAYS[state?.period] || PERIOD_DAYS.week;
    // Coarser periods take a little longer, making each calendar jump readable.
    return BASE_TICK_SECONDS * (1 + .2 * Math.log2(days));
  }
  function periodNumber() {
    return Math.floor((state.elapsedDays || 0) / (PERIOD_DAYS[state.period] || PERIOD_DAYS.week)) + 1;
  }
  function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }
  function dateText() {
    const h = Math.floor(state.hour || 0) % 24;
    return `${PERIOD_LABELS[state.period] || PERIOD_LABELS.week} ${periodNumber()}, ${pad2(h)}.00`;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- state ----------
  function blankState(name) {
    const s = {
      version: 2, cityName: name || 'Kota Kita', money: 6000, tick: 0, hour: 8.6,
      period: 'week', elapsedDays: 0, gridSize: GRID,
      taxRate: 9, policies: {}, grid: [], buildings: [], cars: [],
      uid: 0, population: 0, jobs: 0, commercialJobs: 0, industrialJobs: 0, workers: 0,
      happiness: 60, moodBoost: 0, maxPop: 0, powerCap: 0, powerUse: 0, waterCap: 0, waterUse: 0,
      income: 0, expense: 0, net: 0, roadCount: 0, zoneCount: 0,
      hasPower: false, hasWater: false, hasPark: false, hasSchool: false, hasStadium: false,
      demandR: 18, demandC: 8, demandI: 6,
      missionsDone: {}, won: false, unlocked: {}, eventTimer: 48, warned: {},
      stats: { houses: 0, shops: 0, factories: 0 }, selected: null, started: true,
      tool: null, paused: false, speed: 1, modalPause: false
    };
    return s;
  }

  function generateMap(seed) {
    const rand = rng(seed || Date.now());
    const grid = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      grid.push({ terrain: 'grass', road: false, b: null });
    }
    const s = { grid };
    // main lake (lower-left of map)
    const lx = 18.2, ly = 17.4, lr = 2.9;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x - lx, (y - ly) * 1.2);
      if (d < lr + rand() * .55) grid[idx(x, y)].terrain = 'water';
      else if (d < lr + 1.05) grid[idx(x, y)].terrain = Math.random() < .6 ? 'sand' : 'grass';
    }
    // small pond
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x - 3.6, (y - 20.2) * 1.15);
      if (d < 1.5 + rand() * .3) grid[idx(x, y)].terrain = 'water';
      else if (d < 2.1) grid[idx(x, y)].terrain = 'sand';
    }
    // scatter nature outside the central clearing
    const trees = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const t = grid[idx(x, y)];
      if (t.terrain !== 'grass') continue;
      const dc = Math.hypot(x - 12, y - 12);
      const edge = Math.min(x, y, GRID - 1 - x, GRID - 1 - y);
      let chance = 0;
      if (dc > 7.6) chance = .22;
      if (edge < 3) chance += .2;
      if (dc > 10) chance += .12;
      if (rand() < chance) trees.push({ defId: 'tree', x, y, level: 1, variant: Math.floor(rand() * 3) });
      else if (rand() < .018 && dc > 6.5) trees.push({ defId: 'rock', x, y, level: 1 });
    }
    return { grid, treeSeed: trees };
  }

  function newGame(name) {
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    state = blankState(name);
    const map = generateMap(seed);
    state.grid = map.grid;
    // place initial nature as buildings
    for (const t of map.treeSeed) addBuilding(t.defId, t.x, t.y, 1, { free: true, variant: t.variant });
    // force nature on reserved zone tiles too
    cam.x = 0; cam.y = GRID * 16 - 10;
    cam.zoom = defaultZoom();
    state.cars = [];
    spawnCars(true);
    recalc();
    checkUnlocks(true);
    updateAll();
    saveGame(true);
  }

  function defaultZoom() {
    if (innerWidth < 720) return .74;
    return clamp(Math.min(innerWidth / 1840, innerHeight / 1080), .7, .98);
  }

  function addBuilding(defId, x, y, level, opt) {
    const def = DEFS[defId]; if (!def) return null;
    opt = opt || {};
    const b = {
      uid: uid(), defId, x, y, w: def.w, h: def.h, level: level || 0,
      growth: 0, evo: 0, variant: opt.variant != null ? opt.variant : Math.floor(Math.random() * 6)
    };
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
      if (!inBounds(xx, yy)) return null;
      const t = state.grid[idx(xx, yy)];
      t.b = b;
    }
    state.buildings.push(b);
    if (!opt.free) state.money -= def.cost;
    return b;
  }
  function removeBuilding(b, refund) {
    if (!b) return;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
      if (inBounds(xx, yy) && state.grid[idx(xx, yy)].b === b) state.grid[idx(xx, yy)].b = null;
    }
    const i = state.buildings.indexOf(b);
    if (i >= 0) state.buildings.splice(i, 1);
    if (refund) state.money += Math.round(defOf(b).cost * .35);
    if (state.selected && state.selected.uid === b.uid) { state.selected = null; hideSelection(); }
  }
  function roadAccess(b) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (inBounds(x - 1, y) && state.grid[idx(x - 1, y)].road) return true;
      if (inBounds(x + 1, y) && state.grid[idx(x + 1, y)].road) return true;
      if (inBounds(x, y - 1) && state.grid[idx(x, y - 1)].road) return true;
      if (inBounds(x, y + 1) && state.grid[idx(x, y + 1)].road) return true;
    }
    return false;
  }
  function canPlace(def, x, y, opts) {
    opts = opts || {};
    if (!def) return { ok: false, msg: 'Bangunan tidak dikenal.' };
    if (x < 0 || y < 0 || x + def.w > state.gridSize || y + def.h > state.gridSize) return { ok: false, msg: 'Di luar batas kota.' };
    let wild = false;
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
      const t = state.grid[idx(xx, yy)];
      if (t.terrain === 'water') return { ok: false, msg: 'Tidak bisa membangun di atas air.' };
      if (t.road) return { ok: false, msg: 'Petak sudah dipakai jalan.' };
      if (t.b) {
        if (def.kind === 'road') return { ok: false, msg: 'Ada bangunan di petak ini.' };
        if (t.b.defId === 'tree' || t.b.defId === 'rock') wild = true;
        else return { ok: false, msg: 'Petak sudah terisi.' };
      }
    }
    if (wild) return { ok: false, msg: 'Bersihkan pohon/batu dengan alat bongkar dulu.' };
    if (def.kind !== 'road' && def.kind !== 'decor') {
      let ok = false;
      const test = { x, y, w: def.w, h: def.h };
      ok = roadAccess(test);
      if (!ok) return { ok: false, msg: 'Butuh akses jalan di sebelahnya.' };
    }
    if (!opts.free && state.money < def.cost) return { ok: false, msg: 'Kas kota tidak cukup.' };
    return { ok: true };
  }
  function placeAt(defId, x, y) {
    const def = DEFS[defId];
    const chk = canPlace(def, x, y);
    if (!chk.ok) { sfx.error(); toast(chk.msg, 'bad', 'info'); return false; }
    if (def.kind === 'road') {
      const t = state.grid[idx(x, y)];
      t.road = true; state.money -= def.cost;
      ensureCars();
    } else {
      addBuilding(defId, x, y, 0);
    }
    sfx.place();
    recalc(); checkUnlocks(); updateHUD(true); renderCatalog();
    saveGame(true);
    return true;
  }
  function forcePlace(defId, x, y, level) {
    const def = DEFS[defId]; if (!def) return null;
    if (def.kind === 'road') {
      for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
        if (inBounds(xx, yy)) {
          const t = state.grid[idx(xx, yy)];
          if (t.b && !t.b.defId !== 'tree') removeBuilding(t.b, false);
          t.b = null; t.road = true;
        }
      }
      return true;
    }
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
      if (inBounds(xx, yy)) {
        const t = state.grid[idx(xx, yy)];
        if (t.b) removeBuilding(t.b, false);
        t.road = false; t.b = null;
      }
    }
    return addBuilding(defId, x, y, level == null ? 1 : level, { free: true });
  }
  function bulldozeAt(x, y) {
    const t = tileAt(x, y);
    if (!t) return;
    if (t.b) {
      const b = t.b;
      const def = defOf(b);
      if (def.maint === 0 && def.cost === 0 && b.defId === 'rock') { removeBuilding(b, false); toast('Batu dibersihkan.', 'good', 'check'); }
      else {
        removeBuilding(b, true);
        toast(`${def.name} dibongkar · +${money(Math.round(def.cost * .35))}`, 'info', 'trash');
      }
      sfx.demolish();
    } else if (t.road) {
      t.road = false; state.money += Math.round(DEFS.road.cost * .5);
      toast('Jalan dibongkar.', 'info', 'trash');
      sfx.demolish();
    } else { return; }
    state.cars = state.cars.filter(c => tileAt(Math.round(c.x), Math.round(c.y))?.road);
    recalc(); checkUnlocks(); updateHUD(true); updateSelection(); saveGame(true);
  }

  // ---------- cars ----------
  function allRoads() {
    const list = [];
    for (let y = 0; y < state.gridSize; y++) for (let x = 0; x < state.gridSize; x++) if (state.grid[idx(x, y)].road) list.push({ x, y });
    return list;
  }
  const CAR_COLORS = ['#e6563d', '#3b8fd4', '#f2c94c', '#4fae62', '#c14b7c', '#f28b3c', '#6b7c8a', '#f7f4ec'];
  const VEHICLE_TYPES = ['car', 'car', 'car', 'motorcycle', 'motorcycle', 'bus', 'truck'];
  function newCar(tx, ty) {
    const choices = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx, ny = ty + dy;
      if (inBounds(nx, ny) && state.grid[idx(nx, ny)].road) choices.push({ x: nx, y: ny, dx, dy });
    }
    if (!choices.length) return null;
    const c = choices[Math.floor(Math.random() * choices.length)];
    const type = VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];
    const speed = .45 + Math.random() * .35;
    return {
      x: tx + .5, y: ty + .5, fromX: tx + .5, fromY: ty + .5, toX: c.x + .5, toY: c.y + .5,
      t: 0, speed: speed * (type === 'bus' || type === 'truck' ? .78 : type === 'motorcycle' ? 1.12 : 1),
      type, color: type === 'bus' ? '#e5b83f' : type === 'truck' ? '#4d9b78' : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      dir: c.dx > 0 ? 'x' : c.dx < 0 ? '-x' : c.dy > 0 ? 'y' : '-y', alive: true
    };
  }
  function carShape(car) {
    const dx = car.dir === 'x' ? 1 : car.dir === '-x' ? -1 : 0;
    const dy = car.dir === 'y' ? 1 : car.dir === '-y' ? -1 : 0;
    const vx = (dx - dy) * 32, vy = (dx + dy) * 16;
    const length = Math.hypot(vx, vy) || 1;
    const ux = vx / length, uy = vy / length;
    const px = (car.x - car.y) * 32 - uy * 4.8;
    const py = (car.x + car.y) * 16 + ux * 4.8;
    const halfLength = car.type === 'bus' || car.type === 'truck' ? 16 : car.type === 'motorcycle' ? 6.5 : 10;
    return { x: px, y: py, ux, uy, halfLength, halfWidth: 4.6 };
  }
  function carsOverlap(a, b) {
    const sa = carShape(a), sb = carShape(b);
    const axes = [[sa.ux, sa.uy], [-sa.uy, sa.ux], [sb.ux, sb.uy], [-sb.uy, sb.ux]];
    for (const [ax, ay] of axes) {
      const distance = Math.abs((sb.x - sa.x) * ax + (sb.y - sa.y) * ay);
      const ra = sa.halfLength * Math.abs(sa.ux * ax + sa.uy * ay) + sa.halfWidth * Math.abs(-sa.uy * ax + sa.ux * ay);
      const rb = sb.halfLength * Math.abs(sb.ux * ax + sb.uy * ay) + sb.halfWidth * Math.abs(-sb.uy * ax + sb.ux * ay);
      if (distance >= ra + rb) return false;
    }
    return true;
  }
  function nextCarState(car, dt, size, isRoad) {
    const next = { ...car };
    next.t += dt * next.speed;
    if (next.t >= 1) {
      const tx = Math.round(next.toX - .5), ty = Math.round(next.toY - .5);
      const prevDx = Math.sign(next.toX - next.fromX), prevDy = Math.sign(next.toY - next.fromY);
      next.fromX = next.toX; next.fromY = next.toY;
      const choices = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && isRoad(nx, ny)) choices.push({ x: nx, y: ny, dx, dy });
      }
      if (!choices.length) { next.alive = false; return next; }
      const reverse = { dx: -prevDx, dy: -prevDy };
      const forward = choices.filter(pick => pick.dx !== reverse.dx || pick.dy !== reverse.dy);
      const options = forward.length ? forward : choices;
      const pick = options[Math.floor(Math.random() * options.length)];
      next.toX = pick.x + .5; next.toY = pick.y + .5;
      next.dir = pick.dx > 0 ? 'x' : pick.dx < 0 ? '-x' : pick.dy > 0 ? 'y' : '-y';
      next.t = 0;
    }
    next.x = lerp(next.fromX, next.toX, next.t);
    next.y = lerp(next.fromY, next.toY, next.t);
    return next;
  }
  function spawnCars(initial) {
    const roads = allRoads();
    if (!roads.length) return;
    const cap = Math.min(16, Math.floor(roads.length / 2.4));
    let attempts = 0;
    while (state.cars.length < cap && attempts++ < cap * 24) {
      const r = roads[Math.floor(Math.random() * roads.length)];
      const c = newCar(r.x, r.y);
      if (!c) continue;
      c.t = initial ? Math.random() : 0;
      c.x = lerp(c.fromX, c.toX, c.t); c.y = lerp(c.fromY, c.toY, c.t);
      if (state.cars.some(other => carsOverlap(c, other))) continue;
      state.cars.push(c);
    }
  }
  function ensureCars() { spawnCars(); }
  function updateCars(dt) {
    if (!state || !state.cars) return;
    const isRoad = (x, y) => state.grid[idx(x, y)].road;
    for (const c of state.cars) {
      if (!c.alive) continue;
      const next = nextCarState(c, dt, state.gridSize, isRoad);
      if (state.cars.some(other => other !== c && carsOverlap(next, other))) continue;
      Object.assign(c, next);
    }
    state.cars = state.cars.filter(c => c.alive);
    const roads = allRoads();
    if (state.cars.length < Math.min(14, Math.floor(roads.length / 2.4)) && Math.random() < .02) {
      const r = roads[Math.floor(Math.random() * roads.length)];
      if (r) {
        const c = newCar(r.x, r.y);
        if (c && !state.cars.some(other => carsOverlap(c, other))) state.cars.push(c);
      }
    }
  }

  // ---------- simulation ----------
  function levelVal(def, field, level) {
    const arr = def[field];
    if (Array.isArray(arr)) return arr[Math.min(level, arr.length - 1)] || 0;
    return arr || 0;
  }
  function zoneArtKind(def) {
    return def.kind === 'zone-r' ? 'r' : def.kind === 'zone-c' ? 'c' : 'i';
  }
  function bCenter(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function distance(a, b) {
    const ca = bCenter(a), cb = bCenter(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y);
  }
  function nearbyArt(b, arts, radiusOverride) {
    for (const o of state.buildings) {
      if (o === b) continue;
      const d = defOf(o);
      if (!d) continue;
      const art = KK.render.artFor(d, o.level);
      if (!arts.includes(art)) continue;
      const r = radiusOverride || d.radius || 0;
      if (distance(b, o) <= r) return true;
    }
    return false;
  }

  function recalc() {
    if (!state) return;
    let pop = 0, workers = 0, jobs = 0, cJobs = 0, iJobs = 0;
    let powerUse = 0, powerCap = 0, waterUse = 0, waterCap = 0, expense = 0;
    let roadCount = 0, zoneCount = 0, houses = 0, shops = 0, factories = 0;
    let hasPower = false, hasWater = false, hasPark = false, hasSchool = false, hasStadium = false;
    const houseList = [], amenities = [], polluters = [];
    for (const b of state.buildings) {
      const d = defOf(b); if (!d) continue;
      expense += d.maint || 0;
      if (d.kind === 'zone-r') {
        zoneCount++;
        if (b.level > 0) {
          pop += levelVal(d, 'cap', b.level);
          powerUse += levelVal(d, 'powerUse', b.level);
          waterUse += levelVal(d, 'waterUse', b.level);
          houseList.push(b); houses++;
        }
      } else if (d.kind === 'zone-c') {
        zoneCount++;
        if (b.level > 0) {
          cJobs += levelVal(d, 'jobs', b.level);
          powerUse += levelVal(d, 'powerUse', b.level);
          waterUse += levelVal(d, 'waterUse', b.level);
          shops++;
        }
      } else if (d.kind === 'zone-i') {
        zoneCount++;
        if (b.level > 0) {
          iJobs += levelVal(d, 'jobs', b.level);
          powerUse += levelVal(d, 'powerUse', b.level);
          waterUse += levelVal(d, 'waterUse', b.level);
          factories++;
          polluters.push(b);
        }
      } else {
        powerUse += d.powerUse || 0;
        waterUse += d.waterUse || 0;
        powerCap += d.powerSupply || 0;
        waterCap += d.waterSupply || 0;
        jobs += d.jobs || 0;
        if (d.powerSupply) hasPower = true;
        if (d.waterSupply) hasWater = true;
        if (artOr(defOf(b), b) === 'park' || artOr(defOf(b), b) === 'smallpark') hasPark = true;
        if (artOr(defOf(b), b) === 'school') hasSchool = true;
        if (artOr(defOf(b), b) === 'stadium') hasStadium = true;
      }
      if (d.happy && d.radius) amenities.push(b);
      if (b.defId === 'solar') hasPower = true;
    }
    for (let y = 0; y < state.gridSize; y++) for (let x = 0; x < state.gridSize; x++) if (state.grid[idx(x, y)].road) roadCount++;
    expense += roadCount * DEFS.road.maint;
    for (const pid in state.policies) {
      const p = KK.POLICIES.find(x => x.id === pid);
      if (p && state.policies[pid]) expense += p.cost;
    }
    workers = Math.round(pop * .42);
    jobs += cJobs + iJobs;
    const powered = powerUse <= powerCap;
    const watered = waterUse <= waterCap;
    const policyHappy = KK.POLICIES.reduce((n, p) => n + (state.policies[p.id] ? p.happiness : 0), 0);
    const commerceBonus = KK.POLICIES.reduce((n, p) => n + (state.policies[p.id] ? (p.commerce || 0) : 0), 0);
    const taxPenalty = Math.max(0, (state.taxRate || 9) - 10) * 2.5;
    const unemployment = workers > jobs ? Math.min(24, (workers - jobs) / Math.max(1, workers) * 30) : 0;
    const pollutionPolicy = KK.POLICIES.reduce((n, p) => n + (state.policies[p.id] ? (p.pollution || 0) : 0), 0);
    let happyTotal = 0;
    for (const h of houseList) {
      let bonus = 0;
      for (const a of amenities) {
        const ad = defOf(a);
        if (distance(h, a) <= (ad.radius || 0)) bonus += ad.happy || 0;
      }
      bonus = Math.min(26, bonus);
      let poll = 0;
      for (const f of polluters) {
        if (distance(h, f) <= (defOf(f).pollutionRadius || 3)) poll += 1.6 + f.level * .5;
      }
      poll = Math.max(0, Math.min(14, poll) - pollutionPolicy);
      let hv = 56 + bonus + policyHappy + state.moodBoost - taxPenalty - unemployment - poll;
      if (!powered) hv -= 24;
      if (!watered) hv -= 20;
      happyTotal += clamp(hv, 0, 100);
    }
    let happiness;
    if (houseList.length) happiness = happyTotal / houseList.length;
    else happiness = clamp(62 + policyHappy + state.moodBoost - taxPenalty, 0, 100);
    const income = pop * .33 * ((state.taxRate || 9) / 9) + cJobs * .5 * (1 + commerceBonus) + iJobs * .36;
    state.population = pop;
    state.workers = workers;
    state.jobs = jobs;
    state.commercialJobs = cJobs;
    state.industrialJobs = iJobs;
    state.powerUse = Math.round(powerUse * 10) / 10;
    state.powerCap = powerCap;
    state.waterUse = Math.round(waterUse * 10) / 10;
    state.waterCap = waterCap;
    state.powered = powered;
    state.watered = watered;
    state.expense = Math.round(expense * 10) / 10;
    state.income = Math.round(income * 10) / 10;
    state.net = Math.round((income - expense) * 10) / 10;
    state.happiness = Math.round(happiness);
    state.roadCount = roadCount;
    state.zoneCount = zoneCount;
    state.hasPower = hasPower;
    state.hasWater = hasWater;
    state.hasPark = hasPark;
    state.hasSchool = hasSchool;
    state.hasStadium = hasStadium;
    state.houses = houses; state.shops = shops; state.factories = factories;
    state.demandR = clamp(16 + jobs * 1.25 - pop * .38 + (state.happiness < 48 ? -8 : 0), 0, 100);
    state.demandC = clamp(8 + pop * .34 - cJobs * .85, 0, 100);
    state.demandI = clamp(5 + pop * .18 - iJobs * .45, 0, 100);
    state.maxPop = Math.max(state.maxPop, pop);
    // economy is deliberately forgiving: never below -2.000
    if (state.money < -2000) state.money = -2000;
    if (!state.stats) state.stats = {};
    state.stats.houses = houses; state.stats.shops = shops; state.stats.factories = factories;
  }
  function artOr(def, b) { return KK.render.artFor(def, b.level); }
  function demandFor(kind) {
    return kind === 'r' ? state.demandR : kind === 'c' ? state.demandC : state.demandI;
  }

  function simulateTick() {
    if (!state) return;
    state.tick++;
    const scale = periodScale();
    state.elapsedDays = (state.elapsedDays || 0) + PERIOD_DAYS[state.period];
    state.hour = (state.hour + .24 * scale) % 24;
    state.moodBoost *= Math.pow(.966, scale);
    if (Math.abs(state.moodBoost) < .05) state.moodBoost = 0;
    recalc();
    const hasPower = state.powerCap >= state.powerUse;
    const hasWater = state.waterCap >= state.waterUse;
    let changed = false;
    for (const b of state.buildings.slice()) {
      const d = defOf(b);
      if (!d || !d.kind || !d.kind.startsWith('zone')) continue;
      const ok = hasPower && hasWater && roadAccess(b);
      if (b.level === 0) {
        const kind = zoneArtKind(d);
        if (ok && demandFor(kind) > 0 && state.happiness >= 38) {
          b.growth += (1 + (state.happiness > 66 ? .5 : 0)) * scale;
          if (b.growth >= 2) { b.level = 1; b.growth = 0; b.evo = 0; changed = true; }
        } else b.growth = Math.max(0, b.growth - .5 * scale);
      } else {
        const school = nearbyArt(b, ['school']);
        const hospital = nearbyArt(b, ['hospital']);
        let maxLv = 3;
        if (kindOf(d) === 'r') maxLv = 2 + (school ? 1 : 0) + (hospital ? 1 : 0);
        if (b.level < Math.min(d.maxLevel || 3, maxLv) && ok && state.happiness >= 50) {
          b.evo += (state.happiness >= 68 ? 2 : 1) * scale;
          const need = [0, 7, 13, 21][b.level] || 99;
          if (b.evo >= need) { b.level++; b.evo = 0; changed = true; }
        } else if (b.evo > 0) b.evo = Math.max(0, b.evo - scale);
      }
    }
    if (changed) recalc();
    state.money += (state.income - state.expense) * scale;
    // resource warnings
    if (!state.warned.power && state.powerUse > state.powerCap && state.powerUse > 0) {
      toast('Listrik tidak cukup! Bangun pembangkit atau taman surya.', 'bad', 'bolt');
      state.warned.power = true;
    }
    if (state.powerUse <= state.powerCap) state.warned.power = false;
    if (!state.warned.water && state.waterUse > state.waterCap && state.waterUse > 0) {
      toast('Pasokan air kurang! Bangun menara air tambahan.', 'bad', 'drop');
      state.warned.water = true;
    }
    if (state.waterUse <= state.waterCap) state.warned.water = false;
    checkUnlocks();
    checkMissions();
    // random city event
    state.eventTimer = (state.eventTimer || 48) - scale;
    if (state.eventTimer <= 0) {
      state.eventTimer = 55 + Math.floor(Math.random() * 25);
      if (!state.modalPause && state.population >= 20) setTimeout(showRandomEvent, 350);
    }
    if (state.tick % Math.max(1, Math.round(2 / scale)) === 0) spawnCars();
    if (state.tick % Math.max(1, Math.round(20 / scale)) === 0) saveGame(true);
    updateAll();
    updateSelection();
  }
  function kindOf(def) { return def.kind === 'zone-r' ? 'r' : def.kind === 'zone-c' ? 'c' : 'i'; }

  function checkUnlocks(silent) {
    if (!state) return;
    for (const id in DEFS) {
      const d = DEFS[id];
      if (!d.unlockPop || d.unlockPop > state.maxPop) continue;
      if (!state.unlocked[id]) {
        state.unlocked[id] = true;
        if (!silent) {
          toast(`Bangunan baru terbuka: ${d.name}`, 'reward', 'trophy');
          sfx.unlock();
        }
      }
    }
  }
  function checkMissions() {
    if (!state) return;
    for (const m of KK.MISSIONS) {
      if (state.missionsDone[m.id]) continue;
      if (m.check(state)) {
        state.missionsDone[m.id] = true;
        state.money += m.reward;
        sfx.reward();
        toast(`Misi selesai: ${m.label} · +${money(m.reward)}`, 'reward', 'trophy');
        if (m.id === 'metro' && !state.won) {
          state.won = true;
          setTimeout(showWin, 900);
        }
        updateHUD(true); renderMissions();
      }
    }
  }
  function happyLabel(v) {
    if (v >= 85) return 'Sangat bahagia';
    if (v >= 70) return 'Bahagia';
    if (v >= 55) return 'Cukup senang';
    if (v >= 40) return 'Biasa saja';
    if (v >= 25) return 'Gelisah';
    return 'Sangat tidak puas';
  }

  // ---------- UI ----------
  function icon(name, cls) { return `<svg class="ic ${cls || ''}"><use href="#i-${name}"/></svg>`; }
  function renderNotifications() {
    const list = $('#notificationsList');
    if (!list) return;
    list.replaceChildren();
    if (!notificationHistory.length) {
      const empty = document.createElement('div');
      empty.className = 'notifications-empty';
      empty.innerHTML = `<span class="notifications-empty-icon">${icon('bell')}</span><strong>Belum ada kabar</strong><span>Notifikasi terbaru tentang kotamu akan muncul di sini.</span>`;
      list.appendChild(empty);
      return;
    }
    for (const item of notificationHistory) {
      const row = document.createElement('article');
      row.className = `notification-item ${item.type}`;
      const mark = document.createElement('span');
      mark.className = 'notification-icon';
      mark.innerHTML = icon(item.icon);
      const content = document.createElement('div');
      content.className = 'notification-content';
      const message = document.createElement('div');
      message.className = 'notification-message';
      message.textContent = item.message;
      const time = document.createElement('time');
      time.className = 'notification-time';
      time.dateTime = item.date.toISOString();
      time.textContent = item.date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      content.append(message, time);
      row.append(mark, content);
      list.appendChild(row);
    }
  }
  function animateNotificationBell() {
    const button = $('#notificationsBtn');
    if (!button) return;
    button.classList.remove('is-ringing');
    // Force a style recalculation so rapid notifications restart the animation.
    void button.offsetWidth;
    button.classList.add('is-ringing');
  }
  function toast(msg, type, iconName) {
    const entry = {
      message: String(msg),
      type: type || 'info',
      icon: iconName || 'info',
      date: new Date()
    };
    notificationHistory.unshift(entry);
    if (notificationHistory.length > 50) notificationHistory.length = 50;
    animateNotificationBell();
    renderNotifications();
  }
  function showToast(msg, type, iconName) { toast(msg, type, iconName); }

  function renderRail() {
    const rail = $('#rail');
    let html = '';
    for (const c of KK.CATS) {
      html += `<button class="rail-btn ${c.id === activeCategory ? 'active' : ''}" data-cat="${c.id}" title="${c.name}" aria-label="${c.name}">
        ${icon(c.icon)}<span class="label">${c.name.split(' ')[0]}</span></button>`;
    }
    html += `<div class="rail-spacer"></div><div class="rail-sep"></div>
      <button class="rail-btn" id="railPolicy" title="Kebijakan kota">${icon('scroll')}<span class="label">Kebijakan</span></button>
      <button class="rail-btn danger ${state && state.tool === 'bulldoze' ? 'active' : ''}" data-tool="bulldoze" title="Bongkar (B)">${icon('bulldoze')}<span class="label">Bongkar</span></button>`;
    rail.innerHTML = html;
  }

  function renderCatalog() {
    if (!state) return;
    const cat = KK.catById(activeCategory);
    const grid = $('#catalogGrid');
    $('#catalogTitle').textContent = cat.name;
    $('#catalogEyebrow').textContent = cat.eyebrow;
    $('#catalogBlurb').textContent = cat.blurb;
    const items = Object.values(DEFS).filter(d => d.cat === activeCategory && !d.hidden)
      .sort((a, b) => (a.unlockPop || 0) - (b.unlockPop || 0) || a.cost - b.cost);
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const d of items) {
      const locked = d.unlockPop > state.maxPop;
      const card = document.createElement('button');
      card.className = 'card' + (locked ? ' locked' : '') + (state.tool === d.id ? ' active' : '') + (!locked && state.money < d.cost ? ' cant' : '');
      card.dataset.id = d.id;
      card.setAttribute('aria-label', d.name);
      card.innerHTML = `
        <div class="card-preview"><canvas width="220" height="150"></canvas></div>
        <div class="card-body">
          <div class="card-name">${d.name}</div>
          <div class="card-meta"><span class="card-cost">${icon('coin')}${d.cost}</span><span class="card-tag">${d.tag || ''}</span></div>
        </div>
        ${locked ? `<div class="card-lock"><span class="lock-pill">${icon('lock')}${fmt(d.unlockPop)} warga</span></div>` : ''}`;
      frag.appendChild(card);
    }
    grid.appendChild(frag);
    grid.querySelectorAll('.card').forEach(card => {
      const cv = card.querySelector('canvas');
      const d = DEFS[card.dataset.id];
      if (cv && d) KK.render.drawThumbnail(cv, d.id);
    });
    updateToolHint();
  }
  function updateToolHint() {
    const el = $('#toolHint');
    if (!el) return;
    if (state && state.tool && state.tool !== 'bulldoze' && DEFS[state.tool]) {
      const d = DEFS[state.tool];
      el.innerHTML = `<b>${d.name}</b> · ${money(d.cost)} · ${d.desc}`;
    } else if (state && state.tool === 'bulldoze') {
      el.innerHTML = '<b>Alat bongkar</b> · klik bangunan atau jalan. Kembalikan 35% biaya.';
    } else {
      el.innerHTML = 'Pilih bangunan, lalu klik peta. Tahan & geser untuk menggeser peta.';
    }
  }

  function updateAll() {
    if (!state) return;
    updateHUD(true);
    renderMissions();
    updateAdvisor();
    updateMinimap();
    updateSelection();
  }

  function updateHUD(force) {
    if (!state) return;
    $('#cityNameLabel').textContent = state.cityName;
    $('#mayorLevel').textContent = mayorTitle(state.population);
    $('#dateLabel').textContent = dateText();
    $('#statMoney').textContent = money(state.money);
    const inc = $('#statIncome');
    inc.textContent = (state.net >= 0 ? '+' : '') + money(state.net).replace('$', '$') + '/mg';
    inc.classList.toggle('neg', state.net < 0);
    $('#statPop').textContent = fmt(state.population);
    $('#statHappy').textContent = state.happiness;
    $('#statPower').textContent = `${Math.round(state.powerUse)}/${Math.round(state.powerCap)}`;
    $('#statWater').textContent = `${Math.round(state.waterUse)}/${Math.round(state.waterCap)}`;
    $('#weekLabel').textContent = `${PERIOD_LABELS[state.period] || PERIOD_LABELS.week} ${periodNumber()}`;
    $('#happyValue').textContent = state.happiness + '%';
    $('#happyBar').style.width = state.happiness + '%';
    $('#incomeValue').textContent = (state.income >= 0 ? '+' : '') + money(state.income);
    $('#expenseValue').textContent = '-' + money(state.expense).replace('$', '$');
    $('#jobsValue').textContent = `${fmt(state.jobs)} / ${fmt(state.workers)}`;
    $('#demandR').style.width = Math.min(100, state.demandR) + '%';
    $('#demandC').style.width = Math.min(100, state.demandC) + '%';
    $('#demandI').style.width = Math.min(100, state.demandI) + '%';
    $('#missionCount').textContent = `${Object.keys(state.missionsDone).filter(k => KK.MISSIONS.some(m => m.id === k)).length}/10`;
    $('#miniBadge').textContent = `${state.gridSize} × ${state.gridSize} · ${state.population} warga`;
    const expandBtn = $('#expandBtn');
    if (expandBtn) {
      const atLimit = state.gridSize >= MAX_GRID_SIZE;
      const cost = expansionCost();
      expandBtn.disabled = atLimit || state.money < cost;
      expandBtn.innerHTML = atLimit ? 'Batas kota tercapai' : `Perluas kota <span>${money(cost)}</span>`;
      expandBtn.title = atLimit ? 'Ukuran maksimum 64 × 64' : `Tambah 8 petak ke setiap sisi · ${money(cost)}`;
      expandBtn.setAttribute('aria-label', atLimit ? 'Ukuran maksimum kota tercapai' : `Perluas kota seharga ${money(cost)}`);
    }
    // speed / pause
    const pb = $('#pauseBtn');
    if (pb) {
      pb.innerHTML = icon(state.paused ? 'play' : 'pause');
      pb.setAttribute('aria-label', state.paused ? 'Lanjutkan' : 'Jeda');
    }
    $$('#speedGroup button').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === state.speed));
    const periodSelect = $('#periodSelect');
    if (periodSelect) {
      periodSelect.value = PERIOD_DAYS[state.period] ? state.period : 'week';
      periodSelect.title = `Satu langkah memajukan ${PERIOD_DAYS[state.period] || PERIOD_DAYS.week} hari. Kecepatan ${state.speed}×.`;
    }
    // tool / unlock info
    let hint;
    if (state.tool && state.tool !== 'bulldoze' && DEFS[state.tool]) {
      hint = `Alat: ${DEFS[state.tool].name} · ${money(DEFS[state.tool].cost)} · klik peta`;
    } else if (state.tool === 'bulldoze') {
      hint = 'Alat bongkar aktif · klik bangunan';
    } else {
      const u = nearestUnlock();
      hint = u ? `Berikutnya terbuka: ${u.name} (${fmt(u.unlockPop)} warga)` : 'Semua bangunan terbuka — bangun kotamu!';
    }
    $('#nextUnlock').textContent = hint;
    updateToolHint();
    if (force) updateAdvisor();
  }

  function renderMissions() {
    if (!state) return;
    const list = $('#missionList'); if (!list) return;
    const done = KK.MISSIONS.filter(m => state.missionsDone[m.id]);
    let html = '';
    for (const m of KK.MISSIONS) {
      const d = !!state.missionsDone[m.id];
      html += `<div class="mission ${d ? 'done' : ''}">
        <span class="mcheck">${d ? icon('check') : ''}</span>
        <span>${m.label}</span>
        <span class="reward">${d ? '✓' : '+' + money(m.reward)}</span>
      </div>`;
    }
    list.innerHTML = html;
    $('#missionCount').textContent = `${done.length}/10`;
  }

  function updateAdvisor() {
    if (!state) return;
    let text;
    if (!state.roadCount) text = 'Mulai dengan membangun beberapa petak Jalan. Zona dan bangunan harus menempel pada jalan.';
    else if (!state.zoneCount) text = 'Sekarang cat Zona Perumahan di sisi jalan. Rumah akan tumbuh dengan sendirinya.';
    else if (!state.hasPower) text = 'Warga butuh listrik. Bangun Pembangkit Uap di dekat jalan (kategori Utilitas).';
    else if (!state.hasWater) text = 'Listrik sudah ada. Jangan lupa Menara Air agar rumah bisa terisi.';
    else if (state.powerUse > state.powerCap) text = 'Listrik tidak cukup! Tambah pembangkit atau hemat dengan taman surya.';
    else if (state.waterUse > state.waterCap) text = 'Pasokan air kurang. Bangun menara air tambahan di dekat jalan.';
    else if (state.jobs < state.workers * .75 && state.population > 20) text = 'Banyak warga menganggur. Cat zona komersial atau industri untuk lapangan kerja.';
    else if (state.happiness < 50) text = 'Warga gelisah. Tambah taman, sekolah, atau polisi—dan jangan naikkan pajak terlalu tinggi.';
    else if (!state.hasPark && state.population > 30) text = 'Kota butuh tempat bersantai. Taman Kota menaikkan kebahagiaan dan mempercepat pertumbuhan.';
    else if (!state.hasSchool && state.maxPop >= 30) text = 'Sekolah akan terbuka di 50 warga. Siapkan lahan dan tabungan untuk mendidik generasi berikutnya.';
    else if (state.money < 300) text = 'Kas menipis. Selesaikan misi atau bangun zona komersial untuk menambah pemasukan.';
    else {
      const n = KK.MISSIONS.find(m => !state.missionsDone[m.id]);
      text = n ? `Misi berikutnya: ${n.label}. ${n.tip}` : 'Kota berjalan baik. Teruslah berkembang hingga menjadi metropolis!';
    }
    $('#advisorText').textContent = text;
  }

  function updateMinimap() {
    const cv = $('#minimap'); if (!cv || !state) return;
    const c = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#8ccfe0'; c.fillRect(0, 0, w, h);
    const size = state.gridSize;
    const padX = (w - (Math.min(w, h) - 16)) / 2 + 8;
    const padY = (h - (Math.min(w, h) - 16)) / 2 + 8;
    const cell = (Math.min(w, h) - 16) / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const t = state.grid[idx(x, y)];
      let col = t.terrain === 'water' ? '#3b93b3' : t.terrain === 'sand' ? '#e6d29c' : '#87c568';
      if (t.road) col = '#59626a';
      if (t.b) {
        const d = defOf(t.b);
        if (d.kind === 'zone-r') col = '#3aa96b';
        else if (d.kind === 'zone-c') col = '#3b8fd4';
        else if (d.kind === 'zone-i') col = '#d9a03c';
        else if (d.cat === 'service') col = '#e05a8b';
        else if (d.cat === 'fun') col = '#f0a33e';
        else if (d.kind === 'decor') col = t.b.defId === 'tree' ? '#4f9b54' : '#7bc46a';
        else col = '#6f8f89';
      }
      c.fillStyle = col;
      c.fillRect(padX + x * cell, padY + y * cell, Math.ceil(cell), Math.ceil(cell));
    }
    // camera marker (approx)
    const gx = (cam.x / 32 + cam.y / 16) / 2;
    const gy = (cam.y / 16 - cam.x / 32) / 2;
    c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 2;
    c.strokeRect(padX + gx * cell - 8, padY + gy * cell - 8, 16, 16);
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.beginPath(); c.arc(padX + gx * cell, padY + gy * cell, 2.5, 0, 7); c.fill();
    // frame
    c.strokeStyle = 'rgba(9,57,62,.15)'; c.lineWidth = 1; c.strokeRect(0, 0, w, h);
  }

  function updateSelection() {
    if (!state) return;
    const card = $('#selectionCard');
    if (!state.selected) { card.hidden = true; card.innerHTML = ''; return; }
    const b = state.buildings.find(x => x.uid === state.selected.uid);
    if (!b) { state.selected = null; card.hidden = true; return; }
    state.selected = b;
    const d = defOf(b);
    let rows = '';
    if (d.kind === 'zone-r') rows = b.level === 0 ? '<span>Menunggu penghuni</span>' : `<span>Level ${b.level}</span><span>${levelVal(d, 'cap', b.level)} warga</span>`;
    else if (d.kind === 'zone-c') rows = b.level === 0 ? '<span>Menunggu usaha</span>' : `<span>Level ${b.level}</span><span>${levelVal(d, 'jobs', b.level)} pekerjaan</span>`;
    else if (d.kind === 'zone-i') rows = b.level === 0 ? '<span>Menunggu pabrik</span>' : `<span>Level ${b.level}</span><span>${levelVal(d, 'jobs', b.level)} pekerjaan</span>`;
    else if (d.powerSupply) rows = `<span>+${d.powerSupply} listrik</span><span>Biaya ${money(d.maint)}/mg</span>`;
    else if (d.waterSupply) rows = `<span>+${d.waterSupply} air</span><span>Biaya ${money(d.maint)}/mg</span>`;
    else if (d.jobs) rows = `<span>${d.jobs} pekerjaan</span><span>Biaya ${money(d.maint)}/mg</span>`;
    else rows = `<span>${d.maint ? 'Biaya ' + money(d.maint) + '/mg' : 'Dekorasi'}</span>`;
    card.innerHTML = `
      <div class="sel-head"><h3>${d.name}</h3><button class="icon-btn ghost" id="selClose" aria-label="Tutup">${icon('close')}</button></div>
      <div class="sel-sub">${d.desc}</div>
      <div class="sel-rows">${rows}</div>
      <div class="sel-actions">
        <button class="mini-btn" id="selFocus">Fokus</button>
        <button class="mini-btn danger" id="selDemo">Bongkar +${money(Math.round(d.cost * .35))}</button>
      </div>`;
    card.hidden = false;
    $('#selClose').onclick = hideSelection;
    $('#selFocus').onclick = () => { cam.x = (b.x + b.w / 2 - b.y - b.h / 2) * 32; cam.y = (b.x + b.w / 2 + b.y + b.h / 2) * 16; clampCam(); };
    $('#selDemo').onclick = () => { bulldozeAt(b.x, b.y); hideSelection(); };
  }
  function hideSelection() { if (state) state.selected = null; const c = $('#selectionCard'); if (c) { c.hidden = true; c.innerHTML = ''; } }

  // ---------- modals ----------
  function openModal(html, opts) {
    opts = opts || {};
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop"></div><div class="modal">${html}</div>`;
    root.classList.add('open');
    if (state) state.modalPause = opts.pause !== false;
    const close = () => closeModal();
    root.querySelector('.modal-backdrop').onclick = opts.locked ? null : close;
    const x = root.querySelector('.modal-x');
    if (x) x.onclick = close;
    return root.querySelector('.modal');
  }
  function closeModal() {
    const root = $('#modalRoot');
    root.classList.remove('open'); root.innerHTML = '';
    if (state) state.modalPause = false;
  }
  function showSettings() {
    const modal = openModal(`
      <button class="icon-btn ghost modal-x" aria-label="Tutup">${icon('close')}</button>
      <div class="modal-kicker">PREFERENSI KOTA</div>
      <h2>Pengaturan</h2>
      <p>Atur suasana dan ritme simulasi sesuai cara bermainmu.</p>
      <div class="settings-list">
        <section class="settings-row">
          <div><b>Kecepatan waktu</b><small>Atur laju perkembangan kota</small></div>
          <div class="speed-group settings-speed" id="speedGroup" aria-label="Kecepatan waktu">
            <button type="button" data-speed="1">1×</button>
            <button type="button" data-speed="2">2×</button>
            <button type="button" data-speed="3">3×</button>
          </div>
        </section>
        <label class="settings-row" for="periodSelect">
          <span><b>Periode simulasi</b><small>Durasi tiap langkah ekonomi</small></span>
          <select id="periodSelect" aria-label="Periode simulasi">
            <option value="day">Harian</option><option value="week">Mingguan</option><option value="month">Bulanan</option>
          </select>
        </label>
        <section class="settings-row">
          <div><b>Suara</b><small>Efek suara permainan</small></div>
          <button class="settings-toggle" id="settingsSoundBtn" type="button" aria-pressed="true"></button>
        </section>
        <section class="settings-row">
          <div><b>Tema</b><small>Tampilan terang atau gelap</small></div>
          <button class="settings-toggle" id="settingsThemeBtn" type="button"></button>
        </section>
      </div>`, { pause: false });
    modal.classList.add('settings-modal');
    const soundBtn = modal.querySelector('#settingsSoundBtn');
    const themeBtn = modal.querySelector('#settingsThemeBtn');
    const syncSettings = () => {
      soundBtn.innerHTML = `${icon(soundOn ? 'sound' : 'mute')} ${soundOn ? 'Aktif' : 'Mati'}`;
      soundBtn.setAttribute('aria-pressed', String(soundOn));
      const dark = document.documentElement.dataset.theme === 'dark';
      themeBtn.innerHTML = `${icon(dark ? 'moon' : 'sun')} ${dark ? 'Gelap' : 'Terang'}`;
      themeBtn.setAttribute('aria-label', `Tema ${dark ? 'gelap' : 'terang'}; klik untuk mengganti`);
    };
    syncSettings();
    if (state) updateHUD();
    modal.querySelector('#speedGroup').addEventListener('click', e => {
      const button = e.target.closest('button'); if (!button || !state) return;
      state.speed = Number(button.dataset.speed);
      updateHUD(true); saveGame(true); sfx.click();
    });
    modal.querySelector('#periodSelect').addEventListener('change', e => {
      if (!state || !PERIOD_DAYS[e.target.value]) return;
      const progress = clamp(simAcc / tickInterval(), 0, 1);
      state.period = e.target.value;
      simAcc = progress * tickInterval();
      updateHUD(true); saveGame(true); sfx.click();
    });
    soundBtn.onclick = () => {
      soundOn = !soundOn; audio = null; syncSettings();
      if (soundOn) sfx.click();
      toast(soundOn ? 'Suara aktif.' : 'Suara dimatikan.', 'info', soundOn ? 'sound' : 'mute');
    };
    themeBtn.onclick = () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      syncSettings(); sfx.click();
    };
  }
  function showHelp() {
    const steps = [
      ['Bangun jalan', 'Pilih kategori Jalan & Zona, klik Jalan, lalu klik beberapa petak di peta. Semua bangunan butuh akses jalan.'],
      ['Cat zona', 'Cat Zona Perumahan di sisi jalan. Rumah akan tumbuh otomatis jika ada listrik, air, dan lapangan kerja.'],
      ['Pasok utilitas', 'Bangun Pembangkit Uap dan Menara Air. Tanpa listrik dan air, warga tidak akan pindah.'],
      ['Layani warga', 'Taman, sekolah, polisi, dan rumah sakit menaikkan kebahagiaan serta level bangunan.'],
      ['Capai 1.000 warga', 'Selesaikan misi, kelola pajak di menu Kebijakan, dan jadilah Kota Metropolitan!']
    ];
    openModal(`
      <button class="icon-btn ghost modal-x" aria-label="Tutup">${icon('close')}</button>
      <div class="modal-kicker">PANDUAN WALIKOTA</div>
      <h2>Cara Membangun Kota</h2>
      <p>Kamu memulai dari hamparan sepi. Tidak ada jawaban salah—hanya kota yang lebih hidup.</p>
      <div class="help-grid">
        ${steps.map((s, i) => `<div class="help-step"><div class="help-num">${i + 1}</div><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('')}
      </div>
      <div class="section-label" style="margin-top:4px">Kontrol</div>
      <div class="keys">
        <div class="key"><kbd>Klik</kbd> bangun / pilih</div>
        <div class="key"><kbd>Geser</kbd> menggeser peta</div>
        <div class="key"><kbd>Scroll</kbd> zoom</div>
        <div class="key"><kbd>Spasi</kbd> jeda</div>
        <div class="key"><kbd>Esc</kbd> batal</div>
        <div class="key"><kbd>B</kbd> bongkar</div>
        <div class="key"><kbd>1–5</kbd> kategori</div>
        <div class="key"><kbd>H</kbd> bantuan</div>
      </div>
      <div class="modal-actions"><button class="btn primary" id="helpOk">Siap, Walikota!</button></div>
    `);
    $('#helpOk')?.addEventListener('click', closeModal);
  }

  function showPolicies() {
    if (!state) return;
    const policyHtml = KK.POLICIES.map(p => `
      <div class="policy-item" data-pid="${p.id}">
        <div class="policy-info"><div class="policy-name">${p.name}</div><div class="policy-desc">${p.desc}</div></div>
        <div class="policy-cost">${money(p.cost)}/mg</div>
        <button class="switch ${state.policies[p.id] ? 'on' : ''}" aria-label="${p.name}"></button>
      </div>`).join('');
    openModal(`
      <button class="icon-btn ghost modal-x" aria-label="Tutup">${icon('close')}</button>
      <div class="modal-kicker">KEBIJAKAN & PAJAK</div>
      <h2>Atur Kota</h2>
      <p>Pajak tinggi menambah kas, tapi membuat warga gelisah. Kebijakan kota berjalan otomatis setiap minggu.</p>
      <div class="tax-box">
        <div class="row-between"><span>Pajak warga</span><strong id="taxVal">${state.taxRate}%</strong></div>
        <input type="range" id="taxRange" min="4" max="15" step="1" value="${state.taxRate}"/>
        <div class="tax-scale"><span>4% · rendah</span><span>10% · ideal</span><span>15% · tinggi</span></div>
        <div class="small" id="taxEffect" style="margin-top:7px;color:var(--ink-soft)"></div>
      </div>
      <div class="section-label">Program Kota</div>
      <div class="policy-list" style="margin-top:7px">${policyHtml}</div>
      <div class="modal-actions"><button class="btn primary" id="polOk">Selesai</button></div>
    `);
    const updateTax = () => {
      const v = Number($('#taxRange').value);
      state.taxRate = v;
      $('#taxVal').textContent = v + '%';
      $('#taxEffect').textContent = v <= 8 ? 'Warga senang, pendapatan sedikit lebih kecil.' : v <= 10 ? 'Keseimbangan ideal antara pendapatan dan kebahagiaan.' : v <= 12 ? 'Pendapatan naik, warga mulai gelisah.' : 'Kas cepat naik, tapi kebahagiaan turun drastis.';
      recalc(); updateHUD(true);
    };
    $('#taxRange').addEventListener('input', updateTax);
    updateTax();
    $$('.policy-item').forEach(item => {
      item.querySelector('.switch').addEventListener('click', () => {
        const p = KK.POLICIES.find(x => x.id === item.dataset.pid);
        state.policies[p.id] = !state.policies[p.id];
        item.querySelector('.switch').classList.toggle('on', state.policies[p.id]);
        recalc(); updateHUD(true);
        sfx.click();
      });
    });
    $('#polOk').addEventListener('click', () => { closeModal(); saveGame(true); });
  }

  function showRandomEvent() {
    if (!state || state.modalPause) return;
    const ev = KK.EVENTS[Math.floor(Math.random() * KK.EVENTS.length)];
    const choices = ev.choices.map((c, i) => {
      const can = !c.cost || state.money >= c.cost;
      return `<button class="choice-btn" data-choice="${i}" ${can ? '' : 'disabled'}>
        <b>${c.label}</b><span>${c.note}</span>${c.cost && !can ? '<span class="fx">Kas tidak cukup</span>' : ''}
      </button>`;
    }).join('');
    openModal(`
      <div class="modal-kicker">PERISTIWA KOTA</div>
      <h2>${ev.title}</h2>
      <div class="event-art">${icon(ev.icon)}</div>
      <p>${ev.text}</p>
      <div class="choice-list">${choices}</div>
      <div class="save-note">Pilih dengan bijak. Warga akan mengingatnya.</div>
    `, { pause: true });
    $$('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = ev.choices[Number(btn.dataset.choice)];
        if (c.cost && state.money < c.cost) return;
        if (c.cost) state.money -= c.cost;
        c.apply(state);
        state.moodBoost = clamp(state.moodBoost, -25, 25);
        recalc(); updateHUD(true); updateAll();
        closeModal();
        sfx.coin();
        toast(`${ev.title}: ${c.label}`, 'good', 'check');
        saveGame(true);
      });
    });
  }

  function showWin() {
    if (!state) return;
    if (state.modalPause) { setTimeout(showWin, 1600); return; }
    sfx.win();
    confetti();
    openModal(`
      <div class="win-card">
        <div class="win-trophy">${icon('trophy')}</div>
        <div class="modal-kicker">KOTA METROPOLITAN</div>
        <h2 style="font-size:30px">Selamat, Walikota!</h2>
        <p><b>${state.cityName}</b> resmi menjadi kota metropolitan dengan lebih dari 1.000 warga. Kerja kerasmu terbayar.</p>
        <div class="stat-grid">
          <div class="stat-box"><b>${fmt(state.population)}</b><span>Penduduk</span></div>
          <div class="stat-box"><b>${fmt(state.jobs)}</b><span>Lapangan kerja</span></div>
          <div class="stat-box"><b>${state.happiness}%</b><span>Kebahagiaan</span></div>
          <div class="stat-box"><b>${PERIOD_LABELS[state.period]} ${periodNumber()}</b><span>Waktu membangun</span></div>
        </div>
        <div class="modal-actions" style="justify-content:center"><button class="btn sun" id="winContinue">Terus Membangun</button></div>
        <div class="save-note">Tidak ada batas akhir. Teruskan hingga seluruh peta penuh.</div>
      </div>
    `, { pause: true });
    $('#winContinue').addEventListener('click', closeModal);
  }
  function confetti() {
    const cols = ['#ffc64a', '#ff7a59', '#2ec27e', '#3b8fd4', '#e6738f', '#f7f4ec'];
    for (let i = 0; i < 50; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = cols[i % cols.length];
      el.style.animationDuration = (2.4 + Math.random() * 2) + 's';
      el.style.animationDelay = (Math.random() * .8) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    }
  }

  // ---------- save / load ----------
  function serialize() {
    const size = state.gridSize;
    const roads = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (state.grid[idx(x, y)].road) roads.push(y * size + x);
    return {
      v: 2, gridSize: size, cityName: state.cityName, money: state.money, tick: state.tick, hour: state.hour,
      period: state.period, elapsedDays: state.elapsedDays, speed: state.speed,
      taxRate: state.taxRate, policies: state.policies, uid: state.uid,
      missionsDone: state.missionsDone, won: state.won, maxPop: state.maxPop,
      unlocked: state.unlocked, moodBoost: state.moodBoost, eventTimer: state.eventTimer,
      terrain: state.grid.map(t => t.terrain[0]).join(''),
      roads,
      buildings: state.buildings.map(b => ({ d: b.defId, x: b.x, y: b.y, l: b.level, e: b.evo, v: b.variant })),
      cam: { x: cam.x, y: cam.y, zoom: cam.zoom }
    };
  }
  function saveGame(silent) {
    if (!state || !state.started) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
      if (!silent) { toast('Kota tersimpan.', 'good', 'save'); sfx.click(); }
    } catch (e) { if (!silent) toast('Gagal menyimpan kota.', 'bad', 'info'); }
  }
  function hasSave() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; const d = JSON.parse(raw); return d && d.v === 2; } catch (e) { return false; }
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || d.v !== 2) return false;
      state = blankState(d.cityName);
      const savedSize = Number(d.gridSize);
      state.gridSize = Number.isInteger(savedSize) && savedSize >= GRID && savedSize <= MAX_GRID_SIZE && (savedSize - GRID) % 8 === 0 ? savedSize : GRID;
      state.money = Number.isFinite(d.money) ? d.money : 6000;
      state.tick = Number.isFinite(d.tick) ? d.tick : 0;
      state.hour = Number.isFinite(d.hour) ? d.hour : 8.6;
      state.period = PERIOD_DAYS[d.period] ? d.period : 'week';
      state.elapsedDays = Number.isFinite(d.elapsedDays) && d.elapsedDays >= 0 ? d.elapsedDays : state.tick * 7;
      state.speed = [1, 2, 3].includes(Number(d.speed)) ? Number(d.speed) : 1;
      state.taxRate = d.taxRate || 9; state.policies = d.policies || {};
      state.uid = d.uid || 0; state.missionsDone = d.missionsDone || {};
      state.won = !!d.won; state.maxPop = d.maxPop || 0; state.unlocked = d.unlocked || {};
      state.moodBoost = d.moodBoost || 0; state.eventTimer = d.eventTimer || 50;
      const size = state.gridSize;
      state.grid = [];
      for (let i = 0; i < size * size; i++) {
        const ch = d.terrain?.[i] || 'g';
        state.grid.push({ terrain: ch === 'w' ? 'water' : ch === 's' ? 'sand' : 'grass', road: false, b: null });
      }
      for (const i of d.roads || []) if (Number.isInteger(i) && i >= 0 && i < state.grid.length) state.grid[i].road = true;
      state.buildings = [];
      for (const sb of d.buildings || []) {
        if (!DEFS[sb.d]) continue;
        const b = addBuilding(sb.d, sb.x, sb.y, sb.l || 0, { free: true, variant: sb.v });
        if (b) b.evo = sb.e || 0;
      }
      if (d.cam) { cam.x = d.cam.x; cam.y = d.cam.y; cam.zoom = d.cam.zoom || defaultZoom(); }
      recalc(); updateAll(); spawnCars(true);
      return true;
    } catch (e) { console.error(e); return false; }
  }

  // ---------- camera, input, loop ----------
  function screenToGrid(sx, sy) {
    const wx = cam.x + (sx - viewW / 2) / cam.zoom;
    const wy = cam.y + (sy - viewH / 2) / cam.zoom;
    return { fx: (wx / 32 + wy / 16) / 2, fy: (wy / 16 - wx / 32) / 2, x: 0, y: 0 };
  }
  function clampCam() {
    const size = state ? state.gridSize : GRID;
    cam.x = clamp(cam.x, -size * 32 - 160, size * 32 + 160);
    cam.y = clamp(cam.y, -160, size * 32 + 160);
    cam.zoom = clamp(cam.zoom, .42, 2.4);
  }
  function zoomAt(sx, sy, factor) {
    const wx = cam.x + (sx - viewW / 2) / cam.zoom;
    const wy = cam.y + (sy - viewH / 2) / cam.zoom;
    cam.zoom = clamp(cam.zoom * factor, .42, 2.4);
    cam.x = wx - (sx - viewW / 2) / cam.zoom;
    cam.y = wy - (sy - viewH / 2) / cam.zoom;
    clampCam();
  }
  function setTool(id) {
    if (!state) return;
    state.tool = state.tool === id ? null : id;
    if (state.tool && state.tool !== 'bulldoze' && DEFS[state.tool]) activeCategory = DEFS[state.tool].cat;
    renderRail(); renderCatalog();
    canvas.classList.toggle('building', !!state.tool);
    updateHUD(true);
    if (state.tool) sfx.click();
    if (state.tool && innerWidth < 720) {
      setTimeout(() => { if (state.tool) $('#catalog').classList.add('hidden'); }, 180);
    }
    if (!state.tool) hideCursorHint();
  }
  function hideCursorHint() { const h = $('#cursorHint'); if (h) h.classList.remove('show'); }
  function updateHover(clientX, clientY) {
    if (!state || !running || state.modalPause) { hoverTile = null; hideCursorHint(); return; }
    const g = screenToGrid(clientX, clientY);
    g.x = Math.floor(g.fx); g.y = Math.floor(g.fy);
    if (!inBounds(g.x, g.y)) { hoverTile = null; hideCursorHint(); return; }
    hoverTile = g;
    if (state.tool) {
      const hint = $('#cursorHint');
      let text = '', bad = false;
      if (state.tool === 'bulldoze') {
        const t = tileAt(g.x, g.y);
        if (t && (t.b || t.road)) text = t.b ? `Bongkar ${defOf(t.b).name}` : 'Bongkar jalan';
        else { text = 'Tidak ada yang bisa dibongkar'; bad = true; }
      } else {
        const d = DEFS[state.tool];
        const chk = canPlace(d, g.x, g.y);
        text = `${d.name} · ${money(d.cost)}`;
        if (!chk.ok) { text += ` — ${chk.msg}`; bad = true; }
      }
      hint.textContent = text;
      hint.style.left = clientX + 'px';
      hint.style.top = clientY + 'px';
      hint.classList.toggle('bad', bad);
      hint.classList.add('show');
    } else hideCursorHint();
  }
  function handleTap(clientX, clientY) {
    if (!state || !state.started) return;
    const g = screenToGrid(clientX, clientY);
    g.x = Math.floor(g.fx); g.y = Math.floor(g.fy);
    if (!inBounds(g.x, g.y)) return;
    if (state.tool === 'bulldoze') {
      const before = state.money;
      bulldozeAt(g.x, g.y);
      return;
    }
    if (state.tool) {
      const def = DEFS[state.tool];
      const ok = placeAt(state.tool, g.x, g.y);
      if (innerWidth < 720 && def.cost <= 20) {
        // keep building roads/zones continuously on mobile
      }
      return;
    }
    const t = tileAt(g.x, g.y);
    if (t && t.b) {
      state.selected = t.b;
      updateSelection();
      sfx.click();
    } else {
      hideSelection();
    }
  }

  let dragStart = null, pinchStart = null;
  const pointers = new Map();
  function onPointerDown(e) {
    if (!state || !state.started) return;
    if (e.button === 2) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragStart = { id: e.pointerId, x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, moved: false, time: performance.now() };
      canvas.classList.add('dragging');
    } else if (pointers.size === 2) {
      const ps = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
        cx: (ps[0].x + ps[1].x) / 2, cy: (ps[0].y + ps[1].y) / 2,
        camX: cam.x, camY: cam.y, zoom: cam.zoom
      };
      dragStart = null;
    }
  }
  function onPointerMove(e) {
    if (!state) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinchStart) {
      const ps = [...pointers.values()];
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
      const cx = (ps[0].x + ps[1].x) / 2, cy = (ps[0].y + ps[1].y) / 2;
      const z = clamp(pinchStart.zoom * (dist / pinchStart.dist), .42, 2.4);
      cam.zoom = z;
      cam.x = pinchStart.camX - (cx - pinchStart.cx) / z;
      cam.y = pinchStart.camY - (cy - pinchStart.cy) / z;
      clampCam();
      hideCursorHint();
      return;
    }
    if (dragStart && dragStart.id === e.pointerId && pointers.size === 1) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (!dragStart.moved && Math.hypot(dx, dy) > 6) dragStart.moved = true;
      if (dragStart.moved) {
        cam.x = dragStart.camX - dx / cam.zoom;
        cam.y = dragStart.camY - dy / cam.zoom;
        clampCam();
        hideCursorHint();
      }
    }
    if (e.pointerType === 'mouse' && pointers.size === 0) updateHover(e.clientX, e.clientY);
  }
  function onPointerUp(e) {
    if (!state) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (wasSingle && dragStart && dragStart.id === e.pointerId && !dragStart.moved && performance.now() - dragStart.time < 600) {
      handleTap(e.clientX, e.clientY);
    }
    if (pointers.size < 2) { pinchStart = null; }
    if (pointers.size === 1) {
      const ps = [...pointers.entries()];
      dragStart = { id: ps[0][0], x: ps[0][1].x, y: ps[0][1].y, camX: cam.x, camY: cam.y, moved: true, time: performance.now() };
    } else if (pointers.size === 0) dragStart = null;
    if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
  }
  function onPointerLeave() { if (!dragStart) hideCursorHint(); }

  function bindInput() {
    document.addEventListener('click', e => {
      const button = e.target.closest?.('button:not(:disabled)');
      if (!button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      button.classList.remove('button-feedback');
      void button.offsetWidth;
      button.classList.add('button-feedback');
    });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (state) { state.tool = null; renderRail(); renderCatalog(); updateHUD(true); hideCursorHint(); } });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? .9 : 1.1);
      if (state) updateHover(e.clientX, e.clientY);
    }, { passive: false });

    const rail = $('#rail');
    rail.addEventListener('click', e => {
      const catBtn = e.target.closest('[data-cat]');
      if (catBtn) {
        activeCategory = catBtn.dataset.cat;
        if (state) state.tool = null;
        canvas.classList.remove('building');
        renderRail(); renderCatalog();
        $('#catalog').classList.remove('hidden');
        if (state) updateHUD(true);
        sfx.click();
        return;
      }
      const toolBtn = e.target.closest('[data-tool]');
      if (toolBtn) { setTool(toolBtn.dataset.tool); return; }
      if (e.target.closest('#railPolicy')) showPolicies();
    });
    $('#catalogGrid').addEventListener('click', e => {
      const card = e.target.closest('.card'); if (!card || !state) return;
      const d = DEFS[card.dataset.id];
      if (!d) return;
      if (d.unlockPop > state.maxPop) { sfx.error(); toast(`Terbuka pada ${fmt(d.unlockPop)} penduduk. Kota terbesarmu: ${fmt(state.maxPop)}.`, 'bad', 'lock'); return; }
      if (state.money < d.cost) { sfx.error(); toast(`Kas tidak cukup. Butuh ${money(d.cost)}.`, 'bad', 'coin'); return; }
      setTool(d.id);
    });
    const notificationsPanel = $('#notificationsPanel');
    const notificationsBtn = $('#notificationsBtn');
    const closeNotifications = () => {
      notificationsPanel.hidden = true;
      notificationsBtn.setAttribute('aria-expanded', 'false');
    };
    notificationsBtn.onclick = () => {
      const opening = notificationsPanel.hidden;
      notificationsPanel.hidden = !opening;
      notificationsBtn.setAttribute('aria-expanded', String(opening));
      if (opening) {
        renderNotifications();
        sfx.click();
      }
    };
    $('#notificationsClose').onclick = closeNotifications;
    $('#clearNotificationsBtn').onclick = () => {
      notificationHistory.length = 0;
      renderNotifications();
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !notificationsPanel.hidden) closeNotifications();
    });
    $('#catalogClose').onclick = () => $('#catalog').classList.add('hidden');
    $('#sideBtn').onclick = toggleSide;
    $('#sideClose').onclick = closeSide;
    $('#policyBtn').onclick = showPolicies;
    $('#helpBtn').onclick = showHelp;
    $('#saveBtn').onclick = () => saveGame(false);
    $('#settingsBtn').onclick = showSettings;
    $('#pauseBtn').onclick = () => { if (!state) return; state.paused = !state.paused; updateHUD(true); };
    $('#expandBtn')?.addEventListener('click', expandCity);
    $('#minimap').addEventListener('click', e => {
      if (!state) return;
      const cv = e.currentTarget;
      const r = cv.getBoundingClientRect();
      const px = (e.clientX - r.left) * cv.width / r.width;
      const py = (e.clientY - r.top) * cv.height / r.height;
      const side = Math.min(cv.width, cv.height) - 16;
      const padX = (cv.width - side) / 2 + 8;
      const padY = (cv.height - side) / 2 + 8;
      const cell = side / state.gridSize;
      const gx = clamp(Math.floor((px - padX) / cell), 0, state.gridSize - 1);
      const gy = clamp(Math.floor((py - padY) / cell), 0, state.gridSize - 1);
      cam.x = (gx - gy) * 32; cam.y = (gx + gy) * 16;
      clampCam(); sfx.click();
    });

    window.addEventListener('keydown', e => {
      const summaryPanel = $('#sidePanel');
      if (!summaryPanel.classList.contains('hidden')) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeSide(); return; }
        if (e.key === 'Tab') {
          const focusable = [...summaryPanel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length);
          if (!focusable.length) { e.preventDefault(); summaryPanel.focus(); return; }
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && (document.activeElement === first || !summaryPanel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || !summaryPanel.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
          return;
        }
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if ($('#modalRoot').classList.contains('open')) { closeModal(); return; }
        if (!state) return;
        if (state.tool) { setTool(null); return; }
        hideSelection(); hideCursorHint(); return;
      }
      if (!state || !running) return;
      if (e.code === 'Space') { e.preventDefault(); state.paused = !state.paused; updateHUD(true); return; }
      if (e.key === 'b' || e.key === 'B') { setTool('bulldoze'); return; }
      if (e.key === 'h' || e.key === 'H') { showHelp(); return; }
      if (e.key === 'p' || e.key === 'P') { showPolicies(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveGame(false); return; }
      if (e.key === '+' || e.key === '=') { zoomAt(viewW / 2, viewH / 2, 1.16); return; }
      if (e.key === '-' || e.key === '_') { zoomAt(viewW / 2, viewH / 2, .86); return; }
      if (/^[1-5]$/.test(e.key)) {
        const cat = KK.CATS[Number(e.key) - 1]; if (!cat) return;
        activeCategory = cat.id; state.tool = null;
        renderRail(); renderCatalog(); $('#catalog').classList.remove('hidden'); updateHUD(true);
      }
      const pan = 36 / cam.zoom;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { cam.x -= pan; clampCam(); }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { cam.x += pan; clampCam(); }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { cam.y -= pan; clampCam(); }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { cam.y += pan; clampCam(); }
    });
    window.addEventListener('beforeunload', () => { if (state && state.started) saveGame(true); });
    document.addEventListener('visibilitychange', () => { last = performance.now(); });
    window.addEventListener('resize', resize);
  }
  function toggleSide() {
    const panel = $('#sidePanel');
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
      $('#summaryBackdrop').classList.add('is-open');
      $('#summaryBackdrop').setAttribute('aria-hidden', 'false');
      $('#sideBtn').setAttribute('aria-expanded', 'true');
      $('#sideClose').focus();
    } else closeSide();
    sfx.click();
  }
  function closeSide() {
    const panel = $('#sidePanel');
    if (panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    $('#summaryBackdrop').classList.remove('is-open');
    $('#summaryBackdrop').setAttribute('aria-hidden', 'true');
    $('#sideBtn').setAttribute('aria-expanded', 'false');
    $('#sideBtn').focus();
  }

  // ---------- render loop ----------
  function nightFactor(h) {
    let night = 0, dusk = 0;
    if (h >= 17.5 && h < 20.5) {
      night = (h - 17.5) / 3 * .38;
      dusk = clamp(1 - Math.abs(h - 18.8) / 2.2, 0, 1);
    } else if (h >= 20.5 || h < 5.5) night = .38;
    else if (h >= 5.5 && h < 7.5) {
      night = .38 * (1 - (h - 5.5) / 2);
      dusk = clamp((h - 5.5) / 2 * .65, 0, .65);
    }
    return { night, dusk };
  }
  function buildGhost() {
    if (!state || !state.tool || !hoverTile || state.modalPause) return null;
    if (state.tool === 'bulldoze') return null;
    const d = DEFS[state.tool]; if (!d) return null;
    const chk = canPlace(d, hoverTile.x, hoverTile.y);
    return { def: d, x: hoverTile.x, y: hoverTile.y, valid: chk.ok };
  }
  let uiAcc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(.08, (now - last) / 1000); last = now;
    if (!running || !state || !state.started) return;
    const active = !state.paused && !state.modalPause;
    if (active) {
      updateCars(dt * state.speed);
      simAcc += dt * state.speed;
      let steps = 0;
      const interval = tickInterval();
      while (simAcc >= interval && steps < 5) { simAcc -= interval; simulateTick(); steps++; }
    }
    const nf = nightFactor(state.hour);
    KK.render.drawWorld(ctx, state, cam, viewW, viewH, cam.zoom, now / 1000, {
      dpr, night: nf.night, dusk: nf.dusk, ghost: buildGhost(), selected: state.selected
    });
    if (now - uiAcc > 700) { uiAcc = now; updateHUD(); updateMinimap(); }
  }

  // ---------- hero scene ----------
  function buildHeroWorld() {
    const size = 18;
    const grid = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) grid.push({ terrain: 'grass', road: false, b: null });
    const w = { gridSize: size, grid, buildings: [], cars: [] };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 2.2, (y - 15.2) * 1.1);
      if (d < 2.1) grid[y * size + x].terrain = 'water';
      else if (d < 2.7) grid[y * size + x].terrain = 'sand';
    }
    const road = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) grid[y * size + x].road = true; };
    for (let x = 2; x <= 16; x++) road(x, 8);
    for (let x = 4; x <= 16; x++) road(x, 12);
    for (let y = 2; y <= 16; y++) road(9, y);
    for (let y = 8; y <= 15; y++) road(14, y);
    const put = (id, x, y, lv) => {
      const d = DEFS[id]; if (!d) return;
      w.buildings.push({ uid: w.buildings.length + 1, defId: id, x, y, w: d.w, h: d.h, level: lv || 1, variant: Math.floor(Math.random() * 6) });
    };
    put('park', 2, 3); put('power_plant', 15, 2); put('ferris', 10, 2);
    put('house', 3, 5, 2); put('house', 4, 5, 1); put('house', 5, 5, 2); put('house', 6, 5, 3); put('house', 7, 5, 1);
    put('house', 3, 6, 1); put('house', 4, 6, 2); put('house', 6, 6, 1); put('house', 7, 6, 2);
    put('shop', 11, 5, 2); put('shop', 12, 6, 2); put('shop', 13, 5, 1); put('shop', 13, 6, 2);
    put('school', 15, 8); put('water_tower', 1, 9); put('police', 5, 9); put('fire', 7, 9);
    put('small_park', 10, 9); put('shop', 10, 10, 2); put('shop', 11, 10, 1); put('shop', 12, 10, 2);
    put('hospital', 3, 9); put('house', 3, 10, 2); put('house', 5, 10, 1); put('house', 6, 10, 2); put('house', 7, 10, 1);
    put('plaza', 10, 13); put('fountain', 13, 13); put('monument', 13, 14);
    put('shop', 15, 13, 3); put('house', 1, 6, 1);
    const trees = [[1, 1, 1], [4, 1, 1], [7, 1, 2], [8, 2, 1], [16, 6, 2], [16, 12, 1], [1, 12, 2], [5, 16, 1], [8, 15, 2], [13, 16, 1], [16, 16, 2], [11, 7, 0], [2, 7, 0], [6, 3, 0], [12, 4, 1]];
    for (const [x, y, v] of trees) {
      if (x < size && y < size && !grid[y * size + x].road) w.buildings.push({ uid: w.buildings.length + 1, defId: 'tree', x, y, w: 1, h: 1, level: 1, variant: v });
    }
    const roads = [];
    for (let i = 0; i < grid.length; i++) if (grid[i].road) roads.push({ x: i % size, y: Math.floor(i / size) });
    for (let i = 0; i < 11 && roads.length; i++) {
      const r = roads[(i * 7) % roads.length];
      const choices = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: r.x + dx, y: r.y + dy, dx, dy }))
        .filter(c => c.x >= 0 && c.y >= 0 && c.x < size && c.y < size && grid[c.y * size + c.x].road);
      if (!choices.length) continue;
      const nextTile = choices[i % choices.length];
      const type = ['car', 'motorcycle', 'bus', 'truck'][i % 4];
      const t = Math.random();
      const car = {
        x: lerp(r.x + .5, nextTile.x + .5, t), y: lerp(r.y + .5, nextTile.y + .5, t),
        fromX: r.x + .5, fromY: r.y + .5, toX: nextTile.x + .5, toY: nextTile.y + .5, t,
        speed: (.3 + Math.random() * .35) * (type === 'bus' || type === 'truck' ? .78 : type === 'motorcycle' ? 1.12 : 1),
        type, color: type === 'bus' ? '#e5b83f' : type === 'truck' ? '#4d9b78' : CAR_COLORS[i % CAR_COLORS.length],
        dir: nextTile.dx > 0 ? 'x' : nextTile.dx < 0 ? '-x' : nextTile.dy > 0 ? 'y' : '-y', alive: true
      };
      if (!w.cars.some(other => carsOverlap(car, other))) w.cars.push(car);
    }
    return w;
  }
  function updateHeroCars(dt) {
    if (!heroWorld) return;
    const isRoad = (x, y) => heroWorld.grid[y * heroWorld.gridSize + x].road;
    for (const c of heroWorld.cars) {
      const next = nextCarState(c, dt, heroWorld.gridSize, isRoad);
      if (heroWorld.cars.some(other => other !== c && carsOverlap(next, other))) continue;
      Object.assign(c, next);
    }
    heroWorld.cars = heroWorld.cars.filter(c => c.alive);
  }
  function layoutHero() {
    const hw = heroCanvas.clientWidth || innerWidth, hh = heroCanvas.clientHeight || innerHeight;
    const mobile = innerWidth < 720;
    heroCam.zoom = mobile ? .69 : clamp(Math.min(hw / 1250, hh / 850) * 1.1, .78, 1.22);
    heroCam.x = mobile ? -30 : -150;
    heroCam.y = mobile ? 278 : 268;
  }
  function resizeHero() {
    const hw = heroCanvas.clientWidth || innerWidth, hh = heroCanvas.clientHeight || innerHeight;
    const hd = Math.min(2, devicePixelRatio || 1);
    heroCanvas.width = Math.round(hw * hd); heroCanvas.height = Math.round(hh * hd);
    layoutHero();
    return { hw, hh, hd };
  }
  function heroFrame(now) {
    heroRaf = requestAnimationFrame(heroFrame);
    if (!heroWorld) return;
    const dt = Math.min(.06, (now - heroLast) / 1000 || 0); heroLast = now;
    heroTime += dt;
    updateHeroCars(dt);
    const hw = heroCanvas.clientWidth || innerWidth, hh = heroCanvas.clientHeight || innerHeight;
    const hd = Math.min(2, devicePixelRatio || 1);
    if (heroCanvas.width !== Math.round(hw * hd) || heroCanvas.height !== Math.round(hh * hd)) resizeHero();
    const drift = Math.sin(heroTime * .09) * 14;
    const hc = { x: heroCam.x + drift, y: heroCam.y + Math.cos(heroTime * .07) * 6, zoom: heroCam.zoom };
    KK.render.drawWorld(heroCtx, heroWorld, hc, hw, hh, heroCam.zoom, heroTime, { dpr: hd, night: 0, dusk: 0 });
  }
  function startHero() {
    if (!heroRaf) { heroLast = performance.now(); heroRaf = requestAnimationFrame(heroFrame); }
  }
  function stopHero() { if (heroRaf) cancelAnimationFrame(heroRaf); heroRaf = 0; }

  // ---------- boot & start ----------
  function resize() {
    viewW = innerWidth; viewH = innerHeight;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px'; canvas.style.height = viewH + 'px';
    if (state) clampCam();
    const heroVisible = !$('#startScreen').classList.contains('gone');
    if (heroVisible) resizeHero();
  }
  function hideStart() {
    const el = $('#startScreen');
    el.classList.add('gone');
    stopHero();
    setTimeout(() => { el.style.display = 'none'; }, 520);
    running = true;
    last = performance.now(); simAcc = 0;
  }
  function beginNew(name) {
    newGame(name);
    state.started = true;
    hideStart();
    setTimeout(() => toast(`Selamat datang di ${state.cityName}, Walikota!`, 'good', 'trophy'), 700);
    setTimeout(() => toast('Bangun jalan, lalu cat zona perumahan di sisinya.', 'info', 'road'), 2100);
    setTimeout(() => { if (innerWidth < 720) $('#catalog').classList.add('hidden'); }, 100);
    renderRail(); renderCatalog(); updateAll();
    sfx.chime();
  }
  function continueGame() {
    if (!loadGame()) { toast('Simpanan tidak ditemukan atau rusak.', 'bad', 'info'); return; }
    state.started = true;
    hideStart();
    toast(`Kota ${state.cityName} dimuat. Selamat datang kembali!`, 'good', 'trophy');
    renderRail(); renderCatalog(); updateAll();
  }
  function askNewGame() {
    const input = $('#cityNameInput');
    const name = (input.value || '').trim().slice(0, 22) || 'Kota Kita';
    if (hasSave()) {
      openModal(`
        <button class="icon-btn ghost modal-x" aria-label="Tutup">${icon('close')}</button>
        <div class="modal-kicker">MULAI KOTA BARU</div>
        <h2>Timpa kota tersimpan?</h2>
        <p>Kota tersimpan akan diganti dengan <b>${name}</b>. Tindakan ini tidak bisa dibatalkan.</p>
        <div class="modal-actions">
          <button class="btn" id="cancelNew">Batal</button>
          <button class="btn danger" id="confirmNew">Ya, mulai baru</button>
        </div>`);
      $('#cancelNew').onclick = closeModal;
      $('#confirmNew').onclick = () => { closeModal(); beginNew(name); };
    } else beginNew(name);
  }
  function boot() {
    resize();
    renderRail();
    bindInput();
    try {
      const savedTheme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
      setTheme(savedTheme, false);
    } catch (e) {
      setTheme('light', false);
    }
    if (hasSave()) { $('#continueBtn').hidden = false; }
    const startInput = $('#cityNameInput');
    $('#newGameBtn').addEventListener('click', askNewGame);
    $('#continueBtn').addEventListener('click', continueGame);
    $('#howBtn').addEventListener('click', showHelp);
    startInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); askNewGame(); } });
    startInput.addEventListener('focus', () => startInput.select());
    heroWorld = buildHeroWorld();
    layoutHero();
    startHero();
    requestAnimationFrame(loop);
    window.addEventListener('load', () => { resize(); });
  }

  // ---------- showcase (also used by automated visual checks) ----------
  function showcase() {
    beginNew('Kota Nusantara');
    state.money = 320000; state.maxPop = 1400;
    state.won = true; state.missionsDone.metro = true;
    const road = (x, y) => forcePlace('road', x, y);
    for (let y = 3; y <= 20; y++) road(11, y);
    for (let x = 2; x <= 21; x++) { road(x, 8); road(x, 14); }
    for (let x = 2; x <= 14; x++) road(x, 18);
    for (let y = 8; y <= 18; y++) { road(17, y); }
    for (let y = 8; y <= 14; y++) { road(6, y); }
    for (let y = 14; y <= 18; y++) { road(20, y); }
    // houses
    const houses = [[2, 9], [3, 9], [4, 9], [5, 9], [2, 10], [3, 10], [4, 10], [5, 10], [2, 11], [3, 11], [4, 11], [5, 11],
      [7, 9], [8, 9], [9, 9], [10, 9], [7, 10], [8, 10], [9, 10], [10, 10], [7, 11], [8, 11], [9, 11], [10, 11],
      [12, 9], [13, 9], [15, 9], [16, 9], [12, 10], [13, 10], [15, 10], [16, 10], [12, 11], [13, 11], [15, 11], [16, 11],
      [3, 5], [4, 5], [5, 5], [7, 5], [8, 5], [9, 5], [3, 6], [4, 6], [5, 6], [7, 6], [8, 6], [9, 6],
      [12, 5], [13, 5], [15, 5], [16, 5], [12, 6], [13, 6], [15, 6], [16, 6]];
    for (const [x, y] of houses) forcePlace('zone_r', x, y, 2 + Math.floor(Math.random() * 3));
    // commercial
    for (let y = 9; y <= 12; y++) for (const x of [18, 19, 21]) forcePlace('zone_c', x, y, 1 + Math.floor(Math.random() * 3));
    for (let x = 12; x <= 16; x++) forcePlace('zone_c', x, 16, 2);
    for (let x = 2; x <= 5; x++) forcePlace('zone_i', x, 16, 2);
    forcePlace('zone_i', 2, 17, 3); forcePlace('zone_i', 4, 17, 2);
    // landmarks and services
    forcePlace('park', 7, 12, 1);
    forcePlace('plaza', 14, 12, 1);
    forcePlace('school', 9, 15, 1);
    forcePlace('hospital', 14, 15, 1);
    forcePlace('ferris', 18, 3, 1);
    forcePlace('stadium', 12, 2, 1);
    forcePlace('power_plant', 21, 15, 1);
    forcePlace('solar', 20, 20, 1);
    forcePlace('water_tower', 16, 17, 1);
    forcePlace('water_tower', 2, 7, 1);
    forcePlace('police', 10, 16, 1);
    forcePlace('fire', 8, 16, 1);
    forcePlace('monument', 6, 16, 1);
    forcePlace('small_park', 16, 16, 1);
    forcePlace('lamp', 19, 8, 1);
    state.money = 84200;
    state.tick = 86; state.elapsedDays = 86 * 7; state.hour = 15.2;
    cam.x = -20; cam.y = 370; cam.zoom = innerWidth < 720 ? .72 : .92;
    recalc(); checkUnlocks(true);
    state.maxPop = 1200;
    state.missionsDone = { roads: true, homes: true, utilities: true, pop25: true, park: true, pop100: true, school: true, pop300: true, stadium: true, metro: true };
    state.won = true;
    updateAll(); renderRail(); renderCatalog();
    setTimeout(() => toast('Kota contoh siap. Selamat menikmati!', 'good', 'trophy'), 800);
  }

  // export early pieces for later sections
  KK._g = {
    get state() { return state; }, set state(v) { state = v; }, cam, canvas, ctx,
    addBuilding, removeBuilding, canPlace, placeAt, forcePlace, bulldozeAt, recalc: () => recalc(),
    updateHUD: (f) => updateHUD(f), renderCatalog: () => renderCatalog(), saveGame,
    toast, money, fmt, dateText, defOf, sfx, allRoads, spawnCars, newCar, rng,
    generateMap, blankState, nearestUnlock, mayorTitle
  };
  KK.game = {
    get state() { return state; }, cam, canvas,
    placeAt, forcePlace, bulldozeAt, simulateTick, recalc: () => recalc(),
    tick(n) { for (let i = 0; i < (n || 1); i++) simulateTick(); },
    startNew(name) { beginNew(name || 'Kota Kita'); },
    continueGame, loadGame, saveGame, showPolicies, showHelp, showWin, showRandomEvent,
    setTool, updateAll, showcase, newGame, checkUnlocks, renderCatalog,
    get running() { return running; }
  };
  boot();
})(window.KK);
