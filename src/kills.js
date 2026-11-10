'use strict';
// ---------- kill animations: one finisher per weapon, picked by whatever landed the last hit ----------
// A kill K lives in world.kills while the KO plays out. K.t counts sim steps from the hit; the first
// K.hold steps are a freeze (victim + attacker in hitstop), T = K.t - K.hold is time after the freeze.
//   killTick  -> timed events (world.updateFx, every step)
//   killStep  -> victim physics (Fighter.update 'ko', only once the freeze is over)
//   killLand  -> victim touching the floor; true = handled, skip the default bounce
//   killPose  -> body pose while dying
//   drawKilled / drawKillUnder / drawKillOver -> rendering
const KILL_NAMES = {
  none: 'KNOCKED OUT', sword: 'SLICED', staff: 'BATTERED', greatsword: 'CRUSHED', bow: 'PINCUSHIONED',
  scythe: 'REAPED', lance: 'LIFTOFF', gauntlets: 'PLOWED', axe: 'CLEAVED',
};
const KPOSE = {
  stand:  { t: -96, a: [96, 100], b: [86, 94], l: [82, 92], k: [98, 92], w: 100 },
  stagger:{ t: -118, a: [-125, -150], b: [-145, -165], l: [55, 95], k: [118, 110] },
  kneel:  { t: -70, a: [96, 104], b: [100, 108], l: [-5, 88], k: [88, 178], w: 110 },
  facedown:{ t: -4, a: [70, 85], b: [80, 95], l: [176, 180], k: [172, 186], w: 60 },
  rocket: { t: -92, a: [100, 96], b: [80, 92], l: [94, 92], k: [86, 90], w: 95 },
};
const TAU = Math.PI * 2;

const killBuf = document.createElement('canvas');
killBuf.width = W; killBuf.height = H;
const killCtx = killBuf.getContext('2d');

const bodyMid = (f) => [(f.sk.hip[0] + f.sk.neck[0]) / 2, (f.sk.hip[1] + f.sk.neck[1]) / 2];
const toScreen = (p) => [Cam.sx(p[0]), Cam.sy(p[1])];

function weaponStyle(att, spec, isProj) {
  if (!isProj) return att.weapon || 'none';
  if (spec.type === 'thrown') return spec.wtype;
  return 'bow';
}

