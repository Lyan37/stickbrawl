'use strict';
// ---------- fighter: movement, dodges, multi-part attacks, hitstun ----------
const PHYS = {
  grav: 0.42, maxFall: 6.5, fastFall: 10.5, run: 3.1, accel: 0.7, fric: 0.6,
  air: 2.8, jump: -7.6, airJump: -6.9, airJumps: 2,
  dash: 6.6, dashT: 15, gpV: 9.5,
};
// Brawlhalla dodge rules (frames @60fps)
const DODGE = {
  groundInv: 16, groundT: 20, groundCD: 60,
  airSpotInv: 20, airSpotT: 22, airDirInv: 12, airDirT: 22, airCD: 163, airClear: 75,
  chaseInv: 17, chaseT: 18, chaseWin: 12,
};
const BUF = 8;                       // input buffer
const HURT_W = 14, HURT_H = 36;
const REPEAT_BLOCK = 10;             // same light attack can't be repeated back-to-back (whiff spam)
const LENIENT = 3;                   // frames after pressing light where a late direction still re-picks the move
const REC_ON_HIT = 0.55;             // recovery is shorter when the move connected (Brawlhalla rule)
const CHAIN_WINDOW = 24;             // greatsword chain stays live this long after a move ends
const WHIFF_DODGE_LOCK = 7;          // Brawlhalla: no dodging for 7f after an attack that missed
// combo decay (see World.comboStun): hitstun multipliers that stop loops from being infinite
const COMBO = { decay: 0.1, floor: 0.55, stale: 0.65, projNear: 30, projFall: 220 };
// scarf cloth (verlet): tails = [points, segment length]; trail pushes tails behind the facing,
// wind is a constant breeze, flutter is a ripple travelling down each tail
const SCARF = { tails: [[8, 3], [6, 2.6]], damp: 0.9, grav: 0.13, trail: 0.05, wind: -0.02, flutter: 0.16, iters: 4 };
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const normTo = (pose, ref) => { const o = pose.slice(); for (let i = 0; i < 10; i++) o[i] = ref[i] + wrapDeg(o[i] - ref[i]); return o; };
let MOVE_INST = 0;

class Fighter {
  constructor(id) {
    this.id = id;
    this.ctrl = NULL_CTRL;
    this.wins = 0;
    this.name = 'P' + (id + 1);
    this.reset(0, 1);
  }

  reset(x, facing) {
    Object.assign(this, {
      x, y: 0, vx: 0, vy: 0, facing, ground: true,
      state: 'idle', sf: 0, clock: 0, hp: 100, maxHp: 100, dispHp: 100,
      weapon: null, jumps: PHYS.airJumps, recAvail: true, airDodge: true, dodgeCD: 0, airDodgeAt: -1, gcUsed: false,
      move: null, part: null, pi: 0, pf: 0, af: -1, rf: -1, recLen: 0, moveInst: 0,
      partHit: false, moveHit: false, hitCount: 0, lastHitF: -99, gc: false, weakRec: false,
      charge: 0, chargeMul: 1, throwDir: 0, lastMove: null, lastEnd: -99, dodgeLock: 0, cInst: null, cIds: null,
      chain: null, chainT: 0, chaseN: 0, chaseT: 0,
      inv: 0, stun: 0, hitstop: 0, flash: 0, combo: 0, comboShow: null,
      dashDir: 0, fastfall: false, gravScale: 1, squash: 0, landT: 0,
      dodgeKind: null, dodgeT: 0, chaseDodge: false, runPhase: 0, prevDx: 0, kill: null, wpnAway: false, bowShot: -99, scarf: null,
    });
    this.buf = { jump: 0, light: 0, heavy: 0, dodge: 0, throw: 0 };
    this.bufDir = { jump: [0, 0], light: [0, 0], heavy: [0, 0], dodge: [0, 0], throw: [0, 0] };
    this.tap = { dir: 0, t: 0 };
    this.pose = this.stance().slice();
    this.partFrom = this.pose.slice(); this.recFrom = this.pose.slice();
    this.ghosts = []; this.trail = [];
    this.solve();
    this.stepScarf();
  }

  get wpn() { return WEAPONS[this.weapon || 'none']; }

  // weapon trails on the floor: run/dash for drag weapons, plus standing when the idle pose is the run carry (sword)
  dragging() {
    const w = this.wpn;
    if (!w.drag || !this.weapon || !this.ground) return false;
    return this.state === 'run' || this.state === 'dash' || (this.state === 'idle' && w.idleRun);
  }
  stance() { return this.wpn.STANCE; }
  hurtbox() { return { x: this.x - HURT_W / 2, y: this.y - HURT_H, w: HURT_W, h: HURT_H }; }
  get free() { return this.state === 'idle' || this.state === 'run' || this.state === 'air'; }
  heldDx() { const h = this.ctrl.held; return (h.right ? 1 : 0) - (h.left ? 1 : 0); }

