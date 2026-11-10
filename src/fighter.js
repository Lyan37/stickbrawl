'use strict';
// ---------- fighter: movement, dodges, multi-part attacks, hitstun ----------
const PHYS = {
  grav: 0.42, maxFall: 6.5, fastFall: 10.5, run: 3.1, accel: 0.7, fric: 0.6,
  air: 2.8, jump: -7.6, airJump: -6.9, airJumps: 2,
  dash: 6.6, dashT: 15, gpV: 9.5,
};
// dodge rules (frames @60fps). inv = invincible frames; the rest of T is the dodge's recovery.
// roll = ground dodge + side (invincible dash); falls back to a plain dash while dodge is on cooldown.
const DODGE = {
  groundCD: 54,                      // ground dodge cooldown (rolls / up-dodge); neutral dodge = burst
  rollInv: 18, rollT: 26, rollMove: 15, rollSpd: 6.4,
  airSpotInv: 26, airSpotT: 32, airDirInv: 18, airDirT: 28, airDirMove: 16, airDirSpd: 6.4, airCD: 150, airClear: 70,
  chaseInv: 20, chaseT: 22, chaseWin: 18,
  buf: 12,                           // dodge presses are buffered a bit longer than other buttons
  lenient: 4,                        // a direction pressed this soon after a neutral dodge still turns it directional
};
// crouch block (hold down on the ground): blocks hits from the front for chip damage.
// Ground pounds are overheads and break it; chip that would KO lands as a real hit instead.
// stun: blockstun = move stun × this (min stunMin), a bit longer than before (was 0.8×) so blocking holds you longer
const GUARD = { chip: 0.2, stun: 0.95, stunMin: 8, push: 2.4, attPush: 1.2, stop: 5, hurtH: 25 };
// parry = TAP DOWN on the ground: starts the weapon's deflect move (weapons.js PARRY_SWING). Its first `win`
// frames catch an incoming hit, cancel it and stun the attacker. Still holding down when the window ends ->
// crouch block instead; a tap that caught nothing -> recovery (punishable, no swing). down + attack/throw/dodge
// within `lenient` frames still gives the down move. `cd` keeps one parry per ~1 s, tapped or held.
// On a SUCCESSFUL melee parry the weapon's parry attack (moves.parryAtk) fires automatically at the attacker,
// then the riposte pose follows (weapon aimed at the enemy, cancellable on any frame).
// The parried fighter can't do anything about it: no counter-parry.
const PARRY = { win: PARRY_WIN, lenient: 3, cd: 52, stun: 38, stop: 12, inv: 10, riposte: 24 };
// recovery-frame system: every committal action ends in recovery frames (see Fighter.phase()).
// Whiffs recover slower, connected hits faster (REC_ON_HIT), blocked hits at the base value.
// Getting hit during your own recovery is a PUNISH: extra damage and hitstun.
const RECOVERY = { whiff: 1.25, punishDmg: 1.2, punishStun: 1.3 };
// burst (YOMI Hustle style): dodge with NO direction, costs a full burst bar. Works as a combo breaker while
// in hitstun/blockstun, and in neutral (where spot dodge used to be). Invincible burst that knocks the
// opponent back a little for chip damage (non-lethal) and refreshes your air options; the last frames are recovery.
// Works on the ground and in the air (a combo breaker mid-juggle too).
// In the air a neutral dodge is still the air dodge (gravity cancel) while you have it.
// Meter: regen per frame (empty to full in ~60 s), + per damage taken / dealt; each round starts at `start`.
const BURST = { max: 100, start: 50, regen: 100 / 3600, onHurt: 3, onHit: 1, t: 20, inv: 14, hover: 12, radius: 60, chip: 2, push: 3.5, pushUp: -2, stun: 18, stop: 8 };
const BUF = 8;                       // input buffer
const PICKUP_BUF = 16;               // unarmed throw press stays live this long, so running onto a weapon still grabs it
const HURT_W = 14, HURT_H = 36;
const FRAME_HIST = 60;              // frames kept for the frame meter
const REPEAT_BLOCK = 10;             // same light attack can't be repeated back-to-back (whiff spam)
const LENIENT = 3;                   // frames after pressing light where a late direction still re-picks the move
const REC_ON_HIT = 0.4;              // recovery is shorter when the move connected (Brawlhalla rule)
// hitstun = move stun × HITSTUN_MUL (× combo decay). Lowered from 1.45 so getting hit recovers faster;
// REC_ON_HIT dropped with it (0.55 → 0.4) so every on-hit link keeps the same frame advantage.
const HITSTUN_MUL = 1.32;
const CHAIN_WINDOW = 24;             // greatsword chain stays live this long after a move ends
const WHIFF_DODGE_LOCK = 7;          // Brawlhalla: no dodging for 7f after an attack that missed
// combo decay (see World.comboStun): hitstun multipliers that stop loops from being infinite
const COMBO = { decay: 0.1, floor: 0.55, stale: 0.65, projNear: 30, projFall: 220 };
// scarf cloth (verlet): tails = [points, segment length]; trail pushes tails behind the facing,
// wind is a constant breeze, flutter is a ripple travelling down each tail
const SCARF = { tails: [[8, 3], [6, 2.6]], damp: 0.9, grav: 0.13, trail: 0.05, wind: -0.02, flutter: 0.16, iters: 4 };
// attack direction from the stick: diagonals resolve vertically (up-diag = neutral/up, down-diag = down);
// only pure left/right is a side attack
const attackDir = (dx, dy) => (dy > 0 ? 'd' : dy < 0 ? 'n' : dx ? 's' : 'n');
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
      weapon: null, jumps: PHYS.airJumps, recAvail: true, airDodge: true, airDash: true, dodgeCD: 0, airDodgeAt: -1, gcUsed: false,
      move: null, part: null, pi: 0, pf: 0, af: -1, rf: -1, recLen: 0, moveInst: 0,
      partHit: false, moveHit: false, hitCount: 0, lastHitF: -99, gc: false, weakRec: false,
      charge: 0, chargeMul: 1, throwDir: 0, lastMove: null, lastEnd: -99, dodgeLock: 0, cInst: null, cIds: null,
      chain: null, chainT: 0, chaseN: 0, chaseT: 0, parryCD: 0, ripTarget: null, burst: BURST.start, moveBlocked: false, blockFlash: 0,
      fd: null, lastFD: null, fhist: [],
      inv: 0, stun: 0, hitstop: 0, flash: 0, combo: 0, comboShow: null,
      dashDir: 0, dashUX: 0, dashUY: 0, dashLen: false, fastfall: false, gravScale: 1, squash: 0, landT: 0,
      dodgeKind: null, dodgeT: 0, chaseDodge: false, runPhase: 0, prevDx: 0, kill: null, wpnAway: false, bowShot: -99, scarf: null,
    });
    // down = a fresh press of down on the ground (tap-down parry)
    this.buf = { jump: 0, light: 0, heavy: 0, dodge: 0, throw: 0, down: 0 };
    this.bufDir = { jump: [0, 0], light: [0, 0], heavy: [0, 0], dodge: [0, 0], throw: [0, 0], down: [0, 0] };
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
  hurtbox() {
    const h = this.crouching ? GUARD.hurtH : HURT_H;
    return { x: this.x - HURT_W / 2, y: this.y - h, w: HURT_W, h };
  }
  get crouching() { return this.state === 'block' || this.state === 'blockstun'; }
  get free() { return this.state === 'idle' || this.state === 'run' || this.state === 'air' || this.state === 'block' || this.state === 'riposte'; }

  // what this fighter is doing this frame, for the recovery-frame system and the frame meter:
  // startup | active | recovery | inv | parry | guard | block | stun | neutral
  // raw = ignore the parry overlay (frame counts report the nlight's own startup/active)
  phase(raw = false) {
    switch (this.state) {
      case 'attack': {
        if (!raw && this.parrying()) return 'parry';
        if (this.rf >= 0) return 'recovery';
        const p = this.part;
        if (!p) return 'startup';
        const f = Math.max(0, this.af);
        if (p.fall) return f >= p.s ? 'active' : 'startup';
        return f >= p.s && (p.hb || p.proj) ? 'active' : 'startup';   // hitbox-less parts count as startup
      }
      case 'dodge': return this.inv > 0 ? 'inv' : 'recovery';
      case 'land': return 'recovery';
      case 'block': return 'guard';
      case 'blockstun': return 'block';
      case 'burst': return this.inv > 0 ? 'inv' : 'recovery';
      case 'hitstun': return 'stun';
      case 'ko': return 'stun';
      default: return this.inv > 0 ? 'inv' : 'neutral';
    }
  }
  inRecovery() { return this.phase() === 'recovery'; }
  opponent(world) { return world.game.fighters.find((f) => f !== this); }
  heldDx() { const h = this.ctrl.held; return (h.right ? 1 : 0) - (h.left ? 1 : 0); }

  // runs every frame, even during hitstop, so inputs pressed in hit-freeze are kept
  bufferInput() {
    const c = this.ctrl, frozen = this.hitstop > 0;
    const hdx = (c.held.right ? 1 : 0) - (c.held.left ? 1 : 0), hdy = (c.held.down ? 1 : 0) - (c.held.up ? 1 : 0);
    for (const b in this.buf) {
      // down pressed in the air is a fast-fall, not a parry
      if (b === 'down' && !this.ground) { this.buf.down = 0; continue; }
      if (c.pressed[b]) this.bufDir[b] = [hdx, hdy];   // remember the direction held when the button was pressed
      if (c.pressed[b]) {
        this.buf[b] = b === 'dodge' ? (this.state === 'attack' && this.moveHit ? 40 : DODGE.buf)
          : b === 'throw' && !this.weapon ? PICKUP_BUF : BUF;
      }
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
    if (this.state !== 'ko' && world.game.mode !== 'intro') this.burst = Math.min(BURST.max, this.burst + BURST.regen);
    if (this.dodgeCD > 0) this.dodgeCD--;
    if (this.parryCD > 0) this.parryCD--;
    if (this.blockFlash > 0) this.blockFlash--;
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
        if (dy > 0 && this.ground) {
          // tap down = parry (the parry move turns into a block if down is still held when its window ends)
          if (this.buf.down && this.parryCD === 0) { this.buf.down = 0; this.startParry(); break; }
          this.startBlock(dx, world); break;
        }
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
      case 'block':   // crouch block: hold down
        if (this.tryActions(dx, dy, world, dtap, false)) break;
        if (dy <= 0 || !this.ground) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; break; }
        if (dx) this.facing = dx;
        this.vx = approach(this.vx, 0, 0.6);
        break;
      case 'blockstun':
        if (this.tryBreakBurst(world)) break;
        this.stun--;
        this.vx = approach(this.vx, 0, 0.3);
        if (this.stun <= 0) { this.state = dy > 0 && this.ground ? 'block' : this.ground ? 'idle' : 'air'; this.sf = 0; }
        break;
      case 'dash':
        // dashing onto a weapon: grab it from the first dash frame, keep the dash going
        if (this.buf.throw && !this.weapon && world.tryPickup(this)) this.buf.throw = 0;
        // leniency: a dodge-button dash re-aims if the direction comes in a hair late (8-way)
        if (this.dashLen && this.sf <= DODGE.lenient && (dx || dy)) {
          const gy = this.ground ? Math.min(0, dy) : dy;
          if ((dx || gy) && (dx !== sign(this.dashUX) || gy !== sign(this.dashUY)) && (gy >= 0 || this.airDash || !this.ground)) this.aimDash(dx, gy);
        }
        if (this.sf >= 2 && this.tryActions(dx, dy, world, 0, true)) break;
        // 8-way dash: velocity is locked along the dash vector (no gravity), then eases out
        if (this.sf < PHYS.dashT - 5) {
          this.vx = this.dashUX * PHYS.dash;
          if (!this.ground) { this.vy = this.dashUY * PHYS.dash; this.gravScale = 0; }
        } else {
          if (this.sf === PHYS.dashT - 5 && !this.ground) this.vy *= 0.4;
          this.vx = approach(this.vx, sign(this.dashUX) * PHYS.run, 0.5);
        }
        if (this.sf % 2 === 0) this.addGhost();
        if (this.ground && this.sf % 4 === 0) world.dust(this.x - this.dashDir * 4, 0, 1, -this.dashDir);
        if (this.sf >= PHYS.dashT) { this.state = !this.ground ? 'air' : dx === this.dashDir ? 'run' : 'idle'; this.sf = 0; }
        break;
      case 'attack': this.attacking(dx, dy, world); break;
      case 'dodge': this.dodging(dx, dy, world); break;
      case 'land':
        this.vx = approach(this.vx, 0, 0.5);
        if (this.sf >= this.landT) this.state = 'idle';
        break;
      case 'hitstun':
        if (this.tryBreakBurst(world)) break;
        this.stun--;
        if (this.ground) this.vx = approach(this.vx, 0, 0.45);
        else this.vx *= 0.955;
        if (this.stun <= 0) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; this.combo = 0; }
        break;
      case 'burst':
        this.gravScale = this.sf < BURST.hover ? 0 : 1;
        this.vx *= 0.85;
        if (this.sf < BURST.hover) this.vy *= 0.5;
        if (this.sf >= BURST.t) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; }
        break;
      case 'riposte':   // parried: hold the weapon on them; any input cancels it
        if (this.tryActions(dx, dy, world, dtap, false)) break;
        if (dx || (dy > 0 && this.ground)) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; break; }
        if (this.ground) this.vx = approach(this.vx, 0, 0.5);
        else this.vx *= 0.95;
        if (this.ripTarget && Math.abs(this.ripTarget.x - this.x) > 1) this.facing = sign(this.ripTarget.x - this.x);
        if (this.sf >= PARRY.riposte) { this.state = this.ground ? 'idle' : 'air'; this.sf = 0; }
        break;
      case 'ko':
        if (this.kill) killStep(this, world);   // weapon finisher (src/kills.js)
        else if (this.ground) this.vx = approach(this.vx, 0, 0.15);
        break;
    }

    this.physics(world);
    this.trackFrames();
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
      if (this.weapon) {
        b.throw = 0;
        if (this.ground && dy > 0) world.dropWeapon(this);
        else { this.throwDir = dy; if (dx) this.facing = dx; this.startMove(THROW_MOVE, { fromDash }); }
        return true;
      }
      // a missed grab stays buffered (PICKUP_BUF), so pressing a little early while running/dashing still picks up
      if (world.tryPickup(this)) b.throw = 0;
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
        const hd = attackDir(dx, dy);
        this.startMove(hd === 'd' ? m.dheavy : hd === 's' ? m.sheavy : m.nheavy, { fromDash });
        return true;
      }
    }
    if (b.dodge && (!fromDash || (this.state === 'dash' && !this.fromChase)) && this.tryDodge(dx, dy, world)) { b.dodge = 0; return true; }
    if (b.jump) {
      if (this.ground) { b.jump = 0; this.doJump(dx, true, fromDash, world); return true; }
      if (this.jumps > 0) { b.jump = 0; this.jumps--; this.doJump(dx, false, false, world); return true; }
    }
    if (dtap && this.ground && !fromDash) { this.startDash(dtap, 0, world, false); return true; }
    return false;
  }

  doJump(dx, fromGround, fromDash, world) {
    if (fromDash) this.vx = (this.dashUX || this.dashDir) * PHYS.dash * 0.95;   // dash jump keeps momentum
    else if (dx && (sign(this.vx) !== dx || Math.abs(this.vx) < PHYS.air)) this.vx = dx * PHYS.air;
    else if (!dx) this.vx *= 0.6;
    this.vy = fromGround ? PHYS.jump : PHYS.airJump;
    this.ground = false; this.state = 'air'; this.sf = 0; this.fastfall = false;
    if (dx) this.facing = dx;
    if (fromGround) world.dust(this.x, 0, 4, 0);
    else world.ring(this.x, this.y - 2, 9);
    SFX.jump();
  }

  // 8-way dash along (ux, uy). Upward dashes from the ground and any air dash use the one air dash
  // per airtime (reset on landing or getting hit). lenient = came from the dodge button, may re-aim.
  startDash(ux, uy, world, lenient) {
    this.state = 'dash'; this.sf = 0; this.dashLen = !!lenient; this.fastfall = false;
    if (this.ground) world.dust(this.x, 0, 4, -(sign(ux) || this.facing));
    else world.ring(this.x, this.y - 18, 10);
    this.aimDash(ux, uy);
    SFX.dash();
  }
  aimDash(ux, uy) {
    const n = Math.hypot(ux, uy) || 1;
    this.dashUX = ux / n; this.dashUY = uy / n;
    this.dashDir = sign(ux) || this.facing; if (ux) this.facing = sign(ux);
    if (!this.ground || this.dashUY < 0) this.airDash = false;
    this.vx = this.dashUX * PHYS.dash; this.vy = this.dashUY * PHYS.dash;
    if (this.vy < 0) this.ground = false;
  }

  tryDodge(dx, dy, world) {
    const chase = this.chaseN > 0 && this.chaseT > 0;
    if (chase) {
      this.chaseN--;
      const ddy = this.ground ? Math.min(0, dy) : dy;
      if (dx || ddy) { const n = Math.hypot(dx, ddy); this.startDodge('dir', dx / n, ddy / n, true, world); }
      else if (!this.ground) this.startDodge('air', 0, 0, true, world);
      else { this.chaseN++; return this.tryBurst(world); }   // neutral on the ground = burst, not a chase dodge
      return true;
    }
    if (this.clock < this.dodgeLock) return false;                        // just whiffed an attack
    // 8-way: dodge + any direction. With dodge ready it's an invincible dodge that way;
    // on cooldown it's a dash that way instead (no invincibility).
    if (this.ground) {
      // can't go into the floor: down-diagonals roll. No spot dodge: neutral / straight down = burst (full bar)
      // (the press stays buffered, so a direction a moment later still rolls). Tap down to parry instead.
      const gy = Math.min(0, dy);
      if (!dx && !gy) return this.tryBurst(world);   // neutral = burst (needs a full bar)
      if (this.dodgeCD === 0) {
        if (gy < 0) this.startGroundDir(dx, gy, world);
        else this.startDodge('roll', dx, 0, false, world);
        return true;
      }
      if (!(dx || gy) || this.state === 'dash' || (gy < 0 && !this.airDash)) return false;
      this.startDash(dx, gy, world, true);
      return true;
    }
    if (this.dodgeCD === 0 && this.airDodge) {
      this.airDodge = false; this.airDodgeAt = this.clock; this.gcUsed = false;
      if (dx || dy) { const n = Math.hypot(dx, dy); this.startDodge('dir', dx / n, dy / n, false, world); }
      else this.startDodge('air', 0, 0, false, world);
      return true;
    }
    if (!dx && !dy) return this.tryBurst(world);   // air dodge used: neutral = burst
    if ((dx || dy) && this.airDash && this.state !== 'dash') { this.startDash(dx, dy, world, true); return true; }
    return false;
  }

  // ground dodge up / up-diagonal: an invincible directional dodge that lifts off (ground cooldown, keeps the air dodge)
  startGroundDir(dx, gy, world) {
    const n = Math.hypot(dx, gy);
    this.startDodge('dir', dx / n, gy / n, false, world);
    this.dodgeCD = DODGE.airDirT + DODGE.groundCD;
    this.ground = false;
  }

  // ---------------- burst ----------------
  burstReady() { return this.burst >= BURST.max; }
  tryBurst(world) { if (!this.burstReady()) return false; this.startBurst(world); return true; }
  // in hitstun / blockstun: a neutral dodge press breaks out (combo breaker)
  tryBreakBurst(world) {
    if (!this.buf.dodge || !this.burstReady()) return false;
    const [bx, by] = this.bufDir.dodge;
    if (bx || by) return false;
    this.buf.dodge = 0;
    this.startBurst(world);
    return true;
  }
  startBurst(world) {
    Object.assign(this, {
      burst: 0, state: 'burst', sf: 0, inv: BURST.inv, move: null, part: null, rf: -1, af: -1, gc: false, stun: 0,
      fastfall: false, combo: 0, cInst: null, cIds: null,
      // refresh air options, like YOMI's burst
      jumps: PHYS.airJumps, recAvail: true, airDodge: true, airDash: true,
    });
    this.vx *= 0.2; this.vy = Math.min(this.vy, 0) * 0.2;
    this.trail.length = 0;
    world.burst(this);
  }

  // ---------------- defence ----------------
  startBlock(dx, world) {
    this.state = 'block'; this.sf = 0;
    if (dx) this.facing = dx;
    else { const op = this.opponent(world); if (op && op.x !== this.x) this.facing = sign(op.x - this.x); }
  }

  // tap-down parry: the weapon's parry move; its deflect startup is the parry window
  startParry() {
    this.startMove(this.wpn.moves.parry);
    this.parryCD = PARRY.win + PARRY.cd;
  }
  parrying() {
    return this.state === 'attack' && this.move.kind === 'parry' && this.rf < 0 && this.pi === 0 && this.pf <= PARRY.win;
  }

  startDodge(kind, ux, uy, chase, world) {
    this.state = 'dodge'; this.dodgeKind = kind; this.sf = 0; this.chaseDodge = chase; this.fastfall = false;
    if (chase) { this.inv = DODGE.chaseInv; this.dodgeT = DODGE.chaseT; }
    else if (kind === 'air') { this.inv = DODGE.airSpotInv; this.dodgeT = DODGE.airSpotT; this.dodgeCD = DODGE.airCD; }
    else if (kind === 'roll') { this.inv = DODGE.rollInv; this.dodgeT = DODGE.rollT; this.dodgeCD = DODGE.rollT + DODGE.groundCD; }
    else { this.inv = DODGE.airDirInv; this.dodgeT = DODGE.airDirT; this.dodgeCD = DODGE.airCD; }
    if (kind === 'dir') { this.vx = ux * DODGE.airDirSpd; this.vy = uy * DODGE.airDirSpd; if (ux) this.facing = sign(ux); }
    else if (kind === 'roll') { this.vx = ux * DODGE.rollSpd; this.dashDir = sign(ux); this.facing = sign(ux); }
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
      this.state = this.ground ? 'idle' : 'air'; this.fromChase = true; this.dashDir = sign(this.vx) || this.facing; this.dashUX = this.dashDir;
      const ok = this.tryActions(dx, dy, world, 0, true);
      this.fromChase = false;
      if (ok) { this.inv = 0; return; }
      this.state = prev;
    }
    // leniency: dodge pressed a hair before the direction still comes out directional
    if (!this.chaseDodge && this.sf <= DODGE.lenient && k === 'air') {
      if (dx || dy) { const n = Math.hypot(dx, dy); this.upgradeDodge('dir', dx / n, dy / n); return; }
    }
    if (k === 'dir') {
      const mv = this.chaseDodge ? 13 : DODGE.airDirMove;
      if (this.sf < mv) this.gravScale = 0;
      else { if (this.sf === mv) { this.vx *= 0.35; this.vy *= 0.35; } this.gravScale = 0.5; }
      if (this.sf % 2 === 0) this.addGhost();
    } else if (k === 'roll') {
      if (this.sf < DODGE.rollMove) this.vx = this.dashDir * DODGE.rollSpd;
      else this.vx = approach(this.vx, 0, 0.7);
      if (this.sf % 2 === 0) this.addGhost();
      if (this.sf % 4 === 0) world.dust(this.x - this.dashDir * 4, 0, 1, -this.dashDir);
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

  // turn a just-started neutral dodge into a directional one (keeps the frames already spent)
  upgradeDodge(kind, ux, uy) {
    const spent = this.sf;
    this.dodgeKind = kind;
    if (kind === 'roll') {
      this.inv = Math.max(1, DODGE.rollInv - spent); this.dodgeT = DODGE.rollT; this.dodgeCD = DODGE.rollT + DODGE.groundCD - spent;
      this.vx = ux * DODGE.rollSpd; this.dashDir = sign(ux); this.facing = sign(ux);
    } else {
      this.inv = Math.max(1, DODGE.airDirInv - spent); this.dodgeT = DODGE.airDirT;
      this.vx = ux * DODGE.airDirSpd; this.vy = uy * DODGE.airDirSpd; if (ux) this.facing = sign(ux);
    }
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
    const dir = attackDir(dx, dy);
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
    this.state = 'attack'; this.move = m; this.moveInst = ++MOVE_INST; this.sf = 0; this.lenient = null; this.buf.down = 0;
    this.moveHit = false; this.moveBlocked = false; this.rf = -1; this.gc = !!o.gc; this.weakRec = !!o.weak; this.landedAir = false;
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
    // recovery: shorter on hit, base on block, longer on a whiff
    this.rf = 0; this.af = -1;
    this.recLen = this.moveHit ? Math.ceil(m.r * REC_ON_HIT) : this.moveBlocked || m.kind !== 'atk' ? m.r : Math.ceil(m.r * RECOVERY.whiff);
    if (this.landedAir) this.recLen = Math.max(this.recLen, m.land);
    this.recFrom = this.pose.slice();
  }

  attacking(dx, dy, world) {
    const m = this.move;
    if (m.kind === 'parry' && this.rf < 0 && this.pi === 0) {
      // down + attack/throw/dodge a hair after the tap: drop the parry, do the down move (refund it)
      if (this.pf <= PARRY.lenient && (this.buf.light || this.buf.heavy || this.buf.throw || this.buf.dodge)) {
        this.parryCD = 0; this.move = null; this.part = null; this.state = 'idle'; this.sf = 0;
        if (!this.tryActions(dx, dy, world, 0, false) && dy > 0) this.startBlock(dx, world);
        return;
      }
      // still holding down when the window closes: it was a block, not a tap
      if (this.pf >= PARRY.win && dy > 0) {
        this.move = null; this.part = null; this.af = -1; this.startBlock(dx, world);
        return;
      }
    }
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
        // a late up-diagonal resolves to neutral: never let it downgrade a side/down light
        if (mv !== this.move && attackDir(dx, dy) !== 'n') {
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
    if (m && m.kind === 'parryAtk' && this.ripTarget) this.state = 'riposte';   // parry attack -> riposte pose
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
    this.jumps = PHYS.airJumps; this.recAvail = true; this.airDodge = true; this.airDash = true; this.fastfall = false;
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
        if (this.dodgeKind !== 'roll') { this.state = 'idle'; this.sf = 0; }
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
      case 'dodge': target = P(this.dodgeKind === 'dir' || this.dodgeKind === 'roll' ? POSE.tuck : POSE.spot, st); k = 0.5; break;
      case 'block': target = P(POSE.guard, st); k = 0.5; break;
      case 'blockstun': target = P(POSE.guard, st); target[0] -= 6; k = 0.7; break;
      case 'hitstun':
        target = P(this.ground ? POSE.hurtLo : POSE.hurt, st); k = 0.6; break;
      case 'burst': target = P(POSE.burst, st); k = this.sf < 3 ? 0.8 : 0.35; break;
      case 'riposte': {
        // lunge stance, weapon arm straight and the tip aimed at the enemy's chest
        const tg = this.ripTarget, sh = this.sk ? this.sk.neck : [this.x, this.y - 26];
        const ang = tg ? clamp(Math.atan2(tg.y - 18 - sh[1], Math.abs(tg.x - this.x) || 1) / D2R, -55, 55) : 0;
        target = P({ ...POSE.riposte, a: [ang + 6, ang], w: ang }, st);
        k = this.sf < 4 ? 0.8 : 0.45; break;
      }
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

  // ---------------- frame data (recovery-frame system / frame meter) ----------------
  // fhist: phase of each of the last FRAME_HIST frames. fd counts startup/active/recovery of the
  // current move (or dodge/parry); lastFD keeps the finished one for the HUD readout.
  trackFrames() {
    const ph = this.phase(true);
    this.fhist.push(this.phase());
    if (this.fhist.length > FRAME_HIST) this.fhist.shift();
    const act = this.state === 'attack' || this.state === 'dodge';
    if (act) {
      const key = this.state === 'attack' ? this.moveInst : this.state + this.clock;
      if (!this.fd || (this.state === 'attack' && this.fd.key !== key) || (this.state !== 'attack' && this.fd.kind !== this.state)) {
        this.fd = { key, kind: this.state, name: this.state === 'attack' ? this.move.id || this.move.kind : this.dodgeKind, s: 0, a: 0, r: 0, i: 0 };
      }
      const d = this.fd;
      if (ph === 'startup') d.s++;
      else if (ph === 'active') d.a++;
      else if (ph === 'inv') d.i++;
      else if (ph === 'recovery') d.r++;
    } else if (this.fd) {
      if (this.state !== 'hitstun') this.lastFD = this.fd;   // an interrupted move isn't reported
      this.fd = null;
    }
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