// ---------------- start ----------------
function startKill(w, att, vic, style, dir, px, py) {
  const g = w.game;
  const K = { style, vic, att, dir, t: 0, hold: 22, x: px, y: py, fxs: [] };
  const onGround = vic.y > -3;
  const vel = (vx, vy, grounded = false) => {
    vic.vx = vx; vic.vy = vy;
    if (grounded) { vic.y = 0; vic.ground = true; } else vic.ground = vy >= 0 && onGround;
  };
  vic.state = 'ko'; vic.kill = K; vic.flash = 6; vic.trail.length = 0;
  switch (style) {
    case 'none': // dizzy spin: pops up spinning, lands seeing stars
      K.hold = 18; K.rot = 0; K.spin = 0.42 * dir;
      vel(dir * 4.2, -7.8);
      break;
    case 'sword': { // iai slice: one hair-thin cut across the screen, a beat of stillness, then they crumple
      K.hold = 30;
      const a = 0.34;
      K.u = [dir * Math.cos(a), -Math.sin(a)];
      vel(0, onGround ? 0 : Math.max(0, vic.vy), onGround);
      setPose(vic, KPOSE.stand);
      [K.cx, K.cy] = bodyMid(vic);
      break;
    }
    case 'axe': { // cleave: vertical chop, they buckle under it and collapse
      K.hold = 28;
      const l = Math.hypot(0.1, 1);
      K.u = [(0.1 * dir) / l, 1 / l];
      vel(0, onGround ? 0 : Math.max(0, vic.vy), onGround);
      setPose(vic, KPOSE.stand);
      [K.cx, K.cy] = bodyMid(vic);
      break;
    }
    case 'staff': // battered: staff hurled spinning from the hand, juggles them in place, bats them away, boomerangs home
      K.hold = 18; K.fly = 9; K.pin = K.fly + 30; K.ret = 20; K.rot = 0; K.spin = 0;
      K.fromProj = att.weapon !== 'staff';   // killed by a thrown staff: it is already in the air at the hit point
      K.trail = [];
      if (K.fromProj) { K.sx = px; K.sy = py; K.sa = 0; }
      else [K.sx, K.sy, K.sa] = staffInHand(att);
      vic.y = Math.min(vic.y, -10); vel(dir * 0.8, -1.5);
      vic.ground = false;
      break;
    case 'greatsword': // crater slam: spiked straight into the floor
      K.hold = 22;
      if (onGround) vel(0, 0, true); else vel(dir * 1.2, 11);
      break;
    case 'bow': // pincushion: staggers back while more arrows thunk in
      K.hold = 16;
      K.arrows = [{ bone: 'spine', e: rand(-0.15, 0.1) }];
      vel(dir * 2.6, -3.2);
      break;
    case 'scythe': // reap: the world goes dark, they fall to their knees and the soul drifts up
      K.hold = 26; K.soulSk = vic.sk;
      vel(dir * 0.6, onGround ? 0 : -1, onGround);
      break;
    case 'lance': // liftoff: rocketed into the sky, explodes at the top
      K.hold = 16;
      vel(dir * 2.4, -10.5);
      vic.ground = false;
      break;
    case 'gauntlets': // plow: blasted along the floor, gouging a trail
      K.hold = 24; g.invert = 7;
      for (let i = 0; i < 3; i++) K.fxs.push({ k: 'ring', x: px, y: py, t: -i * 4, life: 16, r: 10 + i * 8 });
      vel(dir * 10.5, onGround ? 0 : 2.5, onGround);
      break;
  }
  vic.hitstop = K.hold; att.hitstop = K.hold;
  if (style !== 'gauntlets') g.invert = 4;
  if (style !== 'sword' && style !== 'axe') w.fx.push({ k: 'orb', x: px, y: py, r: 30, t: 0, life: 22 });
  g.speedLines(style === 'gauntlets' ? (dir > 0 ? 0 : Math.PI) : style === 'lance' ? -Math.PI / 2 : Math.atan2(vic.vy, vic.vx || dir), 40);
  w.kills.push(K);
  g.onKO(vic, att, style);
}

// staff centre + angle as if held: drawWeapon('staff') runs -18..30 along wdir from the hand, so the middle is 6 out
function staffInHand(a) {
  const h = a.sk.handA, d = a.sk.wdir;
  return [h[0] + d[0] * 6, h[1] + d[1] * 6, Math.atan2(d[1], d[0])];
}

function staffFlight(w, K, T) {
  const f = K.vic, a = K.att, dir = K.dir, g = w.game;
  if (K.caught) return;
  K.trail.unshift([K.sx, K.sy, K.sa]); K.trail.length = Math.min(K.trail.length, 3);
  const spot = () => { const m = bodyMid(f); return [m[0] - dir * 8, m[1]]; };
  if (K.t === 1 && K.fromProj) {   // the thrown staff just turned into a floor pickup: take it back
    const i = w.pickups.findIndex((p) => p.type === 'staff' && !p.sky && Math.abs(p.x - K.x) < 30);
    if (i >= 0) w.pickups.splice(i, 1);
  }
  if (T < 0) {                     // freeze: still in the hand (or hanging where the throw connected)
    if (!K.fromProj) [K.sx, K.sy, K.sa] = staffInHand(a);
    K.trail.length = 0;
    return;
  }
  if (T === 0) {
    K.s0 = [K.sx, K.sy]; a.wpnAway = true;
    SFX.throw(); SFX.swing(true);
    w.fx.push({ k: 'muzzle', x: K.sx, y: K.sy, t: 0, life: 4 });
  }
  if (T < K.fly) {                 // hurled: spins out along a low arc into the target
    const k = (T + 1) / K.fly, e = easeOut(k), to = spot();
    K.sx = lerp(K.s0[0], to[0], e); K.sy = lerp(K.s0[1], to[1], e) - Math.sin(k * Math.PI) * 10;
    K.sa += 0.85 * dir;
  } else if (T < K.pin) {          // whirling in place on the body
    [K.sx, K.sy] = spot();
    K.sa += 0.9 * dir;
  } else {
    if (T === K.pin) K.s1 = [K.sx, K.sy];
    const k = Math.min(1, (T - K.pin + 1) / K.ret), e = k * k * (3 - 2 * k), [hx, hy, ha] = staffInHand(a);
    K.sx = lerp(K.s1[0], hx, e); K.sy = lerp(K.s1[1], hy, e) - Math.sin(k * Math.PI) * 26;
    K.sa += 0.75 * dir * (1 - k * 0.5);
    if (k >= 1) {                  // caught: snaps back into the grip
      K.caught = true; K.sa = ha; K.trail.length = 0;
      a.wpnAway = false;
      if (K.fromProj && !a.weapon) a.weapon = 'staff';
      w.ring(hx, hy, 10);
      w.hitSpark(a.sk.handA[0], a.sk.handA[1], 2, -Math.PI / 2);
      a.flash = 3; g.shake(2); SFX.pickup(); SFX.hit(2);
    }
  }
}

