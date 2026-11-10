'use strict';
// ---------- CPU opponent: produces the same held/pressed buttons a player would ----------
// block = chance per frame to crouch-block a swing in range, parry = share of reactions that are parries (timed nlight)
const AI_LEVELS = [
  { name: 'EASY',   think: [16, 28], dodge: 0.01,  aggr: 0.05, cool: [22, 40], block: 0.02, parry: 0.1, burst: 0.01 },
  { name: 'NORMAL', think: [9, 18],  dodge: 0.025, aggr: 0.12, cool: [12, 26], block: 0.05, parry: 0.25, burst: 0.03 },
  { name: 'HARD',   think: [4, 10],  dodge: 0.05,  aggr: 0.25, cool: [5, 14],  block: 0.1,  parry: 0.4, burst: 0.06 },
];

class AIController {
  constructor(level = 1) {
    this.lvl = AI_LEVELS[level];
    this.held = emptyButtons(); this.pressed = emptyButtons();
    this.hold = { jump: 0, light: 0, heavy: 0, dodge: 0, throw: 0 };
    this.blockT = 0;
    this.me = null; this.op = null; this.world = null;
    this.t = 0; this.next = 0; this.cool = 30;
    this.moveDir = 0; this.wantDown = false; this.goalPickup = false;
    this.fdx = 0; this.fdy = 0; this.fT = 0;
  }
  bind(me, op, world) { this.me = me; this.op = op; this.world = world; }

  tap(b) { this.pressed[b] = true; this.hold[b] = 2; }
  dir(dx, dy, frames = 4) { this.fdx = dx; this.fdy = dy; this.fT = frames; }
  act(b, dx, dy) { this.tap(b); this.dir(dx, dy, 5); this.cool = randi(this.lvl.cool[0], this.lvl.cool[1]); }

  poll() {
    for (const b of BTN) this.pressed[b] = false;
    if (!this.me) return;
    this.t++;
    this.think(this.me, this.op);
    // wantDown is for fast-falling; on the ground holding down would crouch-block
    let dx = this.moveDir, dy = this.wantDown && !this.me.ground ? 1 : 0;
    if (this.fT > 0) { this.fT--; dx = this.fdx; dy = this.fdy; }
    if (this.blockT > 0) { this.blockT--; dx = 0; dy = 1; }
    this.held.left = dx < 0; this.held.right = dx > 0;
    this.held.down = dy > 0; this.held.up = dy < 0;
    // direction press edges (tap-down parry reads pressed.down, like a real controller)
    this.prevDir = this.prevDir || {};
    for (const d of ['left', 'right', 'up', 'down']) { this.pressed[d] = this.held[d] && !this.prevDir[d]; this.prevDir[d] = this.held[d]; }
    for (const b in this.hold) {
      this.held[b] = this.hold[b] > 0;
      if (this.hold[b] > 0) this.hold[b]--;
    }
  }

