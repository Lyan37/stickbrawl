'use strict';
// ---------- world: hits, projectiles, weapon pickups, effects ----------
class World {
  constructor(game) { this.game = game; this.reset(); }

  reset() {
    this.projs = []; this.pickups = []; this.fx = []; this.parts = []; this.kills = [];
    this.spawnT = 45; this.dropStage = 0; // 0: opening drop pending, 1: fighting over it, 2: normal drops
  }

  // ---------------- combat ----------------
  resolveMelee(fighters) {
    const hits = [];
    for (const att of fighters) {
      if (att.hitstop > 0) continue;
      const box = att.activeBox();
      if (!box || !att.canHit()) continue;
      for (const vic of fighters) {
        if (vic === att || vic.inv > 0 || vic.state === 'ko') continue;
        const hb = vic.hurtbox();
        if (!overlap(box, hb)) continue;
        const px = (Math.max(box.x, hb.x) + Math.min(box.x + box.w, hb.x + hb.w)) / 2;
        const py = (Math.max(box.y, hb.y) + Math.min(box.y + box.h, hb.y + hb.h)) / 2;
        hits.push([att, vic, att.part, att.facing, px, py]);
      }
    }
    // apply simultaneously so trades are fair
    for (const h of hits) this.applyHit(h[0], h[1], h[2], h[3], h[4], h[5], false);
  }

  applyHit(att, vic, spec, dir, px, py, isProj) {
    const g = this.game;
    const wasStun = vic.state === 'hitstun';
    const dmg = spec.dmg * (isProj ? 1 : att.chargeMul || 1);
    vic.hp = Math.max(0, vic.hp - dmg);

    // scythe-style side swap / carry
    if (!isProj && (spec.carry || spec.behind)) {
      const hdx = att.heldDx(), fwd = hdx === att.facing, back = hdx === -att.facing;
      const behind = spec.behind === 'always' || (spec.behind === 'unlessFwd' && !fwd) || (spec.behind === 'ifBack' && back);
      if (behind) dir = -att.facing;
      if (spec.carry) {
        vic.x = att.x + (behind ? -1 : 1) * att.facing * 15;
        vic.y = Math.min(0, att.y - 2);
      }
    }
    const lowHp = 1 - vic.hp / vic.maxHp;
    // non-finisher hits push less so strings stay in reach; finishers keep their launch
    const base = spec.kb[1] < 6.5 ? spec.kb[1] * 0.85 : spec.kb[1];
    const a = spec.kb[0] * D2R, F = base * (0.9 + 0.4 * lowHp);
    // non-finishers push less sideways so the attacker can keep up; launches keep full force
    vic.vx = Math.cos(a) * F * dir * (spec.kb[1] < 6.5 ? 0.65 : 1);
    vic.vy = Math.sin(a) * F;
    if (!isProj && spec.carry) { vic.vx += att.vx; vic.vy += Math.min(0, att.vy); }
    if (!isProj && spec.together) {
      // attacker and victim travel as a pair (sword dlight hop, scythe scoop, gauntlet uppercut)
      vic.x = att.x + att.facing * 16; vic.y = Math.min(0, att.y);
      vic.vx = att.vx; vic.vy = att.vy * 0.9;
    }
    // fast lunges brake on hit so you don't run straight through your target
    if (!isProj && spec.vx != null && Math.abs(spec.vx) >= 4 && !spec.rocket) att.vx *= 0.35;
    if (vic.ground && vic.vy > 0) vic.vy = -vic.vy * 0.6;   // spiked on the ground -> pop up
    if (vic.vy < 0) vic.ground = false;
    const stunMul = this.comboStun(att, vic, spec, isProj, wasStun);
    Object.assign(vic, {
      state: 'hitstun', sf: 0, move: null, part: null, rf: -1, gc: false, fastfall: false,
      stun: Math.round(spec.stun * 1.45 * stunMul), facing: -dir, recAvail: true, airDodge: true, chain: null,
    });
    if (vic.jumps === 0) vic.jumps = 1;   // hit while out of jumps: get one back
    vic.trail.length = 0;
    vic.combo = wasStun ? vic.combo + 1 : 1;
    if (vic.combo >= 2) att.comboShow = { n: vic.combo, t: 100 };

    const stop = Math.min(14, 3 + Math.round(dmg * 0.8));
    vic.hitstop = stop; vic.flash = stop + 2;
    const sameMove = att.state === 'attack' && (!isProj || spec.minst === att.moveInst);
    if (sameMove) {
      att.partHit = true; att.moveHit = true;
      att.chaseN = Math.max(att.chaseN, att.move.air ? 1 : 2); att.chaseT = 999;  // chase dodge
    }
    if (!isProj && spec.stopOnHit) {
      // rocket lance recovery: victim carries on along your path, you stop dead
      vic.vx += att.vx * 0.8; vic.vy += Math.min(0, att.vy) * 0.8;
      att.vx = 0; att.vy = 0;
    }
    if (!isProj) {
      att.hitstop = stop; att.hitCount++; att.lastHitF = att.af;
      if (spec.bounce) { att.vy = spec.bounce; att.ground = false; }
    }

    const ang = Math.atan2(Math.sin(a), Math.cos(a) * dir);
    this.hitSpark(px, py, dmg, ang);
    // speed warp: big launches, or any hit past the 4th in a combo
    if (F >= 6.5 || vic.combo > 4) g.speedLines(ang, vic.combo > 4 ? 20 : 16);
    g.shake(Math.min(6, 1 + dmg * 0.45));
    SFX.hit(dmg);

    // each weapon has its own finisher (src/kills.js)
    if (vic.hp <= 0) startKill(this, att, vic, weaponStyle(att, spec, isProj), dir, px, py);
  }