function setPose(f, o) {
  f.pose = P(o, f.stance());
  f.solve();
}

// ---------------- per-step ----------------
function killTick(w, K) {
  K.t++;
  const T = K.t - K.hold, f = K.vic, g = w.game, dir = K.dir;
  for (const e of K.fxs) { e.t++; if (e.vx) e.x += e.vx; }
  K.fxs = K.fxs.filter((e) => e.t < e.life);
  switch (K.style) {
    case 'sword':
      if (T === 0) {
        SFX.throw();
        for (let i = 0; i < 10; i++) {
          const s = rand(-10, 10);
          w.parts.push({ x: K.cx + K.u[0] * s, y: K.cy + K.u[1] * s, vx: K.u[0] * rand(-1.5, 1.5), vy: rand(-1.2, 0.2), life: randi(10, 18), t: 0, s: 1, col: '#ffffff', floaty: 1 });
        }
      }
      if (T === 10) { // the delayed sting: the cut registers
        f.flash = 6; g.shake(3); SFX.hit(6);
        w.hitSpark(K.cx, K.cy, 5, Math.atan2(K.u[1], K.u[0]));
      }
      if (T === 40) { w.dust(f.x + dir * 10, 0, 5, 0); SFX.land(); }
      break;
    case 'axe':
      if (T === 0) {
        SFX.swing(true); SFX.hit(7); w.dust(f.x, 0, 4, 0);
        f.flash = 6; f.vx = dir * 1.8; g.shake(4);
        w.hitSpark(K.cx, K.cy - 6, 6, Math.PI / 2);
      }
      if (T === 34) { w.dust(f.x, 0, 6, 0); g.shake(3); SFX.thud(); }
      break;
    case 'bow':
      if (T === 6 || T === 13 || T === 20) {
        const bone = ['neck', 'hip', 'elbowB'][K.arrows.length - 1];
        const e = rand(-0.35, 0.15), pt = f.sk[bone], v = [dir * Math.cos(e), Math.sin(e)];
        K.arrows.push({ bone, e });
        K.fxs.push({ k: 'streak', x0: pt[0] - v[0] * 160, y0: pt[1] - v[1] * 160, x1: pt[0], y1: pt[1], t: 0, life: 3, col: PAL.light });
        w.hitSpark(pt[0], pt[1], 2, Math.atan2(v[1], v[0]));
        f.vx += dir * 1.2; if (!f.ground) f.vy = Math.min(f.vy, -1.2);
        f.flash = 3; g.shake(2); SFX.shoot('arrow'); SFX.hit(3);
      }
      break;
    case 'staff':
      staffFlight(w, K, T);
      if (T >= K.fly && T < K.pin && (T - K.fly) % 6 === 0) {   // flurry: each whirl of the staff cracks a different spot
        const b = f.sk[pick(['spine', 'neck', 'hip', 'head'])];
        w.hitSpark(b[0] + rand(-2, 2), b[1] + rand(-2, 2), 3, rand(0, TAU));
        f.vy = -0.8; f.flash = 2; g.shake(2); SFX.swing(false); SFX.hit(3);
      }
      if (T === K.pin) {                          // home-run swing
        const m = bodyMid(f);
        f.vx = dir * 6; f.vy = -6.5; f.flash = 6; K.spin = 0.38 * dir;
        w.fx.push({ k: 'orb', x: m[0], y: m[1], r: 22, t: 0, life: 16 });
        for (let i = 0; i < 2; i++) K.fxs.push({ k: 'ring', x: m[0], y: m[1], t: -i * 3, life: 14, r: 8 + i * 8 });
        w.hitSpark(m[0], m[1], 8, dir > 0 ? -0.4 : Math.PI + 0.4);
        g.speedLines(dir > 0 ? -0.4 : Math.PI + 0.4, 30);
        g.shake(6); SFX.swing(true); SFX.hit(8);
      }
      break;
    case 'scythe':
      if (T === 0) SFX.swing(true);
      if (T === 40) { w.dust(f.x + dir * 8, 0, 5, 0); SFX.land(); }
      break;
  }
}

