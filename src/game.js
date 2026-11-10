'use strict';
// ---------- game loop, rounds, camera, menus ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
G.ctx = ctx;
ctx.imageSmoothingEnabled = false;

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  const sc = s >= 2 ? Math.max(2, Math.floor(s * 2) / 2) : s;
  canvas.style.width = Math.floor(W * sc) + 'px';
  canvas.style.height = Math.floor(H * sc) + 'px';
}
addEventListener('resize', fit);
fit();

const MAX_SEP = 560, ZMIN = 0.6, ZMAX = 1.15, HUD_TOP = 48;
const TITLE_SHIFT = 100; // title screen: demo fight sits right of centre, menu column on the left
const CONFIRM = ['Enter', 'NumpadEnter', 'Space', 'KeyJ'];

const Game = {
  mode: 'title',          // title | intro | fight | ko | end
  paused: false,
  players: 'demo',        // demo | cpu | pvp
  cpuLevel: 1,
  menuIdx: 0,
  showControls: false,
  frameData: false,       // frame meter overlay (recovery-frame system)
  ctrlRow: 0, ctrlCol: 0, rebinding: false, ctrlMsg: '', ctrlMsgT: 0,
  t: 0, timer: 0, round: 1, phaseT: 0, slow: 0, invert: 0, shakeAmt: 0,
  fighters: [new Fighter(0), new Fighter(1)],
  ctrls: [NULL_CTRL, NULL_CTRL],
  koWinner: null, koText: '', koSub: '', demoReset: 0, speed: { t: 0, ang: 0 },
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); },
  // full-screen colour flash that fades out over `life` frames (parry = white, punish = red)
  flash: null,
  screenFlash(col, life, alpha) { if (this.mode !== 'title') this.flash = { col, life, alpha, t: 0 }; },
  speedLines(ang, t = 16) { this.speed = { t: Math.max(this.speed.t, t), ang }; },
  onKO(vic, att, style) {
    this.slow = 60;
    if (this.mode === 'fight') {
      this.mode = 'ko'; this.phaseT = 0; this.koWinner = att; this.koText = 'K.O.'; this.koSub = KILL_NAMES[style] || '';
      SFX.ko();
    } else if (this.mode === 'title') this.demoReset = 150;
  },
};
Game.world = new World(Game);

// gamepad edge detection for menus
const PadPrev = {};
function padHit(...btns) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let hit = false;
  for (const gp of pads) {
    if (!gp) continue;
    for (const b of btns) {
      const key = gp.index + ':' + b, on = !!(gp.buttons[b] && gp.buttons[b].pressed);
      if (on && !PadPrev[key]) hit = true;
      PadPrev[key] = on;
    }
  }
  return hit;
}
const menuUp = () => anyHit('KeyW', 'ArrowUp') | padHit(12);
const menuDown = () => anyHit('KeyS', 'ArrowDown') | padHit(13);
const menuLeft = () => anyHit('KeyA', 'ArrowLeft') | padHit(14);
const menuRight = () => anyHit('KeyD', 'ArrowRight') | padHit(15);
const menuOk = () => anyHit(...CONFIRM) | padHit(0);
const menuBack = () => anyHit('Escape', 'KeyP') | padHit(9);

// ---------------- setup ----------------
function setupMatch(players) {
  Game.players = players;
  reseedScenery(); // new night sky, moon phase and sakura variants every match
  const [a, b] = Game.fighters;
  a.wins = b.wins = 0;
  if (players === 'pvp') {
    // each player uses the device picked on the controls screen (default P1 keyboard, P2 gamepad)
    Game.ctrls = [new Controller(() => playerSources('p1')), new Controller(() => playerSources('p2'))];
    a.name = 'P1'; b.name = 'P2';
  } else if (players === 'cpu') {
    Game.ctrls = [new Controller(soloSources), new AIController(Game.cpuLevel)];
    a.name = 'P1'; b.name = 'CPU ' + AI_LEVELS[Game.cpuLevel].name;
  } else {
    Game.ctrls = [new AIController(1), new AIController(1)];
    a.name = 'CPU'; b.name = 'CPU';
  }
  Game.round = 1;
  startRound();
}

function setupDemo() {
  setupMatch('demo');
  Game.menuIdx = 0;
  Game.showControls = false;
}

function startRound() {
  const [a, b] = Game.fighters;
  a.reset(-70, 1); b.reset(70, -1);
  Game.world.reset();
  Cam.x = 0; Cam.z = ZMAX; Cam.oy = 0;
  for (let i = 0; i < 2; i++) if (Game.ctrls[i].bind) Game.ctrls[i].bind(Game.fighters[i], Game.fighters[1 - i], Game.world);
  Game.flash = null;
  Game.timer = 99 * 60; Game.phaseT = 0; Game.slow = 0; Game.koWinner = null; Game.demoReset = 0;
  Game.mode = Game.players === 'demo' ? 'title' : 'intro';
  if (Game.mode === 'title') Cam.x = -TITLE_SHIFT / Cam.z;
}