  // runs every frame, even during hitstop, so inputs pressed in hit-freeze are kept
  bufferInput() {
    const c = this.ctrl, frozen = this.hitstop > 0;
    const hdx = (c.held.right ? 1 : 0) - (c.held.left ? 1 : 0), hdy = (c.held.down ? 1 : 0) - (c.held.up ? 1 : 0);
    for (const b in this.buf) {
      if (c.pressed[b]) this.bufDir[b] = [hdx, hdy];   // remember the direction held when the button was pressed
      if (c.pressed[b]) this.buf[b] = b === 'dodge' && this.state === 'attack' && this.moveHit ? 40 : BUF;
      else if (this.buf[b] > 0 && !frozen) this.buf[b]--;
    }
  }

  // ---------------- per-frame ----------------
  update(world) {
    const c = this.ctrl;
    const dx = (c.held.right ? 1 : 0) - (c.held.left ? 1 : 0);
    const dy = (c.held.down ? 1 : 0) - (c.held.up ? 1 : 0);

    let dtap = 0; // double-tap a direction = dash
    if (dx !== 0 && dx !== this.prevDx) {
      if (this.tap.dir === dx && this.tap.t > 0) dtap = dx;
      this.tap.dir = dx; this.tap.t = 14;
    }
    if (this.tap.t > 0) this.tap.t--;
    this.prevDx = dx;

    this.clock++;
    if (this.dodgeCD > 0) this.dodgeCD--;
    if (this.inv > 0) this.inv--;
    if (this.squash > 0) this.squash--;
    if (this.flash > 0) this.flash--;
    if (this.state !== 'attack') {
      if (this.chaseT > 0 && --this.chaseT === 0) this.chaseN = 0;
      if (this.chain && ++this.chainT > CHAIN_WINDOW) this.chain = null;
    }
    if (this.comboShow && --this.comboShow.t <= 0) this.comboShow = null;
    this.sf++;
    this.gravScale = 1;

    switch (this.state) {
      case 'idle':
      case 'run':
        if (this.tryActions(dx, dy, world, dtap, false)) break;
        this.vx = approach(this.vx, dx * PHYS.run, dx ? PHYS.accel : PHYS.fric);
        if (dx) this.facing = dx;
        this.state = dx || Math.abs(this.vx) > 0.4 ? 'run' : 'idle';
        break;
      case 'air':
        if (this.tryActions(dx, dy, world, 0, false)) break;
        this.airControl(dx, 1);
        if (dx) this.facing = dx;
        if (dy > 0 && this.vy > -1.5) this.fastfall = true;
        break;
      case 'dash':
        if (this.sf >= 2 && this.tryActions(dx, dy, world, 0, true)) break;
        if (this.sf < PHYS.dashT - 5) this.vx = this.dashDir * PHYS.dash;
        else this.vx = approach(this.vx, this.dashDir * PHYS.run, 0.5);
        if (this.sf % 2 === 0) this.addGhost();
        if (this.sf % 4 === 0) world.dust(this.x - this.dashDir * 4, 0, 1, -this.dashDir);
        if (this.sf >= PHYS.dashT) this.state = dx === this.dashDir ? 'run' : 'idle';
        break;
      case 'attack': this.attacking(dx, dy, world); break;
      case 'dodge': this.dodging(dx, dy, world); break;
      case 'land':
        this.vx = approach(this.vx, 0, 0.5);
        if (this.sf >= this.landT) this.state = 'idle';
        break;
      case 'hitstun':
        this.stun--;
        if (this.ground) this.vx = approach(this.vx, 0, 0.45);
        else this.vx *= 0.955;
        if (this.stun <= 0) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; this.combo = 0; }
        break;
      case 'ko':
        if (this.kill) killStep(this, world);   // weapon finisher (src/kills.js)
        else if (this.ground) this.vx = approach(this.vx, 0, 0.15);
        break;
    }