function killStep(f, w) {
  const K = f.kill, T = K.t - K.hold, dir = K.dir;
  switch (K.style) {
    case 'none':
      if (!f.ground) K.rot += K.spin;
      else {
        K.rot = approach(K.rot, Math.round(K.rot / TAU) * TAU, 0.35);
        f.vx = approach(f.vx, 0, 0.2);
      }
      break;
    case 'sword': case 'axe':
      if (f.ground) f.vx = approach(f.vx, 0, 0.15);
      break;
    case 'staff':
      if (T < K.pin) {                            // held up by the blows
        f.gravScale = 0;
        f.vx = approach(f.vx, 0, 0.2); f.vy = approach(f.vy, 0, 0.15);
      } else if (!f.ground) K.rot += K.spin;
      else {
        K.rot = approach(K.rot, Math.round(K.rot / TAU) * TAU, 0.35);
        f.vx = approach(f.vx, 0, 0.2);
      }
      break;
    case 'greatsword':
      if (!K.slammed) {
        if (f.ground) slam(f, w, K);
        else { f.gravScale = 0; f.vy = Math.max(f.vy, 11); }
      } else if (f.ground) f.vx = approach(f.vx, 0, 0.3);
      break;
    case 'bow':
      if (f.ground) f.vx = approach(f.vx, 0, 0.12);
      break;
    case 'scythe':
      f.vx = approach(f.vx, 0, 0.1);
      break;
    case 'lance':
      if (!K.boom) {
        f.gravScale = 0.55;
        for (let i = 0; i < 3; i++) {
          w.parts.push({ x: f.x + rand(-2, 2), y: f.y + rand(-1, 3), vx: -f.vx * 0.3 + rand(-0.5, 0.5), vy: rand(1, 2.8), life: randi(8, 15), t: 0, s: randi(2, 3), nograv: 1, col: pick([PAL.hot, PAL.orange, PAL.orange, PAL.red]), ring: Math.random() < 0.3 });
        }
        if (K.t % 2 === 0) f.addGhost();
        if (f.vy > -0.6 || T > 70) boom(f, w, K, T);
      } else {
        if (T % 3 === 0 && T < K.boomT + 80) {
          w.parts.push({ x: f.x + rand(-5, 5), y: f.y - rand(4, 20), vx: rand(-0.3, 0.3), vy: -rand(0.4, 0.9), life: randi(20, 34), t: 0, s: randi(2, 3), nograv: 1, col: pick([PAL.mid, PAL.dim]), ring: true });
        }
        if (f.ground) f.vx = approach(f.vx, 0, 0.2);
      }
      break;
    case 'gauntlets':
      if (!f.ground) f.gravScale = 1.8;
      else {
        f.vx = approach(f.vx, 0, 0.17);
        if (Math.abs(f.vx) > 1.2) {
          if (K.plowX == null) K.plowX = f.x;
          K.plowEnd = f.x;
          w.dust(f.x - dir * 3, 0, 1, -dir);
          if (K.t % 2 === 0) w.parts.push({ x: f.x, y: -1, vx: -dir * rand(1, 3), vy: -rand(1, 2.5), life: randi(8, 12), t: 0, s: randi(1, 2), col: pick([PAL.hot, PAL.orange]) });
          if (K.t % 3 === 0) f.addGhost();
        }
      }
      break;
  }
}

