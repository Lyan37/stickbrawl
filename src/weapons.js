'use strict';
// ---------- weapons & move data (modelled on Brawlhalla's movesets; damage ≈ wiki × 0.5) ----------
// A move is a list of PARTS played in order. Each part:
//   s = startup frames, a = active frames, hb = hitbox [x, y, w, h] (x forward of body centre, y up is negative)
//   dmg, kb = [angleDeg, force] (0 = away, -90 = up, 90 = spike), stun = fixed hitstun frames
//   cond: 'hit'  -> part only plays if the previous part connected (Brawlhalla "follow-up on hit")
//   hits/every   -> multi-hit within one part
//   vxS/vyS      -> velocity set when the part starts, vx/vy -> when its active frames start
//   proj         -> projectiles fired, f = frame offset into the active window
//   carry        -> drag the victim along with you; behind: 'always' | 'unlessFwd' | 'ifBack' (scythe swap-sides)
//   bounce       -> attacker vy on hit; fall -> ground-pound style: fall until landing or hitting
//   alt          -> {when:'fwd'|'back', ...overrides} chosen by held direction when the part starts
//   pS / pA      -> windup / contact poses (partial; inherit from the previous part)
// Move meta: r = recovery after the last part, air, kind ('atk'|'rec'|'gp'|'throw'), chain (greatsword).
function PT(o) {
  return Object.assign({ s: 0, a: 3, hb: null, dmg: 0, kb: [-30, 4], stun: 16, hits: 1, every: 99 }, o);
}
function MV(meta, ...parts) {
  return Object.assign({ r: 12, air: false, kind: 'atk', heavy: false, trail: false, land: 7 }, meta, { parts: parts.map(PT) });
}
const arrow = (ang, o = {}) => Object.assign({ type: 'arrow', ang, spd: 11, dmg: 6, kb: [-15, 4], stun: 16 }, o);

const UP = { a: [-80, -95] }, DOWN_ARM = { a: [80, 90] };