function endRound() {
  const w = Game.koWinner;
  if (w) w.wins++;
  if (w && w.wins >= 2) { Game.mode = 'end'; Game.phaseT = 0; Game.menuIdx = 0; return; }
  if (w) Game.round++;
  startRound();
}

function timeOver() {
  const [a, b] = Game.fighters;
  Game.mode = 'ko'; Game.phaseT = 0; Game.slow = 30;
  Game.koWinner = a.hp === b.hp ? null : a.hp > b.hp ? a : b;
  Game.koText = Game.koWinner ? 'TIME' : 'DRAW'; Game.koSub = '';
  SFX.ko();
}

// ---------------- camera ----------------
function updateCamera(fs) {
  const [a, b] = fs;
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y, 0) - 52;
  const title = Game.mode === 'title';
  let z = Math.min(ZMAX, (W - (title ? TITLE_SHIFT : 0)) / (maxX - minX + 110), (GROUND_SY - HUD_TOP) / -top);
  z = Math.max(ZMIN, z);
  Cam.z += (z - Cam.z) * 0.08;
  const tx = (minX + maxX) / 2 - (title ? TITLE_SHIFT / Cam.z : 0);
  Cam.x += (tx - Cam.x) * 0.12;
  const topScreen = GROUND_SY + top * Cam.z;
  const oy = topScreen < HUD_TOP ? HUD_TOP - topScreen : 0;
  Cam.oy += (oy - Cam.oy) * 0.15;
}

// keep both fighters on one screen (the stage itself is endless)
function constrain(fs) {
  const [a, b] = fs;
  const d = b.x - a.x, ad = Math.abs(d);
  if (ad <= MAX_SEP) return;
  const ex = ad - MAX_SEP, s = sign(d);
  const aAway = -s * a.vx > 0, bAway = s * b.vx > 0;
  const fa = aAway && bAway ? 0.5 : aAway ? 1 : bAway ? 0 : 0.5;
  a.x += s * ex * fa; b.x -= s * ex * (1 - fa);
  if (aAway) a.vx = 0;
  if (bAway) b.vx = 0;
}

// ---------------- simulation ----------------
function simStep() {
  const fs = Game.fighters, w = Game.world;
  const live = Game.mode === 'fight' || Game.mode === 'title';
  for (let i = 0; i < 2; i++) {
    Game.ctrls[i].poll();
    fs[i].ctrl = live ? Game.ctrls[i] : NULL_CTRL;
  }
  for (const f of fs) {
    f.bufferInput();
    if (f.hitstop > 0) { f.hitstop--; if (f.flash > 0) f.flash--; continue; }
    f.update(w);
  }
  w.resolveMelee(fs);
  w.updateProjs(fs);
  w.updatePickups(fs, Cam.x);
  w.updateFx();
  constrain(fs);
  for (const f of fs) if (f.state !== 'hitstun' && f.hitstop === 0) f.dispHp = approach(f.dispHp, f.hp, 1.2);
  for (const f of fs) {
    if ((f.state === 'hitstun' || f.state === 'ko') && f.hitstop === 0 && Math.hypot(f.vx, f.vy) > 3.5 && Game.t % 2 === 0)
      w.parts.push({ x: f.x + rand(-2, 2), y: f.y - 20 + rand(-4, 4), vx: 0, vy: 0, life: 20, t: 0, s: 2, nograv: 1, col: PDIM[f.id] === PDIM[0] ? '#7f9cff' : '#ff9aa0' });
  }
  if (Game.speed.t > 0) Game.speed.t--;
  updateCamera(fs);
  if (Game.invert > 0) Game.invert--;
  if (Game.flash && ++Game.flash.t >= Game.flash.life) Game.flash = null;

  switch (Game.mode) {
    case 'intro':
      Game.phaseT++;
      if (Game.phaseT === 55) SFX.round();
      if (Game.phaseT >= 85) Game.mode = 'fight';
      break;
    case 'fight':
      if (--Game.timer <= 0) timeOver();
      break;
    case 'ko':
      Game.phaseT++;
      if (Game.phaseT > 150) endRound();
      break;
    case 'title':
      if (Game.demoReset > 0 && --Game.demoReset === 0) startRound();
      break;
  }
}