function slam(f, w, K) {
  K.slammed = true; K.craterX = f.x;
  f.vy = -2.2; f.vx *= 0.3; f.ground = false;
  w.shockwave(f);
  w.dust(f.x, 0, 12, 0);
  for (let i = 0; i < 10; i++) w.parts.push({ x: f.x + rand(-10, 10), y: -1, vx: rand(-2.2, 2.2), vy: -rand(2, 4.5), life: randi(18, 30), t: 0, s: 2, col: pick([PAL.light, PAL.mid, '#ffffff']) });
  w.game.shake(9); w.game.invert = 3;
  SFX.thud(); SFX.ko();
}

function boom(f, w, K, T) {
  K.boom = true; K.boomT = T; K.charred = true;
  const x = f.x, y = f.y - 18;
  w.fx.push({ k: 'orb', x, y, r: 42, t: 0, life: 26 });
  w.fx.push({ k: 'spark', x, y, t: 0, life: 14, size: 30, rot: rand(0, 6.28), seed: rand(0, 100) });
  for (let i = 0; i < 3; i++) w.fx.push({ k: 'ring', x, y, r: 26 + i * 16, t: -i * 3, life: 14 + i * 3 });
  for (let i = 0; i < 40; i++) {
    const a = rand(0, TAU), sp = rand(1.5, 6);
    w.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: randi(16, 32), t: 0, s: randi(2, 3), ring: Math.random() < 0.5, col: pick([PAL.hot, PAL.orange, PAL.red, '#ffffff', '#ffffff']), floaty: 1 });
  }
  f.vy = -1.5; f.vx = K.dir * 1.2; f.flash = 6;
  w.game.shake(8); w.game.invert = 3;
  SFX.thud(); SFX.ko();
}

function killLand(f, w, impact) {
  const K = f.kill;
  switch (K.style) {
    case 'greatsword':
      if (!K.slammed) { slam(f, w, K); return true; }
      return false;
    case 'gauntlets':
      f.vy = 0; w.dust(f.x, 0, 6, 0); SFX.land();
      return true;
    case 'sword': case 'axe':
      w.dust(f.x, 0, 3, 0);
      return true;
    case 'staff':
      return K.t - K.hold < K.pin;
  }
  return false;
}

function killPose(f) {
  const K = f.kill;
  if (!K) return [POSE.ko, 0.25];
  const T = K.t - K.hold;
  switch (K.style) {
    case 'none': return f.ground ? [POSE.ko, 0.3] : [POSE.hurt, 0.3];
    case 'sword': // frozen upright, flinch when the cut lands, sink to the knees, fall forward
      return T < 10 ? [KPOSE.stand, 1] : T < 16 ? [POSE.hurt, 0.5] : T < 32 ? [KPOSE.kneel, 0.25] : [KPOSE.facedown, 0.14];
    case 'axe': // reels under the chop, buckles to the knees, keels over
      return T < 8 ? [POSE.hurtLo, 0.6] : T < 24 ? [KPOSE.kneel, 0.25] : [POSE.ko, 0.18];
    case 'staff': return T < K.pin ? [(T >> 2) & 1 ? POSE.hurt : POSE.hurtLo, 0.6] : [f.ground ? POSE.ko : POSE.hurt, 0.3];
    case 'greatsword': return K.slammed ? [POSE.ko, 0.5] : [POSE.hurt, 0.5];
    case 'bow': return T < 28 ? [KPOSE.stagger, 0.3] : [POSE.ko, 0.18];
    case 'scythe': return T < 40 ? [KPOSE.kneel, 0.3] : [KPOSE.facedown, 0.12];
    case 'lance': return K.boom ? [f.ground ? POSE.ko : POSE.hurt, 0.25] : [KPOSE.rocket, 0.4];
    case 'gauntlets': return [f.ground ? POSE.ko : POSE.hurt, 0.4];
  }
  return [POSE.ko, 0.25];
}