  // Combo decay, so no loop is infinite. Brawlhalla scales force with damage taken; HP rounds don't, so:
  //  - from the 3rd move of a combo on, each new move gives 10% less hitstun (down to 55%)
  //  - a move already used in this combo gives 35% less hitstun (stale)
  //  - projectiles lose hitstun as they travel (100% up to 30px, down to 50% at 140px)
  // The starter and the first follow-up are untouched, so every 2-hit combo works as designed.
  comboStun(att, vic, spec, isProj, wasStun) {
    if (!wasStun || !vic.cInst) { vic.cInst = []; vic.cIds = []; }
    const inst = isProj ? spec.minst : att.moveInst;
    const id = isProj ? spec.mid : att.move && att.move.id;
    let k = vic.cInst.indexOf(inst);
    let mul = 1;
    if (k < 0) {
      k = vic.cInst.length;
      if (k > 0 && id && vic.cIds.includes(id)) mul *= COMBO.stale;
      vic.cInst.push(inst); vic.cIds.push(id);
    } else if (k > 0 && id && vic.cIds.indexOf(id) < k) mul *= COMBO.stale;
    mul *= Math.max(COMBO.floor, 1 - COMBO.decay * Math.max(0, k - 1));
    if (isProj && spec.dist != null) mul *= clamp(1 - (spec.dist - COMBO.projNear) / COMBO.projFall, 0.5, 1);
    return mul;
  }

  // ---------------- projectiles ----------------
  spawnProj(owner, spec) {
    const h = owner.sk.handA, dir = owner.facing;
    const a = spec.ang * D2R;
    const vx = Math.cos(a) * spec.spd * dir, vy = Math.sin(a) * spec.spd;
    const y = spec.low ? owner.y - 4 : h[1];
    this.projs.push({
      type: spec.type, x: h[0] + sign(vx) * 4, y, vx, vy,
      g: spec.type === 'arrow' ? 0.03 : 0, owner, dmg: spec.dmg, kb: spec.kb, stun: spec.stun,
      life: spec.life || 34, stuck: 0, dead: false, rot: 0, spin: 0,
      minst: owner.moveInst, mid: owner.move ? owner.move.id : null, dist: 0, low: spec.low,
    });
    if (spec.rx) owner.vx += spec.rx * dir;
    if (spec.ry && !owner.ground) owner.vy = Math.min(owner.vy, 0) + spec.ry;
    if (spec.type === 'arrow') owner.bowShot = owner.clock;   // string snap-back (render.js)
    this.fx.push({ k: 'muzzle', x: h[0] + Math.cos(a) * dir * 5, y: h[1] + Math.sin(a) * 5, t: 0, life: 4 });
    SFX.shoot(spec.type);
  }

  throwWeapon(f, dy) {
    if (!f.weapon) return;
    const ang = dy < 0 ? -55 : dy > 0 && !f.ground ? 45 : -8;
    const a = ang * D2R, spd = f.weapon === 'staff' ? 9.4 : 8.5, h = f.sk.handA;
    this.projs.push({
      type: 'thrown', wtype: f.weapon, x: h[0], y: Math.min(h[1], -12), vx: Math.cos(a) * spd * f.facing, vy: Math.sin(a) * spd,
      g: 0.18, owner: f, dmg: 7, kb: [-35, 5], stun: 18, life: 140, stuck: 0, dead: false,
      rot: 0, spin: 0.45 * f.facing, bounces: 0, minst: -1,
    });
    f.weapon = null;
    SFX.throw();
  }