function step() {
  Game.t++;
  SFX.setQuiet(Game.mode === 'title');
  if (Game.mode === 'title') titleInput();
  else if (Game.paused) { pauseInput(); Keys.hit.clear(); return; }
  else if (Game.mode === 'end') endInput();
  else if (menuBack()) { Game.paused = true; Game.menuIdx = 0; Keys.hit.clear(); return; }

  let sim = true;
  if (Game.slow > 0) { Game.slow--; sim = Game.slow % 3 === 0; }
  if (sim) simStep();

  if (Game.shakeAmt > 0) {
    Cam.shakeX = rand(-1, 1) * Game.shakeAmt; Cam.shakeY = rand(-1, 1) * Game.shakeAmt * 0.6;
    Game.shakeAmt *= 0.82;
    if (Game.shakeAmt < 0.3) Game.shakeAmt = 0;
  } else Cam.shakeX = Cam.shakeY = 0;
  Keys.hit.clear();
}

// ---------------- menus ----------------
// items: { label, value?, opt? } — opt items cycle with left/right
function titleItems() {
  return [
    { label: 'VS CPU' },
    { label: 'LOCAL 2P' },
    { label: 'CPU LEVEL', value: AI_LEVELS[Game.cpuLevel].name, opt: true },
    { label: 'SOUND', value: SFX.muted ? 'OFF' : 'ON', opt: true },
    { label: 'FRAME DATA', value: Game.frameData ? 'ON' : 'OFF', opt: true },
    { label: 'CONTROLS' },
  ];
}
function openControls() {
  Game.showControls = true; Game.ctrlRow = 0; Game.ctrlCol = 0; Game.rebinding = false; Game.ctrlMsg = '';
  Keys.hit.clear();
}
function titleInput() {
  if (Game.showControls) { controlsInput(); return; }
  const n = titleItems().length;
  if (menuUp()) { Game.menuIdx = (Game.menuIdx + n - 1) % n; SFX.select(); }
  if (menuDown()) { Game.menuIdx = (Game.menuIdx + 1) % n; SFX.select(); }
  const lr = menuLeft() ? -1 : menuRight() ? 1 : 0;
  const ok = menuOk();
  if (Game.menuIdx === 2 && (lr || ok)) { Game.cpuLevel = (Game.cpuLevel + (lr || 1) + 3) % 3; SFX.select(); }
  if (Game.menuIdx === 3 && (lr || ok)) { SFX.toggle(); SFX.select(); }
  if (Game.menuIdx === 4 && (lr || ok)) { Game.frameData = !Game.frameData; SFX.select(); }
  if (Game.menuIdx === 5 && ok) { openControls(); SFX.select(); }
  if (ok && Game.menuIdx < 2) { SFX.select(); setupMatch(Game.menuIdx === 0 ? 'cpu' : 'pvp'); Keys.hit.clear(); }
}

function pauseItems() {
  return [
    { label: 'RESUME' }, { label: 'SOUND', value: SFX.muted ? 'OFF' : 'ON', opt: true },
    { label: 'FRAME DATA', value: Game.frameData ? 'ON' : 'OFF', opt: true }, { label: 'CONTROLS' }, { label: 'QUIT TO TITLE' },
  ];
}
function pauseInput() {
  if (Game.showControls) { controlsInput(); return; }
  const n = pauseItems().length;
  if (menuUp()) { Game.menuIdx = (Game.menuIdx + n - 1) % n; SFX.select(); }
  if (menuDown()) { Game.menuIdx = (Game.menuIdx + 1) % n; SFX.select(); }
  const ok = menuOk() || ((menuLeft() || menuRight()) && (Game.menuIdx === 1 || Game.menuIdx === 2));
  if (menuBack()) { Game.paused = false; return; }
  if (!ok) return;
  SFX.select();
  if (Game.menuIdx === 0) Game.paused = false;
  else if (Game.menuIdx === 1) SFX.toggle();
  else if (Game.menuIdx === 2) Game.frameData = !Game.frameData;
  else if (Game.menuIdx === 3) openControls();
  else { Game.paused = false; setupDemo(); }
}