// ---------------- drawing ----------------
// draw the whole buffered body, moved by (ox, oy) and turned rot around pivot, optionally clipped
function killPiece(clip, pivot, ox, oy, rot, alpha = 1) {
  const c = G.ctx;
  c.save();
  c.globalAlpha = alpha;
  c.translate(pivot[0] + ox, pivot[1] + oy); c.rotate(rot); c.translate(-pivot[0], -pivot[1]);
  if (clip) {
    c.beginPath(); c.moveTo(clip[0], clip[1]);
    for (let i = 2; i < clip.length; i += 2) c.lineTo(clip[i], clip[i + 1]);
    c.closePath(); c.clip();
  }
  c.drawImage(killBuf, 0, 0);
  c.restore();
}

function drawKilled(f, t) {
  const K = f.kill, z = Cam.z, T = K.t - K.hold;
  for (const g of f.ghosts) drawGhost(g, f);
  const white = f.flash > 0 && (f.hitstop > 0 || f.flash % 4 < 2);
  let front = white ? '#ffffff' : PCOL[f.id], back = white ? '#e6e6e6' : PBACK[f.id];
  if (K.charred && !white) { front = '#3b3a41'; back = '#29282e'; }
  let jx = 0, jy = 0;
  if (f.hitstop > 0 && f.flash > 0 && K.style !== 'sword') { jx = rand(-2, 2); jy = rand(-1, 1); }
  // pain shudder right after a blade connects
  if ((K.style === 'sword' && T >= 10 && T < 22) || (K.style === 'axe' && T >= 0 && T < 12)) { jx = rand(-1.5, 1.5); jy = rand(-0.5, 0.5); }

  const main = G.ctx;
  G.ctx = killCtx; killCtx.clearRect(0, 0, W, H);
  paintFighter(f, front, back, jx, jy, white);
  G.ctx = main;

  const c = toScreen(bodyMid(f));
  killPiece(null, c, 0, 0, K.style === 'none' || K.style === 'staff' ? K.rot : 0);

  switch (K.style) {
    case 'none':
      if (f.ground && T > 0) {
        const h = toScreen(f.sk.head);
        for (let i = 0; i < 3; i++) {
          const a = t * 0.12 + i * 2.09, sx = h[0] + Math.cos(a) * 9 * z, sy = h[1] - 7 * z + Math.sin(a) * 3 * z;
          G.col(i === 1 ? PAL.cyan : PAL.hot);
          G.rect(sx - 1, sy - 2, 1, 3); G.rect(sx - 2, sy - 1, 3, 1);
        }
      }
      break;
    case 'bow':
      for (const a of K.arrows) {
        const p = toScreen(f.sk[a.bone]), v = [K.dir * Math.cos(a.e), Math.sin(a.e)];
        const tail = [p[0] - v[0] * 12 * z, p[1] - v[1] * 12 * z];
        G.col(PAL.light); G.line(p[0] + v[0] * 2 * z, p[1] + v[1] * 2 * z, tail[0], tail[1], 1);
        G.col(PCOL[K.att.id]);
        G.line(tail[0], tail[1], tail[0] - v[0] * 3 * z - v[1] * 2 * z, tail[1] - v[1] * 3 * z + v[0] * 2 * z, 1);
        G.line(tail[0], tail[1], tail[0] - v[0] * 3 * z + v[1] * 2 * z, tail[1] - v[1] * 3 * z - v[0] * 2 * z, 1);
      }
      break;
    case 'scythe':
      if (T > 8 && T < 100) drawSoul(f, K, T - 8);
      break;
  }
}

