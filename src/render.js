'use strict';
// ---------- rendering (YOMI-style): ruler floor, flat pastel silhouettes; stage art lives in scenery.js ----------
const GROUND_SY = H - 84;

const Cam = {
  x: 0, z: 1, oy: 0, shakeX: 0, shakeY: 0,
  sx(x) { return W / 2 + (x - this.x) * this.z + this.shakeX; },
  sy(y) { return GROUND_SY + this.oy + y * this.z + this.shakeY; },
};

// offscreen buffer used to slice afterimages into offset horizontal strips
const ghostBuf = document.createElement('canvas');
ghostBuf.width = W; ghostBuf.height = H;
const ghostCtx = ghostBuf.getContext('2d');

// ---------------- background ----------------
function drawBackground(t, speed) {
  drawScenery(t);

  // speed lines during big launches, angled along the launch direction
  if (speed && speed.t > 0) {
    const c = Math.cos(speed.ang), s = Math.sin(speed.ang), n = 18;
    for (let i = 0; i < n; i++) {
      const seed = hash(i * 9.1 + Math.floor(t / 2) * 1.37);
      const px = hash(seed * 77) * (W + 200) - 100, py = hash(seed * 31) * H;
      const len = 40 + hash(seed * 13) * 120;
      G.col(i % 3 ? PAL.dim : PAL.mid);
      G.line(px - c * len, py - s * len, px + c * len, py + s * len, 1);
    }
  }

  // the floor (lake surface + ruler) is drawn after the fighters by drawWater() in scenery.js
}