  think(me, op) {
    const L = this.lvl, w = me.wpn;
    const dx = op.x - me.x, adx = Math.abs(dx), fd = sign(dx) || 1;
    const dyv = op.y - me.y, ady = Math.abs(dyv);
    if (this.cool > 0) this.cool--;
    if (op.state === 'ko') { this.moveDir = 0; return; }

    // escape a combo when hitstun ends
    if (me.state === 'hitstun') {
      // burst out of a combo (2+ hits) once the bar is full: neutral dodge
      if (me.burst >= BURST.max && me.combo >= 2 && Math.random() < L.burst) { this.tap('dodge'); this.dir(0, 0, 2); return; }
      if (me.stun <= 2 && adx < 70 && Math.random() < L.dodge * 10) { this.tap('dodge'); this.dir(-fd, me.ground ? 0 : -1, 6); }
      return;
    }

    const canAct = me.free || (me.state === 'dash' && me.sf >= 3);
    if (me.state === 'blockstun' || this.blockT > 0) return;   // keep guarding

    // react to an incoming attack: parry, crouch block, or dodge / hop away
    const swinging = op.state === 'attack' && op.part && op.rf < 0 && op.af < op.part.s && adx < op.wpn.range + 34;
    if (canAct && swinging && me.ground && me.parryCD === 0 && op.part.s - op.af <= 6 && Math.random() < L.dodge * 3 * L.parry * 2) {
      this.moveDir = 0; this.dir(0, 1, 2); return;   // tap down = parry (released, so the parry swing follows)
    }
    if (canAct && swinging && me.ground && op.move.kind !== 'gp' && Math.random() < L.block) {
      this.blockT = randi(14, 30); this.moveDir = 0; return;
    }
    if (canAct && swinging && Math.random() < L.dodge * 3) {
      if (me.ground && Math.random() < 0.5) { this.tap('dodge'); this.dir(-fd, 0, 4); }   // roll away (no spot dodge)
      else if (me.ground) { this.tap('jump'); this.dir(-fd, 0, 6); }
      else { this.tap('dodge'); this.dir(-fd, -1, 4); }
      return;
    }
    // dodge / hop over projectiles
    if (canAct) {
      for (const p of this.world.projs) {
        if (p.owner !== op) continue;
        const rel = p.x - me.x;
        if (Math.abs(rel) < 70 && sign(p.vx) === -sign(rel) && Math.abs(p.y - (me.y - 20)) < 26 && Math.random() < L.dodge * 4) {
          if (me.ground && Math.random() < 0.6) this.tap('jump');
          else if (me.ground) { this.blockT = randi(12, 20); this.moveDir = 0; }   // crouch-block it (no spot dodge)
          else { this.tap('dodge'); this.dir(0, 0, 3); }
          return;
        }
      }
    }

    // movement plan
    if (this.t >= this.next) {
      this.next = this.t + randi(L.think[0], L.think[1]);
      this.wantDown = false;
      let goal = null;
      if (!me.weapon) {
        let bd = 1e9;
        for (const p of this.world.pickups) {
          if (p.sky && p.y < -90) continue;
          const d = Math.abs(p.x - me.x);
          if (d < bd) { bd = d; goal = p.x; }
        }
        if (bd > 340 || (bd > adx && Math.random() < 0.4)) goal = null;
      }
      this.goalPickup = goal != null;
      if (this.goalPickup) {
        this.moveDir = Math.abs(goal - me.x) > 6 ? sign(goal - me.x) : 0;
        if (me.ground && Math.abs(goal - me.x) > 120 && Math.random() < 0.4) { this.tap('dodge'); this.dir(sign(goal - me.x), 0, 3); }
      } else {
        const want = w.range * (w.ranged ? 1 : 0.8) + rand(-6, 10);
        if (adx > want + 12) this.moveDir = fd;
        else if (adx < want - 14) this.moveDir = -fd;
        else this.moveDir = Math.random() < 0.35 ? pick([fd, -fd]) : 0;
        if (me.ground && adx > want + 90 && Math.random() < 0.35) { this.tap('dodge'); this.dir(fd, 0, 3); }
        if (me.ground && dyv < -40 && adx < 90 && Math.random() < 0.5) this.tap('jump');
        else if (me.ground && Math.random() < 0.05) this.tap('jump');
        if (!me.ground && me.jumps > 0 && dyv < -30 && me.vy > 0 && Math.random() < 0.4) this.tap('jump');
        if (!me.ground && dyv > 24 && Math.random() < 0.4) this.wantDown = true;
      }
    }

    if (!me.weapon && this.goalPickup && canAct) {
      for (const p of this.world.pickups) {
        if (Math.abs(p.x - me.x) < 14 && p.y - me.y > -44 && p.y - me.y < 16) { this.tap('throw'); break; }
      }
    }

    // attacks
    if (!canAct || this.cool > 0 || Math.random() > L.aggr) return;
    const facingOk = me.facing === fd;

    if (me.weapon && !w.ranged && adx > 100 && adx < 220 && ady < 30 && Math.random() < 0.02) { this.act('throw', fd, 0); return; }

    if (w.ranged) {
      if (me.ground) {
        if (adx < 34 && ady < 30) this.act('light', 0, 1);
        else if (ady < 30 && adx < w.range + 70) this.act('light', facingOk && Math.random() < 0.6 ? 0 : fd, 0);
        else if (dyv < -40 && adx < 50) this.act('jump', 0, 0);
      } else {
        if (dyv > 20 && adx < 25) this.act('light', 0, 1);
        else if (dyv > 15 && adx < 110 && facingOk) this.act('light', 0, 0);
        else if (ady < 30 && adx < w.range + 40) this.act('light', fd, 0);
      }
      return;
    }

    const inRange = adx < w.range + 10;
    if (me.ground) {
      if (dyv < -28 && adx < 46) this.act(me.weapon ? 'jump' : 'heavy', 0, 0);
      else if (!me.weapon && adx < 40 && ady < 30 && Math.random() < 0.25) this.act('heavy', Math.random() < 0.5 ? fd : 0, Math.random() < 0.3 ? 1 : 0);
      else if (inRange && ady < 30) {
        const r = Math.random();
        if (r < 0.4) this.act('light', fd, 0);
        else if (r < 0.7) this.act('light', 0, 1);
        else this.act('light', facingOk ? 0 : fd, 0);
      } else if (adx < w.range + 50 && ady < 30 && Math.random() < 0.35) this.act('light', fd, 0);
    } else {
      if (dyv > 14 && adx < 30) this.act(Math.random() < 0.3 ? 'heavy' : 'light', 0, 1);
      else if (dyv < -24 && adx < 40 && me.recAvail && Math.random() < 0.4) this.act('heavy', 0, 0);
      else if (inRange && ady < 42) this.act('light', Math.random() < 0.55 || !facingOk ? fd : 0, 0);
    }
  }
}
