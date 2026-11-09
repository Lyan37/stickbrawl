'use strict';
// ---------- stage scenery: night lake under Mount Fuji, sakura shore, falling petals ----------
// Back to front: night sky (stars, milky way, clouds, moon) → Fuji → mist → pine forest → far sakura
// → mist → shore + near sakura → darken → [fighters] → lake surface (live reflection, moon path, ripples).
// Static art is baked at half resolution and upscaled 2x (chunky pixels, low detail) and re-rolled
// every match by reseedScenery(): sky palette, stars, clouds, moon phase/position, tree variants.

const SCN = {
  skies: [
    { band: ['#03040a', '#05070f', '#070a15', '#0a0e1b', '#0d1222', '#111729', '#151c31', '#1a2238'], fog: '#1b2236' },
    { band: ['#040309', '#07060f', '#0a0916', '#0e0c1d', '#131125', '#18152d', '#1e1a35', '#24203d'], fog: '#211d36' },
    { band: ['#02060a', '#040a10', '#060e16', '#08131c', '#0b1823', '#0f1e2a', '#132431', '#182b39'], fog: '#162630' },
  ],
  star: ['#8d98bb', '#c3cbe3', '#ffffff'],
  cloud: '#10141f', cloudEdge: '#242b42', cloudMoon: '#465174',
  moon: '#dfe5f0', moonCrater: '#b3bccf', moonDark: '#0c1020',
  snowLit: '#b9c4dc', snowMid: '#8e9aba', snowShade: '#6b7698',
  rockLit: '#343d5e', rockMid: '#2a3150', rockShade: '#212741',
  hazeLit: '#2b3250', hazeMid: '#252b46', hazeShade: '#1f243b', gully: '#191e33',
  ridgeFar: '#141a2b',
  forestBack: '#101624', forestFront: '#0b0f1a', bank: '#080b13', dark: '#03040a',
  blooms: [
    ['#5e3658', '#87507a', '#b0729a', '#d398b8', '#ecbfd4'], // pink
    ['#584462', '#846a8a', '#b096b2', '#d7bfd6', '#f0e0ee'], // pale, nearly white under the moon
    ['#4f2a50', '#783f6e', '#a35a8d', '#c97fac', '#e3a8c8'], // deep
  ],
  bloomFar: ['#2e2944', '#3b3454', '#4a4064'],
  trunk: '#1f141c', trunkLit: '#352530', trunkFar: '#1c1a2e',
  petal: ['#e9b7cb', '#c98aa8', '#f5d6e2', '#d9a3bd'],
  waterDeep: '#05080f', surface: '#a9c4e0', surface2: '#3f5d7d',
  ripple: '#24395a', rippleHi: '#7f9fc4', foam: '#8fa9c8', glint: '#c9d6ea',
};

const SKY_H = GROUND_SY;           // sky fills everything above the lake surface
const HW = W / 2, HH = H / 2;      // half-res bake size for the sky
const MTN_W = 640, MTN_H = 120;    // half-res mountain strip (drawn 1280x240)
const MTN_BASE_SY = GROUND_SY - 14;
const FUJI = { half: 222, peak: 92, rim: 15 };

// ---------------- helpers ----------------
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi + yi * 57), b = hash(xi + 1 + yi * 57), c = hash(xi + (yi + 1) * 57), d = hash(xi + 1 + (yi + 1) * 57);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 3) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f + i * 17.3, y * f + i * 9.1) * amp; n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}
function mkRng(seed) { let k = 0; return () => hash(seed * 0.7131 + (k++) * 1.6180339); }
// per-pixel bake: fn(x, y) returns an [r,g,b] or null (transparent); onto `canvas` if given
function bakePixels(w, h, fn, canvas) {
  const c = canvas || document.createElement('canvas');
  if (!canvas) { c.width = w; c.height = h; }
  const cx = c.getContext('2d');
  const img = canvas ? cx.getImageData(0, 0, w, h) : cx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y);
    if (!col) continue;
    const i = (y * w + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return c;
}
function up2(c) {
  const o = document.createElement('canvas');
  o.width = c.width * 2; o.height = c.height * 2;
  const x = o.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}
const pal = (arr, v) => arr[clamp(Math.floor(v * arr.length), 0, arr.length - 1)];