const WEAPONS = {
  // ---------------------------------------------------------------- fists
  none: {
    name: 'FISTS', len: 0, limb: 'arm', range: 20,
    stance: { a: [60, -35], b: [100, -10] },
    moves: {
      // 2 jabs, flurry on hit
      nlight: MV({ r: 10, trail: 1 },
        { s: 5, a: 2, hb: [2, -33, 18, 10], dmg: 2, kb: [-10, 1.5], stun: 16, pS: { a: [140, -40] }, pA: { t: -72, a: [-2, -4], b: [130, 40] } },
        { s: 3, a: 2, hb: [2, -33, 18, 10], dmg: 2, kb: [-10, 1.5], stun: 16, pS: { a: [120, -20], b: [-5, -5] }, pA: { a: [0, -2], b: [140, 40] } },
        { cond: 'hit', s: 2, a: 8, hits: 2, every: 4, hb: [2, -35, 20, 14], dmg: 1, kb: [-5, 1], stun: 14, sweep: 1, pS: { a: [10, 30] }, pA: { a: [-10, -30], b: [10, 10] } },
        { cond: 'hit', s: 2, a: 3, hb: [2, -35, 20, 14], dmg: 1, kb: [-30, 4.5], stun: 16, pS: { a: [150, -60] }, pA: { t: -60, a: [-5, -5] } }),
      // low forward kick
      slight: MV({ r: 13, trail: 1, limb: 'leg' },
        { s: 8, a: 4, hb: [4, -20, 22, 12], dmg: 5, kb: [-25, 5.5], stun: 18, vx: 2.5, pS: { t: -95, l: [100, 160], k: [110, 95] }, pA: { t: -110, l: [5, 10], k: [120, 100], a: [-150, -120] } }),
      // sliding kick that pops up (combo starter)
      dlight: MV({ r: 14, trail: 1, limb: 'leg' },
        { s: 8, a: 8, hb: [0, -12, 24, 12], dmg: 3.5, kb: [-75, 4.5], stun: 21, vx: 5, pS: { t: -60, l: [60, 130], k: [140, 80] }, pA: { t: -40, a: [140, 100], b: [160, 120], l: [5, 5], k: [150, 80] } }),
      // two kicks, launching third on hit
      nair: MV({ air: 1, r: 11, trail: 1, limb: 'leg' },
        { s: 7, a: 3, hb: [-4, -34, 26, 30], dmg: 2, kb: [-30, 2], stun: 16, pS: { t: -95, l: [80, 140] }, pA: { t: -80, l: [-20, 30] } },
        { s: 3, a: 3, hb: [-4, -34, 26, 30], dmg: 2, kb: [-30, 2], stun: 16, pS: { l: [70, 120] }, pA: { l: [-30, 20], k: [140, 100] } },
        { cond: 'hit', s: 3, a: 3, hb: [-2, -36, 22, 24], dmg: 2, kb: [-55, 5.5], stun: 18, pS: { l: [90, 150] }, pA: { t: -110, l: [-50, -40] } }),
      // forward punch
      sair: MV({ air: 1, r: 13, trail: 1 },
        { s: 11, a: 4, hb: [4, -32, 22, 12], dmg: 5, kb: [-20, 6], stun: 18, pS: { t: -95, a: [170, -80] }, pA: { t: -60, a: [-5, -5], b: [150, 170], l: [100, 160] } }),
      // leg extended down, travelling diagonally down through the target
      dair: MV({ air: 1, r: 11, trail: 1, limb: 'leg' },
        { s: 6, a: 12, hb: [0, -10, 18, 18], dmg: 5, kb: [50, 4.5], stun: 18, vx: 3.2, vy: 4.5, pS: { t: -90, l: [20, 120], k: [60, 150] }, pA: { t: -100, l: [55, 60], k: [120, 140] } }),
      // rising uppercut
      rec: MV({ air: 1, kind: 'rec', r: 14, trail: 1 },
        { s: 8, a: 12, hb: [-2, -50, 20, 34], dmg: 6, kb: [-85, 7], stun: 22, vy: -8.6, vx: 1.5, pS: { t: -75, a: [100, 30], l: [30, 110], k: [120, 140] }, pA: { t: -100, a: [-85, -95], b: [120, 60], l: [60, 140], k: [110, 100] } }),
      // falling with leg down
      gp: MV({ air: 1, kind: 'gp', r: 12, land: 12 },
        { fall: 1, s: 12, hb: [-8, -10, 16, 16], dmg: 8, kb: [-40, 6], stun: 20, pS: { t: -80, a: [-120, -60], b: [-140, -80], l: [20, 120], k: [60, 150] }, pA: { t: -95, a: [-130, -100], b: [-150, -110], l: [85, 90], k: [130, 160] } }),
      // unarmed ground heavies (not signatures) — hold heavy to charge
      nheavy: MV({ r: 18, trail: 1, heavy: 1 },
        { charge: 1, s: 14, a: 6, hb: [0, -52, 22, 40], dmg: 8, kb: [-80, 7.5], stun: 22, vy: -3, pS: { ...POSE.crouch, a: [110, 80] }, pA: { t: -100, a: [-80, -95], l: [60, 100], k: [110, 90] } }),
      sheavy: MV({ r: 20, trail: 1, heavy: 1 },
        { charge: 1, s: 16, a: 6, hb: [4, -34, 24, 14], dmg: 9, kb: [-25, 7.5], stun: 22, vx: 6.5, pS: { t: -100, a: [170, -80], b: [60, 0] }, pA: { ...POSE.lunge, t: -55, a: [-5, -5], b: [150, 170] } }),
      dheavy: MV({ r: 20, trail: 1, heavy: 1, limb: 'leg' },
        { charge: 1, s: 15, a: 12, hits: 2, every: 6, hb: [-24, -14, 48, 14], dmg: 4.5, kb: [-60, 6], stun: 20, sweep: 1, pS: { t: -40, a: [100, 90], l: [20, 30], k: [160, 120] }, pA: { t: -40, a: [100, 90], l: [-160, -150], k: [170, 120] } }),
    },
  },

  // ---------------------------------------------------------------- sword
  sword: {
    name: 'SWORD', len: 17, range: 30,
    stance: { a: [70, -10], b: [110, 20], w: -55 },
    idle: { a: [110, 125], w: 140 }, idleFlip: 1, idleRun: 1, drag: 17.5,   // standing + running: arm low and back, blade dragged on the floor edge-down
    moves: {
      // two quick slashes; third on hit
      nlight: MV({ r: 12, trail: 1 },
        { s: 6, a: 3, hb: [4, -44, 30, 32], dmg: 2, kb: [-15, 2], stun: 16, vx: 1.5, pS: { t: -92, a: [-110, -140], w: -150 }, pA: { t: -72, a: [20, 30], w: 35 } },
        { s: 4, a: 3, hb: [4, -46, 30, 34], dmg: 2.5, kb: [-15, 2], stun: 16, pS: { w: 60 }, pA: { a: [-40, -60], w: -70 } },
        { cond: 'hit', s: 4, a: 4, hb: [6, -34, 32, 14], dmg: 2.5, kb: [-35, 5.5], stun: 18, vx: 2, pS: { a: [150, 10], w: 0 }, pA: { ...POSE.lunge, a: [-2, 0], w: 0 } }),
      // sword swung around the body while dashing forward
      slight: MV({ r: 14, trail: 1 },
        { s: 10, a: 6, hb: [0, -40, 34, 30], dmg: 7, kb: [-30, 5.6], stun: 21, vx: 6, sweep: 1, pS: { t: -95, a: [160, 190], w: 190, l: [70, 100], k: [110, 95] }, pA: { ...POSE.lunge, a: [360, 365], w: 370 } }),
      // low swipe; on hit a second strike and both hop diagonally up
      dlight: MV({ r: 14, trail: 1 },
        { s: 9, a: 3, hb: [4, -16, 30, 16], dmg: 1, kb: [-10, 1], stun: 24, vx: 3, pS: { ...POSE.crouch, a: [150, 100], w: 150 }, pA: { t: -50, a: [40, 20], w: 10, l: [20, 100], k: [150, 100] } },
        { cond: 'hit', s: 3, a: 4, hb: [2, -36, 30, 36], dmg: 3, kb: [-60, 4.5], stun: 22, vx: 2, vy: -6.5, together: 1, pS: { w: 40 }, pA: { t: -95, a: [-50, -70], w: -70, ...POSE.rise } }),
      // overhead arc
      nair: MV({ air: 1, r: 12, trail: 1 },
        { s: 11, a: 4, hb: [-16, -64, 46, 44], dmg: 8, kb: [-80, 6], stun: 20, sweep: 1, pS: { t: -85, a: [160, 200], w: 200, ...POSE.rise }, pA: { t: -80, a: [355, 360], w: 360 } }),
      // two forward swings, second launches
      sair: MV({ air: 1, r: 13, trail: 1 },
        { s: 10, a: 2, hb: [2, -40, 32, 24], dmg: 3.5, kb: [-10, 1.5], stun: 16, pS: { t: -95, a: [-110, -120], w: -100 }, pA: { t: -75, a: [5, 15], w: 20 } },
        { s: 4, a: 3, hb: [2, -42, 34, 26], dmg: 4, kb: [-30, 6], stun: 18, pS: { a: [60, 80], w: 80 }, pA: { a: [-30, -40], w: -50 } }),
      // swing under you
      dair: MV({ air: 1, r: 12, trail: 1 },
        { s: 12, a: 4, hb: [-14, -14, 40, 28], dmg: 8, kb: [55, 5], stun: 20, sweep: 1, pS: { t: -95, a: [-20, 0], w: 0, ...POSE.tuck }, pA: { t: -85, a: [130, 150], w: 170 } }),
      // fast spin while rising, hits all around
      rec: MV({ air: 1, kind: 'rec', r: 16, trail: 1 },
        { s: 8, a: 18, hits: 3, every: 6, hb: [-18, -58, 36, 50], dmg: 3, kb: [-85, 7], stun: 20, vy: -9, vx: 1, sweep: 1, pS: { t: -80, a: [100, 120], w: 110, l: [30, 110], k: [120, 140] }, pA: { t: -95, a: [-250, -260], w: -610, l: [70, 100], k: [100, 110] } }),
      // sword jabbed straight down, fall until landing or hitting
      gp: MV({ air: 1, kind: 'gp', r: 12, land: 14 },
        { fall: 1, s: 12, hb: [-6, -12, 14, 24], dmg: 11, kb: [45, 6], stun: 20, pS: { t: -85, a: [-100, -100], w: -90, ...POSE.tuck }, pA: { t: -95, ...DOWN_ARM, w: 92, l: [80, 95], k: [100, 95] } }),
    },
  },

  // ---------------------------------------------------------------- staff (shaolin staff: long wooden pole, both ends strike)
  staff: {
    name: 'STAFF', len: 30, range: 50,
    stance: { a: [60, 5], b: [100, 0], w: -8 },
    run: { a: [110, 125], w: 163 }, drag: 30,   // running: arm low and back, far end of the staff dragging along the floor
    moves: {
      // two quick end jabs, then the staff whirls overhead and cracks down in front
      nlight: MV({ r: 11, trail: 1 },
        { s: 6, a: 5, hb: [12, -32, 34, 10], dmg: 2, kb: [-5, 1.5], stun: 14, pS: { a: [150, 20], w: -3 }, pA: { t: -70, a: [-2, 0], w: 0 } },
        { s: 4, a: 5, hb: [12, -32, 34, 10], dmg: 2.5, kb: [-5, 1.5], stun: 14, pS: { a: [130, 10] }, pA: { a: [-2, 0] } },
        { s: 5, a: 3, hb: [8, -46, 38, 34], dmg: 2.5, kb: [-20, 4.5], stun: 16, sweep: 1, pS: { t: -88, a: [-120, -95], w: -120 }, pA: { ...POSE.lunge, a: [-10, 10], w: 18 } }),
      // two spinning swings, stepping forward on each
      slight: MV({ r: 15, trail: 1 },
        { s: 11, a: 4, hb: [0, -46, 40, 40], dmg: 4, kb: [-50, 2.5], stun: 18, vx: 3, sweep: 1, pS: { a: [40, 10], w: 150 }, pA: { a: [60, 20], w: 380, l: [40, 95], k: [130, 110] } },
        { s: 4, a: 4, hb: [0, -50, 40, 44], dmg: 3.5, kb: [-75, 6], stun: 20, vx: 3, sweep: 1, pS: { w: 380 }, pA: { a: [-30, -50], w: 620, ...POSE.lunge } }),
      // plant the staff and pole-vault up/forward: 3 quick spinning hits, then a kick that pops them up (combo starter)
      dlight: MV({ r: 10, trail: 1 },
        { s: 10, a: 9, hits: 3, every: 3, hb: [-4, -40, 34, 40], dmg: 1.2, kb: [-60, 2], stun: 14, vx: 3.2, vy: -4.6, sweep: 1, pS: { ...POSE.crouch, a: [100, 90], w: 95 }, pA: { t: -40, a: [110, 100], w: 100, l: [-10, 0], k: [20, 30] } },
        { s: 2, a: 4, hb: [-2, -44, 32, 42], dmg: 2.4, kb: [-72, 4.6], stun: 25, limb: 'leg', pS: { l: [60, 120] }, pA: { t: -60, l: [-40, -20], k: [100, 80] } }),
      // staff twirled in a full circle in front
      nair: MV({ air: 1, r: 12, trail: 1 },
        { s: 12, a: 8, hits: 2, every: 4, hb: [-10, -54, 50, 44], dmg: 4, kb: [-60, 6], stun: 18, sweep: 1, pS: { t: -85, a: [40, 0], w: 0, ...POSE.rise }, pA: { a: [40, 0], w: -360 } }),
      // big overhead sweep from behind, over the head and down in front
      sair: MV({ air: 1, r: 13, trail: 1 },
        { s: 11, a: 4, hb: [8, -44, 40, 30], dmg: 8, kb: [-15, 6.5], stun: 18, sweep: 1, pS: { t: -100, a: [-150, -125], w: -165 }, pA: { t: -70, a: [5, 10], w: 15, l: [100, 170], k: [120, 100] } }),
      // pogo straight down onto them, bounce off
      dair: MV({ air: 1, r: 12 },
        { s: 10, a: 5, hb: [-8, -8, 24, 36], dmg: 6.5, kb: [70, 4], stun: 18, bounce: -6.5, pS: { t: -90, a: [-100, -90], w: -90, ...POSE.tuck }, pA: { t: -90, a: [80, 90], w: 90, l: [40, 110], k: [100, 120] } }),
      // helicopter spin overhead, flying up
      rec: MV({ air: 1, kind: 'rec', r: 16, trail: 1 },
        { s: 9, a: 16, hits: 3, every: 5, hb: [-24, -76, 48, 40], dmg: 3, kb: [-85, 7], stun: 20, vy: -9.2, sweep: 1, pS: { t: -80, ...UP, w: -180, l: [30, 110], k: [120, 140] }, pA: { t: -95, ...UP, w: -900, l: [85, 95], k: [100, 95] } }),
      // falling face-down with a whirling staff, sends sideways
      gp: MV({ air: 1, kind: 'gp', r: 13, land: 14, trail: 1 },
        { fall: 1, s: 13, hb: [-18, -16, 36, 22], dmg: 9, kb: [-10, 6], stun: 20, pS: { t: -30, a: [60, 60], w: 0, ...POSE.tuck }, pA: { t: -20, a: [80, 80], w: 720, l: [160, 170], k: [170, 175] }, sweep: 1 }),
    },
  },

  // ---------------------------------------------------------------- greatsword (opener → bridge → closer chain)
  greatsword: {
    name: 'GREATSWORD', len: 27, range: 32, chain: true,
    stance: { a: [80, -100], b: [100, -60], w: -150, t: -78 },
    moves: {
      // openers (slow, long recovery; cancel into the chain on hit)
      nlight: MV({ r: 30, chain: 'opener', heavy: 1, trail: 1 },
        { s: 11, a: 5, hb: [0, -62, 34, 46], dmg: 5.5, kb: [-80, 5], stun: 26, pS: { t: -70, a: [100, 120], w: 130 }, pA: { t: -95, a: [-60, -75], w: -80 } }),
      slight: MV({ r: 22, chain: 'opener', heavy: 1 },
        { s: 9, a: 4, hb: [8, -34, 38, 12], dmg: 4.5, kb: [-10, 3.5], stun: 24, vx: 2, pS: { t: -95, a: [150, 10], w: 0 }, pA: { ...POSE.lunge, a: [-2, 0], w: 0 } }),
      dlight: MV({ r: 22, chain: 'opener', heavy: 1, trail: 1 },
        { s: 13, a: 5, hb: [4, -18, 38, 18], dmg: 4.5, kb: [-30, 3], stun: 24, pS: { ...POSE.crouch, a: [-120, -150], w: -160 }, pA: { ...POSE.reach, t: -45, a: [30, 20], w: 15 } }),
      // bridges
      nlightB: MV({ r: 18, chain: 'bridge', heavy: 1, trail: 1 },
        { s: 10, a: 5, hb: [0, -64, 34, 50], dmg: 5.5, kb: [-75, 4.5], stun: 24, pS: { t: -60, a: [110, 130], w: 140 }, pA: { t: -100, a: [-70, -80], w: -85 } }),
      slightB: MV({ r: 18, chain: 'bridge', heavy: 1 },
        { s: 10, a: 4, hb: [8, -36, 44, 14], dmg: 6, kb: [-15, 4], stun: 24, vx: 3, pS: { t: -100, a: [160, 10], w: 0 }, pA: { ...POSE.lunge, t: -50, a: [-2, 0], w: 0 } }),
      dlightB: MV({ r: 18, chain: 'bridge', heavy: 1 },
        { s: 9, a: 8, hb: [2, -24, 34, 24], dmg: 5, kb: [-10, 8], stun: 24, vx: 6.5, pS: { ...POSE.crouch, a: [60, 70], w: 80 }, pA: { ...POSE.dash, a: [50, 70], w: 75 } }),
      // closers
      nlightC: MV({ r: 20, chain: 'closer', heavy: 1, trail: 1 },
        { s: 14, a: 5, hb: [0, -70, 40, 70], dmg: 8.5, kb: [-60, 7.5], stun: 20, vy: -6, pS: { t: -55, a: [120, 130], w: 140 }, pA: { t: -105, a: [-70, -85], w: -95, ...POSE.rise } }),
      slightC: MV({ r: 20, chain: 'closer', heavy: 1, trail: 1 },
        { s: 14, a: 5, hb: [0, -48, 44, 36], dmg: 9, kb: [-20, 8], stun: 20, vx: 3, pS: { t: -100, a: [-170, -160], w: -170 }, pA: { ...POSE.lunge, t: -60, a: [10, 15], w: 20 } }),
      dlightC: MV({ r: 22, chain: 'closer', heavy: 1, trail: 1 },
        { s: 15, a: 8, hb: [-36, -40, 72, 40], dmg: 10, kb: [-40, 7.5], stun: 20, sweep: 1, pS: { ...POSE.crouch, a: [0, 0], w: 0 }, pA: { ...POSE.crouch, a: [360, 360], w: 360 } }),
      // aerials
      nair: MV({ air: 1, r: 17, heavy: 1, trail: 1 },
        { s: 12, a: 8, hb: [-10, -68, 44, 48], dmg: 8.5, kb: [-75, 6.5], stun: 20, sweep: 1, pS: { t: -80, a: [110, 130], w: 130, ...POSE.rise }, pA: { t: -100, a: [-80, -100], w: -110 } }),
      sair: MV({ air: 1, r: 17, heavy: 1, trail: 1 },
        { s: 14, a: 5, hb: [0, -48, 44, 40], dmg: 8.5, kb: [-15, 7], stun: 20, pS: { t: -100, a: [-150, -160], w: -160 }, pA: { t: -70, a: [30, 40], w: 45 } }),
      dair: MV({ air: 1, r: 15, heavy: 1 },
        { s: 13, a: 6, hb: [-8, -8, 26, 38], dmg: 7, kb: [75, 5], stun: 20, pS: { t: -95, a: [-110, -110], w: -90, ...POSE.tuck }, pA: { t: -90, ...DOWN_ARM, w: 90, l: [60, 110], k: [100, 120] } }),
      rec: MV({ air: 1, kind: 'rec', r: 20, heavy: 1, trail: 1 },
        { s: 14, a: 7, hb: [-8, -70, 36, 58], dmg: 10, kb: [-85, 8], stun: 22, vy: -8.6, sweep: 1, pS: { t: -70, a: [110, 130], w: 130, l: [30, 110], k: [120, 140] }, pA: { t: -100, a: [-80, -90], w: -95, l: [70, 100], k: [100, 110] } }),
      gp: MV({ air: 1, kind: 'gp', r: 14, heavy: 1, land: 16 },
        { fall: 1, s: 18, hb: [-2, -18, 30, 26], dmg: 8.5, kb: [40, 7], stun: 22, pS: { t: -90, a: [-110, -110], w: -100, ...POSE.tuck }, pA: { t: -80, a: [30, 50], w: 55, l: [80, 95], k: [100, 95] } }),
    },
  },

  // ---------------------------------------------------------------- bow (arrows + melee)
  // Matched to brawlhalla.wiki.gg/wiki/Bow: dmg = wiki × 0.5, startup/active/gaps = wiki frames,
  // stun ≈ wiki × 0.85 (engine applies ×1.45), r ≈ wiki miss recovery × 0.8, force ≈ (fixed + 0.6·var) / 10.
  bow: {
    name: 'BOW', len: 0, range: 90, ranged: true,
    stance: { a: [15, 0], b: [150, 20], w: 0 },
    run: { a: [92, 98], w: 95 },   // running: bow lowered, arm angled slightly back, arrow end pointing at the floor
    moves: {
      // arrow shot up diagonally, considerable knockback (wiki: 15 dmg, 8f startup, 4f active)
      nlight: MV({ r: 18 },
        { s: 8, a: 4, proj: [arrow(-40, { life: 30, dmg: 7.5, kb: [-45, 6.2], stun: 17 })], pS: { a: [-40, -40], b: [170, -40], w: -40 }, pA: { a: [-40, -40], b: [150, -25], w: -40 } }),
      // melee bow swing; on hit an arrow 20f later launches them forward (wiki: 7 + 7, 10f startup, "5 (20) 5")
      slight: MV({ r: 18, trail: 1 },
        { s: 10, a: 5, hb: [2, -38, 26, 26], dmg: 3.5, kb: [-10, 1.5], stun: 22, vx: 2, pS: { a: [-120, -100], w: -100 }, pA: { a: [20, 30], w: 40, ...POSE.lunge } },
        { cond: 'hit', s: 16, a: 4, proj: [arrow(0, { dmg: 3.5, kb: [-20, 5.1], stun: 22 })], pS: { a: [0, 0], b: [175, 0], w: 0 }, pA: { a: [0, 0], b: [160, 20], w: 0 } }),
      // leap forward, fire at the ground with great horizontal reach (wiki: 10 dmg, 15f startup, 5f active, fixed force)
      dlight: MV({ r: 16 },
        { s: 15, a: 5, vxS: 2.5, vyS: -3.2, proj: [arrow(6, { spd: 12, dmg: 5, kb: [-50, 5], stun: 20 })], pS: { t: -70, a: [6, 6], b: [175, 4], w: 6, ...POSE.tuck }, pA: { a: [6, 6], w: 6 } }),
      // backflip kick above you; on hit an arrow 20f later shoots them upward (wiki: 6 + 10, 9f startup, "5 (20) 2")
      nair: MV({ air: 1, r: 17, limb: 'leg', trail: 1 },
        { s: 9, a: 5, hb: [-12, -52, 26, 26], dmg: 3, kb: [-90, 2], stun: 19, sweep: 1, pS: { t: -80, l: [60, 120] }, pA: { ...POSE.flip, a: [100, 90], w: 90 } },
        { cond: 'hit', s: 16, a: 2, proj: [arrow(-90, { dmg: 5, kb: [-90, 7.7], stun: 19 })], pS: { t: -85, a: [-90, -90], w: -90 }, pA: { t: -85, a: [-90, -90], w: -90 } }),
      // melee bow swing forward, strong knockback (wiki: 15 dmg, 13f startup, 4f active)
      sair: MV({ air: 1, r: 18, trail: 1 },
        { s: 13, a: 4, hb: [2, -40, 28, 28], dmg: 7.5, kb: [-25, 7], stun: 21, pS: { t: -100, a: [-130, -110], w: -110 }, pA: { t: -70, a: [10, 20], w: 30 } }),
      // arrow down diagonally (wiki: 17 dmg, 14f startup, 5f active)
      dair: MV({ air: 1, r: 16 },
        { s: 14, a: 5, proj: [arrow(50, { spd: 10, dmg: 8.5, kb: [45, 7], stun: 16 })], pS: { t: -85, a: [50, 50], b: [140, 30], w: 50 }, pA: { a: [50, 50], w: 50 } }),
      // diagonal rising bow swing; grab on hit, then shoot them out (wiki: 1 + 1 + 16, 12f startup, 7f active)
      rec: MV({ air: 1, kind: 'rec', r: 15, trail: 1 },
        { s: 12, a: 7, hb: [-6, -54, 30, 40], dmg: 0.5, kb: [-80, 1], stun: 24, vy: -7.6, vx: 3.8, carry: 1, pS: { t: -75, a: [120, 100], w: 100, l: [30, 110], k: [120, 140] }, pA: { t: -100, a: [-60, -70], w: -70, l: [60, 120], k: [100, 140] } },
        { cond: 'hit', s: 3, a: 3, hb: [-6, -54, 30, 40], dmg: 0.5, kb: [0, 0], stun: 24, carry: 1, pS: { a: [-55, -55], b: [170, -40], w: -55 }, pA: { a: [-55, -55], w: -55 } },
        { cond: 'hit', s: 5, a: 3, proj: [arrow(-55, { spd: 10, dmg: 8, kb: [-65, 7.5], stun: 17 })], pA: { a: [-55, -55], b: [150, -30], w: -55 } }),
      // feet-first stomp (not steerable); fires down on hit — can't hit by landing on the floor.
      // Strongest ground-pound knockback in the game (wiki: 5 + 16, 14f startup)
      gp: MV({ air: 1, kind: 'gp', r: 12, land: 14 },
        { fall: 1, steer: false, s: 14, hb: [-8, -8, 16, 14], dmg: 2.5, kb: [0, 0.5], stun: 26, bounce: -6, pS: { t: -85, a: [-100, -100], w: -90, ...POSE.tuck }, pA: { t: -90, a: [-60, -60], w: -60, l: [85, 90], k: [95, 92] } },
        { cond: 'hit', s: 6, a: 3, proj: [arrow(90, { spd: 11, dmg: 8, kb: [-70, 8], stun: 15 })], pS: { t: -80, ...DOWN_ARM, w: 90, ...POSE.tuck }, pA: { ...DOWN_ARM, w: 90 } }),
    },
  },

  // ---------------------------------------------------------------- scythe (low knockback, side-swaps)
  scythe: {
    name: 'SCYTHE', len: 36, range: 50,
    stance: { a: [70, -20], b: [110, 30], w: -70 },
    idle: { a: [80, -100], w: -150 }, idleRun: 1, idleFlip: 1,   // standing + running: shouldered like the greatsword/axe, blade hanging down behind
    moves: {
      // upward scoop that lifts the target with you
      nlight: MV({ r: 13, trail: 1 },
        { s: 8, a: 6, hb: [0, -52, 30, 46], dmg: 6.5, kb: [-90, 3.8], stun: 26, vy: -6.2, together: 1, sweep: 1, pS: { ...POSE.crouch, a: [110, 120], w: 140 }, pA: { t: -100, a: [-60, -80], w: -110, ...POSE.rise } }),
      // forward swing; holding forward → second swing knocks away, else a kick pops them up
      slight: MV({ r: 14, trail: 1 },
        { s: 8, a: 3, hb: [2, -40, 34, 28], dmg: 4, kb: [-70, 2.5], stun: 22, vx: 2, pS: { t: -95, a: [-110, -120], w: -150 }, pA: { t: -70, a: [10, 30], w: 60 } },
        { cond: 'hit', s: 4, a: 3, hb: [2, -36, 24, 20], dmg: 2.5, kb: [-80, 4.5], stun: 18, limb: 'leg', pS: { l: [100, 160] }, pA: { t: -110, l: [-30, -20] },
          alt: { when: 'fwd', limb: 'arm', hb: [2, -40, 36, 28], dmg: 3, kb: [-25, 6], pS: { a: [60, 80], w: 120 }, pA: { a: [-40, -50], w: -40 } } }),
      // one-handed ground swing; target swapped behind you unless holding forward
      dlight: MV({ r: 15, trail: 1 },
        { s: 11, a: 3, hb: [4, -18, 36, 18], dmg: 3, kb: [-10, 1], stun: 22, pS: { ...POSE.crouch, a: [-100, -120], w: -150 }, pA: { ...POSE.reach, t: -45, a: [20, 30], w: 60 } },
        { cond: 'hit', s: 2, a: 3, hb: [-4, -24, 40, 24], dmg: 1.5, kb: [-30, 1], stun: 22, carry: 1, behind: 'unlessFwd', pS: { w: 60 }, pA: { t: -70, a: [100, 120], w: 170 } },
        { cond: 'hit', s: 3, a: 3, hb: [-30, -30, 60, 30], dmg: 2.5, kb: [-35, 5.5], stun: 18, behind: 'unlessFwd', pS: { w: 170 }, pA: { t: -90, a: [160, 180], w: 230 } }),
      // hook up-forward then kick; holding back carries them behind you
      nair: MV({ air: 1, r: 12, trail: 1 },
        { s: 11, a: 4, hb: [4, -60, 30, 30], dmg: 3, kb: [-60, 1], stun: 22, pS: { t: -85, a: [100, 110], w: 120 }, pA: { t: -95, a: [-50, -60], w: -40 } },
        { cond: 'hit', s: 2, a: 3, hb: [-8, -56, 40, 40], dmg: 0.5, kb: [-60, 1], stun: 22, carry: 1, behind: 'ifBack', pS: { w: -40 }, pA: { a: [-100, -120], w: -150 } },
        { cond: 'hit', s: 3, a: 3, hb: [-28, -44, 56, 30], dmg: 3.5, kb: [-40, 6], stun: 18, behind: 'ifBack', limb: 'leg', pS: { l: [100, 160] }, pA: { l: [-30, -20], k: [120, 90] } }),
      // swing up and to the side
      sair: MV({ air: 1, r: 13, trail: 1 },
        { s: 11, a: 5, hb: [0, -56, 36, 40], dmg: 6.5, kb: [-55, 6], stun: 18, sweep: 1, pS: { t: -85, a: [100, 90], w: 120 }, pA: { t: -95, a: [-60, -70], w: -80 } }),
      // hook diagonally down; thrown down, or carried behind when holding back
      dair: MV({ air: 1, r: 13, trail: 1 },
        { s: 11, a: 4, hb: [4, -12, 30, 24], dmg: 2.5, kb: [40, 1], stun: 22, pS: { t: -90, a: [-60, -80], w: -60, ...POSE.tuck }, pA: { t: -80, a: [50, 60], w: 90 } },
        { cond: 'hit', s: 2, a: 4, hb: [-6, -20, 36, 30], dmg: 1, kb: [40, 1], stun: 22, carry: 1, behind: 'ifBack', pS: { w: 90 }, pA: { a: [100, 120], w: 140 } },
        { cond: 'hit', s: 3, a: 3, hb: [-26, -24, 52, 30], dmg: 3, kb: [45, 6], stun: 18, behind: 'ifBack', pS: { w: 140 }, pA: { a: [130, 150], w: 200 } }),
      // diagonal helicopter spin, rising, two hit windows
      rec: MV({ air: 1, kind: 'rec', r: 16, trail: 1 },
        { s: 10, a: 6, hb: [-16, -60, 40, 50], dmg: 4.5, kb: [-75, 2.5], stun: 20, vy: -8.6, vx: 2, sweep: 1, pS: { t: -70, a: [100, 110], w: 120, l: [30, 110], k: [120, 140] }, pA: { t: -95, a: [-80, -90], w: -150 } },
        { s: 4, a: 6, hb: [-16, -64, 40, 50], dmg: 4.5, kb: [-70, 7], stun: 20, sweep: 1, pS: { w: -150 }, pA: { w: -420 } }),
      // fall with the scythe ready, slash down
      gp: MV({ air: 1, kind: 'gp', r: 13, land: 14, trail: 1 },
        { fall: 1, s: 16, hb: [-4, -16, 30, 26], dmg: 8, kb: [60, 6], stun: 20, pS: { t: -90, a: [-110, -120], w: -140, ...POSE.tuck }, pA: { t: -80, a: [40, 60], w: 110, l: [80, 95], k: [100, 95] } }),
    },
  },
};