// ---------------- weapons (steel grey-blue) ----------------
function drawWeapon(type, hx, hy, d, z, fs, opts) {
  const n = [-d[1], d[0]];
  const P = (a, b) => [hx + d[0] * a * z + n[0] * b * z * fs, hy + d[1] * a * z + n[1] * b * z * fs];
  const poly = (...pts) => G.poly(pts.flat());
  const L = (a, b, t) => G.line(a[0], a[1], b[0], b[1], Math.max(1, Math.round(t * z)));
  switch (type) {
    case 'sword': {
      // katana: long two-hand grip with wrap ticks, round tsuba, slim curved single-edge blade
      G.col(PAL.steelD); L(P(-7, 0), P(0, 0), 2);
      G.col(PAL.steel); for (const a of [-5.5, -3.5, -1.5]) L(P(a - 0.6, -0.9), P(a + 0.6, 0.9), 1);
      G.col(PAL.steelD); G.disc(...P(0.3, 0), 2.1 * z);
      G.col(PAL.steel);
      poly(P(1, -0.9), P(5, -1), P(9, -1.25), P(13, -1.7), P(15, -2), P(18, -2.6),
        P(15.5, -0.05), P(13, 0.2), P(9, 0.65), P(5, 0.9), P(1, 1));
      G.col(PAL.light); L(P(2, 0.75), P(9, 0.45), 1); L(P(9, 0.45), P(15, -0.25), 1);   // hamon along the edge
      break;
    }
    case 'staff': {
      // shaolin staff: long wooden pole, steel ferrules on both ends, held off-centre
      const sh = Math.max(2, Math.round(2 * z));
      G.col('#6c4f3c'); L(P(-18, 0), P(30, 0), 2);                     // shaded wood
      G.col('#a07a5a'); L(P(-18, -0.5), P(30, -0.5), 1);               // lit edge of the grain
      G.col(PAL.steel); G.disc(...P(-17.5, 0), sh * 0.75); G.disc(...P(29.5, 0), sh * 0.75);
      G.col(PAL.steelD); L(P(-15, 0), P(-14, 0), 2.6); L(P(26, 0), P(27, 0), 2.6);   // ferrule rings
      break;
    }
    case 'greatsword':
      G.col(PAL.steelD); L(P(-6, 0), P(0, 0), 2.5); L(P(0, -5), P(0, 5), 2.5);
      G.col(PAL.steel); poly(P(1, -2.4), P(22, -2.4), P(27, 0), P(22, 2.4), P(1, 2.4));
      break;
    case 'scythe': {
      G.col(PAL.steelD); L(P(-9, 0), P(34, 0), 1.6);
      // curved blade hooks back from the top of the shaft
      G.col(PAL.steel);
      poly(P(33, -1), P(36, 3), P(32, 11), P(24, 17), P(16, 19), P(25, 12), P(30, 5));
      break;
    }
    case 'bow': {
      // opts.draw (0..1): string pulled back with an arrow nocked, limbs flexing; opts.vib: frames since release (string twang)
      const k = (opts && opts.draw) || 0, tipA = -1 - 2.5 * k, span = 12 * (1 - 0.1 * k);
      G.col(PAL.steel);
      let prev = null;
      for (let i = -4; i <= 4; i++) {
        const s = i / 4, pt = P(3 + k - (4 + 3.5 * k) * s * s, s * span);
        if (prev) L(prev, pt, Math.abs(i) < 3 ? 2 : 1.4);
        prev = pt;
      }
      const top = P(tipA, -span), bot = P(tipA, span);
      const str = (m) => { G.line(top[0], top[1], m[0], m[1], 1); G.line(m[0], m[1], bot[0], bot[1], 1); };
      G.col(PAL.light);
      if (opts && opts.draw != null) {
        const a = bowPull(k), nock = P(a, 0);
        str(nock);
        L(nock, P(a + 17, 0), 1);
        G.col(PAL.ink); poly(P(a + 20, 0), P(a + 16.5, -1.8), P(a + 16.5, 1.8));
        G.col(opts.col || PAL.light); L(P(a + 2, 0), P(a - 0.5, -2.2), 1); L(P(a + 2, 0), P(a - 0.5, 2.2), 1);
      } else if (opts && opts.vib != null) {
        const v = opts.vib;
        str(P(tipA + Math.sin(v * 2.3) * 3.5 * (1 - v / 8), 0));
      } else str(P(tipA, 0));
      break;
    }
    case 'axe': {
      // short double-bit axe: stubby haft, two mirrored flared blades either side of the eye
      G.col(PAL.steelD); L(P(-4, 0), P(20, 0), 1.8);
      for (const s of [1, -1]) {
        G.col(PAL.steel);
        poly(P(13.5, s), P(11, 5 * s), P(9.5, 9 * s), P(12, 10.5 * s), P(15, 11 * s), P(18, 10.5 * s), P(20.5, 9 * s), P(19, 5 * s), P(16.5, s));
        G.col(PAL.light);   // bright cutting edge
        L(P(10, 9.2 * s), P(12, 10.6 * s), 1); L(P(12, 10.6 * s), P(18, 10.6 * s), 1); L(P(18, 10.6 * s), P(20, 9.2 * s), 1);
      }
      G.col(PAL.steelD); L(P(13, 0), P(17, 0), 2.6);   // eye / collar
      break;
    }
    case 'lance': {
      // rocket lance: tapered cone, nozzle at the back
      G.col(PAL.steelD); L(P(-10, 0), P(-4, 0), 4); L(P(-1, -3), P(-1, 3), 2);
      G.col(PAL.steel); poly(P(0, -3.4), P(30, -0.6), P(31, 0), P(30, 0.6), P(0, 3.4));
      G.col(PAL.smear); L(P(4, -1), P(22, -0.3), 1);
      break;
    }
    case 'gauntlets':
      G.col(PAL.steel); G.disc(...P(0, -3), 3.6 * z); G.disc(...P(6, 3), 3.6 * z);
      G.col(PAL.steelD); G.rect(P(0, -3)[0] - 1, P(0, -3)[1] - 1, 2, 2);
      break;
  }
}