    this.physics(world);
    this.animate();
    this.solve();
    this.stepScarf();
    this.updateTrails();
  }

  // ---------------- actions ----------------
  // a buffered press uses the direction held when it was pressed, unless you're holding one now
  dirFor(b, dx, dy) { return dx || dy ? [dx, dy] : this.bufDir[b]; }

  tryActions(dx0, dy0, world, dtap, fromDash) {
    const b = this.buf;
    let [dx, dy] = b.light ? this.dirFor('light', dx0, dy0) : b.heavy ? this.dirFor('heavy', dx0, dy0) : b.throw ? this.dirFor('throw', dx0, dy0) : b.dodge ? this.dirFor('dodge', dx0, dy0) : [dx0, dy0];
    if (b.throw) {
      b.throw = 0;
      if (this.weapon) {
        if (this.ground && dy > 0) world.dropWeapon(this);
        else { this.throwDir = dy; if (dx) this.facing = dx; this.startMove(THROW_MOVE, { fromDash }); }
        return true;
      }
      world.tryPickup(this);
    }
    if (b.light && this.startAttack(dx, dy, fromDash, false)) { b.light = 0; return true; }
    if (b.heavy) {
      const m = this.wpn.moves;
      if (!this.ground) {
        b.heavy = 0;
        if (dy > 0) { this.startMove(m.gp); return true; }
        if (this.recAvail) { if (dx) this.facing = dx; this.startMove(m.rec); return true; }
        if (this.jumps > 0) { this.jumps--; if (dx) this.facing = dx; this.startMove(m.rec, { weak: true }); return true; } // exhausted recovery
      } else if (!this.weapon) {
        b.heavy = 0;
        // unarmed ground heavies (weapon ground heavies are signatures — not in this game)
        if (dx) this.facing = dx;
        this.startMove(dy > 0 ? m.dheavy : dx ? m.sheavy : m.nheavy, { fromDash });
        return true;
      }
    }
    if (b.dodge && !fromDash && this.tryDodge(dx, dy, world)) { b.dodge = 0; return true; }
    if (b.jump) {
      if (this.ground) { b.jump = 0; this.doJump(dx, true, fromDash, world); return true; }
      if (this.jumps > 0) { b.jump = 0; this.jumps--; this.doJump(dx, false, false, world); return true; }
    }
    if (dtap && this.ground && !fromDash) { this.startDash(dtap, world); return true; }
    return false;
  }

  doJump(dx, fromGround, fromDash, world) {
    if (fromDash) this.vx = this.dashDir * PHYS.dash * 0.95;           // dash jump keeps momentum
    else if (dx && (sign(this.vx) !== dx || Math.abs(this.vx) < PHYS.air)) this.vx = dx * PHYS.air;
    else if (!dx) this.vx *= 0.6;
    this.vy = fromGround ? PHYS.jump : PHYS.airJump;
    this.ground = false; this.state = 'air'; this.sf = 0; this.fastfall = false;
    if (dx) this.facing = dx;
    if (fromGround) world.dust(this.x, 0, 4, 0);
    else world.ring(this.x, this.y - 2, 9);
    SFX.jump();
  }

  startDash(dir, world) {
    this.state = 'dash'; this.sf = 0; this.dashDir = dir; this.facing = dir;
    this.vx = dir * PHYS.dash;
    world.dust(this.x, 0, 4, -dir);
    SFX.dash();
  }

  tryDodge(dx, dy, world) {
    const chase = this.chaseN > 0 && this.chaseT > 0;
    if (chase) {
      this.chaseN--;
      const ddy = this.ground ? Math.min(0, dy) : dy;
      if (dx || ddy) { const n = Math.hypot(dx, ddy); this.startDodge('dir', dx / n, ddy / n, true, world); }
      else this.startDodge(this.ground ? 'spot' : 'air', 0, 0, true, world);
      return true;
    }
    if (this.clock < this.dodgeLock) return false;                        // just whiffed an attack
    if (this.ground && dx) { this.startDash(dx, world); return true; }   // ground dodge + side = dash
    if (this.dodgeCD > 0) return false;
    if (this.ground) { this.startDodge('spot', 0, 0, false, world); return true; }
    if (!this.airDodge) return false;
    this.airDodge = false; this.airDodgeAt = this.clock; this.gcUsed = false;
    if (dx || dy) { const n = Math.hypot(dx, dy); this.startDodge('dir', dx / n, dy / n, false, world); }
    else this.startDodge('air', 0, 0, false, world);
    return true;
  }

  startDodge(kind, ux, uy, chase, world) {
    this.state = 'dodge'; this.dodgeKind = kind; this.sf = 0; this.chaseDodge = chase; this.fastfall = false;
    if (chase) { this.inv = DODGE.chaseInv; this.dodgeT = DODGE.chaseT; }
    else if (kind === 'spot') { this.inv = DODGE.groundInv; this.dodgeT = DODGE.groundT; this.dodgeCD = DODGE.groundT + DODGE.groundCD; }
    else if (kind === 'air') { this.inv = DODGE.airSpotInv; this.dodgeT = DODGE.airSpotT; this.dodgeCD = DODGE.airCD; }
    else { this.inv = DODGE.airDirInv; this.dodgeT = DODGE.airDirT; this.dodgeCD = DODGE.airCD; }
    if (kind === 'dir') { this.vx = ux * 6.4; this.vy = uy * 6.4; if (ux) this.facing = sign(ux); }
    else if (kind === 'spot') this.vx *= 0.3;
    else { this.vx *= 0.4; this.vy = 0; }
    world.ring(this.x, this.y - 20, 14);
    SFX.dodge();
  }

  dodging(dx, dy, world) {
    const k = this.dodgeKind;
    if (!this.ground && this.inv === 0 && this.buf.heavy && (dy > 0 || this.recAvail || this.jumps > 0)) {
      this.state = 'air';
      if (this.tryActions(dx, dy, world, 0, false)) return;
      this.state = 'dodge';
    }
    // chase dodges can be cancelled into an attack
    if (this.chaseDodge && this.sf >= 1 && (this.buf.light || this.buf.heavy)) {
      const prev = this.state;
      this.state = this.ground ? 'idle' : 'air'; this.fromChase = true; this.dashDir = sign(this.vx) || this.facing;
      const ok = this.tryActions(dx, dy, world, 0, true);
      this.fromChase = false;
      if (ok) { this.inv = 0; return; }
      this.state = prev;
    }
    if (k === 'dir') {
      if (this.sf < 13) this.gravScale = 0;
      else { if (this.sf === 13) { this.vx *= 0.35; this.vy *= 0.35; } this.gravScale = 0.5; }
      if (this.sf % 2 === 0) this.addGhost();
    } else if (k === 'air') {
      this.gravScale = 0.08;
      this.vx *= 0.92;
      // gravity cancel: light during a neutral air dodge = grounded light in the air
      if (this.buf.light) {
        this.buf.light = 0; this.inv = 0; this.gcUsed = true;
        this.startAttack(dx, dy, false, true);
        return;
      }
    } else this.vx = approach(this.vx, 0, 0.5);
    if (this.sf >= this.dodgeT) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; }
  }

  // ---------------- attacks ----------------
  chainMove(dir, gc) {
    const base = dir + 'light', ch = this.chain;
    if (gc) return base + 'C';
    if (!ch) return base;
    if (ch.stage === 'opener') {
      if (dir === ch.dir) return base + 'C';
      const okAfter = { n: ['s', 'd', 'dair'], s: ['n', 'd', 'dair'], d: ['n', 's'] }[dir];
      return okAfter.includes(ch.dir) ? base + 'B' : base + 'C';
    }
    return base + 'C';
  }

  pickLight(dx, dy, gc, chain) {
    const W = this.wpn, m = W.moves, grounded = this.ground || gc;
    const dir = dy > 0 ? 'd' : dx ? 's' : 'n';
    if (!grounded) return m[dir + 'air'];
    if (!W.chain) return m[dir + 'light'];
    const keep = this.chain; this.chain = chain;
    const mv = m[this.chainMove(dir, gc)];
    this.chain = keep;
    return mv;
  }

  startAttack(dx, dy, fromDash, gc) {
    const chainBefore = this.chain;
    const mv = this.pickLight(dx, dy, gc, chainBefore);
    if (!this.fromChase && !(this.wpn.chain && (this.ground || gc)) && mv === this.lastMove && this.clock - this.lastEnd < REPEAT_BLOCK) return false;
    if (dx) this.facing = dx;
    // read ground before startMove: a move that leaps on frame 0 (bow dlight) must not be re-picked as an aerial
    const wasGround = this.ground;
    this.startMove(mv, { gc, fromDash });
    this.lenient = { gc, fromDash, chain: chainBefore, ground: wasGround };
    return true;
  }

  startMove(m, o = {}) {
    this.state = 'attack'; this.move = m; this.moveInst = ++MOVE_INST; this.sf = 0; this.lenient = null;
    this.moveHit = false; this.rf = -1; this.gc = !!o.gc; this.weakRec = !!o.weak; this.landedAir = false;
    this.charge = 0; this.chargeMul = 1;
    this.trail.length = 0;
    if (this.ground && !o.fromDash && m.kind !== 'throw') this.vx *= 0.4;
    if (m.kind === 'rec' && !o.weak) this.recAvail = false;
    // recovery's own launch replaces jump momentum, so jump+heavy doesn't swing 60px over the target
    if (m.kind === 'rec' && this.vy < -3) this.vy = -3;
    if (m.chain) { this.chain = m.chain === 'closer' ? null : { stage: m.chain, dir: m.id[0] }; this.chainT = 0; }
    this.enterPart(0);
  }

  enterPart(i) {
    let p = this.move.parts[i];
    if (p.altPart) {
      const dx = this.heldDx();
      if ((p.alt.when === 'fwd' && dx === this.facing) || (p.alt.when === 'back' && dx === -this.facing)) p = p.altPart;
    }
    this.pi = i; this.part = p; this.pf = 0; this.af = -1;
    this.partHit = false; this.hitCount = 0; this.lastHitF = -99;
    this.partFrom = normTo(this.pose, p.PS);
    if (p.vxS != null) this.vx = p.vxS * this.facing;
    if (p.vyS != null) { this.vy = p.vyS; if (p.vyS < 0) this.ground = false; }
  }

  advance() {
    const m = this.move, nx = m.parts[this.pi + 1];
    if (nx && (!nx.cond || this.partHit)) { this.enterPart(this.pi + 1); return; }
    this.rf = 0; this.af = -1; this.recLen = this.moveHit ? Math.ceil(m.r * REC_ON_HIT) : m.r;
    if (this.landedAir) this.recLen = Math.max(this.recLen, m.land);
    this.recFrom = this.pose.slice();
  }

  attacking(dx, dy, world) {
    const m = this.move;
    if (this.rf >= 0) {
      this.af = -1;
      // greatsword: a connected opener/bridge can be cancelled into the next link
      if (m.chain && m.chain !== 'closer' && this.moveHit && this.rf >= 4 && this.buf.light && this.ground) {
        this.buf.light = 0; this.endMove();
        if (!this.startAttack(dx, dy, false, false)) this.state = 'idle';
        return;
      }
      // feet off the ground + recovery available: heavy cancels the rest of the recovery frames
      if (!this.ground && this.buf.heavy && m.kind !== 'rec' && m.kind !== 'gp' && (dy > 0 || this.recAvail || this.jumps > 0)) {
        this.endMove();
        if (this.tryActions(dx, dy, world, 0, false)) return;
      }
      this.drift(dx, false);
      this.rf++;
      if (this.rf >= this.recLen) this.endMove();
      return;
    }
    let p = this.part;
    // advance lazily so a hit on the last active frame still counts for "on hit" follow-ups
    if (!p.fall && this.pf >= p.s + p.a) {
      this.advance();
      return this.attacking(dx, dy, world);
    }
    if (p.fall && this.partHit) {
      this.advance();
      if (this.rf < 0) return this.attacking(dx, dy, world);
      return;
    }
    // input leniency: a direction pressed a hair after light still picks the directional move
    if (this.lenient && this.pi === 0 && this.pf < LENIENT) {
      const L = this.lenient;
      // only upgrade (neutral -> directional / side <-> down); releasing the stick never downgrades
      if ((this.ground === L.ground || L.gc) && (dx || dy > 0)) {
        const mv = this.pickLight(dx, dy, L.gc, L.chain);
        if (mv !== this.move) {
          this.chain = L.chain;
          if (dx) this.facing = dx;
          const keepPose = this.partFrom;
          this.startMove(mv, { gc: L.gc, fromDash: true });
          this.partFrom = normTo(keepPose, this.part.PS);
          this.lenient = L;
        }
      }
    } else if (this.lenient && this.pf >= LENIENT) this.lenient = null;
    p = this.part;
    const f = this.pf;
    this.af = f;

    if (p.fall) {
      if (f < p.s) { this.vy *= 0.5; this.vx *= 0.85; this.gravScale = 0; }
      else {
        if (f === p.s) SFX.swing(true);
        this.vy = PHYS.gpV; this.gravScale = 0;
        if (p.steer === false) this.vx *= 0.9;
        else if (p.steerFwd) this.vx = approach(this.vx, dx === this.facing ? this.facing * 3 : 0, 0.3);
        else this.vx = approach(this.vx, dx * 1.6, 0.3);
        if (p.rocket && f % 2 === 0) world.exhaust(this);
        if (f % 2 === 0) this.addGhost();
      }
      if (p.proj) for (const q of p.proj) if (f === p.s + (q.f || 0)) world.spawnProj(this, q);
      this.pf++;
      return;
    }

    // hold heavy to charge (unarmed ground heavies)
    const cmax = p.chargeMax || 24;
    if (p.charge && f === p.s - 1 && this.ctrl.held.heavy && this.charge < cmax) {
      this.charge++;
      this.chargeMul = p.chargeLaunch ? 1 : this.charge >= cmax ? 1.25 : 1 + this.charge / 120;
      this.vx = approach(this.vx, 0, 0.4);
      if (!this.ground) { this.gravScale = 0.05; this.vy *= 0.7; }  // hover while charging
      if (this.charge % 3 === 0) world.ring(this.x, this.y - 20, 6 + (this.charge / cmax) * 10);
      return;
    }

    if (f === p.s) {
      const launch = p.chargeLaunch ? 0.8 + 0.5 * (this.charge / (p.chargeMax || 24)) : 1;
      if (p.vx != null) this.vx = p.vx * this.facing * launch;
      if (p.vy != null) {
        const vy = (this.weakRec ? p.vy * 0.7 : p.vy) * launch;
        this.vy = vy;
        if (vy < 0) { this.ground = false; this.fastfall = false; }
      }
      if (m.kind === 'throw') world.throwWeapon(this, this.throwDir);
      if (p.hb) SFX.swing(m.heavy);
    }
    if (p.proj) for (const q of p.proj) if (f === p.s + (q.f || 0)) world.spawnProj(this, q);
    if (this.gc) this.gravScale = 0.12;
    const active = f >= p.s && f < p.s + p.a;
    if (active && p.nograv) this.gravScale = 0;
    if (active && p.rocket) world.exhaust(this);
    if (!(active && p.rocket)) this.drift(dx, active);
    if (m.kind === 'rec' && f >= p.s && f < p.s + p.a && f % 2 === 0) this.addGhost();
    this.pf++;
  }

  drift(dx, active) {
    if (this.ground) this.vx = approach(this.vx, 0, active ? 0.22 : 0.45);
    else if (this.move.kind === 'rec') this.vx = approach(this.vx, dx * 2.2, 0.2);
    else this.airControl(dx, 0.8);   // near-full drift during aerials so you can steer into the target
  }

  endMove() {
    const m = this.move;
    if (m && m.kind === 'atk') {
      this.lastMove = m; this.lastEnd = this.clock;
      if (!this.moveHit) this.dodgeLock = this.clock + WHIFF_DODGE_LOCK;
    }
    if (this.chaseT > DODGE.chaseWin) this.chaseT = DODGE.chaseWin;
    if (m && m.chain) this.chainT = 0;
    this.move = null; this.part = null; this.gc = false; this.rf = -1; this.af = -1;
    this.state = this.ground ? 'idle' : 'air';
    this.sf = 0;
  }

  airControl(dx, mul) {
    const max = PHYS.air;
    if (dx && Math.abs(this.vx) > max && sign(this.vx) === dx) this.vx = approach(this.vx, dx * max, 0.05);
    else if (!dx && Math.abs(this.vx) > max) this.vx = approach(this.vx, 0, 0.1 * mul);
    else this.vx = approach(this.vx, dx * max, (dx ? 0.5 : 0.12) * mul);
  }

  // ---------------- physics ----------------
  physics(world) {
    if (!this.ground) {
      let g = PHYS.grav * this.gravScale * (this.state === 'hitstun' ? 0.78 : 1);
      if (this.fastfall && this.vy > -1) g *= 2;
      this.vy += g;
      const falling = this.state === 'attack' && this.part && this.part.fall && this.rf < 0;
      const cap = falling ? 99 : this.fastfall ? PHYS.fastFall : PHYS.maxFall;
      if (this.vy > cap) this.vy = approach(this.vy, cap, 0.6);
    }
    this.x += this.vx;
    this.y += this.vy;
    if (this.y >= 0) {
      const impact = this.vy;
      this.y = 0; this.vy = 0;
      if (!this.ground) { this.ground = true; this.onLand(world, impact); }
    } else this.ground = false;
  }

  onLand(world, impact) {
    this.jumps = PHYS.airJumps; this.recAvail = true; this.airDodge = true; this.fastfall = false;
    // air dodge cooldown: landing 75f+ after the dodge clears it, sooner leaves the rest of 75f
    if (this.airDodgeAt >= 0) {
      const el = this.clock - this.airDodgeAt;
      if (this.gcUsed || el >= DODGE.airClear) this.dodgeCD = 0;
      else this.dodgeCD = Math.min(this.dodgeCD, DODGE.airClear - el);
      this.airDodgeAt = -1;
    }
    if (impact > 2) { world.dust(this.x, 0, impact > 6 ? 6 : 3, 0); this.squash = 6; }
    switch (this.state) {
      case 'air':
        this.state = 'idle'; this.sf = 0;
        if (impact > 3) SFX.land();
        break;
      case 'attack': {
        const m = this.move, p = this.part;
        if (p && p.fall && this.rf < 0) {
          this.rf = 0; this.recLen = m.land; this.recFrom = this.pose.slice(); this.af = -1;
          world.shockwave(this);
          SFX.thud();
          if (m.bounceLand) { this.vy = m.bounceLand; this.ground = false; }
        } else if (m.air && !this.gc) {
          if (WEAPONS[m.wpn].chain && m.kind === 'atk') { this.chain = { stage: 'opener', dir: m.id === 'dair' ? 'dair' : m.id[0] }; this.chainT = 0; }
          if (this.rf < 0 && m.kind === 'atk') {
            // Brawlhalla: an aerial that touches down keeps playing as its grounded variant instead of vanishing,
            // so late aerials still hit grounded targets (it just gets landing lag added to its recovery)
            this.landedAir = true;
          } else {
            const land = this.rf >= 0 ? Math.min(m.land, Math.max(1, this.recLen - this.rf)) : m.land;
            this.endMove();
            this.state = 'land'; this.landT = land; this.sf = 0;
          }
        } else this.gc = false;
        break;
      }
      case 'hitstun':
        if (impact > 4.5) {
          this.vy = -impact * 0.45; this.ground = false;
          world.dust(this.x, 0, 5, 0); SFX.land();
        }
        break;
      case 'dodge':
        if (this.dodgeKind !== 'spot') { this.state = 'idle'; this.sf = 0; }
        break;
      case 'ko':
        if (this.kill && killLand(this, world, impact)) break;
        if (impact > 3) { this.vy = -impact * 0.35; this.ground = false; world.dust(this.x, 0, 6, 0); SFX.land(); }
        break;
    }
  }

  // ---------------- combat helpers ----------------
  activeBox() {
    const p = this.part;
    if (this.state !== 'attack' || this.rf >= 0 || !p || !p.hb) return null;
    const f = this.af;
    if (p.fall) { if (f < p.s || this.partHit) return null; }
    else if (f < p.s || f >= p.s + p.a) return null;
    const hb = p.hb;
    const x = this.facing === 1 ? this.x + hb[0] : this.x - hb[0] - hb[2];
    return { x, y: this.y + hb[1], w: hb[2], h: hb[3] };
  }

  canHit() {
    const p = this.part;
    return this.hitCount < p.hits && this.af - this.lastHitF >= p.every;
  }

  // ---------------- animation ----------------
  animate() {
    if (this.state === 'attack') { this.pose = this.attackPose(); this.wflip = (this.wflip || 0) * 0.5; return; }
    const st = this.stance();
    let target, k = 0.35;
    switch (this.state) {
      case 'idle': {
        const idle = this.wpn.IDLE || st;
        target = this.squash ? P(POSE.land, idle) : idle.slice();
        const br = Math.sin(this.sf * 0.08 + this.id * 2);
        target[0] += br * 1.5; target[1] += br * 3; target[3] -= br * 3;
        break;
      }
      case 'run':
        this.runPhase += Math.abs(this.vx) * 0.068 + 0.05;   // ~24f per stride at top speed (≈5 steps/s)
        target = runPose(this.runPhase, this.wpn.RUN || st, !!this.weapon); k = 0.5; break;
      case 'dash': target = P(POSE.dash, this.wpn.RUN || st); k = 0.55; break;   // keep the running carry (drag / lowered) through the dash
      case 'air': target = P(this.vy < 0 ? POSE.rise : POSE.fall, st); k = 0.22; break;
      case 'land': target = P(POSE.land, st); k = 0.5; break;
      case 'dodge': target = P(this.dodgeKind === 'dir' ? POSE.tuck : POSE.spot, st); k = 0.5; break;
      case 'hitstun': target = P(this.ground ? POSE.hurtLo : POSE.hurt, st); k = 0.6; break;
      case 'ko': { const [kp, kk] = killPose(this); target = P(kp, st); k = kk; break; }
      default: target = st.slice();
    }
    // idle holds with idleFlip (scythe tuck, sword drag) turn the blade to face backward; eased so it rolls over instead of popping
    const flipT = this.wpn.idleFlip && (this.state === 'idle' || ((this.state === 'run' || this.state === 'dash') && this.wpn.idleRun)) ? 1 : 0;
    this.wflip = (this.wflip || 0) + (flipT - (this.wflip || 0)) * 0.3;
    const cur = this.pose;
    for (let i = 0; i < 10; i++) cur[i] = target[i] + wrapDeg(cur[i] - target[i]);
    towardPose(cur, target, k);
  }

  attackPose() {
    if (this.rf >= 0) {
      const st = normTo(this.stance(), this.recFrom);
      const t = clamp((this.rf - 2) / Math.max(1, this.recLen - 2), 0, 1);
      return mixPose(this.recFrom, st, easeOut(t));
    }
    const p = this.part, f = Math.max(0, this.af);
    if (f < p.s) return mixPose(this.partFrom, p.PS, easeOut((f + 1) / p.s));
    if (p.fall) return mixPose(p.PS, p.PA, Math.min(1, (f - p.s + 1) / 3));
    const t = p.sweep ? easeOut(Math.min(1, (f - p.s + 1) / p.a)) : Math.min(1, (f - p.s + 1) / 2);
    return mixPose(p.PS, p.PA, t);
  }

  solve() {
    const p = this.pose, L = solvePose(p);
    let oy;
    if (this.ground) {
      oy = -Math.max(L.footA[1], L.footB[1], L.kneeA[1], L.kneeB[1], L.head[1] + 5, 2);
      // running: hop clear of the floor during each flight phase (eased so stopping doesn't pop)
      const lift = this.state === 'run' ? runLift(this.runPhase) * clamp(Math.abs(this.vx) / PHYS.run, 0, 1) : 0;
      this.runLift = (this.runLift || 0) + (lift - (this.runLift || 0)) * 0.6;
      oy -= this.runLift;
    } else { oy = -HIP_AIR + p[10]; this.runLift = 0; }
    const f = this.facing, x = this.x, y = this.y + oy, sk = {};
    for (const k in L) sk[k] = [x + L[k][0] * f, y + L[k][1]];
    // dragged weapons (wpn.drag = tip reach): re-aim every frame so the tip rests on the floor, no bounce
    if (this.dragging()) {
      const R = this.wpn.drag, dy = this.y - sk.handA[1];
      const want = 180 - Math.asin(clamp(dy / R, 0, 1)) / D2R;
      p[9] += wrapDeg(want - p[9]) * (this.state === 'idle' ? 0.35 : 0.85);
    }
    const wa = (f === 1 ? p[9] : 180 - p[9]) * D2R;
    sk.wdir = [Math.cos(wa), Math.sin(wa)];
    // flowy legs: each leg's bend point chases the real knee on an underdamped spring and
    // trails behind body motion, so the one-piece leg curve sways instead of snapping.
    if (!this.flow) this.flow = { A: L.kneeA.slice(), B: L.kneeB.slice(), vA: [0, 0], vB: [0, 0] };
    const fl = this.flow, dragX = clamp(-(this.vx || 0) * f * 0.9, -5, 5), dragY = clamp(-(this.vy || 0) * 0.5, -4, 4);
    for (const s of ['A', 'B']) {
      const pos = fl[s], vel = fl['v' + s], ft = L['foot' + s];
      // human knee: must sit on the "front" side of the hip→foot line (cross < 0, hip at origin).
      // Poses that bend it backwards get mirrored across that line; the foot stays where it is.
      const fl2 = ft[0] * ft[0] + ft[1] * ft[1] || 1;
      const side = (k) => ft[0] * k[1] - ft[1] * k[0];
      const mirror = (k) => {
        const d = (k[0] * ft[0] + k[1] * ft[1]) / fl2, px = ft[0] * d, py = ft[1] * d;
        return [2 * px - k[0], 2 * py - k[1]];
      };
      let tgt = L['knee' + s];
      if (side(tgt) > 0) tgt = mirror(tgt);
      for (let i = 0; i < 2; i++) {
        vel[i] = (vel[i] + (tgt[i] + (i ? dragY : dragX) - pos[i]) * 0.3) * 0.72;
        pos[i] += vel[i];
      }
      // spring/drag may swing it past the line: clamp to straight instead of a backwards bow
      let b = pos;
      if (side(b) > 0) { const d = (b[0] * ft[0] + b[1] * ft[1]) / fl2; b = [ft[0] * d, ft[1] * d]; }
      sk['bend' + s] = [x + b[0] * f, y + b[1]];
    }
    // flexible spine: the torso's mid point bows slightly out toward the back and chases its
    // target on a spring, so the back sways a little with each stride (no running hunch).
    {
      const nk = L.neck, tl = Math.hypot(nk[0], nk[1]) || 1;
      const nx = nk[1] / tl, ny = -nk[0] / tl; // perpendicular pointing out of the back
      const hunch = 0.8;   // keep the back straight-ish even when running/dashing
      const tgt = [nk[0] * 0.5 + nx * hunch, nk[1] * 0.5 + ny * hunch];
      if (!fl.S) { fl.S = tgt.slice(); fl.vS = [0, 0]; }
      const pos = fl.S, vel = fl.vS;
      for (let i = 0; i < 2; i++) {
        vel[i] = (vel[i] + (tgt[i] + (i ? dragY : dragX) * 0.4 - pos[i]) * 0.25) * 0.75;
        pos[i] += vel[i];
      }
      sk.spine = [x + pos[0] * f, y + pos[1]];
    }
    this.sk = sk;
  }

  // ---------------- scarf ----------------
  // knot at the back end of the muffler band (lower head, above the shoulders where the arms attach)
  scarfKnot() {
    const sk = this.sk, n = sk.neck, h = sk.head, f = this.facing;
    const ux = h[0] - n[0], uy = h[1] - n[1], l = Math.hypot(ux, uy) || 1;
    const bx = (uy / l) * f, by = (-ux / l) * f;   // perpendicular pointing out of the back
    return [n[0] + (ux / l) * 1.7 + bx * 4.4, n[1] + (uy / l) * 1.7 + by * 4.4];
  }

  // two verlet cloth tails pinned to the knot: they keep their own momentum, so they stream
  // behind runs, dashes and launches, whip around on turns, sag when still and ripple in the breeze
  stepScarf() {
    const a = this.scarfKnot(), f = this.facing;
    if (this.scarf && Math.hypot(this.scarf[0].p[0][0] - a[0], this.scarf[0].p[0][1] - a[1]) > 40) this.scarf = null; // teleported
    if (!this.scarf) {
      this.scarf = SCARF.tails.map(([n, seg]) => {
        const p = [];
        for (let i = 0; i < n; i++) p.push([a[0] - f * i * seg * 0.8, a[1] + i * seg * 0.6]);
        return { p, o: p.map((q) => q.slice()), seg };
      });
      return;
    }
    const t = this.clock, floorY = this.y <= 0.5 ? -0.6 : Infinity;
    this.scarf.forEach(({ p, o, seg }, j) => {
      const n = p.length;
      o[0][0] = p[0][0]; o[0][1] = p[0][1];
      p[0][0] = a[0]; p[0][1] = a[1];
      for (let i = 1; i < n; i++) {
        const q = p[i], r = o[i], k = i / (n - 1);
        const vx = (q[0] - r[0]) * SCARF.damp, vy = (q[1] - r[1]) * SCARF.damp;
        r[0] = q[0]; r[1] = q[1];
        // ripple pushes sideways to the tail's own direction, stronger toward the tip
        const pr = p[i - 1], dx = q[0] - pr[0], dy = q[1] - pr[1], dl = Math.hypot(dx, dy) || 1;
        const wave = Math.sin(t * 0.22 - i * 0.9 + j * 1.9) * SCARF.flutter * (0.3 + k);
        q[0] += vx - f * SCARF.trail + SCARF.wind + (-dy / dl) * wave;
        q[1] += vy + SCARF.grav + (dx / dl) * wave;
      }
      for (let it = 0; it < SCARF.iters; it++) {
        for (let i = 1; i < n; i++) {
          const A = p[i - 1], B = p[i], dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 0.001;
          const e = (d - seg) / d;
          if (i === 1) { B[0] -= dx * e; B[1] -= dy * e; }   // root segment: knot is pinned
          else { A[0] += dx * e * 0.5; A[1] += dy * e * 0.5; B[0] -= dx * e * 0.5; B[1] -= dy * e * 0.5; }
        }
        for (let i = 1; i < n; i++) if (p[i][1] > floorY) p[i][1] = floorY;
      }
    });
  }

  addGhost() {
    this.ghosts.push({ sk: this.sk, age: 0, seed: Math.random() * 100, scarf: this.scarf && this.scarf.map((tl) => tl.p.map((q) => q.slice())) });
    if (this.ghosts.length > 5) this.ghosts.shift();
  }

  updateTrails() {
    for (const g of this.ghosts) g.age++;
    while (this.ghosts.length && this.ghosts[0].age > 12) this.ghosts.shift();
    for (const t of this.trail) t.age++;
    while (this.trail.length && this.trail[0].age > 5) this.trail.shift();
    const m = this.move, p = this.part;
    if (this.state !== 'attack' || !m || !m.trail || this.rf >= 0 || !p || this.af < p.s - 1) return;
    if (p.fall ? this.partHit : this.af > p.s + p.a) return;
    const sk = this.sk, f = this.facing;
    let [a, b] = trailSeg(this.wpn, p.limb, sk, sk.wdir, f);
    // stretch the smear forward so it reaches the hitbox edge; the most forward point of the
    // swing gets the full push, points level with or behind the body get none (keeps the arc shape)
    if (p.ext && p.vis > 0) {
      const rel = (b[0] - this.x) * f;
      b = [b[0] + f * p.ext * clamp(rel / p.vis, 0, 1), b[1]];
    }
    this.trail.push({ a, b, age: 0 });
  }
}