// pale copy of the body at the moment of death, rising and wavering apart in strips
function drawSoul(f, K, s) {
  const z = Cam.z, rise = s * 0.7 * z, fade = 1 - s / 92;
  const main = G.ctx;
  G.ctx = killCtx; killCtx.clearRect(0, 0, W, H);
  const b = drawBody(K.soulSk, z, '#eaf8ff', '#c3e6f5');
  drawFrontArm(K.soulSk, z, '#eaf8ff', b);
  G.ctx = main;
  const m = toScreen([(K.soulSk.hip[0] + K.soulSk.neck[0]) / 2, (K.soulSk.hip[1] + K.soulSk.neck[1]) / 2]);
  const y0 = Math.floor(m[1] - 40 * z), y1 = Math.ceil(m[1] + 40 * z), x0 = Math.floor(m[0] - 40 * z), bw = Math.ceil(80 * z);
  main.globalAlpha = Math.max(0, 0.6 * fade);
  for (let y = y0; y < y1; y += 2) {
    const off = Math.sin(y * 0.25 + s * 0.3) * (1 + s * 0.06) * z;
    main.drawImage(killBuf, x0, y, bw, 2, x0 + off, y - rise, bw, 2);
  }
  main.globalAlpha = 1;
}

// the loose staff (thrown / whirling / returning): pole + fading echoes, blur ring while it works the body
function drawFlyingStaff(K, T) {
  if (K.caught || (T < 0 && !K.fromProj)) return;   // in the hand: drawn with the attacker
  const z = Cam.z, x = Cam.sx(K.sx), y = Cam.sy(K.sy);
  if (T >= K.fly && T < K.pin) { G.ctx.globalAlpha = 0.35; G.col(PAL.smear); G.ring(x, y, 23 * z, 1); }
  const n = T < 0 ? 0 : K.trail.length;
  for (let i = n; i >= 0; i--) {
    const s = i ? K.trail[i - 1] : [K.sx, K.sy, K.sa];
    const sx = Cam.sx(s[0]), sy = Cam.sy(s[1]), d = [Math.cos(s[2]), Math.sin(s[2])];
    G.ctx.globalAlpha = i ? 0.45 / i : 1;
    drawWeapon('staff', sx - d[0] * 6 * z, sy - d[1] * 6 * z, d, z, 1);
  }
  G.ctx.globalAlpha = 1;
}

function crescent(cx, cy, r, a0, a1, wdt) {
  const pts = [], n = 18;
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  for (let i = n; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / n), rr = r - wdt * Math.sin(Math.PI * (i / n));
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  G.poly(pts);
}
const mirrorA = (a, dir) => (dir > 0 ? a : Math.PI - a);

// behind the fighters: darkness, floor marks
function drawKillUnder(w, t) {
  const z = Cam.z, gy = Math.round(Cam.sy(0));
  for (const K of w.kills) {
    const T = K.t - K.hold;
    if (K.style === 'scythe') {
      const a = clamp(K.t / 12, 0, 1) * 0.62 * (T > 80 ? Math.max(0, 1 - (T - 80) / 30) : 1);
      if (a > 0) { G.ctx.globalAlpha = a; G.col('#000000'); G.rect(0, 0, W, H); G.ctx.globalAlpha = 1; }
    }
    if (K.style === 'greatsword' && K.slammed) {
      const cx = Cam.sx(K.craterX);
      G.col(PAL.bg);
      G.poly([cx - 26 * z, gy - 1, cx + 26 * z, gy - 1, cx + 16 * z, gy + 6 * z, cx, gy + 8 * z, cx - 16 * z, gy + 6 * z]);
      G.col(PAL.floor);
      G.line(cx - 26 * z, gy, cx - 16 * z, gy + 6 * z, 1); G.line(cx - 16 * z, gy + 6 * z, cx, gy + 8 * z, 1);
      G.line(cx, gy + 8 * z, cx + 16 * z, gy + 6 * z, 1); G.line(cx + 16 * z, gy + 6 * z, cx + 26 * z, gy, 1);
      G.col(PAL.light);
      for (let i = 0; i < 6; i++) {
        const s = i < 3 ? -1 : 1, k = i % 3, x0 = cx + s * (20 + k * 8) * z;
        const x1 = x0 + s * (8 + hash(i * 3.1) * 10) * z, y1 = gy + (2 + hash(i * 7.7) * 7) * z;
        G.line(x0, gy + 1, x1, y1, 1);
      }
    }
    if (K.style === 'gauntlets' && K.plowX != null) {
      const a = Cam.sx(K.plowX), b = Cam.sx(K.plowEnd);
      G.col(PAL.dim); G.rect(Math.min(a, b), gy - 1, Math.abs(b - a), 3);
      G.col(PAL.orange);
      const n = Math.floor(Math.abs(b - a) / 6);
      for (let i = 0; i < n; i++) if (hash(i * 1.7 + K.plowX) > 0.6) G.rect(lerp(a, b, i / n), gy, 2, 1);
    }
  }
}

