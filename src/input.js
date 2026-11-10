'use strict';
// ---------- keyboard / gamepad -> per-player controller ----------
const Keys = { down: new Set(), hit: new Set() };
const BTN = ['left', 'right', 'up', 'down', 'jump', 'light', 'heavy', 'dodge', 'throw'];

const DEFAULT_KEYMAPS = {
  p1: {
    left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    jump: ['Space'], light: ['KeyJ'], heavy: ['KeyK'], dodge: ['KeyL', 'ShiftLeft'], throw: ['KeyH'],
  },
  p2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    jump: ['ArrowUp'], light: ['KeyZ'], heavy: ['KeyX'],
    dodge: ['ShiftRight'], throw: ['KeyC'],
  },
};
// live keymaps: Controllers hold references to KEYMAPS.p1 / .p2, so edits apply immediately
const KEYMAPS = { p1: {}, p2: {} };
const KEYMAP_STORE = 'classiquebrawl.keymaps.v1';
const KEYMAP_STORE_OLD = 'stickbrawl.keymaps.v1'; // pre-rename saves are still read
const RESERVED_KEYS = new Set(['Escape', 'KeyP']); // pause / cancel
const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
let boundKeys = new Set();

function refreshBound() {
  boundKeys = new Set();
  for (const p in KEYMAPS) for (const b of BTN) for (const c of KEYMAPS[p][b]) boundKeys.add(c);
}
function resetKeymaps() {
  for (const p in DEFAULT_KEYMAPS) for (const b of BTN) KEYMAPS[p][b] = DEFAULT_KEYMAPS[p][b].slice();
  refreshBound();
}
function saveKeymaps() {
  try { localStorage.setItem(KEYMAP_STORE, JSON.stringify(KEYMAPS)); } catch (e) { /* storage blocked */ }
}
function loadKeymaps() {
  resetKeymaps();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEYMAP_STORE) || localStorage.getItem(KEYMAP_STORE_OLD)); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object') return;
  for (const p in KEYMAPS) {
    const m = saved[p];
    if (!m || typeof m !== 'object') continue;
    for (const b of BTN) {
      const v = m[b];
      if (Array.isArray(v) && v.length <= 4 && v.every((c) => typeof c === 'string' && c && !RESERVED_KEYS.has(c))) KEYMAPS[p][b] = v.slice();
    }
  }
  // saves from before an action existed keep its default, unless that key is already used elsewhere
  for (const p in KEYMAPS) for (const b of BTN) {
    if (saved[p] && saved[p][b]) continue;
    KEYMAPS[p][b] = KEYMAPS[p][b].filter((c) => !Object.keys(KEYMAPS).some((q) => BTN.some((o) => (q !== p || o !== b) && KEYMAPS[q][o].includes(c))));
  }
  refreshBound();
}
// bind one key to a player's action. The key is taken off the other player so P1/P2 never share keys;
// sharing within one player is fine (P2 jumps and aims up with the same arrow).
function bindKey(player, action, code) {
  if (RESERVED_KEYS.has(code)) return false;
  for (const p in KEYMAPS) if (p !== player) for (const b of BTN) KEYMAPS[p][b] = KEYMAPS[p][b].filter((c) => c !== code);
  KEYMAPS[player][action] = [code];
  refreshBound();
  saveKeymaps();
  return true;
}

const KEY_NAMES = {
  Space: 'SPACE', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL',
  AltLeft: 'LALT', AltRight: 'RALT', MetaLeft: 'LCMD', MetaRight: 'RCMD',
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Enter: 'ENTER', NumpadEnter: 'NUM ENTER', Backspace: 'BKSP', Tab: 'TAB', CapsLock: 'CAPS',
  Comma: ',', Period: '.', Slash: '/', Semicolon: 'SEMI', Quote: "'", Minus: '-', Equal: '=',
  BracketLeft: 'L BRKT', BracketRight: 'R BRKT', Backslash: 'BSLASH', Backquote: 'TILDE',
  Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
};
function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m;
  if ((m = /^Key(.)$/.exec(code))) return m[1];
  if ((m = /^Digit(.)$/.exec(code))) return m[1];
  if ((m = /^Numpad(.+)$/.exec(code))) return 'NUM ' + m[1].toUpperCase();
  return code.toUpperCase();
}
function bindingLabel(player, action) {
  const ks = KEYMAPS[player][action];
  return ks.length ? ks.map(keyName).join(' / ') : '-';
}

