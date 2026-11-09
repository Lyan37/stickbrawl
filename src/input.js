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
const KEYMAP_STORE = 'stickbrawl.keymaps.v1';
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
  try { saved = JSON.parse(localStorage.getItem(KEYMAP_STORE)); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object') return;
  for (const p in KEYMAPS) {
    const m = saved[p];
    if (!m || typeof m !== 'object') continue;
    for (const b of BTN) {
      const v = m[b];
      if (Array.isArray(v) && v.length <= 4 && v.every((c) => typeof c === 'string' && c && !RESERVED_KEYS.has(c))) KEYMAPS[p][b] = v.slice();
    }
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

class Controller {
  constructor(maps = [], pad = -1) {
    this.maps = maps; this.pad = pad;
    this.held = emptyButtons(); this.pressed = emptyButtons(); this.prev = emptyButtons();
  }
  poll() {
    const now = emptyButtons(), tapped = emptyButtons();
    for (const b of BTN) {
      for (const m of this.maps) {
        for (const code of m[b]) {
          if (Keys.down.has(code)) now[b] = true;
          if (Keys.hit.has(code)) tapped[b] = true;
        }
      }
    }
    const gp = this.pad >= 0 && navigator.getGamepads ? navigator.getGamepads()[this.pad] : null;
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const p = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      now.left ||= ax < -0.45 || p(14); now.right ||= ax > 0.45 || p(15);
      now.up ||= ay < -0.55 || p(12); now.down ||= ay > 0.55 || p(13);
      now.jump ||= p(0); now.light ||= p(2); now.heavy ||= p(1); now.throw ||= p(3);
      now.dodge ||= p(4) || p(5) || p(6) || p(7);
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