// ---------------- fighters: flat filled blob-figures ----------------
function drawBody(sk, z, front, back, jx = 0, jy = 0, noBack = false) {
  const X = (p) => Cam.sx(p[0]) + jx, Y = (p) => Cam.sy(p[1]) + jy;
  const r = 2.3 * z, cap = (a, b, rr = r) => G.capsule(X(a), Y(a), X(b), Y(b), rr);
  // one-piece leg: hip → foot curve bowed by the spring-lagged bend point, no knee joint
  const leg = (bend, foot) => G.limb(X(sk.hip), Y(sk.hip), X(bend), Y(bend), X(foot), Y(foot), 3.3 * z, 2.6 * z);
  if (!noBack) {
    G.col(back);
    cap(sk.neck, sk.elbowB); cap(sk.elbowB, sk.handB); G.disc(X(sk.handB), Y(sk.handB), 2.7 * z);
    leg(sk.bendB || sk.kneeB, sk.footB);
  }
  G.col(front);
  // one-piece torso bowed through the spring-lagged spine point (falls back to straight)
  if (sk.spine) G.limb(X(sk.hip), Y(sk.hip), X(sk.spine), Y(sk.spine), X(sk.neck), Y(sk.neck), 3.4 * z, 4.6 * z);
  else G.taper(X(sk.hip), Y(sk.hip), X(sk.neck), Y(sk.neck), 3.4 * z, 4.6 * z);
  G.disc(X(sk.hip), Y(sk.hip), 3.2 * z);
  leg(sk.bendA || sk.kneeA, sk.footA);
  // narrow neck pinch, round head
  const nx = lerp(X(sk.neck), X(sk.head), 0.5), ny = lerp(Y(sk.neck), Y(sk.head), 0.5);
  G.disc(nx, ny, 2.2 * z);
  G.disc(X(sk.head), Y(sk.head), 5 * z);
  return { X, Y, cap };
}

// ---------------- scarf ----------------
// P1 (lavender) wears red, P2 (coral) wears blue: same pastel lightness family as the bodies,
// one step deeper so the cloth reads as its own shape. [main, shade (short back tail)]
const SCARF_COL = [['#ff5c70', '#d24259'], ['#62aaff', '#4482d8']];
function scarfCols(f, white) {
  if (white) return ['#ffffff', '#e6e6e6'];
  if (f.kill && f.kill.charred) return ['#46444c', '#323138'];
  return SCARF_COL[f.id];
}

// tails as one smooth strip each (back tail first, darker); tails = [[x,y]...] per tail, world space
function drawScarfTails(tails, z, main, shade, jx = 0, jy = 0) {
  for (let j = tails.length - 1; j >= 0; j--) {
    const p = tails[j], n = p.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
      const k = i / (n - 1), w = (2.3 - 0.5 * k + (i === n - 1 ? 0.3 : 0)) * z;   // slight flare at the end
      const x = Cam.sx(p[i][0]) + jx, y = Cam.sy(p[i][1]) + jy, nx = (-dy / dl) * w, ny = (dx / dl) * w;
      L.push(x + nx, y + ny); R.unshift(x - nx, y - ny);
    }
    G.col(j ? shade : main);
    G.poly(L.concat(R));
  }
}

// muffler band wrapped across the lower head (arms hang from the neck point in this rig, so a wrap
// at neck height would read as an armpit strap), plus the knot at the back the tails hang from
function drawScarfCollar(sk, z, main, s, knot, facing) {
  const n = sk.neck, h = sk.head, ux = h[0] - n[0], uy = h[1] - n[1], l = Math.hypot(ux, uy) || 1;
  const bx = (uy / l) * facing, by = (-ux / l) * facing;          // toward the back
  const c = [n[0] + (ux / l) * 1.7, n[1] + (uy / l) * 1.7];      // band centre, just above the neck point
  const a = [c[0] + bx * 2.6, c[1] + by * 2.6], b = [c[0] - bx * 2.3, c[1] - by * 2.3];
  G.col(main);
  G.capsule(s.X(a), s.Y(a), s.X(b), s.Y(b), 1.9 * z);
  G.disc(s.X(knot), s.Y(knot), 2.4 * z);
}

function drawFrontArm(sk, z, col, s) {
  G.col(col);
  s.cap(sk.neck, sk.elbowA); s.cap(sk.elbowA, sk.handA);
  G.disc(s.X(sk.handA), s.Y(sk.handA), 2.7 * z);
}