loadKeymaps();

addEventListener('keydown', (e) => {
  if (BLOCK.has(e.code) || boundKeys.has(e.code)) e.preventDefault();
  if (!e.repeat) Keys.hit.add(e.code);
  Keys.down.add(e.code);
  SFX.unlock();
});
addEventListener('keyup', (e) => Keys.down.delete(e.code));
addEventListener('blur', () => Keys.down.clear());
addEventListener('pointerdown', () => SFX.unlock());

function anyHit(...codes) { return codes.some((c) => Keys.hit.has(c)); }

function emptyButtons() { const o = {}; for (const b of BTN) o[b] = false; return o; }

// ---------- per-player device (keyboard or gamepad) + gamepad button maps ----------
// Directions on a gamepad are always the left stick + D-pad; the other actions are rebindable.
const PAD_DIRS = new Set(['left', 'right', 'up', 'down']);
const DEFAULT_PADMAP = { left: [], right: [], up: [], down: [], jump: [0], light: [2], heavy: [1], dodge: [4, 5, 6, 7], throw: [3] };
const PAD_RESERVED = new Set([9]); // START = pause
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT', 'HOME'];
const PADMAPS = { p1: {}, p2: {} };
const DEVICES = { p1: 'kb', p2: 'pad' }; // default: P1 keyboard, P2 gamepad
const DEVICE_STORE = 'classiquebrawl.devices.v1';
const PADMAP_STORE = 'classiquebrawl.padmaps.v1';

function resetPadmaps() {
  for (const p in PADMAPS) for (const b of BTN) PADMAPS[p][b] = DEFAULT_PADMAP[b].slice();
}
function resetDevices() { DEVICES.p1 = 'kb'; DEVICES.p2 = 'pad'; }
function saveDevices() {
  try {
    localStorage.setItem(DEVICE_STORE, JSON.stringify(DEVICES));
    localStorage.setItem(PADMAP_STORE, JSON.stringify(PADMAPS));
  } catch (e) { /* storage blocked */ }
}
function loadDevices() {
  resetDevices(); resetPadmaps();
  let d = null, m = null;
  try { d = JSON.parse(localStorage.getItem(DEVICE_STORE)); m = JSON.parse(localStorage.getItem(PADMAP_STORE)); } catch (e) { /* ignore */ }
  if (d && typeof d === 'object') for (const p in DEVICES) if (d[p] === 'kb' || d[p] === 'pad') DEVICES[p] = d[p];
  if (m && typeof m === 'object') for (const p in PADMAPS) {
    if (!m[p] || typeof m[p] !== 'object') continue;
    for (const b of BTN) {
      const v = m[p][b];
      if (!PAD_DIRS.has(b) && Array.isArray(v) && v.length <= 4 && v.every((i) => Number.isInteger(i) && i >= 0 && i < 32 && !PAD_RESERVED.has(i))) PADMAPS[p][b] = v.slice();
    }
  }
}
function toggleDevice(player) { DEVICES[player] = DEVICES[player] === 'kb' ? 'pad' : 'kb'; saveDevices(); }
// swap everything between P1 and P2: device, keys and gamepad buttons
function swapPlayers() {
  [DEVICES.p1, DEVICES.p2] = [DEVICES.p2, DEVICES.p1];
  for (const b of BTN) {
    [KEYMAPS.p1[b], KEYMAPS.p2[b]] = [KEYMAPS.p2[b], KEYMAPS.p1[b]];
    [PADMAPS.p1[b], PADMAPS.p2[b]] = [PADMAPS.p2[b], PADMAPS.p1[b]];
  }
  refreshBound(); saveKeymaps(); saveDevices();
}
function bindPad(player, action, btn) {
  if (PAD_DIRS.has(action) || PAD_RESERVED.has(btn)) return false;
  // one pad button = one action per player, so a rebind never also fires the button's old action
  for (const b of BTN) if (b !== action) PADMAPS[player][b] = PADMAPS[player][b].filter((i) => i !== btn);
  PADMAPS[player][action] = [btn];
  saveDevices();
  return true;
}
function padName(i) { return PAD_NAMES[i] || 'BTN ' + i; }
function padLabel(player, action) {
  if (PAD_DIRS.has(action)) return 'STICK / DPAD';
  const bs = PADMAPS[player][action];
  return bs.length ? bs.map(padName).join(' / ') : '-';
}
// what a player's cell in the controls table shows: keys or gamepad buttons, depending on their device
function playerLabel(player, action) {
  return DEVICES[player] === 'pad' ? padLabel(player, action) : bindingLabel(player, action);
}