// ---------------------------------------------------------------- rocket lance (rocket-boosted jousts)
WEAPONS.lance = {
  name: 'ROCKET LANCE', len: 30, range: 44,
  stance: { a: [70, 10], b: [100, 20], w: -6 },
  run: { a: [110, 125], w: 160 }, drag: 31,   // running: lance trailed behind, tip scraping the floor
  moves: {
    // two jabs; third strike only if jab 2 hits
    nlight: MV({ r: 11 },
      { s: 8, a: 5, hb: [14, -34, 34, 12], dmg: 2.5, kb: [-5, 1.5], stun: 16, pS: { a: [150, 20], w: -3 }, pA: { t: -72, a: [-2, 0], w: 0 } },
      { s: 8, a: 3, hb: [14, -34, 34, 12], dmg: 3, kb: [-5, 1.5], stun: 16, pS: { a: [140, 10] }, pA: { a: [-2, 0] } },
      { cond: 'hit', s: 10, a: 5, hb: [14, -34, 36, 12], dmg: 3, kb: [-30, 5.5], stun: 18, vx: 2, pS: { a: [150, 10] }, pA: { ...POSE.lunge, a: [-2, 0] } }),
    // rocket blast forward along the ground; fixed-force combo starter
    slight: MV({ r: 12, trail: 1 },
      { s: 12, a: 11, hb: [10, -34, 34, 16], dmg: 4.5, kb: [-50, 4.6], stun: 24, vx: 7.5, rocket: 1, pS: { t: -95, a: [150, 10], w: 0, l: [70, 100], k: [110, 95] }, pA: { ...POSE.dash, a: [-2, 0], w: 0 } }),
    // lance turned round, exhaust blasted at the enemy, slight recoil back
    dlight: MV({ r: 12 },
      { s: 6, a: 20, hits: 2, every: 10, hb: [2, -20, 34, 20], dmg: 4, kb: [-60, 2.6], stun: 20, vxS: -1.5, rocket: 1, pS: { ...POSE.crouch, a: [120, 160], w: 180 }, pA: { ...POSE.crouch, a: [130, 170], w: 175 } }),
    // flip and swing a very wide arc overhead
    nair: MV({ air: 1, r: 13, trail: 1 },
      { s: 12, a: 12, hb: [-30, -64, 60, 42], dmg: 7, kb: [-80, 5.5], stun: 18, sweep: 1, pS: { t: -80, a: [150, 160], w: 160, ...POSE.rise }, pA: { ...POSE.flip, a: [370, 380], w: 380 } }),
    // rocket joust forward — long horizontal travel (doubles as recovery)
    sair: MV({ air: 1, r: 12, trail: 1 },
      { s: 14, a: 12, hb: [12, -30, 32, 22], dmg: 8.5, kb: [-15, 6.5], stun: 20, vx: 8.5, vy: -0.4, nograv: 1, rocket: 1, pS: { t: -95, a: [150, 10], w: 0, ...POSE.tuck }, pA: { t: -40, a: [-2, 0], w: 0, l: [150, 170], k: [170, 175] } }),
    // rocket joust diagonally down-forward
    dair: MV({ air: 1, r: 12, trail: 1 },
      { s: 12, a: 11, hb: [10, -16, 28, 24], dmg: 8.5, kb: [-10, 6], stun: 20, vx: 6, vy: 6, nograv: 1, rocket: 1, pS: { t: -90, a: [100, 30], w: 30, ...POSE.tuck }, pA: { t: -20, a: [40, 40], w: 40, l: [150, 170], k: [170, 175] } }),
    // hold to hover & charge, then rocket up; on hit you stop dead and they keep flying
    rec: MV({ air: 1, kind: 'rec', r: 12, trail: 1 },
      { s: 13, a: 10, charge: 1, chargeMax: 43, chargeLaunch: 1, hb: [-6, -64, 26, 50], dmg: 9, kb: [-70, 7.5], stun: 20, vy: -7.5, vx: 2.5, nograv: 1, rocket: 1, stopOnHit: 1,
        pS: { t: -80, a: [100, 60], w: 60, ...POSE.tuck }, pA: { t: -100, a: [-70, -70], w: -70, l: [85, 95], k: [100, 95] } }),
    // flip over the lance and drop; exhaust spikes them downward
    gp: MV({ air: 1, kind: 'gp', r: 14, land: 20, heavy: 1 },
      { fall: 1, s: 17, hb: [-8, -10, 16, 24], dmg: 12.5, kb: [90, 7], stun: 22, rocket: 1, pS: { ...POSE.flip, a: [-100, -100], w: -90 }, pA: { t: -95, ...DOWN_ARM, w: 90, l: [80, 95], k: [100, 95] } }),
  },
};

