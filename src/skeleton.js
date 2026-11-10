'use strict';
// ---------- stick-figure skeleton (forward kinematics, pose-to-pose) ----------
// Pose = flat array of absolute angles in degrees (facing right, screen y down):
//   0 = forward, 90 = down, -90 = up, 180 = back.
// [0 torso, 1 frontUpperArm, 2 frontForearm, 3 backUpperArm, 4 backForearm,
//  5 frontThigh, 6 frontShin, 7 backThigh, 8 backShin, 9 weapon, 10 hipYOffset(air)]
const BONE = { thigh: 8, shin: 8, torso: 10, upper: 7, fore: 7, neck: 5, head: 6 }; // chunky YOMI-ish proportions
const HIP_AIR = 15; // hip height above feet while airborne

const BASE = [-82, 60, -30, 105, 20, 60, 95, 125, 100, -60, 0];

function P(o, base = BASE) {
  const p = base.slice();
  if (!o) return p;
  if (o.t != null) p[0] = o.t;
  if (o.a) { p[1] = o.a[0]; p[2] = o.a[1]; }
  if (o.b) { p[3] = o.b[0]; p[4] = o.b[1]; }
  if (o.l) { p[5] = o.l[0]; p[6] = o.l[1]; }
  if (o.k) { p[7] = o.k[0]; p[8] = o.k[1]; }
  if (o.w != null) p[9] = o.w;
  if (o.hy != null) p[10] = o.hy;
  return p;
}

function mixPose(a, b, t, out) {
  out = out || new Array(11);
  for (let i = 0; i < 11; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

function towardPose(cur, target, k) {
  for (let i = 0; i < 11; i++) cur[i] += (target[i] - cur[i]) * k;
}

// local joint positions, hip at (0,0)
function solvePose(p) {
  const v = (deg, len) => [Math.cos(deg * D2R) * len, Math.sin(deg * D2R) * len];
  const hip = [0, 0];
  const tv = v(p[0], BONE.torso);
  const neck = [tv[0], tv[1]];
  const hv = v(p[0], BONE.neck);
  const head = [neck[0] + hv[0], neck[1] + hv[1]];
  const e1 = v(p[1], BONE.upper), f1 = v(p[2], BONE.fore);
  const elbowA = [neck[0] + e1[0], neck[1] + e1[1]];
  const handA = [elbowA[0] + f1[0], elbowA[1] + f1[1]];
  const e2 = v(p[3], BONE.upper), f2 = v(p[4], BONE.fore);
  const elbowB = [neck[0] + e2[0], neck[1] + e2[1]];
  const handB = [elbowB[0] + f2[0], elbowB[1] + f2[1]];
  const k1 = v(p[5], BONE.thigh), s1 = v(p[6], BONE.shin);
  const kneeA = [k1[0], k1[1]];
  const footA = [kneeA[0] + s1[0], kneeA[1] + s1[1]];
  const k2 = v(p[7], BONE.thigh), s2 = v(p[8], BONE.shin);
  const kneeB = [k2[0], k2[1]];
  const footB = [kneeB[0] + s2[0], kneeB[1] + s2[1]];
  return { hip, neck, head, elbowA, handA, elbowB, handB, kneeA, footA, kneeB, footB };
}

// procedural run cycle layered on a stance.
// One leg's stride over t in [0,1): short stance (0 → .36), long swing with a flight
// phase on each side (.36 → .5 and .86 → 1), where neither foot touches the floor.
// [t, thigh angle, knee bend (shin - thigh)]
const RUN_LEG = [
  [0.00, 58, 40],    // contact: foot lands just ahead of the hip, knee soft
  [0.16, 90, 46],    // mid-stance: knee loaded, hip at its lowest
  [0.36, 115, 6],    // toe-off: leg driven straight out behind
  [0.52, 112, 128],  // recovery: heel kicks up toward the butt
  [0.76, 28, 100],   // knee drive: thigh high in front, shin folded under
  [0.92, 46, 44],    // reach: shin swings out ahead
  [1.00, 58, 40],
];
const RUN_FLIGHT = [[0.36, 0.5], [0.86, 1.0]];

function runLeg(t) {
  t -= Math.floor(t);
  let i = 1;
  while (RUN_LEG[i][0] < t) i++;
  const a = RUN_LEG[i - 1], b = RUN_LEG[i];
  const u = (t - a[0]) / (b[0] - a[0]), e = u * u * (3 - 2 * u);
  const thigh = a[1] + (b[1] - a[1]) * e;
  return [thigh, thigh + a[2] + (b[2] - a[2]) * e];
}

// extra hip lift (px) while both feet are off the floor
function runLift(phase) {
  let t = phase / (Math.PI * 2);
  t -= Math.floor(t);
  for (const [a, b] of RUN_FLIGHT) if (t > a && t < b) return 2.6 * Math.sin(Math.PI * (t - a) / (b - a));
  return 0;
}

function runPose(phase, stance, armed, out) {
  out = stance.slice();
  const t = phase / (Math.PI * 2);
  const A = runLeg(t), B = runLeg(t + 0.5);
  out[5] = A[0]; out[6] = A[1];
  out[7] = B[0]; out[8] = B[1];
  // forward lean, tipping a little further at each footfall
  const s2 = Math.cos(phase * 2);
  out[0] = -58 + 3 * s2;
  // arms pump opposite their leg with the elbow bent ~90°; the hand comes up high on the
  // forward swing and the elbow opens a bit on the back swing
  const sw = -Math.sin(phase);   // +1 when leg A is at full knee drive (t ≈ .75)
  const arm = (k) => { const up = 92 + 58 * k; return [up, up - (80 + 22 * Math.max(0, -k))]; };
  const bArm = arm(-sw);
  out[3] = bArm[0]; out[4] = bArm[1];
  if (!armed) { const fArm = arm(sw); out[1] = fArm[0]; out[2] = fArm[1]; }
  else { out[1] += 6 * sw; out[2] += 6 * sw; }
  return out;
}

// common body shapes
const POSE = {
  rise:  { t: -86, l: [20, 110], k: [100, 150] },
  fall:  { t: -84, l: [65, 100], k: [110, 80] },
  crouch:{ t: -60, l: [30, 110], k: [140, 80] },
  lunge: { t: -62, l: [30, 95], k: [140, 120] },
  dash:  { t: -55, l: [25, 90], k: [150, 125] },
  tuck:  { t: -60, l: [0, 120], k: [40, 150] },
  spot:  { t: -96, a: [110, -95], b: [80, -100], l: [70, 120], k: [110, 60] },
  hurt:  { t: -122, a: [-130, -160], b: [-155, -175], l: [45, 85], k: [100, 125] },
  hurtLo:{ t: -105, a: [140, 170], b: [120, 150], l: [55, 100], k: [115, 95] },
  ko:    { t: 186, a: [150, 190], b: [205, 175], l: [-8, 2], k: [8, 12], w: 160 },
  land:  { t: -70, l: [35, 115], k: [135, 75] },
  flip:  { t: -200, l: [-60, 0], k: [-30, 40] },
  reach: { t: -60, l: [30, 95], k: [140, 120] },
  guard: { t: -66, l: [32, 112], k: [142, 78] },                        // crouch block
  burst: { t: -96, a: [-55, -70], b: [-125, -110], l: [55, 100], k: [125, 100] },  // arms flung out (burst)
  riposte: { t: -76, b: [165, 125], l: [28, 98], k: [148, 118] },        // after a parry (arm/weapon aimed in fighter.js)
};