// ---------------- controls screen (device + rebindable keys / gamepad buttons, saved to localStorage) ----------------
// rows: 0 = device, 1..BTN.length = actions, last = SWAP / RESET buttons. Columns: P1, P2.
const CTRL_PLAYERS = ['p1', 'p2'];
const CTRL_DEVICE = 0, CTRL_BTNS = BTN.length + 1;
// gamepad buttons held when a pad rebind starts, so the press that opened it isn't taken as the new button
let padSnap = new Set();
function padsDown() {
  const out = new Set();
  for (const gp of connectedPads()) gp.buttons.forEach((b, i) => { if (b && b.pressed) out.add(gp.index + ':' + i); });
  return out;
}
function ctrlMsg(m) { Game.ctrlMsg = m; Game.ctrlMsgT = Game.t; }
function controlsInput() {
  const player = CTRL_PLAYERS[Game.ctrlCol];
  if (Game.rebinding) {
    const action = BTN[Game.ctrlRow - 1];
    if (DEVICES[player] === 'pad') {
      if (Keys.hit.has('Escape')) { Game.rebinding = false; SFX.select(); return; }
      const down = padsDown();
      for (const k of down) {
        if (padSnap.has(k)) continue;
        const btn = +k.split(':')[1];
        if (btn === 9) { Game.rebinding = false; SFX.select(); break; }
        bindPad(player, action, btn);
        Game.rebinding = false; ctrlMsg('SAVED'); SFX.select();
        break;
      }
      padSnap = down;
      // swallow the menu edge for the button just bound so it doesn't also confirm / back out
      if (!Game.rebinding) padHit(0, 1, 9);
      return;
    }
    if (padHit(9, 1)) { Game.rebinding = false; SFX.select(); return; }
    for (const code of Keys.hit) {
      if (code === 'Escape') { Game.rebinding = false; SFX.select(); return; }
      if (RESERVED_KEYS.has(code)) { ctrlMsg(keyName(code) + ' IS RESERVED'); return; }
      bindKey(player, action, code);
      Game.rebinding = false; ctrlMsg('SAVED');
      SFX.select();
      return;
    }
    return;
  }
  if (menuBack() || padHit(1)) { Game.showControls = false; SFX.select(); return; }
  const n = CTRL_BTNS + 1;
  if (menuUp()) { Game.ctrlRow = (Game.ctrlRow + n - 1) % n; SFX.select(); }
  if (menuDown()) { Game.ctrlRow = (Game.ctrlRow + 1) % n; SFX.select(); }
  if (menuLeft() || menuRight()) { Game.ctrlCol = 1 - Game.ctrlCol; SFX.select(); }
  if (!menuOk()) return;
  SFX.select();
  if (Game.ctrlRow === CTRL_BTNS) {
    if (Game.ctrlCol === 0) { swapPlayers(); ctrlMsg('P1 / P2 SWAPPED'); }
    else { resetKeymaps(); saveKeymaps(); resetDevices(); resetPadmaps(); saveDevices(); ctrlMsg('DEFAULTS RESTORED'); }
  } else if (Game.ctrlRow === CTRL_DEVICE) {
    toggleDevice(player);
    ctrlMsg(player.toUpperCase() + ': ' + (DEVICES[player] === 'pad' ? 'GAMEPAD' : 'KEYBOARD'));
  } else if (DEVICES[player] === 'pad' && PAD_DIRS.has(BTN[Game.ctrlRow - 1])) {
    ctrlMsg('GAMEPAD MOVES WITH STICK / DPAD');
  } else {
    Game.rebinding = true; Game.ctrlMsg = '';
    padSnap = padsDown();
  }
}

function endInput() {
  Game.phaseT++;
  if (Game.phaseT < 40) return;
  if (menuOk()) { SFX.select(); setupMatch(Game.players); }
  else if (menuBack()) { SFX.select(); setupDemo(); }
}