function drawGhost(g, f) {
  // YOMI-style afterimage: dim copy sliced into horizontal strips, each nudged sideways
  const xs = [], ys = [];
  for (const k in g.sk) if (k !== 'wdir') { xs.push(Cam.sx(g.sk[k][0])); ys.push(Cam.sy(g.sk[k][1])); }
  const bx = Math.floor(Math.min(...xs) - 12), by = Math.floor(Math.min(...ys) - 12);
  const bw = Math.ceil(Math.max(...xs) - bx + 24), bh = Math.ceil(Math.max(...ys) - by + 24);
  const main = G.ctx;
  G.ctx = ghostCtx;
  ghostCtx.clearRect(bx, by, bw, bh);
  if (g.scarf) drawScarfTails(g.scarf, Cam.z, PDIM[f.id], PDIM[f.id]);
  const gs = drawBody(g.sk, Cam.z, PDIM[f.id], PDIM[f.id]);
  if (g.scarf) drawScarfCollar(g.sk, Cam.z, PDIM[f.id], gs, g.scarf[0][0], f.facing);
  const s = drawBody.lastS;
  G.ctx = main;
  const fade = 1 - g.age / 12;
  main.globalAlpha = Math.max(0, fade);
  const strip = 3;
  for (let y = by; y < by + bh; y += strip) {
    const off = Math.round((hash(y * 0.71 + g.seed) - 0.5) * 10 * (1 - fade + 0.4));
    main.drawImage(ghostBuf, bx, y, bw, strip, bx + off, y, bw, strip);
  }
  main.globalAlpha = 1;
  return s;
}

function drawSmear(f) {
  const tr = f.trail;
  if (tr.length < 2) return;
  const n = tr.length, outer = [], inner = [];
  for (let i = 0; i < n; i++) {
    const e = tr[i], k = i / (n - 1);               // 0 = oldest, 1 = newest
    const ax = Cam.sx(e.a[0]), ay = Cam.sy(e.a[1]), bx = Cam.sx(e.b[0]), by = Cam.sy(e.b[1]);
    outer.push(bx, by);
    inner.unshift(lerp(bx, ax, 0.25 + 0.75 * k), lerp(by, ay, 0.25 + 0.75 * k)); // thin tail, full width at the head
  }
  const unarmed = !f.weapon || !f.wpn.len;
  G.col(unarmed ? '#e9e6ff' : PAL.smear);
  if (unarmed && f.id === 1) G.col('#ffe1e2');
  G.poly(outer.concat(inner));
  if (f.move && f.move.heavy) {
    G.col(PAL.cyan);
    for (let i = 2; i < outer.length; i += 2) G.line(outer[i - 2], outer[i - 1], outer[i], outer[i + 1], 1);
  }
}

// ---------------- bow draw ----------------
// nock point along the bow axis (behind the grip) for a draw amount k
const bowPull = (k) => -1 - 12 * k;

// { draw: 0..1 } from nocking to the release frame of an arrow shot, then { vib: frames } while the string twangs
function bowState(f) {
  if (f.weapon !== 'bow') return null;
  const p = f.part;
  if (f.state === 'attack' && f.rf < 0 && p && p.proj && !p.fall) {
    const rel = p.s + (p.proj[0].f || 0);
    if (f.af < rel) return { draw: easeOut(clamp((Math.max(0, f.af) + 1) / rel, 0, 1)), col: PCOL[f.id] };
  }
  const v = f.clock - f.bowShot;
  return v >= 0 && v < 8 ? { vib: v } : null;
}

// two-bone IK for the back (draw) arm: hand on tgt, elbow flared out behind, away from the bow direction d
function armIK(root, tgt, d) {
  const l1 = BONE.upper, l2 = BONE.fore, reach = l1 + l2 - 0.05;
  const dx = tgt[0] - root[0], dy = tgt[1] - root[1];
  let dist = Math.hypot(dx, dy) || 0.01, hand = tgt;
  if (dist > reach) { hand = [root[0] + (dx / dist) * reach, root[1] + (dy / dist) * reach]; dist = reach; }
  const base = Math.atan2(dy, dx), off = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  const el = (s) => [root[0] + Math.cos(base + s * off) * l1, root[1] + Math.sin(base + s * off) * l1];
  const dot = (p) => (p[0] - root[0]) * d[0] + (p[1] - root[1]) * d[1];
  const e1 = el(1), e2 = el(-1);
  return { elbowB: dot(e1) < dot(e2) ? e1 : e2, handB: hand };
}

