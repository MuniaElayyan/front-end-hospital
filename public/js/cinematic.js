/**
 * cinematic.js — the Emergency Alert sequence (PHASE 2).
 *
 * Plays full-screen on every device at once. It is fire-and-forget: the phase
 * itself is what the server tracks, so a student who joins mid-cinematic (or
 * refreshes) simply lands in the room without it, rather than getting stuck.
 */

import { el } from './ui.js';
import { play } from './sound.js';

const SCRIPT = [
  { at: 200,  class: 'cinema__line--alert',   text: '🚨  EMERGENCY ALERT  🚨' },
  { at: 1500, class: 'cinema__line--body',    text: 'A website has been admitted to the hospital.' },
  { at: 3200, class: 'cinema__line--count',   text: '12 PATIENTS' },
  { at: 4000, class: 'cinema__line--count',   text: '12 DOCTORS' },
  { at: 4800, class: 'cinema__line--count',   text: 'ONE MISSION' },
  { at: 6200, class: 'cinema__line--mission', text: 'DIAGNOSE YOUR PATIENT.' },
];

const TOTAL = 8600;

let playing = false;

/**
 * @param {object} [opts]
 * @param {() => void} [opts.onDone]  Called once the curtain lifts.
 * @returns {() => void} a function that ends the sequence early.
 */
export function playEmergencyAlert({ onDone } = {}) {
  if (playing) return () => {};
  playing = true;

  const inner = el('div', { class: 'cinema__inner' });
  const stage = el('div', { class: 'cinema cinema__bars', role: 'dialog', 'aria-label': 'Emergency alert' },
    inner,
    el('button', {
      class: 'btn btn--ghost btn--sm',
      style: { position: 'absolute', bottom: '18px', right: '18px', zIndex: '3' },
      text: 'Skip',
      onClick: () => finish(),
    }));

  document.body.append(stage);
  play('alert');

  const timers = SCRIPT.map((line) => setTimeout(() => {
    inner.append(el('div', { class: `cinema__line ${line.class}`, text: line.text }));
    play(line.class.includes('count') ? 'monitor' : 'click');
  }, line.at));

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    playing = false;
    timers.forEach(clearTimeout);
    clearTimeout(endTimer);
    stage.style.transition = 'opacity .5s';
    stage.style.opacity = '0';
    setTimeout(() => { stage.remove(); onDone?.(); }, 500);
  }

  const endTimer = setTimeout(finish, TOTAL);
  return finish;
}

/** A red strobe bar pinned to the top of the viewport, for Code Blue moments. */
export function strobe(on = true) {
  const existing = document.querySelector('.strobe');
  if (on && !existing) document.body.append(el('div', { class: 'strobe', 'aria-hidden': 'true' }));
  if (!on && existing) existing.remove();
}

/** Big full-screen announcement used for THE FINAL PATIENT. */
export function announce({ lines = [], durationMs = 4200, danger = true } = {}) {
  const inner = el('div', { class: 'cinema__inner' },
    lines.map((text, i) => el('div', {
      class: `cinema__line ${i === 0 ? 'cinema__line--alert' : 'cinema__line--mission'}`,
      style: { animationDelay: `${i * 500}ms` },
      text,
    })));

  const stage = el('div', { class: 'cinema', style: danger ? {} : { background: '#04060c' } }, inner);
  document.body.append(stage);
  play(danger ? 'alert' : 'reveal');

  setTimeout(() => {
    stage.style.transition = 'opacity .5s';
    stage.style.opacity = '0';
    setTimeout(() => stage.remove(), 500);
  }, durationMs);
}