// ---------------- drawing ----------------
function render() {
  const fs = Game.fighters, w = Game.world, t = Game.t;
  drawBackground(t, Game.speed);
  drawKillUnder(w, t);  // finisher darkness / floor marks (src/kills.js)
  for (const p of w.pickups) drawPickup(p, t);
  for (const p of w.projs) if (p.stuck) drawProj(p, t);
  const order = fs[0].state === 'attack' && fs[1].state !== 'attack' ? [fs[1], fs[0]] : [fs[0], fs[1]];
  for (const f of order) drawFighter(f, t);
  for (const p of w.projs) if (!p.stuck) drawProj(p, t);
  drawFx(w, t);
  drawKillOver(w, t);   // finisher slashes, arcs, streaks
  drawWater(t, fs);     // lake surface: reflects everything drawn so far
  drawPetals(t, 14, 1); // near petals drift in front of the fighters

  if (Game.invert > 0) {
    // negative flash (finishers): flips lightness but keeps each colour's hue. A plain invert would turn
    // the lavender fighter yellow. Per channel: v + 255 - max - min.
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], k = 255 - Math.max(r, g, b) - Math.min(r, g, b);
      d[i] = r + k; d[i + 1] = g + k; d[i + 2] = b + k;
    }
    ctx.putImageData(img, 0, 0);
  }
  if (Game.flash) {
    const fl = Game.flash, k = fl.t / fl.life;
    ctx.globalAlpha = fl.alpha * (1 - k) * (1 - k);
    ctx.fillStyle = fl.col; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  if (Game.mode === 'title') { drawTitle(t); return; }

  if (Game.mode !== 'end') for (const f of fs) drawTag(f, Game.players === 'cpu' ? (f.id === 0 ? 'YOU' : 'CPU') : f.name);
  drawBar(fs[0], 1, fs[0].comboShow); drawBar(fs[1], -1, fs[1].comboShow);
  if (Game.frameData) drawFrameMeter(fs);
  const secs = Math.max(0, Math.ceil(Game.timer / 60));
  otext(String(secs).padStart(2, '0'), W / 2, 9, 2, 'center', secs <= 10 && t % 30 < 15 ? PAL.red : '#ffffff', true);
  text('ROUND ' + Game.round, W / 2, 28, 1, 'center', PAL.mid);

  if (Game.mode === 'intro') {
    if (Game.phaseT < 55) bigText('ROUND ' + Game.round, 112, 3);
    else bigText('FIGHT!', 106, Game.phaseT < 60 ? 5 : 4, PAL.accent);
  } else if (Game.mode === 'ko') {
    bigText(Game.koText, 104, Game.phaseT < 8 ? 6 : 5, PAL.accent);
    if (Game.koSub && Game.phaseT > 6) otext(Game.koSub, W / 2, 148, 1, 'center', '#ffffff', true);
    if (Game.phaseT > 50) {
      const msg = Game.koWinner ? Game.koWinner.name + ' TAKES THE ROUND' : 'NO WINNER';
      otext(msg, W / 2, Game.koSub ? 162 : 150, 1, 'center', PAL.light);
    }
  } else if (Game.mode === 'end') {
    const win = fs[0].wins >= 2 ? fs[0] : fs[1];
    panel(W / 2 - 130, 100, 260, 80);
    G.col(PCOL[win.id]); G.rect(W / 2 - 130, 100, 260, 3);
    bigText(win.name + ' WINS', 120, win.name.length > 6 ? 2 : 3, PCOL[win.id]);
    if (Game.phaseT > 40 && t % 60 < 45) otext('ENTER - REMATCH     ESC - TITLE', W / 2, 160, 1, 'center', PAL.light);
  }
  if (Game.paused) drawPause();
}

// button-style list. Selected row: white bar, dark text, cyan accent tab, slides out a few px.
const BTN_H = 15, BTN_GAP = 3;
let btnSel = -1, btnT = 0;
function drawButtons(items, x, y, w, sel, slide = 4) {
  if (sel !== btnSel) { btnSel = sel; btnT = Game.t; }
  const k = easeOut(clamp((Game.t - btnT) / 6, 0, 1));
  items.forEach((it, i) => {
    const on = i === sel, by = y + i * (BTN_H + BTN_GAP), bx = Math.round(x + (on ? slide * k : 0));
    if (on) {
      G.col('#ffffff'); G.rect(bx, by, w, BTN_H);
      G.col(PAL.accent); G.rect(bx - 4, by, 2, BTN_H);
    } else {
      ctx.globalAlpha = 0.6; G.col('#000000'); G.rect(bx, by, w, BTN_H); ctx.globalAlpha = 1;
      G.col(PAL.dim); G.rect(bx, by + BTN_H - 1, w, 1);
    }
    text(it.label, bx + 8, by + 4, 1, 'left', on ? PAL.bg : PAL.light, true);
    if (it.value != null) {
      const v = it.opt && on ? '< ' + it.value + ' >' : it.value;
      text(v, bx + w - 8, by + 4, 1, 'right', on ? PAL.bg : PAL.accent, true);
    }
  });
}

// little outlined key cap + caption, returns the x after it
function keyHint(key, label, x, y) {
  const kw = textWidth(key, 1) + 4;
  G.col(PAL.light); G.rect(x, y, kw, 9);
  text(key, x + 2, y + 1, 1, 'left', PAL.bg);
  text(label, x + kw + 3, y + 1, 1, 'left', PAL.mid);
  return x + kw + 3 + textWidth(label, 1) + 10;
}

// left-side shade: solid behind the menu, then fades out in hard pixel steps
function leftShade(solid, fade, alpha) {
  ctx.fillStyle = PAL.bg;
  ctx.globalAlpha = alpha; ctx.fillRect(0, 0, solid, H);
  const steps = 8, sw = fade / steps;
  for (let i = 0; i < steps; i++) {
    ctx.globalAlpha = alpha * (1 - (i + 1) / (steps + 1));
    ctx.fillRect(Math.round(solid + i * sw), 0, Math.round(sw), H);
  }
  ctx.globalAlpha = 1;
}