// ---------------------------------------------------------------- gauntlets (fast strings, grab, uppercut)
const PUNCH_A = { a: [0, -4], b: [140, 40] }, PUNCH_B = { a: [140, 40], b: [0, -4] };
WEAPONS.gauntlets = {
  name: 'GAUNTLETS', len: 0, limb: 'arm', range: 22,
  stance: { a: [70, -40], b: [95, -30] },
  moves: {
    // flurry: first three punches always, last two only on hit
    nlight: MV({ r: 10, trail: 1 },
      { s: 5, a: 5, hb: [2, -36, 22, 14], dmg: 1.5, kb: [-5, 1], stun: 15, pS: { a: [140, -40] }, pA: { t: -74, ...PUNCH_A } },
      { s: 5, a: 3, hb: [2, -36, 22, 14], dmg: 1, kb: [-5, 1], stun: 15, pS: { a: [120, -30] }, pA: PUNCH_B },
      { s: 5, a: 3, hb: [2, -36, 22, 14], dmg: 1, kb: [-5, 1], stun: 15, pS: { b: [120, -30] }, pA: PUNCH_A },
      { cond: 'hit', s: 5, a: 3, hb: [2, -36, 22, 14], dmg: 1.5, kb: [-5, 1], stun: 15, pS: { a: [120, -30] }, pA: PUNCH_B },
      { cond: 'hit', s: 10, a: 3, hb: [2, -36, 24, 14], dmg: 1.5, kb: [-25, 5], stun: 18, pS: { t: -95, a: [160, -60] }, pA: { ...POSE.lunge, ...PUNCH_A } }),
    // small forward-hopping uppercut that chains
    slight: MV({ r: 10, trail: 1 },
      { s: 8, a: 11, hb: [0, -52, 24, 42], dmg: 7, kb: [-75, 4.5], stun: 26, vx: 2.5, vy: -6.2, together: 1, sweep: 1, pS: { ...POSE.crouch, a: [110, 60] }, pA: { t: -100, ...UP, ...POSE.rise } }),
    // step in and pound the ground — main combo starter
    dlight: MV({ r: 10, trail: 1 },
      { s: 11, a: 5, hb: [8, -18, 26, 18], dmg: 5.5, kb: [-84, 5.4], stun: 28, vx: 3, pS: { t: -100, a: [-100, -120] }, pA: { ...POSE.reach, t: -40, a: [60, 80] } }),
    // grab: tiny clap window, then a down-throw
    nair: MV({ air: 1, r: 10 },
      { s: 11, a: 4, hb: [4, -42, 24, 32], dmg: 0.5, kb: [0, 0], stun: 30, carry: 1, pS: { a: [-60, -20], b: [60, 20] }, pA: { a: [0, 10], b: [0, -10] } },
      { cond: 'hit', s: 5, a: 2, hb: [-6, -40, 34, 30], dmg: 2.5, kb: [0, 0], stun: 30, carry: 1, pS: { a: [-40, -60] }, pA: { a: [20, 40] } },
      { cond: 'hit', s: 5, a: 3, hb: [-6, -34, 34, 36], dmg: 2.5, kb: [70, 5.5], stun: 18, pS: { a: [-120, -100], b: [-100, -80] }, pA: { a: [80, 90], b: [90, 95] } }),
    // dashing punch; second punch 16f later only on hit
    sair: MV({ air: 1, r: 12, trail: 1 },
      { s: 13, a: 7, hb: [4, -36, 22, 14], dmg: 2.5, kb: [-10, 1], stun: 26, vx: 6, pS: { t: -95, a: [170, -80] }, pA: { t: -60, ...PUNCH_A } },
      { cond: 'hit', s: 10, a: 3, hb: [4, -36, 24, 16], dmg: 5, kb: [-20, 6.5], stun: 18, pS: { b: [150, -60] }, pA: { t: -55, ...PUNCH_B } }),
    // downward flurry drifting down-forward; last punch only on hit
    dair: MV({ air: 1, r: 11, trail: 1 },
      { s: 11, a: 3, hb: [-2, -12, 22, 22], dmg: 1, kb: [60, 1], stun: 16, vx: 2, vy: 2.5, pS: { t: -80, a: [-40, -60], ...POSE.tuck }, pA: { t: -70, a: [60, 70] } },
      { s: 4, a: 3, hb: [-2, -12, 22, 22], dmg: 1.5, kb: [60, 1], stun: 16, pA: { a: [-20, -40], b: [60, 70] } },
      { s: 4, a: 3, hb: [-2, -12, 22, 22], dmg: 2, kb: [60, 1], stun: 16, pA: { a: [60, 70], b: [-20, -40] } },
      { cond: 'hit', s: 6, a: 3, hb: [-2, -14, 24, 24], dmg: 2, kb: [-40, 5], stun: 18, pS: { a: [-90, -100] }, pA: { a: [40, 30] } }),
    // rising uppercut, sends straight up
    rec: MV({ air: 1, kind: 'rec', r: 14, trail: 1 },
      { s: 11, a: 10, hb: [-4, -58, 22, 42], dmg: 8.5, kb: [-90, 7], stun: 20, vy: -9, vx: 1, pS: { ...POSE.tuck, a: [110, 60] }, pA: { t: -100, ...UP, l: [60, 140], k: [110, 100] } }),
    // arms drawn back, steer forward while falling, slam on hit
    gp: MV({ air: 1, kind: 'gp', r: 12, land: 16 },
      { fall: 1, steerFwd: 1, s: 14, hb: [-4, -14, 26, 22], dmg: 8.5, kb: [50, 6.5], stun: 20, pS: { t: -80, a: [-150, -170], b: [-160, -175], ...POSE.tuck }, pA: { t: -70, a: [60, 70], b: [70, 80], l: [80, 95], k: [100, 95] } }),
  },
};