// ---------------- night sky ----------------
function bakeSky(rng, sky, moon) {
  const B = sky.band.map(rgb), FOG = rgb(sky.fog), n = B.length, bandH = (SKY_H / 2) / n;
  const ST = SCN.star.map(rgb), CL = rgb(SCN.cloud), CE = rgb(SCN.cloudEdge), CM = rgb(SCN.cloudMoon);
  const MO = rgb(SCN.moon), MC = rgb(SCN.moonCrater), MD = rgb(SCN.moonDark);
  const sd = rng() * 500;
  const starCut = 0.9935 + rng() * 0.004;
  const cov = rng() * 0.6, cloudY = 30 + rng() * 60;
  const mw = rng() < 0.45 && moon.illum < 0.7;
  const mwX = 60 + rng() * 200, mwA = 0.5 + rng() * 0.8;
  const cos2p = Math.cos(moon.phase * Math.PI * 2);
  const bandCol = (i) => (i >= n ? FOG : B[i]);
  const cloud = (x, y) => (fbm(x * 0.025 + sd, y * 0.09, 3) - 0.5) * 2.6 + Math.exp(-(((y - cloudY) / 9) ** 2)) * 0.9 - 1.05 + cov;

  return up2(bakePixels(HW, HH, (x, y) => {
    let b = Math.min(n - 1, Math.floor(y / bandH));
    if (b + 1 < n && y - b * bandH > bandH - 1 && ((x + y) & 1) === 0) b++; // dithered seam
    const mdx = x - moon.x, mdy = y - moon.y, md = Math.sqrt(mdx * mdx + mdy * mdy);
    if (y < SKY_H / 2 && cov > 0.05 && cloud(x, y) > 0) {
      if (cloud(x, y - 1) <= 0) return md < moon.r * 4 && moon.illum > 0.3 ? CM : CE; // moonlit top edge
      return CL;
    }
    if (md <= moon.r) {
      const nx = mdx / moon.r, ny = mdy / moon.r, w = Math.sqrt(Math.max(0, 1 - ny * ny));
      const lit = moon.phase < 0.5 ? nx > cos2p * w : nx < -cos2p * w;
      if (!lit) return MD;
      return fbm(x * 0.6 + sd, y * 0.6, 2) > 0.6 ? MC : MO;
    }
    // halo around a bright moon
    if (moon.illum > 0.35) {
      if (md < moon.r * 1.8) b += 2;
      else if (md < moon.r * 2.8 && ((x + y) & 1 || md < moon.r * 2.4)) b += 1;
    }
    // milky way: faint dusty band along a random diagonal
    let mwd = 0;
    if (mw) {
      const dist = Math.abs((x - mwX) * Math.sin(mwA) - (y - 60) * Math.cos(mwA));
      mwd = Math.exp(-((dist / 13) ** 2)) * fbm(x * 0.08 + sd, y * 0.08, 3);
      if (mwd > 0.42) b += 2; else if (mwd > 0.3) b += 1;
    }
    if (y < 125 && md > moon.r * 3) {
      const h = hash(x * 7.13 + y * 311.1 + sd);
      if (h > starCut - mwd * 0.02) return ST[h > 0.9996 ? 2 : h > 0.998 ? 1 : 0];
    }
    return bandCol(b);
  }));
}

// ---------------- Fuji: clean planes, snow cap with tapered streaks, hazy lower slopes ----------------
function fujiH(x) {
  const dx = x - MTN_W / 2, a = dx < 0 ? -dx * 1.03 : dx * 0.97;
  if (a >= FUJI.half) return 0;
  const k = 1 - Math.max(0, a - FUJI.rim) / (FUJI.half - FUJI.rim);
  let h = FUJI.peak * Math.pow(k, 1.6);
  if (a < FUJI.rim && (a > 4 && a < 8)) h -= 1; // shallow crater notch
  return Math.max(0, Math.round(h));
}