// ---------- title logo (samurai look: sumi ink, washi ivory, shu vermilion) ----------
// built once into an offscreen canvas: fat CLAZZIQUE with a red slash cut through it, a small BRAWL
// brush stroke leaning out under its bottom right, and a tiny 無 seal as a ™.
const LOGO = { ink: '#0b0c0f', washi: '#f2ead8', washiD: '#b9ad97', shu: '#d7262e', shuD: '#6e0c14' };
const LOGO_X = 4; // canvas x where the word starts
// 無 (mu, "nothing") for the seal, 11x10 at 1px
const SEAL_GLYPH = [
  '.#.........', '.#########.', '#.#.#.#.#..', '###########', '..#.#.#.#..',
  '..#.#.#.#..', '###########', '...........', '.#..#..#.#.', '#....#..#.#',
];
let logoCanvas = null;
function buildLogo() {
  const LW = 230, LH = 60;
  const mk = (w = LW, h = LH) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const keep = G.ctx;
  const S = 3, wx = LOGO_X, wy = 17, DEPTH = 2;
  const lw = textWidth('CLAZZIQUE', S, true);
  const cutAt = (c) => Math.round(wy + 16 - (c - wx) * 0.05); // rising slash

  // 1. CLAZZIQUE: thick ink outline, deep red extrusion, ivory face, darker bottom row
  const word = mk();
  G.ctx = word.getContext('2d');
  const ring = [[-2, -2], [0, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2]];
  for (let d = 0; d <= DEPTH; d += DEPTH) for (const [ox, oy] of ring) text('CLAZZIQUE', wx + ox, wy + d + oy, S, 'left', LOGO.ink, true);
  for (let d = DEPTH; d >= 1; d--) text('CLAZZIQUE', wx, wy + d, S, 'left', LOGO.shuD, true);
  text('CLAZZIQUE', wx, wy, S, 'left', LOGO.washi, true);
  const wc = G.ctx;
  wc.save(); wc.beginPath(); wc.rect(0, wy + 6 * S, LW, S); wc.clip();
  text('CLAZZIQUE', wx, wy, S, 'left', LOGO.washiD, true);
  wc.restore();

  // 2. slice the word along the cut: top half slides up-right, thin red slash in the gap
  const out = mk(), oc = out.getContext('2d');
  for (let c = 0; c < LW - 2; c++) {
    const r = cutAt(c);
    oc.drawImage(word, c, 0, 1, r, c + 2, -1, 1, r);
    oc.drawImage(word, c, r, 1, LH - r, c, r + 1, 1, LH - r);
  }
  const s0 = wx - 3, s1 = wx + lw + 18;
  for (let c = s0; c < s1; c++) {
    const edge = Math.min(1, (c - s0) / 5, (s1 - c) / 18);
    if (hash(c * 3.1) < edge) { oc.fillStyle = LOGO.shu; oc.fillRect(c, cutAt(c), 1, 1); }
  }

  // 3. BRAWL brush stroke: drawn flat, skewed so it leans up to the right, ink-outlined, then
  //    tucked just under the bottom right of the word
  const bw = 104, bh = 15, lean = 0.06, pad = 3;
  const flat = mk(bw + pad * 2, bh + pad * 2 + 8);
  G.ctx = flat.getContext('2d');
  const fc = G.ctx, by = pad + 7;
  for (let i = 0; i < bw; i++) {
    const u = i / bw;
    const end = u < 0.06 ? 1 - u / 0.06 : u > 0.78 ? (u - 0.78) / 0.22 : 0; // blunt start, tapered lift
    const top = Math.round(by + end * 5 * (u < 0.5 ? 0.6 : 1) + hash(i * 1.3) * 1.4);
    const bot = Math.round(by + bh - end * (u < 0.5 ? 3 : 4) - hash(i * 2.7 + 9) * 1.4);
    for (let y = top; y < bot; y++) {
      if (u > 0.55 && hash(y * 17.3 + Math.floor(i / 5) * 0.37) < (u - 0.55) * 1.3) continue; // dry-brush streaks
      fc.fillStyle = y === top ? LOGO.shuD : LOGO.shu;
      fc.fillRect(pad + i, y, 1, 1);
    }
  }
  let lx = pad + 9;
  for (const ch of 'BRAWL') {
    text(ch, lx, by + 2 + 2, 2, 'left', LOGO.shuD, true);
    text(ch, lx, by + 2, 2, 'left', LOGO.washi, true);
    lx += textWidth(ch, 2, true) + 3;
  }
  const skew = mk(flat.width, flat.height), sc = skew.getContext('2d');
  for (let c = 0; c < flat.width; c++) sc.drawImage(flat, c, 0, 1, flat.height, c, -Math.round(c * lean), 1, flat.height);
  const sil = mk(flat.width, flat.height), slc = sil.getContext('2d');
  slc.drawImage(skew, 0, 0); slc.globalCompositeOperation = 'source-in'; slc.fillStyle = LOGO.ink; slc.fillRect(0, 0, sil.width, sil.height);
  const bx = wx + lw - bw + 16, byOut = wy + 14;
  for (const [ox, oy] of [[-2, -2], [0, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2]]) oc.drawImage(sil, bx + ox, byOut + oy);
  oc.drawImage(skew, bx, byOut);

  // 4. tiny 無 seal, top right outside the word like a ™
  const sw = 15, sh = 14, sx = wx + lw + 3, sy = wy - sh - 1;
  oc.fillStyle = LOGO.ink; oc.fillRect(sx - 1, sy - 1, sw + 2, sh + 2);
  oc.fillStyle = LOGO.shu; oc.fillRect(sx, sy, sw, sh);
  oc.fillStyle = LOGO.washi;
  SEAL_GLYPH.forEach((row, r) => [...row].forEach((p, c) => { if (p === '#') oc.fillRect(sx + 2 + c, sy + 2 + r, 1, 1); }));
  for (let k = 0; k < 8; k++) { // worn stamp edge
    const side = k % 4, e = Math.floor(hash(k * 5.7) * (side < 2 ? sw : sh));
    const [px, py] = side === 0 ? [sx + e, sy] : side === 1 ? [sx + e, sy + sh - 1] : side === 2 ? [sx, sy + e] : [sx + sw - 1, sy + e];
    oc.fillStyle = LOGO.ink; oc.fillRect(px, py, 1, 1);
  }

  G.ctx = keep;
  logoCanvas = out;
}