// body + weapon + front arm (no ghosts / smear); also used by kills.js to paint into a buffer
function paintFighter(f, front, back, jx, jy, white) {
  let sk = f.sk;
  const z = Cam.z, bow = bowState(f);
  if (bow && bow.draw != null) {
    const h = sk.handA, d = sk.wdir, a = bowPull(bow.draw);
    sk = Object.assign({}, sk, armIK(sk.neck, [h[0] + d[0] * a, h[1] + d[1] * a], d));
  }
  const sc = f.scarf && scarfCols(f, white);
  if (sc) drawScarfTails(f.scarf.map((tl) => tl.p), z, sc[0], sc[1], jx, jy);
  // tucked weapons (wflip → 1) roll their blade to the far side and sit behind the body
  const wf = f.wflip || 0, tucked = wf > 0.5, wfs = f.facing * (1 - 2 * wf);
  const paintWpn = (X, Y) => { if (f.weapon && f.weapon !== 'gauntlets' && !f.wpnAway) drawWeapon(f.weapon, X(sk.handA), Y(sk.handA), sk.wdir, z, wfs, bow); };
  if (tucked) paintWpn((p) => Cam.sx(p[0]) + jx, (p) => Cam.sy(p[1]) + jy);
  const s = drawBody(sk, z, front, back, jx, jy);
  if (sc) drawScarfCollar(sk, z, sc[0], s, f.scarf[0].p[0], f.facing);
  if (!tucked) paintWpn(s.X, s.Y);
  drawFrontArm(sk, z, front, s);
  if (f.weapon === 'gauntlets') {
    G.col(white ? '#ffffff' : PAL.steel);
    G.disc(s.X(sk.handB), s.Y(sk.handB), 3.6 * z);
    G.disc(s.X(sk.handA), s.Y(sk.handA), 3.8 * z);
    G.col(PAL.steelD); G.rect(s.X(sk.handA) - 1, s.Y(sk.handA) - 1, 2, 2);
  }
  if (white && f.hitstop > 0) { G.col(PAL.cyan); G.ring(s.X(sk.head), s.Y(sk.head), 6 * z, 1); }
}

function drawFighter(f, t) {
  if (f.state === 'ko' && f.kill) { drawKilled(f, t); return; }   // weapon finisher (src/kills.js)
  for (const g of f.ghosts) drawGhost(g, f);
  drawSmear(f);

  let jx = 0, jy = 0;
  if (f.hitstop > 0 && f.flash > 0) { jx = rand(-2, 2); jy = rand(-1, 1); }
  const white = f.flash > 0 && (f.hitstop > 0 || f.flash % 4 < 2);
  const front = white ? '#ffffff' : PCOL[f.id];
  const back = white ? '#e6e6e6' : PBACK[f.id];
  const dodging = f.inv > 0 && f.state === 'dodge';
  if (dodging) G.ctx.globalAlpha = t % 4 < 2 ? 0.45 : 0.7;
  paintFighter(f, front, back, jx, jy, white);
  G.ctx.globalAlpha = 1;
}

function drawTag(f, label) {
  const sk = f.sk;
  otext(label, Cam.sx(sk.head[0]), Cam.sy(sk.head[1]) - 16 * Cam.z, 1, 'center', PCOL[f.id]);
}