// ---------------------------------------------------------------- axe: short double-bit hand axe (wide arcs, heavy hits, hop-chop starter)
WEAPONS.axe = {
  name: 'AXE', len: 20, range: 44,
  stance: { a: [70, -50], b: [100, -30], w: -110 },
  moves: {
    // upward scoop in front and above — anti-air launcher
    nlight: MV({ r: 14, trail: 1 },
      { s: 9, a: 5, hb: [-6, -66, 40, 50], dmg: 6.5, kb: [-80, 5.6], stun: 22, sweep: 1, pS: { ...POSE.crouch, a: [130, 150], w: 160 }, pA: { t: -100, a: [-60, -80], w: -100, ...POSE.rise } }),
    // stepping horizontal cleave; overhead slam on hit pops them up
    slight: MV({ r: 15, trail: 1 },
      { s: 10, a: 4, hb: [2, -44, 36, 30], dmg: 4.5, kb: [-45, 2.5], stun: 22, vx: 4, sweep: 1, pS: { t: -95, a: [-130, -150], w: -150 }, pA: { ...POSE.lunge, a: [10, 20], w: 30 } },
      { cond: 'hit', s: 5, a: 4, hb: [0, -60, 38, 56], dmg: 4, kb: [-65, 5.8], stun: 20, sweep: 1, pS: { t: -90, a: [-100, -120], w: -130 }, pA: { t: -70, a: [30, 40], w: 50 } }),
    // small hop forward and chop down in front — main combo starter
    dlight: MV({ r: 14, trail: 1 },
      { s: 12, a: 5, hb: [6, -40, 34, 40], dmg: 6, kb: [-72, 4.8], stun: 25, vxS: 2.2, vyS: -3.4, sweep: 1, pS: { ...POSE.tuck, t: -85, a: [-110, -130], w: -140 }, pA: { ...POSE.reach, t: -50, a: [40, 50], w: 60 } }),
    // huge overhead arc from behind to front
    nair: MV({ air: 1, r: 14, trail: 1 },
      { s: 11, a: 6, hb: [-26, -72, 58, 50], dmg: 8, kb: [-80, 6], stun: 20, sweep: 1, pS: { t: -80, a: [160, 200], w: 200, ...POSE.rise }, pA: { t: -85, a: [350, 360], w: 370 } }),
    // heavy forward cleave
    sair: MV({ air: 1, r: 15, trail: 1 },
      { s: 12, a: 4, hb: [2, -46, 38, 32], dmg: 8, kb: [-25, 6.5], stun: 18, sweep: 1, pS: { t: -100, a: [-150, -160], w: -170 }, pA: { t: -65, a: [20, 30], w: 40 } }),
    // swing in front and under, spikes diagonally down-forward
    dair: MV({ air: 1, r: 13, trail: 1 },
      { s: 12, a: 5, hb: [-12, -16, 44, 32], dmg: 8, kb: [50, 5.5], stun: 20, vx: 1.5, sweep: 1, pS: { t: -95, a: [-40, -20], w: -20, ...POSE.tuck }, pA: { t: -85, a: [130, 150], w: 170 } }),
    // rising whirl: two dragging hits, then a launching cut
    rec: MV({ air: 1, kind: 'rec', r: 16, trail: 1 },
      { s: 9, a: 14, hits: 2, every: 7, hb: [-14, -64, 44, 52], dmg: 3.5, kb: [-80, 2.5], stun: 20, vy: -8.8, vx: 1.5, sweep: 1, pS: { t: -75, a: [100, 120], w: 120, l: [30, 110], k: [120, 140] }, pA: { t: -95, a: [-80, -90], w: -460, l: [70, 100], k: [100, 110] } },
      { s: 2, a: 4, hb: [-10, -70, 40, 44], dmg: 4, kb: [-80, 7.2], stun: 20, sweep: 1, pS: { w: -460 }, pA: { w: -520 } }),
    // raise the axe and fall, chopping down hard
    gp: MV({ air: 1, kind: 'gp', r: 14, land: 16, heavy: 1, trail: 1 },
      { fall: 1, s: 17, hb: [-14, -18, 40, 28], dmg: 10, kb: [55, 7], stun: 22, sweep: 1, pS: { t: -85, a: [-110, -130], w: -150, ...POSE.tuck }, pA: { t: -75, a: [50, 60], w: 80, l: [80, 95], k: [100, 95] } }),
  },
};