function bakeMountain(rng, L) {
  const mid = MTN_W / 2, top0 = MTN_H - FUJI.peak;
  const C = {
    snow: [SCN.snowLit, SCN.snowMid, SCN.snowShade].map(rgb),
    rock: [SCN.rockLit, SCN.rockMid, SCN.rockShade].map(rgb),
    haze: [SCN.hazeLit, SCN.hazeMid, SCN.hazeShade].map(rgb),
    g: rgb(SCN.gully), far: rgb(SCN.ridgeFar),
  };
  const s1 = rng() * 6, s2 = rng() * 6, s3 = rng() * 6;
  const gul = [];
  for (let i = 0; i < 13; i++) {
    gul.push({ u: (rng() - 0.5) * 3.4, w: 1.2 + rng() * 2.6, len: 5 + rng() * rng() * 40, off: rng() * 6 - 3, ph: rng() * 6, dr: (rng() - 0.5) * 3 });
  }
  const FH = [], RF = [];
  for (let x = 0; x < MTN_W; x++) {
    const p = (x / MTN_W) * Math.PI * 2; // integer harmonics → tiles seamlessly
    FH.push(fujiH(x));
    RF.push(Math.round(24 + Math.sin(p * 3 + s1) * 7 + Math.sin(p * 7 + s2) * 4 + Math.sin(p * 17 + s3) * 1.5));
  }
  return up2(bakePixels(MTN_W, MTN_H, (x, y) => {
    const hF = FH[x];
    if (hF > 0 && y >= MTN_H - hF) {
      const dx = x - mid, depth = y - top0, u = dx / (depth + 12), uu = u * L;
      // 3 light planes; the edges between them wander instead of following one straight line
      const b = uu + (vnoise(depth * 0.07 + s1, u * 1.5 + s2) - 0.5) * 0.5;
      const tone = b < -0.2 ? 0 : b < 0.3 ? 1 : 2;
      const snowLine = 29 + (vnoise(u * 2.5 + s1, 0.5) - 0.5) * 12 + (vnoise(u * 8 + s2, 2.5) - 0.5) * 5;
      let snow = depth < snowLine, gully = false;
      if (!snow) for (const g of gul) {
        const dd = depth - snowLine - g.off;
        if (dd < 0) continue;
        const px = g.u * (depth + 12) + Math.sin(depth * 0.09 + g.ph) * 1.5 + g.dr * dd / 30; // slight wander
        if (dd < g.len && Math.abs(dx - px) < g.w * Math.pow(1 - dd / g.len, 0.7)) { snow = true; break; }
        if (g.w > 2.2 && dd >= g.len && dd < g.len * 1.6 && Math.abs(dx - px) < 0.6) gully = true;
      }
      if (snow) return C.snow[tone];
      const haze = depth > FUJI.peak * 0.66 + ((x & 1) ? 1 : 0);
      if (haze) return C.haze[tone];
      if (gully) return tone === 0 ? C.rock[1] : C.g;
      return C.rock[tone];
    }
    return y >= MTN_H - RF[x] ? C.far : null;
  }));
}