function drawTitle(t) {
  if (Game.showControls) { drawControls(); return; }
  leftShade(225, 110, 0.82);
  const x = 30;
  if (!logoCanvas) buildLogo();
  ctx.drawImage(logoCanvas, x - LOGO_X, 34);
  text('1V1 WEAPON BRAWLER', x, 101, 1, 'left', PAL.mid);

  drawButtons(titleItems(), x, 128, 160, Game.menuIdx);

  let hx = x;
  hx = keyHint('W/S', 'SELECT', hx, H - 20);
  hx = keyHint('A/D', 'CHANGE', hx, H - 20);
  keyHint('ENTER', 'CONFIRM', hx, H - 20);
  text('GAMEPAD SUPPORTED', W - 14, H - 18, 1, 'right', PAL.mid);
}

const CONTROL_ROWS = [
  'LEFT', 'RIGHT', 'UP / AIM UP', 'DOWN / BLOCK / PARRY',
  'JUMP', 'LIGHT', 'HEAVY', 'DODGE / DASH / BURST', 'PICK UP / THROW',
];
const CONTROL_TIPS = [
  'DODGE + ANY OF 8 DIRECTIONS = DODGE THAT WAY (DASH IF ON COOLDOWN)',
  'TAP DOWN = PARRY (AUTO COUNTER-STRIKE)    HOLD DOWN = CROUCH BLOCK',
  'GROUND POUNDS BREAK BLOCK    HITS FROM BEHIND AREN\'T BLOCKED',
  'BAR FULL: DODGE WITH NO DIRECTION = BURST (WORKS MID-COMBO, ALSO IN AIR)',
  'AIR HEAVY = RECOVERY    NEUTRAL AIR DODGE + LIGHT = GRAVITY CANCEL',
  'VS CPU: KEYBOARD + ANY GAMEPAD = P1    NO GAMEPAD FOUND = USES KEYS',
];
function deviceLabel(p) {
  if (DEVICES[p] === 'kb') return 'KEYBOARD';
  const slot = p === 'p2' && DEVICES.p1 === 'pad' ? 1 : 0;
  return 'GAMEPAD ' + (slot + 1) + (connectedPads()[slot] ? '' : ' (OFF)');
}
function drawControls() {
  ctx.globalAlpha = 0.75; G.col(PAL.bg); G.rect(0, 0, W, H); ctx.globalAlpha = 1;
  const pw = 460, ph = 352, px = (W - pw) / 2, py = (H - ph) / 2;
  panel(px, py, pw, ph);
  G.col(PCOL[0]); G.rect(px, py, pw / 2, 3);
  G.col(PCOL[1]); G.rect(px + pw / 2, py, pw / 2, 3);
  otext('CONTROLS', px + 20, py + 16, 2, 'left', '#ffffff', true);
  text('SAVED IN THIS BROWSER', px + pw - 20, py + 20, 1, 'right', PAL.mid);
  const cols = [px + 20, px + 170, px + 310], cellW = [0, 130, 130];
  ['ACTION', 'P1', 'P2'].forEach((h, i) => text(h, cols[i], py + 40, 1, 'left', i === 1 ? PCOL[0] : i === 2 ? PCOL[1] : PAL.mid));
  G.col(PAL.dim); G.rect(px + 14, py + 49, pw - 28, 1);
  const RH = 14, ry0 = py + 55;
  const rows = [['DEVICE', deviceLabel('p1'), deviceLabel('p2')]];
  CONTROL_ROWS.forEach((label, j) => rows.push([label, playerLabel('p1', BTN[j]), playerLabel('p2', BTN[j])]));
  rows.push(['PAUSE', ...CTRL_PLAYERS.map((p) => (DEVICES[p] === 'pad' ? 'START' : 'ESC / P'))]);
  rows.forEach((r, j) => {
    const ry = ry0 + j * RH;
    if (j % 2) { ctx.globalAlpha = 0.5; G.col(PAL.dim); G.rect(px + 14, ry - 3, pw - 28, RH); ctx.globalAlpha = 1; }
    r.forEach((c, i) => {
      const sel = j < CTRL_BTNS && j === Game.ctrlRow && i === Game.ctrlCol + 1;
      const p = CTRL_PLAYERS[i - 1];
      if (sel) {
        const blink = Game.rebinding && Game.t % 40 < 20;
        G.col(Game.rebinding ? (blink ? PAL.accent : '#ffffff') : '#ffffff'); G.rect(cols[i] - 4, ry - 3, cellW[i], RH);
        G.col(PAL.accent); G.rect(cols[i] - 6, ry - 3, 2, RH);
        const shown = Game.rebinding ? (DEVICES[p] === 'pad' ? 'PRESS A BUTTON' : 'PRESS A KEY') : j === CTRL_DEVICE ? '< ' + c + ' >' : c;
        text(shown, cols[i], ry + 1, 1, 'left', PAL.bg, true);
      } else {
        const fixed = j === rows.length - 1 || (i > 0 && j > CTRL_DEVICE && DEVICES[p] === 'pad' && PAD_DIRS.has(BTN[j - 1]));
        const col = i === 0 ? PAL.light : j === CTRL_DEVICE ? PAL.accent : fixed ? PAL.mid : '#ffffff';
        text(c, cols[i], ry + 1, 1, 'left', col, true);
      }
    });
  });
  // swap / reset buttons
  const by = ry0 + rows.length * RH + 2, onBtns = Game.ctrlRow === CTRL_BTNS;
  drawButtons([{ label: 'SWAP P1 / P2' }], px + 20, by, 110, onBtns && Game.ctrlCol === 0 ? 0 : -1, 0);
  drawButtons([{ label: 'RESET TO DEFAULTS' }], px + 140, by, 140, onBtns && Game.ctrlCol === 1 ? 0 : -1, 0);
  if (Game.ctrlMsg && Game.t - Game.ctrlMsgT < 120) text(Game.ctrlMsg, px + 292, by + 4, 1, 'left', PAL.accent, true);
  G.col(PAL.dim); G.rect(px + 14, by + 22, pw - 28, 1);
  CONTROL_TIPS.forEach((l, i) => text(l, px + 20, by + 30 + i * 11, 1, 'left', PAL.mid));
  let hx = px + 20;
  const fy = py + ph - 16;
  if (Game.rebinding) {
    const pad = DEVICES[CTRL_PLAYERS[Game.ctrlCol]] === 'pad';
    hx = keyHint(pad ? 'ANY BUTTON' : 'ANY KEY', 'BIND', hx, fy);
    keyHint(pad ? 'ESC / START' : 'ESC', 'CANCEL', hx, fy);
  } else {
    const act = onBtns ? (Game.ctrlCol === 0 ? 'SWAP' : 'RESET') : Game.ctrlRow === CTRL_DEVICE ? 'CHANGE' : 'REBIND';
    hx = keyHint('ARROWS', 'SELECT', hx, fy);
    hx = keyHint('ENTER', act, hx, fy);
    keyHint('ESC', 'BACK', hx, fy);
  }
}

function drawPause() {
  if (Game.showControls) { drawControls(); return; }
  ctx.globalAlpha = 0.7; G.col(PAL.bg); G.rect(0, 0, W, H); ctx.globalAlpha = 1;
  const pw = 200, ph = 150, px = (W - pw) / 2, py = 95;
  panel(px, py, pw, ph);
  G.col(PAL.accent); G.rect(px, py, pw, 3);
  bigText('PAUSED', py + 16, 2);
  drawButtons(pauseItems(), px + 20, py + 40, pw - 40, Game.menuIdx, 0);
  keyHint('ESC', 'RESUME', px + 20, py + ph - 16);
}

// ---------------- main loop ----------------
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(250, now - last); last = now;
  let n = 0;
  while (acc >= STEP && n < 5) { step(); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  render();
  requestAnimationFrame(frame);
}
setupDemo();
requestAnimationFrame(frame);
window.__game = { Game, step, render, setupMatch };