// in front of everything: slash lines, arcs, streaks, the POW burst
function drawKillOver(w, t) {
  const z = Cam.z, gy = Cam.sy(0);
  for (const K of w.kills) {
    const T = K.t - K.hold, dir = K.dir;
    const px = Cam.sx(K.x), py = Cam.sy(K.y);
    switch (K.style) {
      case 'none':
        if (K.t < 40) {
          const pop = K.t < 4 ? 1.3 : 1, sz = 24 * z * pop;
          G.col('#ffffff'); star(px, py - 10 * z, 10, sz * 1.1, sz * 0.55, K.t * 0.04, 5);
          G.col(PAL.hot); star(px, py - 10 * z, 10, sz * 0.9, sz * 0.45, K.t * 0.04, 5);
          otext('POW!', px, py - 10 * z - 9, 2, 'center', PAL.red);
        }
        break;
      case 'sword':
        if (T < 10) {
          const cx = Cam.sx(K.cx), cy = Cam.sy(K.cy), L = W * 1.2 * Math.min(1, (K.t + 1) / 3), u = K.u;
          G.ctx.globalAlpha = T < 0 ? 1 : 1 - T / 10;
          G.col(PAL.cyan); G.line(cx - u[0] * L, cy - u[1] * L + 2, cx + u[0] * L, cy + u[1] * L + 2, 1);
          G.col('#ffffff'); G.line(cx - u[0] * L, cy - u[1] * L, cx + u[0] * L, cy + u[1] * L, T < 0 ? 2 : 1);
          G.ctx.globalAlpha = 1;
        }
        break;
      case 'axe':
        if (T < 8) {
          // the chop line follows the cut (through the body centre, along u) from above the screen to the floor
          const cx = Cam.sx(K.cx), cy = Cam.sy(K.cy), grow = Math.min(1, (K.t + 1) / 3), u = K.u;
          const xAt = (y) => cx + (y - cy) * (u[0] / u[1]);
          const top = -20, bot = lerp(top, gy, grow);
          G.ctx.globalAlpha = T < 0 ? 1 : 1 - T / 8;
          G.col('#ffffff'); G.line(xAt(top), top, xAt(bot), bot, T < 0 ? 3 : 1);
          if (grow >= 1) { G.col(PAL.hot); star(xAt(gy), gy, 6, 7 * z, 3 * z, K.t * 0.2, 9); }
          G.ctx.globalAlpha = 1;
        }
        break;
      case 'staff':
        drawFlyingStaff(K, T);
        break;
      case 'greatsword':
        if (K.t < 14) {
          const k = K.t / 14;
          G.col('#ffffff');
          crescent(px - dir * 6 * z, py - 6 * z, 38 * z, mirrorA(-1.9, dir), mirrorA(0.8, dir), 12 * z * (1 - k * 0.8));
        }
        break;
      case 'scythe':
        if (K.t < 18) {
          const k = K.t / 18;
          G.col('#d7f2ff');
          crescent(px, py, 52 * z, mirrorA(-2.6, dir), mirrorA(0.6, dir), 14 * z * (1 - k * 0.85));
        }
        break;
    }
    for (const e of K.fxs) {
      if (e.t < 0) continue;
      const k = e.t / e.life;
      if (e.k === 'ring') { G.col('#ffffff'); G.ring(Cam.sx(e.x), Cam.sy(e.y), (e.r + easeOut(k) * 34) * z, k < 0.5 ? 2 : 1); }
      else if (e.k === 'streak') { G.col(e.col); G.line(Cam.sx(e.x0), Cam.sy(e.y0), Cam.sx(e.x1), Cam.sy(e.y1), 1); }
    }
  }
}