// ---------------- sakura: random variants each match ----------------
function bakeTree(rng, far, L) {
  const s = far ? 0.45 + rng() * 0.15 : 0.7 + rng() * 0.35;
  const shape = Math.floor(rng() * 3);           // 0 round, 1 wide/spreading, 2 tall/upright
  const spread0 = shape === 1 ? 2.3 + rng() * 0.3 : shape === 2 ? 1.3 + rng() * 0.3 : 1.8 + rng() * 0.3;
  const squash = shape === 1 ? 0.65 : shape === 2 ? 1.0 : 0.8;
  const lean = (rng() - 0.5) * 0.5;
  const trunkLen = (shape === 2 ? 24 : 18 + rng() * 6) * s;
  const P = (far ? SCN.bloomFar : SCN.blooms[Math.floor(rng() * SCN.blooms.length)]).map(rgb);
  const w = Math.round(110 * s), h = Math.round(90 * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const segs = [], tips = [];
  (function grow(x, y, ang, len, th, depth) {
    const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
    segs.push([x, y, x1, y1, th, depth]);
    if (depth >= 2) tips.push([(x + x1) / 2, (y + y1) / 2]);
    if (depth >= 3) { tips.push([x1, y1]); return; }
    const kids = depth === 0 ? 2 + (rng() > 0.4 ? 1 : 0) : 2 + (rng() > 0.6 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const spread = (k / (kids - 1) - 0.5) * (depth === 0 ? spread0 : 1.2);
      const a = ang + spread + (rng() - 0.5) * 0.5;
      grow(x1, y1, a * 0.82 - Math.PI / 2 * 0.18, len * (0.6 + rng() * 0.2), Math.max(1, th * 0.6), depth + 1);
    }
  })(w / 2, h - 1, -Math.PI / 2 + lean, trunkLen, 3.5 * s + 0.5, 0);

  const drawSegs = (filter, frac) => {
    const main = G.ctx;
    G.ctx = c.getContext('2d');
    for (const [x0, y0, x1, y1, th, dp] of segs) {
      if (!filter(dp)) continue;
      const f = frac(dp);
      G.col(far ? SCN.trunkFar : SCN.trunk);
      G.line(x0, y0, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.max(1, Math.round(th)));
    }
    G.ctx = main;
  };
  drawSegs(() => true, () => 1);

  const cl = tips.map(([x, y]) => ({ x, y, r: (5 + rng() * 4) * s * (shape === 1 ? 1.15 : 1) }));
  let top = Infinity, bot = -Infinity;
  for (const q of cl) { top = Math.min(top, q.y - q.r); bot = Math.max(bot, q.y + q.r); }
  const fq = 0.2 / s, sd = rng() * 300;
  bakePixels(w, h, (x, y) => {
    let best = -9, bq = null;
    for (const q of cl) {
      const ex = (x - q.x) / q.r, ey = (y - q.y) / (q.r * squash);
      const v = 1 - Math.sqrt(ex * ex + ey * ey);
      if (v > best) { best = v; bq = q; }
    }
    if (best < -0.5) return null;
    const nz = fbm(x * fq + sd, y * fq, 2);
    if (best + (nz - 0.5) * 0.7 < 0.05) return null;
    const lx = ((x - bq.x) / bq.r) * L, ly = (y - bq.y) / bq.r;
    const tone = 0.6 - lx * 0.25 - ly * 0.3 + (nz - 0.5) * 0.45 - ((y - top) / (bot - top)) * 0.35;
    return pal(P, tone);
  }, c);
  drawSegs((dp) => dp <= 1, (dp) => (dp === 0 ? 1 : 0.6)); // trunk + limbs show through
  return up2(c);
}

// ---------------- per-match stage roll ----------------
let STAGE = null;
function reseedScenery(seed = Math.random() * 1e4) {
  const rng = mkRng(seed);
  const sky = SCN.skies[Math.floor(rng() * SCN.skies.length)];
  const phase = 0.08 + rng() * 0.84;
  const side = rng() < 0.5 ? -1 : 1;
  const moon = {
    phase, illum: (1 - Math.cos(phase * Math.PI * 2)) / 2, r: 6 + Math.round(rng() * 3),
    x: Math.round(HW / 2 + side * (55 + rng() * 75)), y: Math.round(34 + rng() * 26),
  };
  const L = moon.x < HW / 2 ? 1 : -1; // 1 = moonlight from the left
  STAGE = {
    seed, sky, moon, L,
    skyBuf: bakeSky(rng, sky, moon),
    mtnBuf: bakeMountain(rng, L),
    near: Array.from({ length: 7 }, () => bakeTree(rng, false, L)),
    far: Array.from({ length: 5 }, () => bakeTree(rng, true, L)),
  };
}
reseedScenery();

// ---------------- parallax layers (drawn every frame) ----------------
function hillY(wx, amp, seed) {
  return Math.sin(wx * 0.006 + seed) * amp + Math.sin(wx * 0.017 + seed * 2.3) * amp * 0.45;
}

function drawHills(par, baseY, amp, seed, col) {
  const ox = Math.round(Cam.x * par / 2) * 2;
  G.col(col);
  for (let x = 0; x < W; x += 2) {
    const y = Math.round((baseY + hillY(x + ox, amp, seed)) / 2) * 2;
    G.rect(x, y, 2, H - y);
  }
}

// jagged pine treeline in 2px columns
function drawForest(par, baseY, tall, seed, col) {
  const ox = Math.round(Cam.x * par / 2) * 2;
  G.col(col);
  for (let x = 0; x < W; x += 2) {
    const wx = x + ox, i0 = Math.floor(wx / 12);
    let best = 0;
    for (let j = i0 - 1; j <= i0 + 1; j++) {
      const cx = j * 12 + hash(j * 3.1 + seed) * 6;
      const hh = tall * (0.45 + hash(j * 1.7 + seed) * 0.65) + hillY(cx, 4, seed) - Math.abs(wx - cx) * 1.8;
      if (hh > best) best = hh;
    }
    const y = Math.round((baseY - best) / 2) * 2;
    G.rect(x, y, 2, H - y);
  }
}

// trees on a wide world-space grid, small jitter so neighbours never crowd each other
function drawTreeRow(par, spacing, baseY, set, salt, skip) {
  const ox = Math.round(Cam.x * par / 2) * 2;
  const i0 = Math.floor((ox - 200) / spacing), i1 = Math.ceil((ox + W + 200) / spacing);
  const sd = STAGE.seed * 0.01 + salt;
  for (let i = i0; i <= i1; i++) {
    if (hash(i * 1.13 + sd) < skip) continue;
    const wx = i * spacing + (hash(i * 4.7 + sd) - 0.5) * spacing * 0.35;
    const tr = set[Math.floor(hash(i * 2.3 + sd) * set.length)];
    ctx.drawImage(tr, Math.round((wx - ox - tr.width / 2) / 2) * 2, baseY - tr.height + 2);
  }
}

// horizontal mist bands that thicken toward the horizon
function drawMist(bottom, height, alpha, col) {
  G.col(col);
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = alpha * (1 - i / 6);
    G.rect(0, bottom - (i + 1) * height / 6, W, height / 6);
  }
  ctx.globalAlpha = 1;
}