const WEAPON_DROP = ['sword', 'staff', 'greatsword', 'bow', 'scythe', 'lance', 'gauntlets', 'axe'];

const THROW_MOVE = MV({ kind: 'throw', r: 11 },
  { s: 4, a: 2, pS: { t: -100, a: [-150, -120], w: -120 }, pA: { t: -65, a: [10, 0], w: 0, l: [40, 95], k: [135, 115] } });

// smear segment [inner, outer] for the striking weapon edge / limb. sk = joint positions, d = weapon dir, f = facing
function trailSeg(wpn, limb, sk, d, f) {
  if (wpn.len && limb !== 'leg') {
    const h = sk.handA, n = [-d[1] * f, d[0] * f];
    const at = (a, b) => [h[0] + d[0] * a + n[0] * b, h[1] + d[1] * a + n[1] * b];
    if (wpn.id === 'scythe') return [at(3, 0), at(28, 12)];
    if (wpn.id === 'axe') return [at(3, 0), at(16, 10)];
    return [at(3, 0), at(wpn.len, 0)];
  }
  return (limb || wpn.limb) === 'leg' ? [sk.kneeA, sk.footA] : [sk.elbowA, sk.handA];
}

// how far forward the smear actually gets during a part's active window vs. its hitbox edge.
// p.vis = furthest forward smear point (body-relative), p.ext = forward push the smear needs so
// what you see reaches what hits. Carry/behind parts sweep around the body, so they're left alone.
const SMEAR_TOL = 2;   // hurtbox is a touch wider than the drawn body
function measureReach(wpn, m) {
  if (m.kind === 'gp') return;
  for (const p of m.parts.flatMap((q) => (q.altPart ? [q, q.altPart] : [q]))) {
    if (!p.hb || p.carry || p.behind) continue;
    let vis = -1e9;
    for (let f = p.s - 1; f <= p.s + p.a; f++) {
      let pose;
      if (f < p.s) pose = p.PS;
      else {
        const k = f - p.s + 1;
        pose = mixPose(p.PS, p.PA, p.sweep ? easeOut(Math.min(1, k / p.a)) : Math.min(1, k / 2));
      }
      const L = solvePose(pose), wa = pose[9] * D2R;
      vis = Math.max(vis, trailSeg(wpn, p.limb, L, [Math.cos(wa), Math.sin(wa)], 1)[1][0]);
    }
    const ext = p.hb[0] + p.hb[2] - SMEAR_TOL - vis;
    p.vis = vis;
    p.ext = ext > 3 ? ext : 0;
    if (p.ext) m.trail = m.trail || 1;
  }
}

