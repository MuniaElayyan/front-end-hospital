/**
 * bus.js — the two things the render layer needs to know about the outside
 * world, kept deliberately free of any transport.
 *
 *   • what time it is ON THE SERVER  (so every device draws the same countdown)
 *   • whether we are currently connected
 *
 * `net.js` pushes into this module; `ui.js` reads from it. Neither knows about
 * the other, which means the rendering code can be exercised without a socket.
 */

/* ── shared clock ────────────────────────────────────────────────────────── */

let offset = 0;
let rtt = Infinity;

/** Called by the transport whenever it takes a fresh time sample. */
export function setClockOffset(nextOffset, nextRtt) {
  offset = nextOffset;
  rtt = nextRtt;
}

export function resetClockSamples() {
  rtt = Infinity;
}

export const bestRtt = () => rtt;

/** Server time, as best this device can tell. */
export const serverNow = () => Date.now() + offset;

export const clockInfo = () => ({ offset: Math.round(offset), rtt: Math.round(rtt) });

/* ── connection status ───────────────────────────────────────────────────── */

const listeners = new Set();

export function onConnectionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitConnection(status) {
  listeners.forEach((fn) => {
    try { fn(status); } catch (err) { console.error('[bus]', err); }
  });
}