// falling petals: stateless (pure function of time + index), wind drift, flutter
function drawPetals(t, n, layer) {
  const near = layer === 1;
  for (let i = 0; i < n; i++) {
    const k = i + layer * 500;
    const speed = (near ? 0.55 : 0.3) + hash(k * 1.7) * 0.35;
    const period = H + 40;
    const y = ((hash(k * 2.9) * period + t * speed) % period) - 20;
    const drift = t * (near ? 0.5 : 0.3) * (0.6 + hash(k * 3.3) * 0.6);
    const sway = Math.sin(t * 0.035 + k) * (8 + hash(k * 5.5) * 10);
    let x = (hash(k * 7.1) * (W + 80) - drift - Cam.x * (near ? 0.9 : 0.35) + sway) % (W + 80);
    if (x < 0) x += W + 80;
    x -= 40;
    const flip = Math.sin(t * 0.09 + k * 2.1);
    const sz = near ? 3 : 2;
    G.col(SCN.petal[Math.floor(hash(k * 9.7) * SCN.petal.length)]);
    const w = Math.max(1, Math.round(Math.abs(flip) * sz));
    G.rect(x, y, w, sz - (Math.abs(flip) < 0.3 ? 1 : 0));
  }
}

// full backdrop behind the fighters (the lake is drawn after them, see drawWater)
function drawScenery(t) {
  const S = STAGE, oy = Cam.oy, fog = S.sky.fog;
  ctx.drawImage(S.skyBuf, 0, 0);

  let mx = Math.round((W / 2 - MTN_W - Cam.x * 0.04) / 2) * 2 % (MTN_W * 2);
  if (mx > 0) mx -= MTN_W * 2;
  const my = Math.round((MTN_BASE_SY - MTN_H * 2 + oy * 0.15) / 2) * 2;
  for (let x = mx; x < W; x += MTN_W * 2) ctx.drawImage(S.mtnBuf, x, my);
  drawMist(GROUND_SY + oy * 0.2, 150, 0.55, fog);

  drawPetals(t, 30, 0);
  drawForest(0.12, Math.round(GROUND_SY - 20 + oy * 0.2), 18, 2.3, SCN.forestBack);
  drawForest(0.18, Math.round(GROUND_SY - 14 + oy * 0.25), 12, 6.1, SCN.forestFront);
  drawTreeRow(0.3, 150, Math.round(GROUND_SY - 10 + oy * 0.35), S.far, 3.1, 0.3);
  drawMist(GROUND_SY + oy * 0.4, 60, 0.5, fog);

  drawHills(0.65, GROUND_SY - 6 + oy * 0.7, 2, 4.2, SCN.bank);
  drawTreeRow(0.65, 330, Math.round(GROUND_SY - 4 + oy * 0.7), S.near, 8.9, 0.3);

  // push the whole backdrop down so the fighters pop
  ctx.globalAlpha = 0.22; G.col(SCN.dark); G.rect(0, 0, W, H); ctx.globalAlpha = 1;
}

// ---------------- lake: the fight happens on the water surface ----------------
const reflBuf = document.createElement('canvas');
reflBuf.width = W; reflBuf.height = H;
const reflCtx = reflBuf.getContext('2d');

