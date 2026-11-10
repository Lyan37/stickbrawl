'use strict';
// ---------- core constants & helpers ----------
const W = 640, H = 360;          // logical (pixel) resolution, upscaled nearest-neighbour
const STEP = 1000 / 60;          // fixed timestep
const D2R = Math.PI / 180;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
function approach(v, target, step) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------- palette (YOMI-style: black void, flat pastel fighters, hot effect colours) ----------
const PAL = {
  bg: '#0b0c0f', floor: '#ffffff', ink: '#ffffff', mid: '#6e6f71', dim: '#37383a', light: '#c5c5c5',
  // no yellow in this game: accent = UI highlight (bright cyan), hot = warm spark/fire tone, hp = HP fill
  accent: '#7fe0ff', hot: '#ff8a5c', hp: '#eef2f7', orange: '#ff7c20', red: '#ff333d', steel: '#6d8696', steelD: '#41525c',
  smear: '#a4c1d5', cyan: '#94e4ff', magenta: '#d540b7', crimson: '#84001f', hpWell: '#000000',
};
const PCOL = ['#ada2ff', '#ff7b81'];   // body
const PBACK = ['#8a7fe0', '#dc5f66'];  // far limbs (one shade darker for depth)
const PDIM = ['#3d3870', '#6d3a3e'];   // afterimages / ghosts
// ---------- pixel drawing (crisp, no anti-aliasing) ----------
const G = {
  ctx: null,
  col(c) { this.ctx.fillStyle = c; },
  rect(x, y, w, h) { this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
  px(x, y, s = 1) { this.ctx.fillRect(Math.round(x), Math.round(y), s, s); },
  line(x0, y0, x1, y1, t = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    const o = Math.floor(t / 2);
    let err = dx + dy, n = 0;
    const ctx = this.ctx;
    for (;;) {
      ctx.fillRect(x0 - o, y0 - o, t, t);
      if ((x0 === x1 && y0 === y1) || n++ > 2000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  },
  disc(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.max(0.5, r);
    if (r < 1) { this.ctx.fillRect(cx, cy, 1, 1); return; }
    r = Math.round(r);
    for (let dy = -r; dy <= r; dy++) {
      const h = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      this.ctx.fillRect(cx - h, cy + dy, h * 2 + 1, 1);
    }
  },
  ring(cx, cy, r, t = 1) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    if (r < 1) return;
    const ri = Math.max(0, r - t);
    for (let dy = -r; dy <= r; dy++) {
      const ho = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      const hi = Math.abs(dy) <= ri ? Math.floor(Math.sqrt(ri * ri - dy * dy) + 0.35) : -1;
      if (hi < 0) { this.ctx.fillRect(cx - ho, cy + dy, ho * 2 + 1, 1); continue; }
      this.ctx.fillRect(cx - ho, cy + dy, ho - hi, 1);
      this.ctx.fillRect(cx + hi + 1, cy + dy, ho - hi, 1);
    }
  },
  // crisp filled polygon (scanline, even-odd), pts = [x0,y0,x1,y1,...]
  poly(pts) {
    const n = pts.length / 2;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) { if (pts[i] < minY) minY = pts[i]; if (pts[i] > maxY) maxY = pts[i]; }
    minY = Math.max(-50, Math.round(minY)); maxY = Math.min(H + 50, Math.round(maxY));
    const xs = [];
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
        if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.round(xs[k]), x1 = Math.round(xs[k + 1]);
        if (x1 > x0) this.ctx.fillRect(x0, y, x1 - x0, 1);
      }
    }
  },
  // thick round-capped segment
  capsule(x0, y0, x1, y1, r) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * r, ny = (dx / l) * r;
    this.poly([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]);
    this.disc(x0, y0, r); this.disc(x1, y1, r);
  },
  // one-piece limb: smooth bezier a→c bowed toward b (no joint), tapering ra→rc.
  // Overlapping convex slices so sharp bends never punch even-odd holes.
  limb(ax, ay, bx, by, cx, cy, ra, rc) {
    const mx = (ax + cx) / 2, my = (ay + cy) / 2;
    const qx = mx + (bx - mx) * 1.6, qy = my + (by - my) * 1.6;
    const len = Math.hypot(bx - ax, by - ay) + Math.hypot(cx - bx, cy - by);
    const n = Math.max(6, Math.ceil(len / 2));
    let px = ax, py = ay, pr = ra;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * ax + 2 * u * t * qx + t * t * cx;
      const y = u * u * ay + 2 * u * t * qy + t * t * cy;
      const r = ra + (rc - ra) * t;
      this.taper(px, py, x, y, pr, r);
      if (i < n) this.disc(x, y, r - 0.5);
      px = x; py = y; pr = r;
    }
    this.disc(ax, ay, ra); this.disc(cx, cy, rc);
  },
  // tapered quad from a (half-width ra) to b (half-width rb)
  taper(x0, y0, x1, y1, ra, rb) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, ux = -dy / l, uy = dx / l;
    this.poly([x0 + ux * ra, y0 + uy * ra, x1 + ux * rb, y1 + uy * rb, x1 - ux * rb, y1 - uy * rb, x0 - ux * ra, y0 - uy * ra]);
  },
  bitmap(rows, x, y, s = 1) {
    x = Math.round(x); y = Math.round(y);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      let start = -1;
      for (let c = 0; c <= row.length; c++) {
        const on = row[c] === '#';
        if (on && start < 0) start = c;
        if (!on && start >= 0) { this.ctx.fillRect(x + start * s, y + r * s, (c - start) * s, s); start = -1; }
      }
    }
  },
};

