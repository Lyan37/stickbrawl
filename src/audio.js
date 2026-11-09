'use strict';
// Tiny synthesized beeps & noise bursts — no audio files.
const SFX = (() => {
  let ac = null, master = null, noiseBuf = null, muted = false, quiet = false;

  function unlock() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.22;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function tone(freq, dur, type = 'square', vol = 0.4, slide = 0, delay = 0, force = false) {
    if (!ac || muted || (quiet && !force)) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.4, freq = 1200, q = 1) {
    if (!ac || muted || quiet) return;
    const t = ac.currentTime;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  return {
    unlock,
    toggle() { muted = !muted; return muted; },
    get muted() { return muted; },
    setQuiet(v) { quiet = v; },
    jump()   { tone(420, 0.07, 'square', 0.18, 260); },
    dash()   { noise(0.08, 0.25, 2400, 0.8); },
    dodge()  { tone(260, 0.07, 'triangle', 0.3, 380); },
    swing(heavy) { noise(heavy ? 0.16 : 0.08, heavy ? 0.35 : 0.25, heavy ? 800 : 1900, 0.9); },
    shoot(kind) { kind === 'arrow' ? noise(0.06, 0.3, 3000, 2) : tone(980, 0.05, 'square', 0.15, -600); },
    hit(dmg) {
      tone(Math.max(60, 170 - dmg * 6), 0.1 + dmg * 0.006, 'square', 0.35, -70);
      noise(0.08 + dmg * 0.006, 0.5, 500 + dmg * 20, 0.7);
    },
    land()   { noise(0.05, 0.15, 400, 1); },
    thud()   { tone(70, 0.18, 'square', 0.35, -30); noise(0.15, 0.4, 300, 0.8); },
    pickup() { tone(660, 0.05, 'square', 0.2); tone(990, 0.07, 'square', 0.2, 0, 0.05); },
    throw()  { noise(0.1, 0.3, 1400, 1.5); },
    select() { tone(880, 0.04, 'square', 0.18, 0, 0, true); },
    ko()     { tone(220, 0.5, 'square', 0.35, -180); noise(0.4, 0.5, 300, 0.6); },
    round()  { tone(523, 0.08, 'square', 0.2); tone(784, 0.14, 'square', 0.2, 0, 0.09); },
  };
})();