loadDevices();

// connected gamepads in order (browsers can leave holes in getGamepads(), so index by slot, not by gp.index)
function connectedPads() {
  const out = [];
  if (navigator.getGamepads) for (const gp of navigator.getGamepads()) if (gp && gp.connected !== false) out.push(gp);
  return out;
}

// input sources for a LOCAL 2P player: their keys, or their gamepad (if both players are on gamepads,
// P1 takes the first pad and P2 the second). A gamepad player with no pad plugged in falls back to their keys.
function playerSources(player) {
  if (DEVICES[player] === 'pad') {
    const slot = player === 'p2' && DEVICES.p1 === 'pad' ? 1 : 0;
    const gp = connectedPads()[slot];
    if (gp) return { maps: [], pads: [[gp, PADMAPS[player]]] };
  }
  return { maps: [KEYMAPS[player]], pads: [] };
}
// VS CPU: the human is P1 on every input at once: both key sets and every connected gamepad.
// Gamepads use the button map of whichever column is set to GAMEPAD (P1 first), since that's the one
// the controls screen shows and lets you rebind.
function soloPadmap() {
  return DEVICES.p1 === 'pad' ? PADMAPS.p1 : DEVICES.p2 === 'pad' ? PADMAPS.p2 : PADMAPS.p1;
}
function soloSources() {
  const pm = soloPadmap();
  return { maps: [KEYMAPS.p1, KEYMAPS.p2], pads: connectedPads().map((gp) => [gp, pm]) };
}

// sources() returns { maps: keymaps to read, pads: [[gamepad, padmap], ...] }; re-read every frame so
// controls-screen changes apply immediately, even mid-match
class Controller {
  constructor(sources) {
    this.sources = sources;
    this.held = emptyButtons(); this.pressed = emptyButtons(); this.prev = emptyButtons();
  }
  poll() {
    const now = emptyButtons(), tapped = emptyButtons();
    const { maps, pads } = this.sources();
    for (const b of BTN) {
      for (const m of maps) {
        for (const code of m[b]) {
          if (Keys.down.has(code)) now[b] = true;
          if (Keys.hit.has(code)) tapped[b] = true;
        }
      }
    }
    for (const [gp, pm] of pads) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const p = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      now.left ||= ax < -0.45 || p(14); now.right ||= ax > 0.45 || p(15);
      now.up ||= ay < -0.55 || p(12); now.down ||= ay > 0.55 || p(13);
      for (const b of BTN) if (!PAD_DIRS.has(b)) for (const i of pm[b]) if (p(i)) now[b] = true;
    }
    for (const b of BTN) {
      this.pressed[b] = (now[b] && !this.prev[b]) || tapped[b];
      this.held[b] = now[b] || tapped[b];
      this.prev[b] = now[b];
    }
  }
}

// Controller that never presses anything (used during intros / KO)
const NULL_CTRL = { held: emptyButtons(), pressed: emptyButtons(), poll() {} };