function waterRing(cx, cy, rx, ry) {
  const n = Math.max(12, Math.round(rx * 1.6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    G.px(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
}

// call after fighters/fx are drawn: mirrors everything above the surface into the lake
function drawWater(t, fighters) {
  const gy = Math.round(Cam.sy(0));
  if (gy >= H) return;
  reflCtx.clearRect(0, 0, W, H);
  reflCtx.drawImage(ctx.canvas, 0, 0);
  G.col(SCN.waterDeep); G.rect(0, gy, W, H - gy);

  // faint wobbly mirror in 2px rows, fading out with depth
  const depthH = H - gy;
  for (let y = gy + 2; y < H; y += 2) {
    const d = y - gy, sy = gy - d;
    if (sy < 0) break;
    ctx.globalAlpha = 0.07 * (1 - d / depthH) ** 1.5;
    const amp = Math.min(2, 0.5 + d * 0.03);
    const off = Math.round(Math.sin(d * 0.35 - t * 0.06) * amp) * 2;
    ctx.drawImage(reflBuf, 0, sy, W, 2, off, y, W, 2);
  }
  ctx.globalAlpha = 1;

  // moon path: shimmering dashes straight below the moon
  const M = STAGE.moon;
  if (M.illum > 0.25) {
    const mx = M.x * 2 + 1;
    G.col(SCN.glint);
    for (let y = gy + 4; y < H; y += 3) {
      const k = (y - gy) / (H - gy);
      if (hash(y * 0.73 + Math.floor(t / 8)) > 0.55) continue;
      const len = Math.round((2 + hash(y * 1.9 + Math.floor(t / 8)) * 6) * (0.5 + k) * M.illum);
      ctx.globalAlpha = 0.35 + M.illum * 0.4;
      G.rect(mx - len + Math.sin(y + t * 0.05) * 2, y, len * 2, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ripple dashes (longer further down = closer to the viewer)
  const span = W + 60;
  for (let i = 0; i < 24; i++) {
    const ph = Math.sin(t * 0.025 + i * 1.9);
    if (ph < 0.2) continue;
    const ry = gy + 4 + Math.floor(hash(i * 3.3) * (H - gy - 4) / 2) * 2;
    const dk = (ry - gy) / (H - gy + 1);
    const len = Math.round(4 + dk * 14 + hash(i * 5.1) * 6);
    let rx = (hash(i * 7.7) * span - Cam.x * (0.8 + dk * 0.4) + t * 0.12) % span;
    if (rx < 0) rx += span;
    G.col(ph > 0.7 ? SCN.rippleHi : SCN.ripple); G.rect(rx - 30, ry, len, 1);
  }

  // a few petals floating on the surface
  for (let i = 0; i < 10; i++) {
    const ry = gy + 4 + Math.floor(hash(i * 2.1 + 40) * Math.min(50, H - gy - 5));
    let rx = (hash(i * 6.3 + 40) * span - Cam.x + t * 0.06 * (0.5 + hash(i * 1.3))) % span;
    if (rx < 0) rx += span;
    G.col(SCN.petal[i % SCN.petal.length]);
    G.rect(rx - 30 + Math.sin(t * 0.02 + i) * 2, ry, 2, 1);
  }

  // rings spreading from the feet of anyone standing on the water
  if (fighters) for (const f of fighters) {
    if (!f.ground) continue;
    for (let k = 0; k < 2; k++) {
      const ph = ((t + f.id * 17 + k * 30) % 60) / 60;
      ctx.globalAlpha = (1 - ph) * 0.8;
      G.col(SCN.foam);
      waterRing(Cam.sx(f.x), gy + 2, (5 + ph * 20) * Cam.z, (1 + ph * 3) * Cam.z);
    }
    ctx.globalAlpha = 1;
  }

  // surface line + world-anchored ruler ticks (endless scroll)
  G.col(SCN.surface); G.rect(0, gy, W, 1);
  G.col(SCN.surface2); G.rect(0, gy + 1, W, 1);
  const x0 = Cam.x - W / 2 / Cam.z - 60, x1 = Cam.x + W / 2 / Cam.z + 60;
  ctx.globalAlpha = 0.5;
  for (let wx = Math.floor(x0 / 50) * 50; wx < x1; wx += 50) {
    const big = wx % 500 === 0;
    G.col(SCN.surface); G.rect(Cam.sx(wx), gy + 2, 1, big ? 12 : 6);
    if (big) text(Math.abs(wx / 50) + '', Cam.sx(wx) + 4, gy + 8, 1, 'left', SCN.surface2);
  }
  ctx.globalAlpha = 1;
}