  dropWeapon(f) {
    this.addPickup(f.weapon, f.x + f.facing * 6, -16, f.facing * 0.5, -2.5, false);
    f.weapon = null;
    SFX.throw();
  }

  // swept test along this frame's movement so point-blank / fast shots can't tunnel; true if it hit someone
  projHit(p, ox, oy, fighters) {
    for (const f of fighters) {
      if (f === p.owner || f.inv > 0 || f.state === 'ko') continue;
      const hb = f.hurtbox();
      let hit = false;
      for (let k = 0; k <= 4 && !hit; k++) {
        const sx = ox + (p.x - ox) * (k / 4), sy = Math.min(0, oy + (p.y - oy) * (k / 4));
        hit = sx > hb.x - 3 && sx < hb.x + hb.w + 3 && sy > hb.y - 3 && sy < hb.y + hb.h + 3;
      }
      if (hit) {
        this.applyHit(p.owner, f, p, sign(p.vx) || p.owner.facing, p.x, Math.min(0, p.y), true);
        if (p.type === 'thrown') this.toPickup(p, true);
        else p.dead = true;
        return true;
      }
    }
    return false;
  }

  updateProjs(fighters) {
    for (const p of this.projs) {
      if (p.dead) continue;
      if (p.stuck) { if (--p.stuck <= 0) p.dead = true; continue; }
      const ox = p.x, oy = p.y;
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.spin; p.life--;
      if (p.dist != null) p.dist += Math.hypot(p.vx, p.vy);
      // hit test before the floor check, so point-blank downward shots still land on a grounded target
      if (p.type !== 'thrown' && p.life > 0 && this.projHit(p, ox, oy, fighters)) continue;
      if (p.y >= 0) {
        if (p.type === 'arrow') { p.y = 0; p.stuck = 45; }
        else if (p.type === 'thrown') {
          // thrown weapons bounce a little, then lie down as a pickup
          if (p.bounces < 2 && Math.abs(p.vy) > 2) { p.y = 0; p.vy = -Math.abs(p.vy) * 0.4; p.vx *= 0.6; p.bounces++; this.dust(p.x, 0, 2, 0); }
          else this.toPickup(p, false);
        } else if (p.low && p.vy === 0) { p.y = -1; }
        else {
          p.dead = true; this.dust(p.x, 0, 2, 0);
        }
        continue;
      }
      if (p.type === 'thrown' && Math.hypot(p.vx, p.vy) < 4) continue; // too slow to hurt
      if (p.life <= 0) { if (p.type === 'thrown') this.toPickup(p, false); else p.dead = true; continue; }
      if (p.type === 'thrown') this.projHit(p, ox, oy, fighters);
    }
    this.projs = this.projs.filter((p) => !p.dead);
  }

  toPickup(p, bounced) {
    p.dead = true;
    this.addPickup(p.wtype, p.x, Math.min(p.y, -1), bounced ? -p.vx * 0.2 : p.vx * 0.15, bounced ? -3.5 : -1.5, false);
  }

  // ---------------- weapon pickups ----------------
  addPickup(type, x, y, vx, vy, sky) {
    // fresh sky drops are mystery crates: the weapon is only revealed when someone grabs it
    this.pickups.push({ type, x, y, vx, vy, sky, hidden: sky, falling: true, life: 1800, t: 0 });
  }