// ---------- 5x7 proportional bitmap font ----------
// Each glyph is 7 rows of '#'/'.'; its width is the row length (narrow I, 1, punctuation).
// `s` is the pixel scale (1 = 7px cap height). `bold` doubles every stroke horizontally.
const FONT_H = 7;
const FONT_SRC = {
  A: '.###. #...# #...# ##### #...# #...# #...#', B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.', D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####', F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####', H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '### .#. .#. .#. .#. .#. ###', J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#', L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#', N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.', P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#', R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.', T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.', V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.', X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..', Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.', '1': '.#. ##. .#. .#. .#. .#. ###',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####', '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.', '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.', '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.', '9': '.###. #...# #...# .#### ....# ...#. .##..',
  '.': '. . . . . . #', ',': '.. .. .. .. .. .# #.', ':': '. . # . . # .',
  '!': '# # # # # . #', "'": '# # . . . . .', '-': '.... .... .... #### .... .... ....',
  '_': '..... ..... ..... ..... ..... ..... #####',
  '/': '....# ...#. ...#. ..#.. .#... .#... #....', '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....', '=': '.... .... #### .... #### .... ....',
  '>': '#... .#.. ..#. ...# ..#. .#.. #...', '<': '...# ..#. .#.. #... .#.. ..#. ...#',
  '(': '..# .#. #.. #.. #.. .#. ..#', ')': '#.. .#. ..# ..# ..# .#. #..',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##', '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....', ' ': '... ... ... ... ... ... ...',
};
// bold weight is the glyph OR'd with itself shifted 1px right; these would fill in solid,
// so they get hand-drawn bold bitmaps instead (drawn as-is, no shift)
const FONT_BOLD_SRC = {
  M: '##...## ###.### ##.#.## ##.#.## ##...## ##...## ##...##',
  K: '##..## ##.##. ####.. ###... ####.. ##.##. ##..##',
  V: '##...## ##...## ##...## ##...## .##.##. .##.##. ..###..',
  X: '##...## .##.##. ..###.. ..###.. ..###.. .##.##. ##...##',
  Y: '##...## .##.##. ..###.. ...##.. ...##.. ...##.. ...##..',
  N: '##..## ###.## ###.## ##.### ##.### ##..## ##..##',
  W: '##...## ##...## ##.#.## ##.#.## ####### ###.### ##...##',
  '#': '.##.##. .##.##. ####### .##.##. ####### .##.##. .##.##.',
};
const parseGlyphs = (src) => {
  const out = {};
  for (const ch in src) {
    const rows = src[ch].split(' ');
    out[ch] = { w: rows[0].length, rows: rows.map((r) => [...r].map((c) => c === '#')) };
  }
  return out;
};
const FONT = parseGlyphs(FONT_SRC), FONT_BOLD = parseGlyphs(FONT_BOLD_SRC);
// returns [glyph, draw width per lit pixel (in font px), advance (in font px)]
function glyphOf(ch, bold) {
  if (bold && FONT_BOLD[ch]) return [FONT_BOLD[ch], 1, FONT_BOLD[ch].w + 1];
  const g = FONT[ch];
  if (!g) return [null, 0, 4];
  return [g, bold ? 2 : 1, g.w + (bold ? 2 : 1)];
}
function textWidth(str, s = 1, bold = false) {
  str = String(str).toUpperCase();
  let w = 0;
  for (const ch of str) w += glyphOf(ch, bold)[2];
  return Math.max(0, w - 1) * s;
}
function text(str, x, y, s = 1, align = 'left', color, bold = false) {
  str = String(str).toUpperCase();
  if (align === 'center') x -= textWidth(str, s, bold) / 2;
  else if (align === 'right') x -= textWidth(str, s, bold);
  x = Math.round(x); y = Math.round(y);
  const ctx = G.ctx;
  ctx.fillStyle = color || PAL.ink;
  for (const ch of str) {
    const [g, pw, adv] = glyphOf(ch, bold);
    if (g) {
      for (let r = 0; r < FONT_H; r++) {
        const row = g.rows[r];
        for (let c = 0; c < g.w; c++) if (row[c]) ctx.fillRect(x + c * s, y + r * s, pw * s, s);
      }
    }
    x += adv * s;
  }
}

// white pixel text with a black outline (YOMI UI look)
function otext(str, x, y, s = 1, align = 'left', color = '#ffffff', bold = false) {
  const o = Math.max(1, Math.round(s / 2));
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) text(str, x + ox * o, y + oy * o, s, align, '#000000', bold);
  text(str, x, y, s, align, color, bold);
}