// ---------------- pickups & projectiles ----------------
function drawPickup(p, t) {
  if (p.life < 150 && t % 8 < 4) return;
  const z = Cam.z, ang = p.sky ? 90 : -30;
  const d = [Math.cos(ang * D2R), Math.sin(ang * D2R)];
  const len = Math.max(10, WEAPONS[p.type].len);
  const bob = p.falling ? 0 : Math.round(Math.sin(p.t * 0.08) * 1.5);
  const cx = Cam.sx(p.x), cy = Cam.sy(p.y - 9 + bob);
  if (p.hidden) {
    // cloth sack with a hilt sticking out — same for every weapon type, so the contents stay
    // secret until grabbed (the pickup label reveals it). Origin = bottom-centre of the sack.
    // Sky drops hang from a parachute and swing under it like a pendulum.
    const ox = cx, oy = Cam.sy(p.y) + (p.falling ? 0 : bob * 0.5);
    const PY = -50, sw = p.sky ? Math.cos(p.t * 0.045) * 0.22 : 0, cs = Math.cos(sw), sn = Math.sin(sw);
    const Q = (a, b) => [ox + (a * cs - (b - PY) * sn) * z, oy + (PY + a * sn + (b - PY) * cs) * z];
    const poly = (...pts) => G.poly(pts.flat());
    const T = (v) => Math.max(1, Math.round(v * z));
    const C = { cloth: '#a89a82', hi: '#d8ccb4', sh: '#7f715b', rope: '#5c4f3c' };
    // parachute: striped dome + rigging lines; after landing it sinks, flattens and slides off
    const landK = p.landT != null ? p.landT / 28 : 0;
    if (p.sky || (p.landT != null && landK < 1)) {
      const k = p.sky ? 0 : easeOut(landK), R = 20 * (1 + k * 0.25), Ry = 10 * (1 - k * 0.85);
      const ccx = k * 16, ccy = PY + k * 44, N = 6;
      const ell = (a) => Q(ccx + Math.cos(a) * R, ccy + Math.sin(a) * Ry);
      const rim = (a) => Q(ccx + Math.cos(a) * R, ccy + 2 + (1 - k) * 1.5 * Math.abs(Math.sin(a * N)));
      if (k < 0.5) {
        G.col(PAL.light);
        for (const a of [Math.PI, Math.PI * 1.25, Math.PI * 1.75, Math.PI * 2]) G.line(...rim(a), ...Q(Math.cos(a) * 3, -16), 1);
      }
      // plain white canopy, thin grey seams between panels
      G.col('#f4f4f4');
      for (let i = 0; i < N; i++) {
        const a0 = Math.PI + (i / N) * Math.PI, a1 = Math.PI + ((i + 1) / N) * Math.PI;
        poly(ell(a0), ell(a1), rim(a1), rim(a0));
      }
      G.col(PAL.light);
      for (let i = 1; i < N; i++) { const a = Math.PI + (i / N) * Math.PI; G.line(...ell(a), ...rim(a), 1); }
    }
    if (p.sky) {
      // rope from the canopy to the sack neck (sack swings with the rig)
      G.col(C.rope); G.line(...Q(0, PY + 2), ...Q(0, -18), 1);
    }
    // sack body: wide rounded bottom tapering to the neck
    G.col(C.cloth);
    poly(Q(-7, 0), Q(7, 0), Q(9, -3), Q(9.5, -7), Q(8, -11), Q(4.5, -14), Q(-4.5, -14), Q(-8, -11), Q(-9.5, -7), Q(-9, -3));
    G.col(C.sh); poly(Q(3, 0), Q(7, 0), Q(9, -3), Q(9.5, -7), Q(8, -10), Q(6, -6), Q(5, -2));   // shaded right side
    G.col(C.hi); poly(Q(-7.5, -4), Q(-8, -9), Q(-5, -12.5), Q(-4.5, -9), Q(-5.5, -5));         // highlight
    G.col(C.sh); G.line(...Q(-2, -2), ...Q(0, -10), 1);                                        // fold crease
    // ruffled opening above the tie
    G.col(C.cloth); poly(Q(-2.5, -15.5), Q(-5, -19), Q(-2, -18), Q(0, -20), Q(2, -18), Q(5, -19), Q(2.5, -15.5));
    // hilt poking out of the opening, tilted
    G.col(PAL.steelD);
    G.line(...Q(0, -16), ...Q(4, -27), T(2));                                                   // grip
    G.line(...Q(-1.2, -20.8), ...Q(4.4, -18.8), T(1.6));                                        // guard
    G.col(PAL.steel); G.disc(...Q(4.4, -28), 1.7 * z);                                           // pommel
    // rope tie around the neck, over the hilt's base
    G.col(C.rope); G.line(...Q(-3.5, -15.5), ...Q(3.5, -15.5), T(2)); G.line(...Q(3, -15), ...Q(5.5, -12), T(1));
    const g = (p.t + Math.floor(Math.abs(p.x))) % 70;
    if (g < 8) {
      const r = g < 4 ? g : 8 - g, [gx, gy] = Q(6.5, -27);
      G.col(PAL.ink); G.rect(gx - r, gy, r * 2 + 1, 1); G.rect(gx, gy - r, 1, r * 2 + 1);
    }
    return;
  }
  drawWeapon(p.type, cx - d[0] * len * 0.5 * z, cy - d[1] * len * 0.5 * z, d, z, 1);
  const g = (p.t + Math.floor(Math.abs(p.x))) % 70;
  if (g < 8) {
    const r = g < 4 ? g : 8 - g;
    G.col(PAL.ink);
    const gx = cx + d[0] * len * 0.3 * z, gy = cy + d[1] * len * 0.3 * z - 3;
    G.rect(gx - r, gy, r * 2 + 1, 1); G.rect(gx, gy - r, 1, r * 2 + 1);
  }
}

