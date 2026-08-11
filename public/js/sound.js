/**
 * sound.js — optional audio, synthesised with the Web Audio API.
 *
 * No audio files ship with the project: every cue is a few oscillators, so the
 * repo stays tiny and there is nothing to 404. Sound is OFF-by-default-safe —
 * browsers block audio until the first gesture anyway — and the preference is
 * remembered per device.
 */

const KEY = 'feh.sound.v1';

let ctx = null;
let enabled = (() => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
})();

export const isSoundOn = () => enabled;

export function setSound(on) {
  enabled = Boolean(on);
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
  if (enabled) ensureCtx();
  return enabled;
}

export const toggleSound = () => setSound(!enabled);

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Browsers require a gesture before audio may start.
['pointerdown', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, () => { if (enabled) ensureCtx(); }, { once: true, passive: true });
});

/** One shaped tone. */
function tone({ freq = 440, dur = 0.16, type = 'sine', gain = 0.14, at = 0, slideTo = null }) {
  const audio = ensureCtx();
  if (!audio) return;
  const t0 = audio.currentTime + at;

  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(amp).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.2, gain = 0.06, at = 0 }) {
  const audio = ensureCtx();
  if (!audio) return;
  const frames = Math.floor(audio.sampleRate * dur);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = audio.createBufferSource();
  const amp = audio.createGain();
  src.buffer = buffer;
  amp.gain.value = gain;
  src.connect(amp).connect(audio.destination);
  src.start(audio.currentTime + at);
}

const CUES = {
  click:    () => tone({ freq: 660, dur: 0.07, type: 'triangle', gain: 0.08 }),
  claim:    () => { tone({ freq: 523, dur: 0.1, type: 'triangle' }); tone({ freq: 784, dur: 0.16, type: 'triangle', at: 0.08 }); },
  denied:   () => { tone({ freq: 220, dur: 0.16, type: 'sawtooth', gain: 0.1, slideTo: 110 }); },
  join:     () => { tone({ freq: 587, dur: 0.09, type: 'sine' }); tone({ freq: 880, dur: 0.13, type: 'sine', at: 0.07 }); },
  submit:   () => { tone({ freq: 494, dur: 0.09 }); tone({ freq: 659, dur: 0.09, at: 0.08 }); tone({ freq: 988, dur: 0.2, at: 0.16 }); },
  alert:    () => { for (let i = 0; i < 3; i += 1) { tone({ freq: 880, dur: 0.16, type: 'square', gain: 0.09, at: i * 0.34 }); tone({ freq: 660, dur: 0.16, type: 'square', gain: 0.09, at: i * 0.34 + 0.17 }); } },
  monitor:  () => tone({ freq: 1046, dur: 0.06, type: 'sine', gain: 0.06 }),
  tick:     () => tone({ freq: 1200, dur: 0.035, type: 'sine', gain: 0.05 }),
  timeup:   () => { tone({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slideTo: 90 }); noise({ dur: 0.3, gain: 0.05 }); },
  reveal:   () => { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', at: i * 0.1 })); },
  fanfare:  () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.34, type: 'triangle', gain: 0.13, at: i * 0.11 })); noise({ dur: 0.5, gain: 0.04, at: 0.5 }); },
  yourturn: () => { tone({ freq: 784, dur: 0.14, type: 'sine' }); tone({ freq: 1046, dur: 0.2, type: 'sine', at: 0.13 }); },
};

export function play(cue) {
  if (!enabled) return;
  try { CUES[cue]?.(); } catch { /* audio is a nicety, never a failure mode */ }
}

/** A ready-made mute button for the top bar. */
export function soundToggleButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--ghost btn--icon';
  btn.title = 'Toggle sound';
  const paint = () => {
    btn.textContent = enabled ? '🔊' : '🔇';
    btn.setAttribute('aria-label', enabled ? 'Sound on — click to mute' : 'Sound off — click to unmute');
  };
  btn.addEventListener('click', () => { setSound(!enabled); paint(); if (enabled) play('click'); });
  paint();
  return btn;
}
