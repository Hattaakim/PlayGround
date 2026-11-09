window.KK = window.KK || {};
(function (KK) {
  const GRID = KK.GRID, DEFS = KK.DEFS;
  const IX = 32, IY = 16;
  let NIGHT = 0;
  let TIME = 0;
  let HOUR = 12;
  let SUN_ELEVATION = 1;

  function iso(gx, gy) { return { x: (gx - gy) * IX, y: (gx + gy) * IY }; }
  function isoPts(points) { return points.map(p => iso(p[0], p[1])); }
  function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7 + 19.19) * 43758.5453;
    return n - Math.floor(n);
  }
  function hash3(x, y, z) {
    const n = Math.sin(x * 93.1 + y * 47.7 + z * 211.3) * 24634.6345;
    return n - Math.floor(n);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mixColor(hex, target, t) {
    const a = parseColor(hex), b = parseColor(target);
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }
  function parseColor(hex) {
    if (hex[0] !== '#') return [200, 200, 200];
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function shade(hex, f) {
    const c = parseColor(hex);
    return `rgb(${clamp(Math.round(c[0] * f), 0, 255)},${clamp(Math.round(c[1] * f), 0, 255)},${clamp(Math.round(c[2] * f), 0, 255)})`;
  }
  function light(hex, t) { return mixColor(hex, '#ffffff', t); }
  function poly(ctx, pts, fill, stroke, lw) {
    if (!pts || !pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function line(ctx, a, b, color, w, dash) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }
  function ellipse(ctx, cx, cy, rx, ry, fill, stroke, lw) {
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, .1), Math.max(ry, .1), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function diamondPoints(x, y, w, h, inset) {
    const i = inset || 0;
    return [iso(x + i, y + i), iso(x + w - i, y + i), iso(x + w - i, y + h - i), iso(x + i, y + h - i)];
  }
  function tileQuad(cx, cy, w, h) {
    // axis-aligned-ish iso quad centered on screen point
    return [
      { x: cx, y: cy - h / 2 }, { x: cx + w / 2, y: cy },
      { x: cx, y: cy + h / 2 }, { x: cx - w / 2, y: cy }
    ];
  }

  // ---------- background ----------
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    clouds.push({
      x: hash3(i, 2, 3), y: 0.08 + hash3(i, 5, 1) * .42,
      s: .55 + hash3(i, 7, 9) * 1.1, a: .18 + hash3(i, 1, 4) * .25,
      sp: .0005 + hash3(i, 8, 2) * .0012
    });
  }
  function skyColors(hour) {
    const stops = [
      [0, '#081a38', '#132c50', '#273956'], [4.8, '#10254a', '#354c70', '#526278'],
      [6.2, '#f08c69', '#f7bd83', '#f5d6a0'], [8, '#73c2e2', '#b9e8ed', '#a8d7ce'],
      [16, '#55a9d2', '#a9dce6', '#7ec3c7'], [18.2, '#ee8065', '#f4b77c', '#d69d85'],
      [20, '#283d68', '#475779', '#5a6174'], [24, '#081a38', '#132c50', '#273956']
    ];
    let i = 0;
    while (i < stops.length - 2 && hour > stops[i + 1][0]) i++;
    const a = stops[i], b = stops[i + 1], t = clamp((hour - a[0]) / (b[0] - a[0]), 0, 1);
    return [1, 2, 3].map(n => mixColor(a[n], b[n], t));
  }
  function drawBackground(ctx, w, h, time) {
    const colors = skyColors(HOUR);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, colors[0]);
    g.addColorStop(.48, colors[1]);
    g.addColorStop(1, colors[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const daylight = clamp(SUN_ELEVATION, 0, 1);
    const sunriseGlow = clamp(1 - Math.abs(HOUR - 6.5) / 2.2, 0, 1);
    const sunsetGlow = clamp(1 - Math.abs(HOUR - 18.5) / 2.5, 0, 1);
    const glow = Math.max(daylight * .45, sunriseGlow, sunsetGlow);
    const sunX = w * (.5 + .43 * Math.cos((HOUR - 12) * Math.PI / 12));
    const sunY = h * (.43 - .34 * Math.max(0, Math.sin((HOUR - 6) * Math.PI / 12)));
    if (daylight > .04) {
      const halo = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, Math.max(w, h) * .48);
      halo.addColorStop(0, `rgba(255,239,177,${.42 * glow})`);
      halo.addColorStop(.32, `rgba(255,202,134,${.14 * glow})`);
      halo.addColorStop(1, 'rgba(255,202,134,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      const disc = ctx.createRadialGradient(sunX, sunY, 1, sunX, sunY, Math.max(9, w * .014));
      disc.addColorStop(0, 'rgba(255,255,225,.98)');
      disc.addColorStop(.42, `rgba(255,239,187,${.9 * daylight})`);
      disc.addColorStop(1, 'rgba(255,239,187,0)');
      ctx.fillStyle = disc; ctx.fillRect(sunX - w * .025, sunY - w * .025, w * .05, w * .05);
    }
    const stars = clamp(NIGHT / .38, 0, 1);
    if (stars > .02) {
      for (let i = 0; i < 72; i++) {
        const x = hash3(i, 17, 3) * w, y = hash3(i, 29, 8) * h * .58;
        const twinkle = .55 + .45 * Math.sin(time * 1.7 + i * 4.1);
        ctx.globalAlpha = stars * twinkle * (.28 + hash3(i, 2, 7) * .55);
        ctx.fillStyle = '#e9f4ff';
        ctx.beginPath(); ctx.arc(x, y, .5 + hash3(i, 5, 4) * 1.1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (NIGHT > .12) {
      const mx = w * (.5 - .43 * Math.cos((HOUR - 12) * Math.PI / 12));
      const my = h * (.43 - .30 * Math.max(0, Math.sin((HOUR - 6) * Math.PI / 12)));
      ctx.save();
      ctx.shadowColor = 'rgba(206,229,255,.55)'; ctx.shadowBlur = 22;
      ctx.fillStyle = `rgba(238,242,219,${clamp(NIGHT * 1.9, 0, .9)})`;
      ctx.beginPath(); ctx.arc(mx, my, Math.max(6, w * .009), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (const c of clouds) {
      const cx = ((c.x + time * c.sp) % 1.25 - .12) * w;
      const cy = c.y * h;
      const rw = 150 * c.s * (w / 1400), rh = 44 * c.s * (w / 1400);
      if (cy > h * .78) continue;
      drawCloud(ctx, cx, cy, rw, rh, c.a * (1 - NIGHT * .55));
    }
  }
  function drawCloud(ctx, x, y, rw, rh, a) {
    const parts = [[0, 0, 1], [-.45, .1, .7], [.4, .12, .66], [-.15, -.22, .62], [.2, -.25, .5]];
    const g = ctx.createRadialGradient(x, y, 0, x, y, rw * 1.2);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(.55, `rgba(255,255,255,${a * .7})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rw * 1.1, rh * 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const p of parts) {
      if (p[0] === 0 && p[1] === 0) continue;
      ctx.beginPath();
      ctx.ellipse(x + p[0] * rw, y + p[1] * rh, rw * .45 * p[2], rh * .8 * p[2], 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- map plate ----------
  function drawPlate(ctx, grid) {
    const p = isoPts([[0, 0], [grid, 0], [grid, grid], [0, grid]]);
    const cx = 0, cy = grid * IY;
    const shadow = ctx.createRadialGradient(cx, cy + 40, 40, cx, cy + 40, grid * 42);
    shadow.addColorStop(0, 'rgba(3,35,42,.30)');
    shadow.addColorStop(.7, 'rgba(3,35,42,.10)');
    shadow.addColorStop(1, 'rgba(3,35,42,0)');
    ctx.save();
    ctx.translate(0, 34);
    ctx.scale(1.02, .88);
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.ellipse(cx, cy, grid * 34, grid * 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const depth = 20;
    // visible cliff sides
    poly(ctx, [p[3], p[2], { x: p[2].x, y: p[2].y + depth }, { x: p[3].x, y: p[3].y + depth }], '#4e4032');
    poly(ctx, [p[2], p[1], { x: p[1].x, y: p[1].y + depth }, { x: p[2].x, y: p[2].y + depth }], '#64513e');
    poly(ctx, [p[3], p[0], { x: p[0].x, y: p[0].y + depth }, { x: p[3].x, y: p[3].y + depth }], '#3f3529');
    poly(ctx, [p[0], p[1], { x: p[1].x, y: p[1].y + depth }, { x: p[0].x, y: p[0].y + depth }], '#574636');
    poly(ctx, p, '#6ea758');
    // outer grass rim
    const rim = diamondPoints(0, 0, grid, grid, .1);
    poly(ctx, rim, '#78b45e');
  }

  // ---------- terrain ----------
  const GRASS = ['#8bcb67', '#85c562', '#91d06d', '#7fbe5d', '#96d371'];
  const SAND = ['#e7d19a', '#e3ca8e', '#edd8a6'];
  function drawTerrain(ctx, world, x, y, tile, time) {
    const T = iso(x, y), R = iso(x + 1, y), B = iso(x + 1, y + 1), L = iso(x, y + 1);
    const h = hash(x, y);
    if (tile.terrain === 'water') {
      const base = h > .5 ? '#3d9fc0' : '#429fbe';
      poly(ctx, [T, R, B, L], base);
      const shimmer = (Math.sin(time * 1.1 + x * 1.7 + y * 2.3) + 1) / 2;
      ctx.globalAlpha = .18 + shimmer * .18;
      line(ctx, { x: T.x + 16, y: T.y + 10 }, { x: T.x + 25, y: T.y + 14.5 }, '#e9ffff', 1.4);
      line(ctx, { x: T.x + 9, y: T.y + 20 }, { x: T.x + 17, y: T.y + 24 }, '#d8fbff', 1.2);
      line(ctx, { x: T.x + 27, y: T.y + 21 }, { x: T.x + 35, y: T.y + 25 }, '#d8fbff', 1.1);
      ctx.globalAlpha = 1;
      // shoreline foam
      const foam = (dir) => {
        const n = neighbor(world, x, y, dir);
        if (!n || n.terrain === 'water') return;
        if (dir === 'n') line(ctx, T, R, 'rgba(240,255,255,.6)', 2.2);
        if (dir === 'e') line(ctx, R, B, 'rgba(240,255,255,.55)', 2);
        if (dir === 's') line(ctx, B, L, 'rgba(240,255,255,.55)', 1.8);
        if (dir === 'w') line(ctx, L, T, 'rgba(240,255,255,.6)', 2);
      };
      foam('n'); foam('e'); foam('s'); foam('w');
      return;
    }
    let base;
    if (tile.terrain === 'sand') base = SAND[Math.floor(h * SAND.length)];
    else base = GRASS[Math.floor(h * GRASS.length)];
    poly(ctx, [T, R, B, L], base);
    if (tile.terrain === 'grass') {
      ctx.strokeStyle = 'rgba(45,100,40,.055)'; ctx.lineWidth = .8;
      ctx.stroke();
      if (h > .32) {
        const gx = T.x + 10 + hash(x + 3, y) * 30;
        const gy = T.y + 9 + hash(x, y + 5) * 12;
        ctx.globalAlpha = .35;
        line(ctx, { x: gx, y: gy }, { x: gx + 1.5, y: gy - 3.4 }, '#4d8a3e', 1);
        line(ctx, { x: gx + 1, y: gy }, { x: gx + 4, y: gy - 2.8 }, '#4d8a3e', .9);
        line(ctx, { x: gx + 1, y: gy }, { x: gx - 1.7, y: gy - 2.6 }, '#5a9648', .9);
        if (h > .75) {
          ctx.fillStyle = h > .9 ? '#f7d85e' : '#f2fdf8';
          ctx.beginPath(); ctx.arc(gx + 6, gy - 3, 1.15, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    } else if (tile.terrain === 'sand') {
      ctx.globalAlpha = .28;
      ctx.fillStyle = '#b99f66';
      for (let i = 0; i < 2; i++) {
        const sx = T.x + 12 + hash(x + i, y + 1) * 30;
        const sy = T.y + 8 + hash(x + 2, y + i) * 12;
        ctx.beginPath(); ctx.arc(sx, sy, .9, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  // Directions match the four visible diamond edges: n=T-R (+x), e=R-B (+y),
  // s=B-L (-x), and w=L-T (-y).
  function neighbor(world, x, y, dir) {
    const dx = dir === 'n' ? 1 : dir === 's' ? -1 : 0;
    const dy = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.gridSize || ny >= world.gridSize) return null;
    return world.grid[ny * world.gridSize + nx];
  }
  function isRoad(world, x, y) {
    if (x < 0 || y < 0 || x >= world.gridSize || y >= world.gridSize) return false;
    return world.grid[y * world.gridSize + x].road;
  }
  function drawRoad(ctx, world, x, y, tile) {
    const T = iso(x, y), R = iso(x + 1, y), B = iso(x + 1, y + 1), L = iso(x, y + 1);
    const col = '#505a62';
    // Keep the road surface clean; vehicles define the lanes as they pass.
    poly(ctx, [T, R, B, L], col);
  }

  // ---------- building primitives ----------
  function boxGeo(x, y, w, h, inset) {
    const i = inset == null ? .07 : inset;
    return {
      T: iso(x + i, y + i), R: iso(x + w - i, y + i), B: iso(x + w - i, y + h - i), L: iso(x + i, y + h - i)
    };
  }
  function drawBox(ctx, x, y, w, h, height, opt) {
    const o = opt || {};
    const g = boxGeo(x, y, w, h, o.inset);
    const wall = o.wall || '#f0e3c8';
    const left = o.left || shade(wall, .84);
    const right = o.right || shade(wall, .67);
    const top = o.top || wall;
    const up = (p, dy) => ({ x: p.x, y: p.y - (dy || height) });
    poly(ctx, [g.L, g.B, up(g.B), up(g.L)], left);
    poly(ctx, [g.B, g.R, up(g.R), up(g.B)], right);
    poly(ctx, [up(g.T), up(g.R), up(g.B), up(g.L)], top);
    if (o.outline !== false) {
      ctx.strokeStyle = o.outlineColor || 'rgba(20,42,32,.16)';
      ctx.lineWidth = .8;
      poly(ctx, [g.L, g.B, up(g.B), up(g.L)], null, ctx.strokeStyle, .8);
      poly(ctx, [g.B, g.R, up(g.R), up(g.B)], null, ctx.strokeStyle, .8);
    }
    return { g, height, up, top: top };
  }
  function drawPitchedRoof(ctx, g, height, rise, color, opt) {
    const o = opt || {};
    const y = height;
    const T = { x: g.T.x, y: g.T.y - y }, R = { x: g.R.x, y: g.R.y - y }, B = { x: g.B.x, y: g.B.y - y }, L = { x: g.L.x, y: g.L.y - y };
    const cx = (T.x + B.x) / 2, cy = (T.y + B.y) / 2;
    const apex = { x: cx, y: cy - rise };
    const over = o.over || 0;
    if (over) {
      const dirs = [[T, R], [R, B], [B, L], [L, T]];
      for (const [a, b] of dirs) {
        const na = { x: a.x + (a.x - cx) * .06, y: a.y + (a.y - cy) * .06 };
        const nb = { x: b.x + (b.x - cx) * .06, y: b.y + (b.y - cy) * .06 };
        poly(ctx, [a, b, nb, na], shade(color, .7));
      }
    }
    poly(ctx, [L, B, apex], shade(color, .86));
    poly(ctx, [B, R, apex], shade(color, .66));
    if (o.ridge !== false) {
      line(ctx, apex, { x: lerp(L.x, B.x, .5), y: lerp(L.y, B.y, .5) - rise * .0 }, shade(color, .55), 1.2);
    }
    if (o.tiles) {
      ctx.globalAlpha = .18;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const a = { x: lerp(L.x, B.x, t / 2), y: lerp(L.y, B.y, t / 2) };
        const b = { x: lerp(apex.x, B.x, t * .8), y: lerp(apex.y, B.y, t * .8) };
        line(ctx, { x: lerp(L.x, B.x, 1 - t), y: lerp(L.y, B.y, 1 - t) }, { x: lerp(apex.x, L.x, .5), y: lerp(apex.y, L.y, .5) }, shade(color, .5), .8);
      }
      ctx.globalAlpha = 1;
    }
  }
  function drawWindows(ctx, faceA, faceB, height, rows, cols, opt) {
    const o = opt || {};
    const top = o.top || 6, bottom = o.bottom || 7;
    const usable = height - top - bottom;
    if (usable < 6) return;
    const winH = Math.min(o.winH || 6, usable / rows * .5);
    const winW = o.winW || 4.6;
    const col = NIGHT > .28 ? '#ffd98a' : (o.color || '#bfe6f5');
    const frame = o.frame || 'rgba(255,255,255,.28)';
    const stepX = (faceB.x - faceA.x) / cols;
    const stepY = (faceB.y - faceA.y) / cols;
    for (let r = 0; r < rows; r++) {
      const wy = height - top - (usable / rows) * (r + .5);
      for (let c = 0; c < cols; c++) {
        const cx = faceA.x + stepX * (c + .5);
        const cy = faceA.y + stepY * (c + .5) - wy;
        const ex = (stepX / Math.abs(stepX || 1)) * winW;
        ctx.beginPath();
        ctx.moveTo(cx - ex / 2, cy);
        ctx.lineTo(cx + ex / 2, cy);
        ctx.lineTo(cx + ex / 2, cy + winH);
        ctx.lineTo(cx - ex / 2, cy + winH);
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        if (o.frame !== false) {
          ctx.strokeStyle = frame; ctx.lineWidth = .5; ctx.stroke();
        }
        if (NIGHT > .28) {
          ctx.globalAlpha = .18;
          ctx.fillStyle = '#ffe7a8';
          ctx.fillRect(cx - ex / 2 - 1, cy - 1, Math.abs(ex) + 2, winH + 2);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
  function drawDoor(ctx, g, height, color, opt) {
    const o = opt || {};
    const frac = o.frac == null ? .5 : o.frac;
    const dx = lerp(g.L.x, g.B.x, frac), dy = lerp(g.L.y, g.B.y, frac);
    const w = o.w || 5, h = o.h || 10;
    poly(ctx, [
      { x: dx - w / 2, y: dy - h }, { x: dx + w / 2, y: dy - h },
      { x: dx + w / 2, y: dy }, { x: dx - w / 2, y: dy }
    ], color || '#7a5a3a');
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(dx + w / 2 - 1.6, dy - h / 2, 1, 1);
  }
  function drawAwning(ctx, g, height, colorA, colorB, y) {
    const baseY = y == null ? height - 13 : y;
    const segments = 6;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      const a0 = { x: lerp(g.L.x, g.B.x, t0), y: lerp(g.L.y, g.B.y, t0) - baseY };
      const a1 = { x: lerp(g.L.x, g.B.x, t1), y: lerp(g.L.y, g.B.y, t1) - baseY };
      const b0 = { x: a0.x + 2, y: a0.y + 4 }, b1 = { x: a1.x + 2, y: a1.y + 4 };
      poly(ctx, [a0, a1, b1, b0], i % 2 ? colorB : colorA);
    }
  }
  function addVariantColors(b, palettes) {
    const idx = Math.abs(Math.floor(hash(b.x * 7 + b.uid * .17, b.y * 11 + b.level * 3) * palettes.length)) % palettes.length;
    return palettes[idx];
  }

  // object dispatch & main render (art functions below)
  function defOf(b) { return DEFS[b.defId]; }
  function artFor(def, level) {
    if (def.kind === 'zone-r') return level > 0 ? 'house' : 'lot_r';
    if (def.kind === 'zone-c') return level > 0 ? 'shop' : 'lot_c';
    if (def.kind === 'zone-i') return level > 0 ? 'factory' : 'lot_i';
    return def.art;
  }
  function artHeight(def, level) {
    const lv = level || 1;
    if (def.kind === 'zone-r') return [0, 52, 64, 80, 100][Math.min(lv, 4)];
    if (def.kind === 'zone-c') return [0, 48, 64, 84][Math.min(lv, 3)];
    if (def.kind === 'zone-i') return [0, 68, 80, 92][Math.min(lv, 3)];
    const map = {
      powerplant: 112, watertower: 78, solar: 46, police: 54, fire: 60, school: 86, hospital: 96,
      smallpark: 54, park: 74, plaza: 64, fountain: 58, ferris: 126, stadium: 100, monument: 96,
      museum: 78, busterminal: 64, airport: 88,
      tree: 58, flowers: 44, streetlamp: 54, rock: 36, lot_r: 34, lot_c: 34, lot_i: 34
    };
    return map[def.art] || 60;
  }
  function drawObject(ctx, b, time) {
    const def = defOf(b);
    if (!def) return;
    if (def.kind === 'road' || b.defId === 'road') return;
    const art = b.art || artFor(def, b.level);
    const footprint = diamondPoints(b.x + (b.w - 1) * .5, b.y + (b.h - 1) * .5, b.w + .16, b.h + .16, .02);
    const sunAngle = (HOUR - 12) * Math.PI / 12;
    const daylight = clamp(SUN_ELEVATION, 0, 1);
    const shadowLength = clamp(artHeight(def, b.level) * (.1 + (1 - daylight) * .42), 4, 58);
    const shadowX = Math.sin(sunAngle) * shadowLength;
    const shadowY = 2 + shadowLength * .24;
    const shadowOpacity = .025 + daylight * .12;
    ctx.save();
    ctx.translate(shadowX, shadowY);
    poly(ctx, footprint, `rgba(18,34,43,${shadowOpacity * .35})`);
    ctx.translate(shadowX * .12, shadowY * .12);
    poly(ctx, footprint, `rgba(15,35,39,${shadowOpacity})`);
    ctx.restore();
    switch (art) {
      case 'lot_r': return drawLot(ctx, b, def, '#5ab86c', 'R', time);
      case 'lot_c': return drawLot(ctx, b, def, '#4a9bda', 'C', time);
      case 'lot_i': return drawLot(ctx, b, def, '#dcaa46', 'I', time);
      case 'house': return drawHouse(ctx, b, def, time);
      case 'shop': return drawShop(ctx, b, def, time);
      case 'factory': return drawFactory(ctx, b, def, time);
      case 'powerplant': return drawPowerPlant(ctx, b, time);
      case 'watertower': return drawWaterTower(ctx, b, time);
      case 'solar': return drawSolar(ctx, b, time);
      case 'police': return drawPolice(ctx, b, time);
      case 'fire': return drawFire(ctx, b, time);
      case 'school': return drawSchool(ctx, b, time);
      case 'hospital': return drawHospital(ctx, b, time);
      case 'smallpark': return drawSmallPark(ctx, b, time);
      case 'park': return drawPark(ctx, b, time);
      case 'plaza': return drawPlaza(ctx, b, time);
      case 'fountain': return drawFountain(ctx, b, time);
      case 'ferris': return drawFerris(ctx, b, time);
      case 'stadium': return drawStadium(ctx, b, time);
      case 'museum': return drawMuseum(ctx, b, time);
      case 'busterminal': return drawBusTerminal(ctx, b, time);
      case 'airport': return drawAirport(ctx, b, time);
      case 'monument': return drawMonument(ctx, b, time);
      case 'tree': return drawTree(ctx, b, def, time);
      case 'flowers': return drawFlowers(ctx, b, time);
      case 'streetlamp': return drawStreetLamp(ctx, b, time);
      case 'rock': return drawRock(ctx, b, time);
      default: return;
    }
  }

  function drawWorld(ctx, world, cam, viewW, viewH, zoom, time, opts) {
    opts = opts || {};
    NIGHT = opts.night || 0;
    TIME = time;
    HOUR = Number.isFinite(opts.hour) ? ((opts.hour % 24) + 24) % 24 : 12;
    SUN_ELEVATION = Math.sin((HOUR - 6) * Math.PI / 12);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, viewW * (opts.dpr || 1), viewH * (opts.dpr || 1));
    const dpr = opts.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(ctx, viewW, viewH, time);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (viewW / 2 - cam.x * zoom), dpr * (viewH / 2 - cam.y * zoom));
    drawPlate(ctx, world.gridSize);
    const left = cam.x - viewW / (2 * zoom) - 90;
    const right = cam.x + viewW / (2 * zoom) + 90;
    const top = cam.y - viewH / (2 * zoom) - 200;
    const bottom = cam.y + viewH / (2 * zoom) + 130;
    for (let y = 0; y < world.gridSize; y++) {
      for (let x = 0; x < world.gridSize; x++) {
        const t = world.grid[y * world.gridSize + x];
        if (!t) continue;
        const s = iso(x, y);
        if (s.x < left - 90 || s.x > right + 90 || s.y < top - 80 || s.y > bottom + 80) continue;
        drawTerrain(ctx, world, x, y, t, time);
        if (t.road) drawRoad(ctx, world, x, y, t);
      }
    }
    if (opts.placements && opts.placements.length) {
      drawPlacementCandidates(ctx, opts.placements, { left, right, top, bottom }, time);
    }
    const objs = [];
    for (const b of world.buildings) {
      const s = iso(b.x, b.y);
      if (s.x < left - 260 || s.x > right + 260 || s.y < top - 120 || s.y > bottom + 260) continue;
      objs.push({ d: b.x + b.y + (b.w + b.h - 2) * .34, b });
    }
    if (world.cars) {
      for (const c of world.cars) {
        if (c.x < left / 32 - 20 || c.y < top / 16 - 20) { /* rough */ }
        objs.push({ d: c.x + c.y, car: c });
      }
    }
    objs.sort((a, b) => a.d - b.d);
    for (const o of objs) {
      if (o.b) drawObject(ctx, o.b, time);
      else drawCar(ctx, o.car, time);
    }
    if (opts.selected) {
      const b = opts.selected;
      const pts = diamondPoints(b.x, b.y, b.w, b.h, .02);
      ctx.save();
      ctx.setLineDash([6, 4]);
      poly(ctx, pts, 'rgba(255,255,255,.05)', 'rgba(255,255,255,.9)', 2.2);
      ctx.setLineDash([]);
      ctx.restore();
      if (DEFS[b.defId] && DEFS[b.defId].radius) drawZoneRadius(ctx, b, 'rgba(46,194,126,.55)');
    }
    if (opts.ghost) drawGhost(ctx, opts.ghost, time);
    // night overlay (screen space)
    if (NIGHT > .02) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(14,26,62,${NIGHT * .3})`;
      ctx.fillRect(0, 0, viewW, viewH);
      if (opts.dusk) {
        ctx.fillStyle = `rgba(255,127,58,${opts.dusk * .12})`;
        ctx.fillRect(0, 0, viewW, viewH);
      }
    }
  }

  function drawCar(ctx, car, time) {
    // Simulation coordinates already point to the center of the current road tile.
    const p = iso(car.x, car.y);
    const color = car.color || '#e6563d';
    const dir = car.dir || 'x';
    const dxs = dir === 'x' ? 1 : dir === '-x' ? -1 : 0;
    const dys = dir === 'y' ? 1 : dir === '-y' ? -1 : 0;
    const vx = (dxs - dys) * IX, vy = (dxs + dys) * IY;
    const length = Math.hypot(vx, vy) || 1;
    // Opposing traffic uses opposite sides of the road, leaving room to pass.
    const lane = 4.8;
    const ang = Math.atan2(vy, vx);
    ctx.save();
    ctx.translate(p.x - vy / length * lane, p.y + vx / length * lane);
    ctx.fillStyle = 'rgba(20,45,30,.24)';
    ctx.beginPath(); ctx.ellipse(0, 2, car.type === 'bus' || car.type === 'truck' ? 15 : 11, 5, ang, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(ang + Math.PI);

    if (car.type === 'motorcycle') {
      // Compact bike with two visible wheels and a helmeted rider.
      ctx.fillStyle = '#26323a';
      ctx.beginPath(); ctx.arc(-5, 1, 2.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, 1, 2.7, 0, Math.PI * 2); ctx.fill();
      line(ctx, { x: -5, y: 1 }, { x: -1, y: -1 }, '#d8dce0', 1.4);
      line(ctx, { x: -1, y: -1 }, { x: 2, y: 1 }, '#d8dce0', 1.4);
      line(ctx, { x: 2, y: 1 }, { x: 5, y: 1 }, '#d8dce0', 1.4);
      ctx.fillStyle = shade(color, .72);
      roundRect(ctx, -2.7, -.5, 5.2, 2, 1); ctx.fill();
      line(ctx, { x: -1.5, y: -1 }, { x: 2, y: -2.3 }, '#313c43', 2.2);
      ctx.fillStyle = '#344b59';
      ctx.beginPath(); ctx.ellipse(-.2, -3, 2, 2.8, -.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2c99a';
      ctx.beginPath(); ctx.arc(-2.2, -5.3, 1.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(-2.2, -5.8, 1.7, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff0bd'; ctx.beginPath(); ctx.arc(-6.3, .2, .8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    if (car.type === 'bus') {
      ctx.fillStyle = '#26323a';
      for (const x of [-9, 0, 9]) {
        roundRect(ctx, x - 2, -5.4, 4, 2.5, 1); ctx.fill();
        roundRect(ctx, x - 2, 3, 4, 2.5, 1); ctx.fill();
      }
      ctx.fillStyle = shade(color, .62);
      roundRect(ctx, -15, -4.7, 30, 9.5, 2); ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, -14.5, -4.5, 28.5, 7.7, 1.8); ctx.fill();
      ctx.fillStyle = '#a9d8df';
      for (let x = -10.5; x <= 6; x += 5.5) {
        roundRect(ctx, x, -3.4, 4.1, 3.1, .6); ctx.fill();
      }
      ctx.fillStyle = '#85bac6';
      roundRect(ctx, -14, -3.3, 3, 5.5, .6); ctx.fill();
      line(ctx, { x: 10, y: -3.5 }, { x: 10, y: 3.2 }, 'rgba(255,255,255,.55)', .7);
      ctx.fillStyle = '#fff0bd'; ctx.fillRect(-15, -2.2, 1.1, 1.2); ctx.fillRect(-15, 1, 1.1, 1.2);
      ctx.fillStyle = '#c94c43'; ctx.fillRect(14, -2.2, 1, 1); ctx.fillRect(14, 1, 1, 1);
      ctx.restore();
      return;
    }

    if (car.type === 'truck') {
      ctx.fillStyle = '#26323a';
      for (const x of [-10, 4, 10]) {
        roundRect(ctx, x - 2, -5.4, 4, 2.6, 1); ctx.fill();
        roundRect(ctx, x - 2, 3, 4, 2.6, 1); ctx.fill();
      }
      ctx.fillStyle = shade(color, .65);
      roundRect(ctx, -15, -4.5, 17, 9, 1.2); ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, -14.5, -4.2, 16, 7.5, 1); ctx.fill();
      poly(ctx, [{ x: -14, y: -3.4 }, { x: -10, y: -3.7 }, { x: -8.5, y: -2.2 }, { x: -8.5, y: 2.8 }, { x: -14, y: 2.8 }], '#a9d8df');
      ctx.fillStyle = '#d6ddd8';
      roundRect(ctx, 2, -4.8, 13, 9.6, .8); ctx.fill();
      poly(ctx, [{ x: 3, y: -4 }, { x: 13.5, y: -4 }, { x: 13.5, y: 3.7 }, { x: 3, y: 3.7 }], '#e8eee8', shade(color, .76), .7);
      line(ctx, { x: 5, y: -2.8 }, { x: 12, y: -2.8 }, '#aebbb4', .7);
      ctx.fillStyle = '#fff0bd'; ctx.fillRect(-15, -2, 1.1, 1.2); ctx.fillRect(-15, 1, 1.1, 1.2);
      ctx.fillStyle = '#c94c43'; ctx.fillRect(14, -2, 1, 1); ctx.fillRect(14, 1, 1, 1);
      ctx.restore();
      return;
    }

    // Tires and the darker lower body give the car a raised, dimensional silhouette.
    ctx.fillStyle = '#26323a';
    roundRect(ctx, -6.5, -5, 4.5, 2.6, 1); ctx.fill();
    roundRect(ctx, 3, -5, 4.5, 2.6, 1); ctx.fill();
    roundRect(ctx, -6.5, 2.7, 4.5, 2.6, 1); ctx.fill();
    roundRect(ctx, 3, 2.7, 4.5, 2.6, 1); ctx.fill();
    poly(ctx, [
      { x: -9, y: -2.8 }, { x: 6.5, y: -3.4 }, { x: 9, y: -1.5 },
      { x: 8, y: 3.4 }, { x: -7, y: 4 }, { x: -9, y: 1.8 }
    ], shade(color, .62), '#26323a', .7);
    poly(ctx, [
      { x: -8.5, y: -3.2 }, { x: 6.2, y: -3.8 }, { x: 8, y: -1.6 },
      { x: 7, y: 2.1 }, { x: -7.5, y: 2.7 }, { x: -8.8, y: .8 }
    ], color, shade(color, .68), .6);

    // Hood, cabin glass and roof highlights read clearly at the game's small scale.
    poly(ctx, [
      { x: -8, y: -2.5 }, { x: -5.3, y: -3 }, { x: -4.8, y: 2.4 },
      { x: -7.5, y: 2.2 }, { x: -8.7, y: .6 }
    ], light(color, .2));
    poly(ctx, [
      { x: -4.8, y: -3 }, { x: 2.5, y: -3.3 }, { x: 4.3, y: -1.7 },
      { x: 3.8, y: 2.3 }, { x: -4.8, y: 2.5 }
    ], shade(color, .78));
    poly(ctx, [
      { x: -4, y: -2.5 }, { x: -1.1, y: -2.7 }, { x: -.9, y: 1.8 },
      { x: -4.1, y: 1.9 }
    ], '#b9dce2');
    poly(ctx, [
      { x: -.3, y: -2.7 }, { x: 2.3, y: -2.8 }, { x: 3.5, y: -1.6 },
      { x: 3.2, y: 1.8 }, { x: -.4, y: 1.9 }
    ], '#84b9c5');
    line(ctx, { x: -.7, y: -2.7 }, { x: -.5, y: 1.9 }, 'rgba(255,255,255,.55)', .6);
    line(ctx, { x: -7, y: -2.2 }, { x: -5.5, y: -2.5 }, 'rgba(255,255,255,.65)', .7);

    ctx.fillStyle = NIGHT > .28 ? '#ffe9a0' : '#fff3ce';
    roundRect(ctx, -9, -2.1, 1.5, 1.4, .5); ctx.fill();
    roundRect(ctx, -9, .8, 1.5, 1.4, .5); ctx.fill();
    ctx.fillStyle = '#c94c43';
    ctx.fillRect(7, -2, 1.2, 1.2); ctx.fillRect(7, 1.2, 1.2, 1.2);
    if (NIGHT > .28) {
      ctx.globalAlpha = .24; ctx.fillStyle = '#ffe9a0';
      ctx.beginPath(); ctx.moveTo(-9, -1.5); ctx.lineTo(-22, -7); ctx.lineTo(-22, 4); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawPlacementCandidates(ctx, candidates, bounds, time) {
    const pulse = .9 + Math.sin(time * 3.2) * .1;
    ctx.save();
    ctx.globalAlpha = pulse;
    for (const candidate of candidates) {
      const p = iso(candidate.x + candidate.w / 2, candidate.y + candidate.h / 2);
      if (p.x < bounds.left - 100 || p.x > bounds.right + 100 ||
          p.y < bounds.top - 100 || p.y > bounds.bottom + 100) continue;
      poly(ctx, diamondPoints(candidate.x, candidate.y, candidate.w, candidate.h, .09),
        'rgba(57,214,157,.16)', 'rgba(29,190,133,.78)', 1.5);
    }
    ctx.restore();
  }

  function drawGhost(ctx, ghost, time) {
    const { def, x, y, valid } = ghost;
    const b = { defId: def.id, x, y, w: def.w, h: def.h, level: def.previewLevel || 1, uid: 1 };
    ctx.save();
    ctx.globalAlpha = .68;
    drawObject(ctx, b, time);
    ctx.globalAlpha = 1;
    const pts = diamondPoints(x, y, def.w, def.h, .02);
    poly(ctx, pts, valid ? 'rgba(80,220,130,.16)' : 'rgba(255,90,60,.2)', valid ? '#4ee58a' : '#ff5b3d', 2);
    if (def.radius) {
      ctx.setLineDash([5, 5]);
      const c = iso(x + (def.w - 1) / 2 + .5, y + (def.h - 1) / 2 + .5);
      ellipse(ctx, c.x, c.y, def.radius * 32, def.radius * 16, 'rgba(80,220,130,.055)', valid ? 'rgba(46,194,126,.5)' : 'rgba(255,90,60,.4)', 1.4);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawZoneRadius(ctx, b, color) {
    const def = defOf(b);
    if (!def.radius) return;
    const c = iso(b.x + (b.w - 1) / 2 + .5, b.y + (b.h - 1) / 2 + .5);
    ctx.save();
    ctx.setLineDash([4, 5]);
    ellipse(ctx, c.x, c.y, def.radius * 32, def.radius * 16, 'rgba(46,194,126,.05)', color || 'rgba(46,194,126,.45)', 1.2);
    ctx.restore();
  }

  // ---------- shared art helpers ----------
  function flatRoof(g, height, color, lipColor) {
    const T = { x: g.T.x, y: g.T.y - height }, R = { x: g.R.x, y: g.R.y - height }, B = { x: g.B.x, y: g.B.y - height }, L = { x: g.L.x, y: g.L.y - height };
    poly(ctx, [L, B, B, L], null);
    poly(ctx, [T, R, B, L].map(p => ({ x: lerp(p.x, (T.x + B.x) / 2, .08), y: lerp(p.y, (T.y + B.y) / 2, .08) })), color || '#d9d1c1');
    return { T, R, B, L };
  }
  function roofLip(ctx, g, height, color) {
    const T = { x: g.T.x, y: g.T.y - height }, R = { x: g.R.x, y: g.R.y - height }, B = { x: g.B.x, y: g.B.y - height }, L = { x: g.L.x, y: g.L.y - height };
    const cx = (T.x + B.x) / 2, cy = (T.y + B.y) / 2;
    const inset = p => ({ x: lerp(p.x, cx, .07), y: lerp(p.y, cy, .07) });
    const iT = inset(T), iR = inset(R), iB = inset(B), iL = inset(L);
    poly(ctx, [T, R, iR, iT], color); poly(ctx, [R, B, iB, iR], shade(color, .82));
    poly(ctx, [B, L, iL, iB], shade(color, .75)); poly(ctx, [L, T, iT, iL], shade(color, .92));
  }
  function cylinder(ctx, cx, baseY, rx, h, color) {
    const topY = baseY - h;
    const grd = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    grd.addColorStop(0, shade(color, .78));
    grd.addColorStop(.45, light(color, .12));
    grd.addColorStop(1, shade(color, .66));
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(cx - rx, topY); ctx.lineTo(cx - rx, baseY); ctx.ellipse(cx, baseY, rx, rx * .42, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, topY); ctx.closePath(); ctx.fill();
    ellipse(ctx, cx, topY, rx, rx * .42, light(color, .17), shade(color, .58), .7);
  }
  function smoke(ctx, cx, cy, time, scale) {
    const sc = scale || 1;
    for (let i = 0; i < 4; i++) {
      const t = (time * .19 + i * .25) % 1;
      const r = (4 + t * 12) * sc;
      ctx.globalAlpha = (1 - t) * .3;
      ctx.fillStyle = i % 2 ? '#e9f0ef' : '#d8e0df';
      ctx.beginPath(); ctx.arc(cx + Math.sin(time * .5 + i * 2.1) * 5 * sc, cy - t * 46 * sc, r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function flag(ctx, x, y, h, time) {
    line(ctx, { x, y }, { x, y: y - h }, '#8b8f8b', 1.6);
    const wave = Math.sin(time * 2.4 + x * .1) * 1.8;
    poly(ctx, [{ x: x + 1, y: y - h }, { x: x + 1 + 11, y: y - h + 1 + wave }, { x: x + 1 + 11, y: y - h + 5 + wave }, { x: x + 1, y: y - h + 4 }], '#e0453a');
    poly(ctx, [{ x: x + 1, y: y - h + 4 }, { x: x + 1 + 11, y: y - h + 5 + wave }, { x: x + 1 + 11, y: y - h + 8 + wave }, { x: x + 1, y: y - h + 7 }], '#f7f4ec');
  }
  function basePad(ctx, b, color1, color2) {
    const p = diamondPoints(b.x, b.y, b.w, b.h, .015);
    poly(ctx, p, color1 || '#d9d0ba');
    const p2 = diamondPoints(b.x, b.y, b.w, b.h, .08);
    poly(ctx, p2, color2 || light(color1 || '#d9d0ba', .12));
  }

  // ---------- zones ----------
  function drawLot(ctx, b, def, color, letter, time) {
    const p = diamondPoints(b.x, b.y, 1, 1, .035);
    poly(ctx, p, color + '33');
    ctx.save();
    ctx.setLineDash([5, 4]);
    poly(ctx, diamondPoints(b.x, b.y, 1, 1, .11), null, color, 1.4);
    ctx.restore();
    // diagonal tint stripes
    ctx.save();
    ctx.beginPath(); poly(ctx, diamondPoints(b.x, b.y, 1, 1, .08), null); ctx.clip();
    ctx.globalAlpha = .1;
    for (let i = -1; i < 5; i++) {
      const t = i * .28;
      line(ctx, iso(b.x + t, b.y), iso(b.x + t + .5, b.y + 1), color, 2);
    }
    ctx.restore();
    // sign
    const sp = iso(b.x + .72, b.y + .28);
    line(ctx, { x: sp.x, y: sp.y }, { x: sp.x, y: sp.y - 10 }, '#8b7355', 1.6);
    poly(ctx, [{ x: sp.x - 1, y: sp.y - 16 }, { x: sp.x + 10, y: sp.y - 12 }, { x: sp.x + 10, y: sp.y - 6 }, { x: sp.x - 1, y: sp.y - 10 }], '#fdf9ee', color, .8);
    ctx.fillStyle = color; ctx.font = '700 6px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(letter, sp.x + 4.5, sp.y - 9);
    // small props
    const a = iso(b.x + .25, b.y + .7);
    ctx.globalAlpha = .5; ctx.fillStyle = shade(color, .7);
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(a.x + i * 3, a.y - i * 1.3, 1.2, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  function houseOpts(ctx, b) {
    const pal = addVariantColors(b, KK.HOUSE_PALETTES);
    return pal;
  }
  function drawHouse(ctx, b, def, time) {
    const pal = houseOpts(ctx, b);
    const lv = b.level || 1;
    if (lv === 1) {
      const g = boxGeo(b.x, b.y, 1, 1, .12);
      drawBox(ctx, b.x, b.y, 1, 1, 18, { inset: .12, wall: pal.wall, left: shade(pal.wall, .86), right: shade(pal.wall, .68), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 18, 1, 2, { top: 5, bottom: 6, winW: 4.2, winH: 5 });
      drawDoor(ctx, g, 18, shade(pal.roof, .7), { w: 5, h: 9 });
      drawPitchedRoof(ctx, g, 18, 13, pal.roof, { over: 1, tiles: true });
      // chimney
      const cp = { x: lerp(g.T.x, g.R.x, .62), y: lerp(g.T.y, g.R.y, .62) - 24 };
      poly(ctx, [{ x: cp.x - 2, y: cp.y }, { x: cp.x + 2, y: cp.y + 1 }, { x: cp.x + 2, y: cp.y + 8 }, { x: cp.x - 2, y: cp.y + 7 }], '#a9836f');
      // garden
      const gp = iso(b.x + .2, b.y + .82);
      ctx.fillStyle = '#4e9e56'; ctx.beginPath(); ctx.arc(gp.x, gp.y, 2.4, 0, 7); ctx.fill();
      ctx.fillStyle = '#f2d45a'; ctx.beginPath(); ctx.arc(gp.x + 3, gp.y - 1, 1, 0, 7); ctx.fill();
    } else if (lv === 2) {
      const g = boxGeo(b.x, b.y, 1, 1, .1);
      drawBox(ctx, b.x, b.y, 1, 1, 29, { inset: .1, wall: pal.wall, left: shade(pal.wall, .87), right: shade(pal.wall, .69), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 29, 2, 2, { top: 5, bottom: 6, winW: 4.4, winH: 5.4 });
      drawDoor(ctx, g, 29, shade(pal.roof, .65), { w: 5, h: 9 });
      // balcony band
      const by = 13;
      poly(ctx, [
        { x: g.L.x, y: g.L.y - by }, { x: g.B.x, y: g.B.y - by },
        { x: g.B.x + 2, y: g.B.y - by + 3 }, { x: g.L.x + 2, y: g.L.y - by + 3 }
      ], light(pal.wall, .25));
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        line(ctx, { x: lerp(g.L.x + 2, g.B.x + 2, t), y: lerp(g.L.y, g.B.y, t) - by + 3 }, { x: lerp(g.L.x + 2, g.B.x + 2, t), y: lerp(g.L.y, g.B.y, t) - by - 2 }, 'rgba(255,255,255,.7)', .7);
      }
      roofLip(ctx, g, 29, shade(pal.roof, .85));
      drawPitchedRoof(ctx, g, 29, 9, pal.roof, { over: 0, tiles: true });
    } else if (lv === 3) {
      const g = boxGeo(b.x, b.y, 1, 1, .09);
      drawBox(ctx, b.x, b.y, 1, 1, 43, { inset: .09, wall: pal.wall, left: shade(pal.wall, .86), right: shade(pal.wall, .68), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 43, 3, 2, { top: 5, bottom: 6, winW: 4.2, winH: 5 });
      drawDoor(ctx, g, 43, shade(pal.roof, .6), { w: 6, h: 10 });
      // balcony slabs
      for (const by of [17, 30]) {
        poly(ctx, [{ x: g.L.x, y: g.L.y - by }, { x: g.B.x, y: g.B.y - by }, { x: g.B.x + 2.5, y: g.B.y - by + 3 }, { x: g.L.x + 2.5, y: g.L.y - by + 3 }], '#f2ede1');
        line(ctx, { x: g.L.x + 2.5, y: g.L.y - by + 3 }, { x: g.B.x + 2.5, y: g.B.y - by + 3 }, 'rgba(255,255,255,.8)', .8);
      }
      roofLip(ctx, g, 43, shade(pal.roof, .8));
      // rooftop tank
      const c = iso(b.x + .65, b.y + .36);
      cylinder(ctx, c.x, c.y - 43, 4.5, 7, '#c9d8d7');
      line(ctx, { x: c.x - 3, y: c.y - 43 }, { x: c.x - 3, y: c.y - 37 }, '#889988');
    } else {
      const g = boxGeo(b.x, b.y, 1, 1, .07);
      drawBox(ctx, b.x, b.y, 1, 1, 60, { inset: .07, wall: pal.wall, left: shade(pal.wall, .85), right: shade(pal.wall, .66), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 60, 4, 3, { top: 5, bottom: 6, winW: 3.4, winH: 5 });
      drawDoor(ctx, g, 60, shade(pal.roof, .55), { w: 7, h: 11, frac: .5 });
      // vertical accent
      poly(ctx, [{ x: lerp(g.L.x, g.B.x, .02), y: lerp(g.L.y, g.B.y, .02) - 60 }, { x: lerp(g.L.x, g.B.x, .14), y: lerp(g.L.y, g.B.y, .14) - 60 }, { x: lerp(g.L.x, g.B.x, .14), y: lerp(g.L.y, g.B.y, .14) }, { x: lerp(g.L.x, g.B.x, .02), y: lerp(g.L.y, g.B.y, .02) }], shade(pal.roof, .9));
      roofLip(ctx, g, 60, shade(pal.roof, .75));
      const c = iso(b.x + .6, b.y + .4);
      cylinder(ctx, c.x, c.y - 60, 4, 6, '#d7e1de');
      line(ctx, { x: c.x + 8, y: c.y - 60 }, { x: c.x + 8, y: c.y - 78 }, '#8a9a97', 1);
      if (NIGHT > .28) { ctx.fillStyle = '#ff5b4d'; ctx.beginPath(); ctx.arc(c.x + 8, c.y - 79, 1.5, 0, 7); ctx.fill(); }
    }
  }

  function drawShop(ctx, b, def, time) {
    const pal = addVariantColors(b, KK.SHOP_PALETTES);
    const lv = b.level || 1;
    if (lv === 1) {
      const g = boxGeo(b.x, b.y, 1, 1, .11);
      drawBox(ctx, b.x, b.y, 1, 1, 22, { inset: .11, wall: pal.wall, left: shade(pal.wall, .87), right: shade(pal.wall, .7), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 22, 1, 2, { top: 7, bottom: 5, winW: 5, winH: 7, color: '#a9dcef' });
      drawDoor(ctx, g, 22, shade(pal.sign, .7), { w: 5.5, h: 10, frac: .72 });
      drawAwning(ctx, g, 22, pal.awn, '#fdf8ec', 14);
      poly(ctx, [{ x: g.L.x + 1, y: g.L.y - 23 }, { x: g.B.x - 1, y: g.B.y - 23 }, { x: g.B.x - 1, y: g.B.y - 17 }, { x: g.L.x + 1, y: g.L.y - 17 }], pal.sign);
      roofLip(ctx, g, 22, '#d8d0c0');
      const ac = iso(b.x + .7, b.y + .3); ctx.fillStyle = '#c9d2d0'; ctx.fillRect(ac.x - 2, ac.y - 24, 4, 3);
    } else if (lv === 2) {
      const g = boxGeo(b.x, b.y, 1, 1, .1);
      drawBox(ctx, b.x, b.y, 1, 1, 37, { inset: .1, wall: pal.wall, left: shade(pal.wall, .87), right: shade(pal.wall, .7), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 37, 2, 2, { top: 6, bottom: 6, winW: 4.6, winH: 6, color: '#9fd7eb' });
      drawDoor(ctx, g, 37, shade(pal.sign, .65), { w: 6, h: 11, frac: .75 });
      drawAwning(ctx, g, 37, pal.awn, '#fdf8ec', 27);
      // sign band
      poly(ctx, [{ x: g.L.x + 1, y: g.L.y - 37 }, { x: g.B.x - 1, y: g.B.y - 37 }, { x: g.B.x - 1, y: g.B.y - 30 }, { x: g.L.x + 1, y: g.L.y - 30 }], pal.sign);
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      for (let i = 0; i < 3; i++) {
        const t = .2 + i * .26;
        ctx.fillRect(lerp(g.L.x + 3, g.B.x - 7, t), lerp(g.L.y, g.B.y, t) - 35.5, 4, 2);
      }
      roofLip(ctx, g, 37, shade(pal.awn, .8));
      // rooftop sign pole
      const sp = iso(b.x + .72, b.y + .26);
      line(ctx, { x: sp.x, y: sp.y - 37 }, { x: sp.x, y: sp.y - 47 }, '#8c9998', 1);
      poly(ctx, [{ x: sp.x - 4, y: sp.y - 50 }, { x: sp.x + 5, y: sp.y - 47 }, { x: sp.x + 5, y: sp.y - 43 }, { x: sp.x - 4, y: sp.y - 46 }], pal.sign);
    } else {
      const g = boxGeo(b.x, b.y, 1, 1, .08);
      drawBox(ctx, b.x, b.y, 1, 1, 58, { inset: .08, wall: pal.wall, left: shade(pal.wall, .84), right: shade(pal.wall, .66), top: pal.wall });
      drawWindows(ctx, g.L, g.B, 58, 4, 3, { top: 7, bottom: 6, winW: 3.3, winH: 5.2, color: '#8fd4ea' });
      drawDoor(ctx, g, 58, shade(pal.sign, .55), { w: 7, h: 11 });
      poly(ctx, [{ x: g.L.x + 2, y: g.L.y - 58 }, { x: g.L.x + 2, y: g.L.y - 46 }, { x: g.B.x - 6, y: g.B.y - 44 }, { x: g.B.x - 6, y: g.B.y - 56 }], pal.sign);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillRect(g.L.x + 4, g.L.y - 54, 3, 7);
      roofLip(ctx, g, 58, shade(pal.awn, .72));
      // billboard
      const sp = iso(b.x + .62, b.y + .3);
      line(ctx, { x: sp.x - 8, y: sp.y - 58 }, { x: sp.x - 8, y: sp.y - 70 }, '#7e8a89', 1.1);
      line(ctx, { x: sp.x + 8, y: sp.y - 58 }, { x: sp.x + 8, y: sp.y - 70 }, '#7e8a89', 1.1);
      poly(ctx, [{ x: sp.x - 11, y: sp.y - 72 }, { x: sp.x + 11, y: sp.y - 66 }, { x: sp.x + 11, y: sp.y - 58 }, { x: sp.x - 11, y: sp.y - 64 }], '#3a7f9c');
      poly(ctx, [{ x: sp.x - 8, y: sp.y - 69 }, { x: sp.x + 6, y: sp.y - 65 }, { x: sp.x + 6, y: sp.y - 61 }, { x: sp.x - 8, y: sp.y - 65 }], '#bfeaf5');
    }
  }

  function drawFactory(ctx, b, def, time) {
    const pal = addVariantColors(b, KK.FACTORY_PALETTES);
    const lv = b.level || 1;
    basePad(ctx, b, '#b9b2a2', '#c4bdac');
    const h = lv === 1 ? 22 : lv === 2 ? 32 : 42;
    const g = boxGeo(b.x, b.y, 1, 1, .1);
    drawBox(ctx, b.x, b.y, 1, 1, h, { inset: .1, wall: pal.wall, left: shade(pal.wall, .86), right: shade(pal.wall, .68), top: pal.roof });
    // sawtooth / vents
    ctx.globalAlpha = .3;
    for (let i = 0; i < 3; i++) {
      const t = .18 + i * .26;
      line(ctx, { x: lerp(g.L.x, g.B.x, t), y: lerp(g.L.y, g.B.y, t) - h }, { x: lerp(g.L.x, g.B.x, t) + 5, y: lerp(g.L.y, g.B.y, t) - h - 4 }, shade(pal.roof, .6), 1.2);
    }
    ctx.globalAlpha = 1;
    // loading door
    poly(ctx, [
      { x: g.L.x + 5, y: g.L.y - 12 }, { x: g.L.x + 16, y: g.L.y - 6 },
      { x: g.L.x + 16, y: g.L.y }, { x: g.L.x + 5, y: g.L.y + 6 }
    ], '#6f6455');
    // windows
    drawWindows(ctx, g.L, g.B, h, lv === 1 ? 1 : 2, 2, { top: 5, bottom: 7, winW: 3.8, winH: 4.4, color: '#b3dfe8' });
    if (lv >= 2) {
      // silo
      const s = iso(b.x + .78, b.y + .26);
      cylinder(ctx, s.x, s.y, 5.5, 18, '#c3cbc5');
      ellipse(ctx, s.x, s.y - 18, 5.5, 2.3, '#dbe2dc', '#9aa5a0', .8);
    }
    // chimney
    const c = iso(b.x + .25, b.y + .3);
    cylinder(ctx, c.x, c.y - h, 3.2, lv === 3 ? 26 : 17, '#a7ada5');
    smoke(ctx, c.x, c.y - h - (lv === 3 ? 26 : 17), time, .8);
    // crates
    const cr = iso(b.x + .25, b.y + .82);
    ctx.fillStyle = '#a87d4f'; ctx.fillRect(cr.x - 4, cr.y - 5, 5, 5); ctx.fillStyle = '#c69a62'; ctx.fillRect(cr.x + 1, cr.y - 3, 3, 3);
    if (lv === 3) {
      poly(ctx, [{ x: g.R.x - 8, y: g.R.y - 10 }, { x: g.R.x, y: g.R.y - 15 }, { x: g.R.x, y: g.R.y - 22 }, { x: g.R.x - 8, y: g.R.y - 17 }], '#8a9594');
    }
    ctx.globalAlpha = .16; ctx.fillStyle = '#3c3a32';
    for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(iso(b.x + .35 + i * .1, b.y + .8).x, iso(b.x + .35 + i * .1, b.y + .8).y, 6, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // ---------- utilities ----------
  function drawPowerPlant(ctx, b, time) {
    basePad(ctx, b, '#a9ad9f', '#b9bcaf');
    // main hall
    drawBox(ctx, b.x + .12, b.y + .12, 1.15, 1.15, 28, { inset: .04, wall: '#b9b7a8', left: '#9c9a8b', right: '#828073', top: '#c9c6b5' });
    // hall windows / vents
    const g = boxGeo(b.x + .12, b.y + .12, 1.15, 1.15, .04);
    drawWindows(ctx, g.L, g.B, 28, 2, 3, { top: 4, bottom: 6, winW: 3, winH: 4, color: '#8fc8d1' });
    roofLip(ctx, g, 28, '#7e7c6d');
    // cooling towers
    const t1 = iso(b.x + .72, b.y + 1.55), t2 = iso(b.x + 1.55, b.y + .72);
    for (const [t, sc] of [[t1, 1], [t2, .92]]) {
      const baseY = t.y;
      ctx.fillStyle = '#d2d0c2';
      ctx.beginPath();
      ctx.moveTo(t.x - 11 * sc, baseY); ctx.quadraticCurveTo(t.x - 8 * sc, baseY - 24 * sc, t.x - 5 * sc, baseY - 32 * sc);
      ctx.lineTo(t.x + 5 * sc, baseY - 32 * sc); ctx.quadraticCurveTo(t.x + 8 * sc, baseY - 24 * sc, t.x + 11 * sc, baseY);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(90,95,88,.35)'; ctx.lineWidth = .8; ctx.stroke();
      ellipse(ctx, t.x, baseY - 32 * sc, 5 * sc, 2 * sc, '#e3e1d5', '#a5a49a', .7);
      smoke(ctx, t.x, baseY - 32 * sc, time, .72);
    }
    // transformer yard
    const y = iso(b.x + 1.55, b.y + 1.35);
    ctx.strokeStyle = '#6e746c'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const px = y.x - 9 + i * 6;
      line(ctx, { x: px, y: y.y }, { x: px, y: y.y - 10 }, '#6e746c', 1.1);
      line(ctx, { x: px - 2, y: y.y - 10 }, { x: px + 2, y: y.y - 10 }, '#8e948c', 1.4);
    }
    line(ctx, { x: y.x - 12, y: y.y - 10 }, { x: y.x + 9, y: y.y - 10 }, '#8e948c', .7);
    // fence posts
    ctx.globalAlpha = .6;
    for (let i = 0; i < 6; i++) {
      const p = iso(b.x + .12 + i * .3, b.y + 1.9);
      line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y - 4 }, '#7d8177', 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawWaterTower(ctx, b, time) {
    basePad(ctx, b, '#cfc8b8', '#ddd7c9');
    const c = iso(b.x + .5, b.y + .5);
    const topY = c.y - 34;
    ctx.strokeStyle = '#8a938d'; ctx.lineWidth = 1.8;
    line(ctx, { x: c.x - 9, y: c.y + 4 }, { x: c.x - 6, y: topY }, '#8a938d', 1.8);
    line(ctx, { x: c.x + 9, y: c.y + 4 }, { x: c.x + 6, y: topY }, '#8a938d', 1.8);
    line(ctx, { x: c.x - 5, y: c.y - 6 }, { x: c.x + 5, y: c.y - 6 }, '#a9b0ab', 1);
    line(ctx, { x: c.x - 7, y: c.y - 14 }, { x: c.x + 7, y: c.y - 14 }, '#a9b0ab', .8);
    cylinder(ctx, c.x, topY + 9, 11, 15, '#3f9fbe');
    ellipse(ctx, c.x, topY - 6, 11, 2.4, '#5cbad4', '#2f7f98', .8);
    poly(ctx, [{ x: c.x - 11, y: topY - 6 }, { x: c.x, y: topY - 13 }, { x: c.x + 11, y: topY - 6 }, { x: c.x, y: topY + 1 }], '#76cfe2');
    // drop emblem
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.moveTo(c.x, topY + 1); ctx.bezierCurveTo(c.x + 4, topY + 5, c.x + 2, topY + 8, c.x, topY + 8); ctx.bezierCurveTo(c.x - 2, topY + 8, c.x - 4, topY + 5, c.x, topY + 1); ctx.fill();
    line(ctx, { x: c.x + 8, y: topY + 13 }, { x: c.x + 8, y: c.y - 2 }, '#4f7c86', 1.4);
    line(ctx, { x: c.x + 8, y: c.y - 2 }, { x: c.x + 11, y: c.y + 1 }, '#4f7c86', 1.4);
  }

  function drawSolar(ctx, b, time) {
    basePad(ctx, b, '#a9c78f', '#b7d39d');
    const panels = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) panels.push([b.x + .35 + c * .42, b.y + .42 + r * .52]);
    for (const [gx, gy] of panels) {
      const p = iso(gx, gy);
      const lift = 9;
      poly(ctx, [
        { x: p.x - 11, y: p.y - lift }, { x: p.x + 9, y: p.y - lift - 3 },
        { x: p.x + 9, y: p.y - lift + 5 }, { x: p.x - 11, y: p.y - lift + 8 }
      ], '#2f6f9e');
      poly(ctx, [
        { x: p.x - 10, y: p.y - lift + 1 }, { x: p.x + 8, y: p.y - lift - 1.5 },
        { x: p.x + 8, y: p.y - lift + 3 }, { x: p.x - 10, y: p.y - lift + 6 }
      ], '#4d9ac4');
      line(ctx, { x: p.x - 8, y: p.y - lift + 3 }, { x: p.x + 6, y: p.y - lift + .6 }, 'rgba(255,255,255,.4)', .6);
      line(ctx, { x: p.x - 7, y: p.y - lift + 9 }, { x: p.x - 7, y: p.y + 2 }, '#7b837e', .9);
      line(ctx, { x: p.x + 6, y: p.y - lift + 7 }, { x: p.x + 6, y: p.y + 1 }, '#7b837e', .9);
    }
    ctx.globalAlpha = .5;
    for (let i = 0; i < 5; i++) {
      const p = iso(b.x + .2 + i * .5, b.y + 1.72);
      line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y - 4 }, '#8b9683', 1);
    }
    ctx.globalAlpha = 1;
    if (NIGHT > .3) {
      for (const [gx, gy] of panels) {
        const p = iso(gx, gy);
        ctx.globalAlpha = .18; ctx.fillStyle = '#aee8ff'; ctx.beginPath(); ctx.arc(p.x, p.y - 14, 8, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- services ----------
  function drawPolice(ctx, b, time) {
    basePad(ctx, b, '#c5c0b2', '#d3cec0');
    const g = boxGeo(b.x, b.y, 1, 1, .13);
    drawBox(ctx, b.x, b.y, 1, 1, 20, { inset: .13, wall: '#e8eef0', left: '#c9d4d8', right: '#aab8bd', top: '#eef4f5' });
    // blue band
    poly(ctx, [{ x: g.L.x, y: g.L.y - 20 }, { x: g.B.x, y: g.B.y - 20 }, { x: g.B.x, y: g.B.y - 15 }, { x: g.L.x, y: g.L.y - 15 }], '#2f6f9e');
    drawWindows(ctx, g.L, g.B, 20, 1, 2, { top: 4, bottom: 7, winW: 4.6, winH: 4.4, color: '#9ccfe2' });
    drawDoor(ctx, g, 20, '#27495c', { w: 4, h: 8, frac: .22 });
    roofLip(ctx, g, 20, '#6f88a0');
    // antenna + light
    const a = iso(b.x + .72, b.y + .3);
    line(ctx, { x: a.x, y: a.y - 20 }, { x: a.x, y: a.y - 36 }, '#879a9d', 1.1);
    if (NIGHT > .25) { ctx.fillStyle = '#ff6255'; ctx.beginPath(); ctx.arc(a.x, a.y - 37, 1.6, 0, 7); ctx.fill(); }
    // sign shield
    poly(ctx, [{ x: a.x - 4, y: a.y - 28 }, { x: a.x + 3, y: a.y - 26 }, { x: a.x + 3, y: a.y - 22 }, { x: a.x - 4, y: a.y - 24 }], '#f4f7f4');
    ctx.strokeStyle = '#2f6f9e'; ctx.lineWidth = .8; ctx.stroke();
    // patrol car
    const c = iso(b.x + .3, b.y + .82);
    ctx.fillStyle = '#f0f4f5'; roundRect(ctx, c.x - 5, c.y - 4, 10, 4, 1.6); ctx.fill();
    ctx.fillStyle = '#2f6f9e'; ctx.fillRect(c.x - 2, c.y - 4, 3, 1.4);
    if (NIGHT > .25) { ctx.fillStyle = '#ff6255'; ctx.fillRect(c.x - 1, c.y - 5, 2, 1.4); }
  }

  function drawFire(ctx, b, time) {
    basePad(ctx, b, '#c5c0b2', '#d3cec0');
    const g = boxGeo(b.x, b.y, 1, 1, .13);
    drawBox(ctx, b.x, b.y, 1, 1, 22, { inset: .13, wall: '#e8d7cf', left: '#d0b6ab', right: '#b89a8f', top: '#f1e7e0' });
    // garage door
    poly(ctx, [{ x: g.L.x + 5, y: g.L.y - 12 }, { x: g.L.x + 17, y: g.L.y - 6 }, { x: g.L.x + 17, y: g.L.y }, { x: g.L.x + 5, y: g.L.y + 6 }], '#c9473a');
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = .6;
    for (let i = 1; i < 4; i++) line(ctx, { x: g.L.x + 5, y: g.L.y - 12 + i * 2 }, { x: g.L.x + 17, y: g.L.y - 6 + i * 2 }, 'rgba(255,255,255,.35)', .6);
    drawWindows(ctx, g.L, g.B, 22, 1, 1, { top: 5, bottom: 8, winW: 4, winH: 4, color: '#a9d7e4' });
    roofLip(ctx, g, 22, '#d9cabf');
    // hose tower
    const th = boxGeo(b.x + .55, b.y + .24, .45, .45, .02);
    drawBox(ctx, b.x + .55, b.y + .24, .45, .45, 29, { inset: .02, wall: '#dccac1', left: '#c3a99d', right: '#a88d82', top: '#e8dcd5' });
    poly(ctx, [{ x: th.L.x, y: th.L.y - 29 }, { x: th.B.x, y: th.B.y - 29 }, { x: th.B.x, y: th.B.y - 26 }, { x: th.L.x, y: th.L.y - 26 }], '#c9473a');
    // sign
    const s = iso(b.x + .82, b.y + .2);
    line(ctx, { x: s.x, y: s.y - 22 }, { x: s.x, y: s.y - 31 }, '#8e9b98', 1);
    poly(ctx, [{ x: s.x - 4, y: s.y - 34 }, { x: s.x + 4, y: s.y - 32 }, { x: s.x + 4, y: s.y - 27 }, { x: s.x - 4, y: s.y - 29 }], '#f6f2e8');
    ctx.fillStyle = '#c9473a'; ctx.beginPath(); ctx.arc(s.x, s.y - 31, 1.4, 0, 7); ctx.fill();
  }

  function drawSchool(ctx, b, time) {
    basePad(ctx, b, '#c9c1ac', '#d8d1bd');
    // courtyard path
    poly(ctx, diamondPoints(b.x, b.y + .95, 2, 1, .12), '#cbbf9e');
    const g = boxGeo(b.x + .1, b.y + .1, 1.8, 1.05, .04);
    drawBox(ctx, b.x + .1, b.y + .1, 1.8, 1.05, 26, { inset: .04, wall: '#f1e4c6', left: '#d6c5a2', right: '#bda57e', top: '#f6ecd4' });
    drawWindows(ctx, g.L, g.B, 26, 2, 5, { top: 4, bottom: 7, winW: 3.2, winH: 4.4, color: '#b0d9e8' });
    drawDoor(ctx, g, 26, '#8a5b37', { w: 6, h: 9, frac: .42 });
    drawDoor(ctx, g, 26, '#8a5b37', { w: 6, h: 9, frac: .68 });
    roofLip(ctx, g, 26, '#c56a45');
    // roof sign band
    poly(ctx, [{ x: g.T.x, y: g.T.y - 26 }, { x: g.R.x, y: g.R.y - 26 }, { x: g.R.x, y: g.R.y - 31 }, { x: g.T.x, y: g.T.y - 31 }], '#d97a4f');
    // flag
    const f = iso(b.x + 1.72, b.y + 1.2);
    flag(ctx, f.x, f.y, 32, time);
    // yard benches + ball
    const y = iso(b.x + 1.1, b.y + 1.55);
    ctx.fillStyle = '#c08a52'; ctx.fillRect(y.x - 6, y.y - 2, 9, 2.2);
    ctx.fillStyle = '#e05a3f'; ctx.beginPath(); ctx.arc(y.x + 12, y.y + 2, 1.9, 0, 7); ctx.fill();
    // small trees
    drawTreeAt(ctx, b.x + .35, b.y + 1.55, .8, 2, time);
    drawTreeAt(ctx, b.x + 1.75, b.y + 1.55, .7, 1, time);
    // sports hoop
    const h = iso(b.x + 1.82, b.y + .7);
    line(ctx, { x: h.x, y: h.y }, { x: h.x, y: h.y - 14 }, '#7d8580', 1);
    ctx.strokeStyle = '#e8e2d2'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(h.x + 2, h.y - 13, 2.4, 0, 7); ctx.stroke();
  }

  function drawHospital(ctx, b, time) {
    basePad(ctx, b, '#cdcbc0', '#dad8ce');
    // drive
    poly(ctx, diamondPoints(b.x, b.y + 1.05, 2, .9, .1), '#b8b6ac');
    const g = boxGeo(b.x + .12, b.y + .1, 1.5, 1.05, .04);
    drawBox(ctx, b.x + .12, b.y + .1, 1.5, 1.05, 31, { inset: .04, wall: '#f4f5ef', left: '#d9ddd6', right: '#bfc6bf', top: '#fafbf7' });
    drawWindows(ctx, g.L, g.B, 31, 3, 4, { top: 4, bottom: 6, winW: 3, winH: 4.6, color: '#a7d8e6' });
    drawDoor(ctx, g, 31, '#5b7c86', { w: 7, h: 10, frac: .58 });
    roofLip(ctx, g, 31, '#d3d8d1');
    // red cross billboard
    const c = iso(b.x + 1.05, b.y + .35);
    line(ctx, { x: c.x - 6, y: c.y - 31 }, { x: c.x - 6, y: c.y - 41 }, '#96a09b', 1.1);
    line(ctx, { x: c.x + 6, y: c.y - 31 }, { x: c.x + 6, y: c.y - 41 }, '#96a09b', 1.1);
    poly(ctx, [{ x: c.x - 9, y: c.y - 44 }, { x: c.x + 9, y: c.y - 39 }, { x: c.x + 9, y: c.y - 33 }, { x: c.x - 9, y: c.y - 38 }], '#f7f7f1');
    ctx.fillStyle = '#d64535';
    const q = { x: c.x, y: c.y - 39 };
    poly(ctx, [{ x: q.x - 1.4, y: q.y - 3.4 }, { x: q.x + 1.4, y: q.y - 2.7 }, { x: q.x + 1.4, y: q.y + 2.8 }, { x: q.x - 1.4, y: q.y + 2.1 }], '#d64535');
    poly(ctx, [{ x: q.x - 4, y: q.y - 1.6 }, { x: q.x + 4, y: q.y + .5 }, { x: q.x + 4, y: q.y + 3.2 }, { x: q.x - 4, y: q.y + 1.1 }], '#d64535');
    // ambulance
    const a = iso(b.x + .3, b.y + 1.6);
    ctx.fillStyle = '#f7f8f5'; roundRect(ctx, a.x - 7, a.y - 6, 14, 6, 2); ctx.fill();
    ctx.fillStyle = '#d64535'; ctx.fillRect(a.x - 2, a.y - 6, 4, 2);
    ctx.fillStyle = '#8bb7c4'; ctx.fillRect(a.x + 2, a.y - 5, 3, 2);
    // helipad
    const hp = iso(b.x + 1.55, b.y + 1.7);
    ellipse(ctx, hp.x, hp.y, 9, 4.5, '#cfd2c9', '#f1f3ec', 1);
    ctx.fillStyle = '#f1f3ec'; ctx.font = '700 5px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('H', hp.x, hp.y + 2);
    drawTreeAt(ctx, b.x + 1.83, b.y + 1.4, .7, 1, time);
  }

  // ---------- recreation ----------
  function drawSmallPark(ctx, b, time) {
    const p = diamondPoints(b.x, b.y, 1, 1, .03);
    poly(ctx, p, '#7fc369');
    poly(ctx, diamondPoints(b.x, b.y, 1, 1, .12), '#8ed176');
    // path
    poly(ctx, [iso(b.x + .12, b.y + .62), iso(b.x + .88, b.y + .62), iso(b.x + .88, b.y + .8), iso(b.x + .12, b.y + .8)], '#ddcfad');
    drawTreeAt(ctx, b.x + .38, b.y + .33, .78, 0, time);
    // bench
    const bp = iso(b.x + .65, b.y + .7);
    line(ctx, { x: bp.x - 4, y: bp.y }, { x: bp.x + 3, y: bp.y - 3 }, '#a87647', 2);
    line(ctx, { x: bp.x - 3, y: bp.y - 4 }, { x: bp.x + 3, y: bp.y - 6 }, '#c28f5a', 1.2);
    // flowers
    for (let i = 0; i < 4; i++) {
      const f = iso(b.x + .15 + i * .15, b.y + .86);
      ctx.fillStyle = ['#f2d45a', '#e6738f', '#f6f3e5', '#b57fd0'][i];
      ctx.beginPath(); ctx.arc(f.x, f.y, 1.1, 0, 7); ctx.fill();
    }
  }

  function drawPark(ctx, b, time) {
    poly(ctx, diamondPoints(b.x, b.y, 2, 2, .015), '#6cae59');
    poly(ctx, diamondPoints(b.x, b.y, 2, 2, .09), '#83c56c');
    // diagonal paths
    poly(ctx, [iso(b.x + .15, b.y + .95), iso(b.x + 1.45, b.y + .15), iso(b.x + 1.62, b.y + .24), iso(b.x + .3, b.y + 1.18)], '#e3d5b2');
    poly(ctx, [iso(b.x + .15, b.y + 1.05), iso(b.x + 1.55, b.y + 1.55), iso(b.x + 1.5, b.y + 1.72), iso(b.x + .1, b.y + 1.22)], '#e3d5b2');
    // pond
    const pd = iso(b.x + 1.42, b.y + .62);
    ellipse(ctx, pd.x, pd.y, 21, 10, '#4aa6c1', '#7dd3e6', 1);
    ellipse(ctx, pd.x - 5, pd.y - 2, 6, 3, 'rgba(190,245,255,.25)');
    ctx.fillStyle = '#58a35b';
    for (let i = 0; i < 3; i++) {
      const lx = pd.x - 10 + i * 9, ly = pd.y - 2 + (i % 2) * 3;
      ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#f2a3c0'; ctx.beginPath(); ctx.arc(lx, ly - .6, .8, 0, 7); ctx.fill(); ctx.fillStyle = '#58a35b';
    }
    // trees
    drawTreeAt(ctx, b.x + .35, b.y + .35, 1.05, 0, time);
    drawTreeAt(ctx, b.x + .7, b.y + 1.55, .95, 1, time);
    drawTreeAt(ctx, b.x + 1.72, b.y + 1.5, 1.0, 2, time);
    drawTreeAt(ctx, b.x + 1.74, b.y + 1.02, .75, 1, time);
    // benches
    for (const [gx, gy] of [[b.x + .55, b.y + .85], [b.x + 1.15, b.y + .4]]) {
      const p = iso(gx, gy);
      line(ctx, { x: p.x - 4, y: p.y }, { x: p.x + 3, y: p.y - 3 }, '#a87647', 2);
      line(ctx, { x: p.x - 3, y: p.y - 4 }, { x: p.x + 3, y: p.y - 6 }, '#c28f5a', 1.2);
    }
    // flower clusters
    for (let i = 0; i < 8; i++) {
      const f = iso(b.x + .18 + hash(i, 2) * 1.6, b.y + .18 + hash(i, 5) * 1.6);
      ctx.fillStyle = ['#f2d45a', '#e6738f', '#f6f3e5', '#b57fd0'][i % 4];
      ctx.beginPath(); ctx.arc(f.x, f.y, 1.1, 0, 7); ctx.fill();
    }
    // fence dots
    ctx.fillStyle = 'rgba(50,100,50,.35)';
    for (let i = 0; i < 10; i++) {
      const p = iso(b.x + .05 + i * .21, b.y + .05);
      ctx.beginPath(); ctx.arc(p.x, p.y, .8, 0, 7); ctx.fill();
    }
  }

  function drawPlaza(ctx, b, time) {
    poly(ctx, diamondPoints(b.x, b.y, 2, 2, .015), '#bdb7a7');
    poly(ctx, diamondPoints(b.x, b.y, 2, 2, .06), '#d8d2c2');
    ctx.strokeStyle = 'rgba(120,110,90,.18)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      line(ctx, iso(b.x + i * .5, b.y), iso(b.x + i * .5, b.y + 2), 'rgba(120,110,90,.15)', .8);
      line(ctx, iso(b.x, b.y + i * .5), iso(b.x + 2, b.y + i * .5), 'rgba(120,110,90,.15)', .8);
    }
    // fountain center
    drawFountainAt(ctx, b.x + 1, b.y + 1, 1.15, time);
    // flower beds
    for (let i = 0; i < 4; i++) {
      const gx = b.x + .28 + (i % 2) * 1.4, gy = b.y + .28 + Math.floor(i / 2) * 1.4;
      const p = iso(gx, gy);
      ellipse(ctx, p.x, p.y, 9, 4.5, '#7b6e58', '#9a8c72', .8);
      for (let j = 0; j < 5; j++) {
        ctx.fillStyle = ['#e6738f', '#f2d45a', '#f6f3e5'][j % 3];
        ctx.beginPath(); ctx.arc(p.x - 5 + j * 2.6, p.y - 1 + Math.sin(j) * 1.6, 1, 0, 7); ctx.fill();
      }
    }
    // lamps
    for (const [gx, gy] of [[b.x + .2, b.y + 1.8], [b.x + 1.8, b.y + .2]]) drawLampAt(ctx, gx, gy, time, .9);
    // benches
    for (const [gx, gy] of [[b.x + .55, b.y + 1.5], [b.x + 1.5, b.y + .55]]) {
      const p = iso(gx, gy);
      line(ctx, { x: p.x - 4, y: p.y }, { x: p.x + 3, y: p.y - 3 }, '#a87647', 2);
      line(ctx, { x: p.x - 3, y: p.y - 4 }, { x: p.x + 3, y: p.y - 6 }, '#c28f5a', 1.2);
    }
  }

  function drawFountainAt(ctx, gx, gy, scale, time) {
    const c = iso(gx, gy);
    const s = scale || 1;
    ellipse(ctx, c.x, c.y, 15 * s, 7.5 * s, '#9b9587', '#c4bda9', 1);
    ellipse(ctx, c.x, c.y, 11 * s, 5.3 * s, '#3ba1c4', '#7fd3e4', .8);
    ellipse(ctx, c.x, c.y - 2 * s, 4 * s, 2 * s, '#6fc4d9');
    // spray
    const h = 18 * s;
    ctx.strokeStyle = 'rgba(225,250,255,.65)'; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(c.x + i * 3 * s, c.y - 3 * s);
      ctx.quadraticCurveTo(c.x + i * 5 * s, c.y - h * .7, c.x + i * 1.5 * s, c.y - 2 * s);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(225,250,255,.9)'; ctx.lineWidth = 1.4;
    line(ctx, { x: c.x, y: c.y - 4 * s }, { x: c.x, y: c.y - h }, 'rgba(235,255,255,.9)', 1.6);
    const drop = (time * .35) % 1;
    for (let i = 0; i < 3; i++) {
      const t = (drop + i / 3) % 1;
      ctx.globalAlpha = .55; ctx.fillStyle = '#dffbff';
      ctx.beginPath(); ctx.arc(c.x + Math.sin(t * 7 + i) * 4 * s, c.y - 5 * s - t * h, 1.2, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // center bowl
    ellipse(ctx, c.x, c.y - 4 * s, 3.4 * s, 1.6 * s, '#a7c7c4');
  }

  function drawFountain(ctx, b, time) {
    poly(ctx, diamondPoints(b.x, b.y, 1, 1, .03), '#b9b3a3');
    poly(ctx, diamondPoints(b.x, b.y, 1, 1, .1), '#d4cebd');
    drawFountainAt(ctx, b.x + .5, b.y + .5, 1.15, time);
    // flowers around
    for (let i = 0; i < 5; i++) {
      const f = iso(b.x + .15 + i * .16, b.y + .85);
      ctx.fillStyle = ['#f2d45a', '#e6738f', '#f6f3e5'][i % 3];
      ctx.beginPath(); ctx.arc(f.x, f.y, 1.1, 0, 7); ctx.fill();
    }
  }

  function drawFerris(ctx, b, time) {
    poly(ctx, diamondPoints(b.x, b.y, 2, 2, .015), '#c9c1ac');
    poly(ctx, diamondPoints(b.x, b.y, 2, 2, .08), '#ddd5c1');
    // queue fence
    ctx.globalAlpha = .5;
    for (let i = 0; i < 8; i++) {
      const p = iso(b.x + .2 + i * .18, b.y + 1.78);
      line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y - 3 }, '#8d8a7c', 1);
    }
    ctx.globalAlpha = 1;
    const c = iso(b.x + 1, b.y + 1);
    const hub = { x: c.x, y: c.y - 64 };
    // support legs
    ctx.strokeStyle = '#8d9490'; ctx.lineWidth = 3;
    line(ctx, { x: c.x - 24, y: c.y + 6 }, hub, '#8d9490', 3, null);
    line(ctx, { x: c.x + 24, y: c.y + 6 }, hub, '#8d9490', 3, null);
    line(ctx, { x: c.x - 26, y: c.y + 4 }, { x: c.x + 26, y: c.y + 4 }, '#7e8582', 1.2);
    // booth
    const bp = iso(b.x + .38, b.y + 1.62);
    const gb = { x: bp.x, y: bp.y };
    ctx.fillStyle = '#e8dfc9'; roundRect(ctx, gb.x - 9, gb.y - 14, 18, 14, 2); ctx.fill();
    ctx.fillStyle = '#d9614c'; ctx.beginPath(); ctx.moveTo(gb.x - 11, gb.y - 14); ctx.lineTo(gb.x + 11, gb.y - 14); ctx.lineTo(gb.x + 8, gb.y - 21); ctx.lineTo(gb.x - 8, gb.y - 21); ctx.fill();
    ctx.fillStyle = '#8cc9d6'; ctx.fillRect(gb.x - 5, gb.y - 9, 5, 4);
    // wheel
    const R = 46;
    const rot = time * .35;
    ctx.strokeStyle = '#e3d9bf'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.arc(hub.x, hub.y, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#b9ac8b'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(hub.x, hub.y, R - 5, 0, 7); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = rot + i * Math.PI / 6;
      line(ctx, hub, { x: hub.x + Math.cos(a) * R, y: hub.y + Math.sin(a) * R }, 'rgba(160,150,125,.7)', 1);
    }
    ellipse(ctx, hub.x, hub.y, 5, 5, '#f2c94c', '#9b8238', 1);
    // gondolas
    const cols = ['#e6563d', '#3b8fd4', '#f2c94c', '#4fae62', '#c14b7c', '#f28b3c'];
    for (let i = 0; i < 12; i++) {
      const a = rot + i * Math.PI / 6;
      const gx = hub.x + Math.cos(a) * R, gy = hub.y + Math.sin(a) * R;
      if (Math.sin(a) > -.15) {
        ctx.fillStyle = cols[i % cols.length];
        roundRect(ctx, gx - 4, gy + 1, 8, 5, 1.6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(gx - 2.5, gy + 2, 2, 2);
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = rot + i * Math.PI / 6;
      const gx = hub.x + Math.cos(a) * R, gy = hub.y + Math.sin(a) * R;
      if (Math.sin(a) <= -.15) {
        ctx.fillStyle = cols[i % cols.length];
        roundRect(ctx, gx - 4, gy + 1, 8, 5, 1.6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(gx - 2.5, gy + 2, 2, 2);
      }
    }
    // lights
    if (NIGHT > .25) {
      for (let i = 0; i < 12; i++) {
        const a = rot + i * Math.PI / 6;
        const lx = hub.x + Math.cos(a) * (R + 2), ly = hub.y + Math.sin(a) * (R + 2);
        ctx.globalAlpha = .55; ctx.fillStyle = '#ffe9a0';
        ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = .12; ctx.fillStyle = '#ffd76a';
      ctx.beginPath(); ctx.arc(hub.x, hub.y - 3, R * 1.15, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    // sign
    const sp = iso(b.x + 1.55, b.y + 1.7);
    line(ctx, { x: sp.x, y: sp.y }, { x: sp.x, y: sp.y - 14 }, '#8d9490', 1.4);
    poly(ctx, [{ x: sp.x - 7, y: sp.y - 18 }, { x: sp.x + 7, y: sp.y - 16 }, { x: sp.x + 7, y: sp.y - 10 }, { x: sp.x - 7, y: sp.y - 12 }], '#f6f0dd');
    ctx.fillStyle = '#d9614c'; ctx.beginPath(); ctx.arc(sp.x, sp.y - 14, 2.2, 0, 7); ctx.fill();
  }

  function drawStadium(ctx, b, time) {
    const c = iso(b.x + 1.5, b.y + 1.5);
    const rx = 78, ry = 39;
    // shadow & bowl
    ellipse(ctx, c.x + 2, c.y + 8, rx + 2, ry + 2, 'rgba(20,50,35,.16)');
    ellipse(ctx, c.x, c.y, rx, ry, '#6b7f7c');
    ellipse(ctx, c.x, c.y - 7, rx - 3, ry - 2, '#8b6f4e');
    // stands
    ellipse(ctx, c.x, c.y - 7, rx - 8, ry - 5, '#cf8b4a');
    ellipse(ctx, c.x, c.y - 8, rx - 16, ry - 9, '#e3b269');
    // pitch
    ellipse(ctx, c.x, c.y - 9, rx - 26, ry - 13, '#4e9e52');
    ellipse(ctx, c.x, c.y - 9, rx - 30, ry - 16, '#5cb15f');
    // pitch lines
    ctx.strokeStyle = 'rgba(245,255,240,.66)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 9, 30, 13, 0, 0, 7); ctx.stroke();
    line(ctx, { x: c.x - 30, y: c.y - 9 }, { x: c.x + 30, y: c.y - 9 }, 'rgba(245,255,240,.6)', 1);
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 9, 6, 3, 0, 0, 7); ctx.stroke();
    // stands stripes
    ctx.save();
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 7, rx - 8, ry - 5, 0, 0, 7); ctx.clip();
    ctx.globalAlpha = .16;
    for (let i = -8; i <= 8; i++) {
      line(ctx, { x: c.x + i * 9, y: c.y - 45 }, { x: c.x + i * 9, y: c.y + 20 }, i % 2 ? '#fff' : '#8a3b2a', 3);
    }
    ctx.restore();
    // floodlights
    for (const [sx, sy] of [[-1, -.55], [1, -.55], [-1, .62], [1, .62]]) {
      const px = c.x + sx * (rx - 6), py = c.y - 7 + sy * ry;
      line(ctx, { x: px, y: py }, { x: px, y: py - 34 }, '#7f8a86', 2);
      ctx.fillStyle = '#e8e4d4'; ctx.fillRect(px - 5, py - 38, 10, 4);
      if (NIGHT > .25) {
        ctx.globalAlpha = .5; ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(px, py - 36, 7, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    // flags on top
    flag(ctx, c.x - 24, c.y - 46, 10, time);
    flag(ctx, c.x + 22, c.y - 46, 10, time + 1);
    // entrance
    const e = iso(b.x + 1.5, b.y + 2.45);
    ctx.fillStyle = '#f0e8d5'; ctx.fillRect(e.x - 18, e.y - 8, 36, 8);
    ctx.fillStyle = '#3f6f8a'; ctx.fillRect(e.x - 8, e.y - 7, 16, 7);
    if (NIGHT > .25) { ctx.globalAlpha = .35; ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(e.x, e.y - 8, 26, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  }

  function drawMuseum(ctx, b, time) {
    basePad(ctx, b, '#c9c1ae', '#ded6c4');
    // Broad civic steps and a classical gallery.
    poly(ctx, diamondPoints(b.x + .18, b.y + .32, 1.65, 1.35, .02), '#b8af9d');
    const x = b.x + .2, y = b.y + .18, w = 1.6, h = .95;
    const g = boxGeo(x, y, w, h, .04);
    drawBox(ctx, x, y, w, h, 29, { inset: .04, wall: '#e8dfcb', left: '#cfc2a8', right: '#b5a688', top: '#f5ecd9' });
    // Pillars and the blue museum frieze.
    for (let i = 0; i < 4; i++) {
      const p = iso(x + .22 + i * .38, y + .88);
      line(ctx, { x: p.x, y: p.y - 2 }, { x: p.x, y: p.y - 26 }, '#f7f0df', 3.2);
      line(ctx, { x: p.x + 1.2, y: p.y - 2 }, { x: p.x + 1.2, y: p.y - 26 }, '#b8aa91', .8);
    }
    poly(ctx, [{ x: g.L.x, y: g.L.y - 29 }, { x: g.B.x, y: g.B.y - 29 }, { x: g.B.x, y: g.B.y - 34 }, { x: g.L.x, y: g.L.y - 34 }], '#3e7890');
    poly(ctx, [{ x: g.T.x, y: g.T.y - 29 }, { x: g.R.x, y: g.R.y - 29 }, { x: g.R.x, y: g.R.y - 34 }, { x: g.T.x, y: g.T.y - 34 }], '#548fa2');
    poly(ctx, [{ x: g.T.x, y: g.T.y - 34 }, { x: g.R.x, y: g.R.y - 34 }, { x: (g.T.x + g.R.x) * .5, y: (g.T.y + g.R.y) * .5 - 42 }], '#c5b89f');
    const sign = iso(b.x + 1, b.y + .23);
    ctx.fillStyle = '#f2e7ce'; ctx.font = '700 5px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('MUSEUM', sign.x, sign.y - 34);
    drawDoor(ctx, g, 29, '#765d48', { w: 6, h: 12, frac: .5 });
    // A small sculpture in the front court.
    const statue = iso(b.x + 1, b.y + 1.62);
    ellipse(ctx, statue.x, statue.y + 1, 8, 3.5, '#a99d87');
    line(ctx, { x: statue.x, y: statue.y }, { x: statue.x, y: statue.y - 11 }, '#927c5d', 2.2);
    ellipse(ctx, statue.x, statue.y - 13, 3, 3.5, '#d1b879');
  }

  function drawBusTerminal(ctx, b, time) {
    basePad(ctx, b, '#bfc6c1', '#d2d7cf');
    // Covered passenger bays.
    poly(ctx, diamondPoints(b.x + .08, b.y + .85, 1.82, .9, .06), '#8b9694');
    const x = b.x + .2, y = b.y + .15, w = 1.6, h = .82;
    const g = boxGeo(x, y, w, h, .04);
    drawBox(ctx, x, y, w, h, 21, { inset: .04, wall: '#e7e8df', left: '#c4cec9', right: '#aab8b6', top: '#f3f5ed' });
    drawWindows(ctx, g.L, g.B, 21, 1, 5, { top: 4, bottom: 6, winW: 5, winH: 5, color: '#78b9cf' });
    roofLip(ctx, g, 21, '#3c7183');
    poly(ctx, [{ x: g.L.x, y: g.L.y - 23 }, { x: g.B.x, y: g.B.y - 23 }, { x: g.B.x, y: g.B.y - 28 }, { x: g.L.x, y: g.L.y - 28 }], '#e0a84a');
    drawDoor(ctx, g, 21, '#466879', { w: 5, h: 9, frac: .5 });
    // Two compact buses at the curb.
    for (let i = 0; i < 2; i++) {
      const p = iso(b.x + .55 + i * .78, b.y + 1.5);
      ctx.fillStyle = i ? '#e5a944' : '#4a9eb0';
      roundRect(ctx, p.x - 10, p.y - 9, 20, 8, 2); ctx.fill();
      ctx.fillStyle = '#bfe3e8'; ctx.fillRect(p.x - 7, p.y - 8, 5, 3);
      ctx.fillRect(p.x, p.y - 8, 5, 3);
      ctx.fillStyle = '#39474a';
      ctx.beginPath(); ctx.arc(p.x - 6, p.y, 2, 0, 7); ctx.arc(p.x + 6, p.y, 2, 0, 7); ctx.fill();
    }
    const sign = iso(b.x + 1, b.y + .3);
    ctx.fillStyle = '#fff4d8'; ctx.font = '700 5px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BUS', sign.x, sign.y - 26);
    if (NIGHT > .25) { ctx.globalAlpha = .25; ctx.fillStyle = '#ffe8a0'; ctx.beginPath(); ctx.arc(sign.x, sign.y - 17, 18, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  }

  function drawAirport(ctx, b, time) {
    basePad(ctx, b, '#aebbb2', '#c4cec1');
    // Runway, centerline and threshold markings.
    const runway = diamondPoints(b.x + .18, b.y + 1.35, 4.65, 1.15, .02);
    poly(ctx, runway, '#59636a');
    const start = iso(b.x + .38, b.y + 1.92), end = iso(b.x + 4.62, b.y + 1.92);
    line(ctx, start, end, '#e8e4d4', 1.2);
    for (let i = 0; i < 5; i++) {
      const a = iso(b.x + .38 + i * .13, b.y + 1.52), z = iso(b.x + .38 + i * .13, b.y + 1.78);
      line(ctx, a, z, '#f2efe3', 1.3);
      const aa = iso(b.x + 4.12 + i * .13, b.y + 1.52), zz = iso(b.x + 4.12 + i * .13, b.y + 1.78);
      line(ctx, aa, zz, '#f2efe3', 1.3);
    }
    // Terminal concourse and glass frontage.
    const x = b.x + 1.2, y = b.y + .12, w = 2.45, h = 1.05;
    const g = boxGeo(x, y, w, h, .04);
    drawBox(ctx, x, y, w, h, 27, { inset: .04, wall: '#e5e8e3', left: '#c5cfcc', right: '#aab9bc', top: '#f5f4e9' });
    drawWindows(ctx, g.L, g.B, 27, 2, 6, { top: 5, bottom: 7, winW: 5, winH: 7, color: '#6eb4cf' });
    roofLip(ctx, g, 27, '#43849a');
    drawDoor(ctx, g, 27, '#456b7a', { w: 8, h: 12, frac: .53 });
    const sign = iso(b.x + 2.42, b.y + .25);
    ctx.fillStyle = '#f7f0dc'; ctx.font = '700 6px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('AIRPORT', sign.x, sign.y - 29);
    // Control tower with a glass cab.
    const tower = boxGeo(b.x + 3.72, b.y + .2, .65, .56, .05);
    drawBox(ctx, b.x + 3.72, b.y + .2, .65, .56, 45, { inset: .05, wall: '#d8ddd8', left: '#b7c3c0', right: '#99aaa9', top: '#e9eee7' });
    poly(ctx, [{ x: tower.L.x, y: tower.L.y - 46 }, { x: tower.B.x, y: tower.B.y - 46 }, { x: tower.B.x, y: tower.B.y - 53 }, { x: tower.L.x, y: tower.L.y - 53 }], '#46859a');
    poly(ctx, [{ x: tower.T.x, y: tower.T.y - 46 }, { x: tower.R.x, y: tower.R.y - 46 }, { x: tower.R.x, y: tower.R.y - 53 }, { x: tower.T.x, y: tower.T.y - 53 }], '#63abc1');
    // Simple parked aircraft silhouette.
    const plane = iso(b.x + 4.15, b.y + 3.17);
    poly(ctx, [{ x: plane.x - 20, y: plane.y - 2 }, { x: plane.x + 15, y: plane.y - 4 }, { x: plane.x + 20, y: plane.y - 1 }, { x: plane.x + 13, y: plane.y + 1 }, { x: plane.x - 20, y: plane.y + 2 }], '#f4f2e9');
    poly(ctx, [{ x: plane.x - 2, y: plane.y - 2 }, { x: plane.x + 5, y: plane.y - 12 }, { x: plane.x + 9, y: plane.y - 12 }, { x: plane.x + 5, y: plane.y - 1 }], '#d4d8d2');
    poly(ctx, [{ x: plane.x - 3, y: plane.y + 1 }, { x: plane.x + 4, y: plane.y + 8 }, { x: plane.x + 7, y: plane.y + 8 }, { x: plane.x + 3, y: plane.y + 1 }], '#c4cbc7');
    if (NIGHT > .25) { ctx.globalAlpha = .25; ctx.fillStyle = '#ffeaa3'; ctx.beginPath(); ctx.arc(sign.x, sign.y - 18, 26, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  }

  function drawMonument(ctx, b, time) {
    basePad(ctx, b, '#c8c1ae', '#dad3c0');
    const c = iso(b.x + .5, b.y + .5);
    // plinth
    ellipse(ctx, c.x, c.y + 2, 22, 10, '#a9a190');
    ellipse(ctx, c.x, c.y, 19, 8.5, '#cfc7b3');
    ellipse(ctx, c.x, c.y - 3, 14, 6, '#e2dac6');
    // obelisk
    poly(ctx, [{ x: c.x - 4, y: c.y - 4 }, { x: c.x + 4, y: c.y - 1 }, { x: c.x + 4, y: c.y - 42 }, { x: c.x - 4, y: c.y - 45 }], '#e7dfcd');
    poly(ctx, [{ x: c.x + 4, y: c.y - 1 }, { x: c.x + 8, y: c.y + 1 }, { x: c.x + 8, y: c.y - 39 }, { x: c.x + 4, y: c.y - 42 }], '#bfb6a2');
    poly(ctx, [{ x: c.x - 4, y: c.y - 45 }, { x: c.x + 4, y: c.y - 42 }, { x: c.x, y: c.y - 50 }], '#f2c94c');
    // gold band + emblem
    poly(ctx, [{ x: c.x - 4.4, y: c.y - 18 }, { x: c.x + 4.4, y: c.y - 15 }, { x: c.x + 4.4, y: c.y - 13 }, { x: c.x - 4.4, y: c.y - 16 }], '#d9a83c');
    ctx.fillStyle = '#2f6f9e'; ctx.beginPath(); ctx.arc(c.x, c.y - 28, 2.2, 0, 7); ctx.fill();
    flag(ctx, c.x + 12, c.y + 4, 30, time);
    // hedges
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const px = c.x + Math.cos(a) * 24, py = c.y + Math.sin(a) * 11;
      ctx.fillStyle = '#5b9d56'; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fill();
    }
  }

  // ---------- decor ----------
  function drawTreeAt(ctx, gx, gy, scale, variant, time) {
    const s = scale || 1;
    const c = iso(gx, gy);
    const sway = Math.sin(time * 1.25 + gx * .7 + gy * .4) * .8 * s;
    ellipse(ctx, c.x + 2, c.y + 1, 13 * s, 5.5 * s, 'rgba(25,60,35,.18)');
    line(ctx, { x: c.x, y: c.y + 1 }, { x: c.x + sway * .4, y: c.y - 13 * s }, '#7a5534', 2.4 * s);
    const v = variant == null ? 0 : variant;
    if (v === 1) {
      // pine
      for (let i = 0; i < 3; i++) {
        const yy = c.y - (10 + i * 7) * s;
        const w = (16 - i * 4) * s;
        poly(ctx, [{ x: c.x + sway, y: yy - 14 * s }, { x: c.x + w, y: yy + 4 * s }, { x: c.x - w, y: yy + 4 * s }], i === 0 ? '#3f7d4b' : i === 1 ? '#488b52' : '#559a5d');
      }
    } else if (v === 2) {
      // palm
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * .52;
        const ex = c.x + Math.cos(a) * 20 * s + sway, ey = c.y - 22 * s + Math.sin(a) * 10 * s;
        line(ctx, { x: c.x + sway, y: c.y - 20 * s }, { x: ex, y: ey }, '#3f8b52', 2.4 * s);
        line(ctx, { x: ex, y: ey }, { x: ex + Math.cos(a) * 6 * s, y: ey + 3 * s }, '#4c9e5f', 1.6 * s);
      }
      ctx.fillStyle = '#8a5a34'; ctx.beginPath(); ctx.arc(c.x + sway, c.y - 20 * s, 2.4 * s, 0, 7); ctx.fill();
    } else {
      const blobs = [[0, -24, 11], [-8, -19, 8], [8, -19, 8], [2, -31, 8]];
      for (const [bx, by, br] of blobs) {
        ctx.fillStyle = br > 9 ? '#428a4d' : '#4e9d58';
        ctx.beginPath(); ctx.arc(c.x + bx * s + sway, c.y + by * s, br * s, 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgba(140,220,130,.28)';
      ctx.beginPath(); ctx.arc(c.x - 5 * s + sway, c.y - 27 * s, 5 * s, 0, 7); ctx.fill();
    }
  }
  function drawTree(ctx, b, def, time) {
    const variant = b.variant != null ? b.variant : (hash(b.x, b.y) > .65 ? 2 : hash(b.x + 2, b.y) > .45 ? 0 : 1);
    const scale = .85 + hash(b.x + 7, b.y + 1) * .35;
    drawTreeAt(ctx, b.x + .5, b.y + .5, scale, variant, time);
  }
  function drawFlowers(ctx, b, time) {
    poly(ctx, diamondPoints(b.x, b.y, 1, 1, .04), 'rgba(90,180,100,.22)');
    poly(ctx, diamondPoints(b.x, b.y, 1, 1, .14), '#7cbf66');
    const cols = ['#f2d45a', '#e6738f', '#f8f6ee', '#b57fd0', '#f28b3c'];
    for (let i = 0; i < 9; i++) {
      const p = iso(b.x + .18 + hash(i, b.x) * .64, b.y + .18 + hash(b.y, i + 4) * .64);
      ctx.strokeStyle = '#4f9a52'; ctx.lineWidth = 1;
      line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y - 3 }, '#4f9a52', .8);
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.arc(p.x, p.y - 3.4, 1.5, 0, 7); ctx.fill();
    }
    drawTreeAt(ctx, b.x + .3, b.y + .3, .45, 0, time);
  }
  function drawLampAt(ctx, gx, gy, time, scale) {
    const s = scale || 1;
    const c = iso(gx, gy);
    ellipse(ctx, c.x, c.y + 1, 5 * s, 2 * s, 'rgba(20,50,35,.18)');
    line(ctx, { x: c.x, y: c.y }, { x: c.x, y: c.y - 27 * s }, '#6d7c78', 1.8 * s);
    line(ctx, { x: c.x, y: c.y - 27 * s }, { x: c.x + 6 * s, y: c.y - 29 * s }, '#6d7c78', 1.4 * s);
    ellipse(ctx, c.x + 6 * s, c.y - 29 * s, 2.4 * s, 1.4 * s, NIGHT > .3 ? '#ffe9a0' : '#f8f2d8');
    if (NIGHT > .3) {
      const g = ctx.createRadialGradient(c.x + 6 * s, c.y - 29 * s, 0, c.x + 6 * s, c.y - 29 * s, 22 * s);
      g.addColorStop(0, 'rgba(255,225,140,.4)'); g.addColorStop(1, 'rgba(255,225,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x + 6 * s, c.y - 29 * s, 22 * s, 0, 7); ctx.fill();
    }
  }
  function drawStreetLamp(ctx, b, time) {
    drawLampAt(ctx, b.x + .5, b.y + .5, time, 1.1);
  }
  function drawRock(ctx, b, time) {
    const c = iso(b.x + .5, b.y + .5);
    ellipse(ctx, c.x + 2, c.y + 1, 13, 6, 'rgba(20,50,35,.18)');
    ellipse(ctx, c.x - 3, c.y - 3, 10, 7, '#8f9690');
    ellipse(ctx, c.x + 5, c.y - 1, 7, 5, '#7d857f');
    poly(ctx, [{ x: c.x - 8, y: c.y - 5 }, { x: c.x - 2, y: c.y - 11 }, { x: c.x + 4, y: c.y - 8 }, { x: c.x + 1, y: c.y - 3 }], '#a3aaa3');
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.arc(c.x - 2, c.y - 8, 3, 0, 7); ctx.fill();
  }

  function drawThumbnail(canvas, defId, level) {
    const def = DEFS[defId];
    if (!def) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const lv = level || def.previewLevel || 1;
    const artH = artHeight(def, lv);
    const worldW = (def.w + def.h) * 32;
    const top = -artH, bottom = (def.w + def.h) * 16;
    const worldH = (bottom - top) * 1.1;
    const scale = Math.min((w * .78) / worldW, (h * .82) / worldH);
    const centerX = (def.w - def.h) * 16;
    const centerY = (top + bottom) / 2;
    ctx.setTransform(scale, 0, 0, scale, w / 2 - centerX * scale, h / 2 - centerY * scale);
    const oldNight = NIGHT; NIGHT = 0;
    const gp = diamondPoints(0, 0, def.w, def.h, .03);
    poly(ctx, gp, 'rgba(120,190,100,.22)');
    poly(ctx, diamondPoints(0, 0, def.w, def.h, .11), 'rgba(110,185,92,.35)');
    const fake = { defId, x: 0, y: 0, w: def.w, h: def.h, level: lv, uid: 3, art: artFor(def, lv) };
    if (def.kind === 'road') {
      const thumbWorld = { gridSize: 1, grid: [{ road: true, defId }] };
      drawRoad(ctx, thumbWorld, 0, 0, thumbWorld.grid[0]);
    } else {
      drawObject(ctx, fake, 1.2);
    }
    NIGHT = oldNight;
  }

  const api = {
    iso, isoPts, hash, hash3, clamp, lerp, shade, light, mixColor, poly, line, ellipse, roundRect,
    diamondPoints, tileQuad, drawBox, drawPitchedRoof, drawWindows, drawDoor, drawAwning,
    boxGeo, addVariantColors, drawWorld, drawCar, drawGhost, drawZoneRadius, drawObject,
    drawThumbnail, artFor, artHeight,
    getNight: () => NIGHT, getTime: () => TIME,
    neighbor, isRoad,
    _art: {}
  };
  KK.render = api;
})(window.KK);