function drawProj(p, t) {
  const z = Cam.z, x = Cam.sx(p.x), y = Cam.sy(p.y);
  if (p.type === 'arrow') {
    const a = Math.atan2(p.vy, p.vx), c = Math.cos(a), s = Math.sin(a);
    G.col(PAL.light); G.line(x, y, x - c * 13 * z, y - s * 13 * z, 1);
    G.col(PAL.ink); G.poly([x + c * 2, y + s * 2, x - c * 3 - s * 2.5, y - s * 3 + c * 2.5, x - c * 3 + s * 2.5, y - s * 3 - c * 2.5]);
    G.col(PCOL[p.owner.id]); G.line(x - c * 11 * z, y - s * 11 * z, x - c * 14 * z - s * 2 * z, y - s * 14 * z + c * 2 * z, 1);
  } else if (p.type === 'thrown') {
    const d = [Math.cos(p.rot), Math.sin(p.rot)], len = Math.max(10, WEAPONS[p.wtype].len);
    drawWeapon(p.wtype, x - d[0] * len * 0.5 * z, y - d[1] * len * 0.5 * z, d, z, 1);
  }
}

// ---------------- effects ----------------
function star(x, y, spikes, rOut, rIn, rot, seed) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = rot + (i / (spikes * 2)) * Math.PI * 2;
    const r = i % 2 ? rIn : rOut * (0.7 + hash(seed + i) * 0.55);
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  G.poly(pts);
}

function drawFx(world, t) {
  const z = Cam.z;
  for (const p of world.parts) {
    const x = Cam.sx(p.x), y = Cam.sy(p.y), k = p.t / p.life;
    G.col(p.col || PAL.mid);
    if (p.ring) { G.ring(x, y, Math.max(1, p.s * (1 - k * 0.6)), 1); continue; }
    if (p.plus) { G.rect(x - 1, y - 2, 1, 3); G.rect(x - 2, y - 1, 3, 1); continue; }
    G.rect(x, y - p.s, p.s, p.s);
  }
  for (const e of world.fx) {
    const k = e.t / e.life, x = Cam.sx(e.x), y = Cam.sy(e.y);
    switch (e.k) {
      case 'spark': {
        const sz = e.size * z;
        if (e.t < 2) { G.col('#ffffff'); star(x, y, 9, sz * 1.1, sz * 0.5, e.rot, e.seed); break; }
        const sh = 1 - easeOut(k) * 0.7;
        G.col(PAL.yellow); star(x, y, 9, sz * sh, sz * 0.45 * sh, e.rot + k * 0.3, e.seed);
        G.col(PAL.pale); G.disc(x, y, sz * 0.3 * sh);
        G.col(PAL.yellow);
        for (let i = 0; i < 6; i++) {
          const a = e.rot + i * 1.05 + 0.4, r0 = sz * (0.9 + k * 0.8), r1 = r0 + sz * 0.6 * (1 - k);
          G.line(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1, 1);
        }
        break;
      }
      case 'orb': {
        const r = e.r * z * (0.7 + easeOut(k) * 0.5);
        if (k < 0.55) { G.col('#ffffff'); G.disc(x, y, r * (1 - k)); }
        G.col('#ffffff'); G.ring(x, y, r * 1.5 + k * 20 * z, k < 0.5 ? 2 : 1);
        break;
      }
      case 'ring':
        G.col(PAL.light); G.ring(x, y, e.r * z * (0.4 + easeOut(k) * 0.8), 1);
        break;
      case 'shock': {
        G.col(PAL.ink);
        const r = (10 + e.t * 5) * z;
        G.rect(x - r - 10 * z, y - 2, 10 * z, 2); G.rect(x + r, y - 2, 10 * z, 2);
        G.col(PAL.light);
        G.rect(x - r * 0.7, y - 5 - (1 - k) * 5, 1, 3); G.rect(x + r * 0.7, y - 5 - (1 - k) * 5, 1, 3);
        break;
      }
      case 'muzzle':
        G.col(e.t < 2 ? '#ffffff' : PAL.yellow);
        if (e.t < 2) star(x, y, 5, 5 * z, 2 * z, 0, 3); else G.ring(x, y, 4 * z, 1);
        break;
      case 'label':
        otext(e.s, x, y - e.t * 0.3, 1, 'center', '#ffffff');
        break;
    }
  }
}