  tryPickup(f) {
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      const dy = p.y - f.y;
      if (Math.abs(p.x - f.x) < 20 && dy > -52 && dy < 18) {
        f.weapon = p.type;
        this.pickups.splice(i, 1);
        this.ring(p.x, p.y - 6, 16);
        this.fx.push({ k: 'label', x: f.x, y: f.y - 54, t: 0, life: 40, s: WEAPONS[p.type].name });
        SFX.pickup();
        return true;
      }
    }
    return false;
  }

  updatePickups(fighters, camX) {
    for (const p of this.pickups) {
      p.t++; p.life--;
      if (!p.falling) { if (p.landT != null) p.landT++; continue; }
      // sky drops float down under a parachute, drifting side to side
      if (p.sky) { p.vy = 1.4; p.vx = Math.sin(p.t * 0.045) * 0.35; } else p.vy += 0.3;
      p.x += p.vx; p.y += p.vy; if (!p.sky) p.vx *= 0.97;
      if (p.y >= 0) {
        if (p.sky) p.landT = 0;   // starts the canopy collapse
        p.y = 0; p.falling = false; p.sky = false; this.dust(p.x, 0, 3, 0);
      }
    }
    this.pickups = this.pickups.filter((p) => p.life > 0);

    // opening: a single weapon in the middle to fight over; the second only drops once it's grabbed
    if (this.dropStage === 1) {
      if (this.pickups.some((p) => p.opening)) return;
      this.dropStage = 2; this.spawnT = 90;
    }
    if (--this.spawnT <= 0) {
      const mid = (fighters[0].x + fighters[1].x) / 2;
      const next = () => { let t; do t = pick(WEAPON_DROP); while (t === this.lastDrop); this.lastDrop = t; return t; };
      if (this.dropStage === 0) {
        this.addPickup(next(), mid, -300, 0, 0, true);
        this.pickups[this.pickups.length - 1].opening = true;
        this.dropStage = 1;
      } else {
        // lean the drop toward whoever is still empty-handed
        const bare = fighters.filter((f) => !f.weapon);
        const x = bare.length === 1 ? lerp(mid, bare[0].x, 0.6) : mid + rand(-50, 50);
        if (this.pickups.length < 2) this.addPickup(next(), x, -300, 0, 0, true);
        this.spawnT = randi(300, 480);
      }
    }
  }

  // ---------------- effects ----------------
  dust(x, y, n, dir) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: x + rand(-4, 4), y: y - rand(0, 2), vx: dir * rand(0.5, 2) + rand(-0.8, 0.8), vy: -rand(0.3, 1.8), life: randi(14, 26), t: 0, s: 1, plus: Math.random() < 0.5, col: Math.random() < 0.5 ? PAL.mid : PAL.light });
    }
  }
  ring(x, y, r) { this.fx.push({ k: 'ring', x, y, r, t: 0, life: 10 }); }
  // rocket exhaust from the back of the lance
  exhaust(f) {
    const h = f.sk.handA, d = f.sk.wdir;
    const bx = h[0] - d[0] * 10, by = h[1] - d[1] * 10;
    for (let i = 0; i < 2; i++) {
      this.parts.push({ x: bx + rand(-1, 1), y: by + rand(-1, 1), vx: -d[0] * rand(2, 4) + f.vx * 0.3, vy: -d[1] * rand(2, 4) + rand(-0.5, 0.5), life: randi(6, 12), t: 0, s: randi(2, 3), nograv: 1, col: pick([PAL.yellow, PAL.orange, PAL.orange, PAL.red]), ring: Math.random() < 0.3 });
    }
  }
  hitSpark(x, y, dmg, ang) {
    this.fx.push({ k: 'spark', x, y, t: 0, life: 8 + Math.floor(dmg / 2), size: 7 + dmg * 1.3, rot: rand(0, 6.28), seed: rand(0, 100) });
    if (dmg >= 7) this.fx.push({ k: 'orb', x, y, r: 8 + dmg, t: 0, life: 14 });
    const cols = [PAL.yellow, PAL.yellow, PAL.orange, PAL.red];
    for (let i = 0; i < 4 + dmg; i++) {
      const a2 = ang + rand(-0.9, 0.9), sp = rand(1.5, 4.5);
      this.parts.push({ x, y, vx: Math.cos(a2) * sp, vy: Math.sin(a2) * sp - 0.8, life: randi(12, 24), t: 0, s: randi(2, 3), ring: Math.random() < 0.7, col: pick(cols), floaty: 1 });
    }
  }
  shockwave(f) {
    this.fx.push({ k: 'shock', x: f.x, y: 0, t: 0, life: 14 });
    this.dust(f.x - 6, 0, 5, -1); this.dust(f.x + 6, 0, 5, 1);
    this.game.shake(3);
  }
  blast(f) {
    this.fx.push({ k: 'ring', x: f.x, y: f.y - 4, r: 22, t: 0, life: 12 });
    this.fx.push({ k: 'spark', x: f.x, y: f.y - 2, t: 0, life: 10, size: 16, rot: 0, seed: 7 });
    this.dust(f.x, f.y, 6, 0);
    SFX.thud();
  }

  updateFx() {
    for (const p of this.parts) { p.t++; p.x += p.vx; p.y += p.vy; if (!p.nograv) p.vy += p.floaty ? 0.05 : 0.15; p.vx *= 0.94; if (p.floaty) p.vy *= 0.94; if (p.y > 0) { p.y = 0; p.vy *= -0.3; } }
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const K of this.kills) killTick(this, K);
    for (const e of this.fx) e.t++;
    this.fx = this.fx.filter((e) => e.t < e.life);
  }
}