// bake partial poses into full arrays; each part inherits from the previous part's contact pose
(function bakeMoves() {
  const bake = (m, stance, wid, mid) => {
    let prev = stance;
    m.id = mid; m.wpn = wid;
    for (const p of m.parts) {
      p.PS = P(p.pS, prev); p.PA = P(p.pA, p.PS); prev = p.PA;
      if (p.limb == null) p.limb = m.limb;
      if (p.alt) {
        const alt = Object.assign({}, p, p.alt);
        delete alt.alt;
        alt.PS = P(p.alt.pS, p.PS.slice()); alt.PA = P(p.alt.pA, alt.PS);
        p.altPart = alt;
      }
    }
  };
  // generous side reach so strings can follow up after knockback (Brawlhalla hitboxes are big).
  // Already-long weapons (staff, lance) keep the small bonus.
  // extra forward reach on every melee hitbox (ground-pounds excluded)
  const REACH = { scythe: 18, staff: 8, bow: 10, axe: 6 };
  for (const key in REACH) {
    for (const mk in WEAPONS[key].moves) {
      const m = WEAPONS[key].moves[mk];
      if (m.kind === 'gp') continue;
      for (const p of m.parts) {
        // kicks don't get the weapon's reach (a 'fwd' alt swing on a kick part still does)
        if (p.hb && (p.limb || m.limb) !== 'leg') p.hb = [p.hb[0], p.hb[1], p.hb[2] + REACH[key], p.hb[3]];
        if (p.alt && p.alt.hb && (p.alt.limb || p.limb || m.limb) !== 'leg') p.alt.hb = [p.alt.hb[0], p.alt.hb[1], p.alt.hb[2] + REACH[key], p.alt.hb[3]];
      }
    }
  }
  const SIDE = ['slight', 'sair', 'slightB', 'slightC'];
  const LONG = ['staff', 'lance'];
  for (const key in WEAPONS) {
    const wpn = WEAPONS[key], bonus = LONG.includes(key) ? 12 : key === 'greatsword' ? 8 : key === 'none' || key === 'gauntlets' ? 18 : 24;
    for (const mk of SIDE) {
      const m = wpn.moves[mk];
      if (!m) continue;
      for (const p of m.parts) {
        if (p.hb) p.hb = [p.hb[0], p.hb[1] - 8, p.hb[2] + bonus, p.hb[3] + 8];
        if (mk === 'sair' && p.hb && p.vx == null && !p.cond && !p.nograv) p.vx = 2.5;
        if (p.alt && p.alt.hb) p.alt.hb = [p.alt.hb[0], p.alt.hb[1] - 8, p.alt.hb[2] + bonus, p.alt.hb[3] + 8];
      }
    }
  }
  for (const key in WEAPONS) {
    const wpn = WEAPONS[key];
    wpn.id = key;
    wpn.STANCE = P(wpn.stance);
    wpn.IDLE = wpn.idle ? P(wpn.idle, wpn.STANCE) : wpn.STANCE;   // standing-still pose (attacks still bake from STANCE)
    wpn.RUN = wpn.run ? P(wpn.run, wpn.STANCE) : wpn.idleRun ? wpn.IDLE : wpn.STANCE;   // arm/weapon carried while running
    for (const mk in wpn.moves) { bake(wpn.moves[mk], wpn.STANCE, key, mk); measureReach(wpn, wpn.moves[mk]); }
  }
  bake(THROW_MOVE, P({}), 'none', 'throw');
})();