// ---------------- HUD ----------------
function drawBar(f, side, combo) {
  const bw = 230, bh = 9, y = 18;
  const x0 = side === 1 ? 34 : W - 34 - bw;
  // corner portrait: tiny silhouette in the player colour
  const px = side === 1 ? 16 : W - 16;
  G.col(PAL.dim); G.rect(px - 11, y - 9, 22, 22);
  G.col(PCOL[f.id]); G.disc(px, y - 1, 5); G.taper(px, y + 13, px, y + 5, 6, 3);
  otext(f.name, side === 1 ? x0 : x0 + bw, y - 12, 1, side === 1 ? 'left' : 'right', '#ffffff');
  // HP: yellow on a black well, crimson lag segment, thin grey frame
  G.col(PAL.dim); G.rect(x0 - 2, y - 2, bw + 4, bh + 4);
  G.col(PAL.hpWell); G.rect(x0 - 1, y - 1, bw + 2, bh + 2);
  const wd = Math.round((bw * f.dispHp) / f.maxHp), wh = Math.round((bw * f.hp) / f.maxHp);
  const fill = (w) => (side === 1 ? G.rect(x0, y, w, bh) : G.rect(x0 + bw - w, y, w, bh));
  G.col(PAL.crimson); fill(wd);
  G.col(f.hp < 25 && Math.floor(Date.now() / 180) % 2 ? '#ffffff' : PAL.yellow); fill(wh);
  // weapon + round wins
  const wname = f.weapon ? WEAPONS[f.weapon].name : 'FISTS';
  text(wname, side === 1 ? x0 : x0 + bw, y + bh + 5, 1, side === 1 ? 'left' : 'right', PAL.mid);
  for (let i = 0; i < 2; i++) {
    const qx = side === 1 ? x0 + bw - 7 - i * 10 : x0 + i * 10 + 1;
    G.col('#ffffff');
    if (i < f.wins) G.rect(qx, y + bh + 4, 6, 6);
    else { G.col(PAL.mid); G.ring(qx + 3, y + bh + 7, 3, 1); }
  }
  // combo counter: chunky white numeral + "hits"
  if (combo) {
    const cx = side === 1 ? x0 + 4 : x0 + bw - 4, al = side === 1 ? 'left' : 'right';
    const pop = combo.t > 94 ? 4 : 3;
    otext(String(combo.n), cx, y + 26, pop, al, '#ffffff', true);
    otext('HITS', cx + (side === 1 ? 2 : -2), y + 26 + pop * FONT_H + 4, 1, al, PAL.light, true);
  }
}

function bigText(str, y, s = 6, color = '#ffffff') {
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1], [2, 2]]) text(str, W / 2 + ox * 2, y + oy * 2, s, 'center', '#000000', true);
  text(str, W / 2, y, s, 'center', color, true);
}

function panel(x, y, w, h) {
  G.col(PAL.bg); G.rect(x, y, w, h);
  G.col(PAL.mid); G.rect(x, y, w, 1); G.rect(x, y + h - 1, w, 1); G.rect(x, y, 1, h); G.rect(x + w - 1, y, 1, h);
}
