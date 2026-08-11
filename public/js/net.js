/**
 * net.js — the only place the app talks to the server.
 *
 * Responsibilities:
 *   • one socket, shared
 *   • promise-based emit (Socket.IO acks → async/await)
 *   • clock synchronisation, so every device renders the same countdown
 *   • session storage + automatic re-attach after a refresh or a dropped Wi-Fi
 */

/* global io */

import {
  bestRtt, emitConnection, resetClockSamples, setClockOffset,
} from './bus.js';

export { clockInfo, onConnectionChange, serverNow } from './bus.js';

export const socket = io({
  transports: ['websocket', 'polling'],
  reconnectionDelay: 400,
  reconnectionDelayMax: 4000,
  timeout: 12000,
});

/* ── promise wrapper ─────────────────────────────────────────────────────── */

export function send(event, payload = {}, { timeout = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('The server did not answer in time.'), { code: 'TIMEOUT' }));
    }, timeout);

    socket.emit(event, payload, (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (reply?.ok) resolve(reply);
      else {
        reject(Object.assign(
          new Error(reply?.message || 'Request failed.'),
          { code: reply?.code || 'ERROR' },
        ));
      }
    });
  });
}

/* ── shared clock ────────────────────────────────────────────────────────── */
// The server owns the truth. We measure our own offset from it (round-trip /2)
// and keep the best of several samples, so a phone with a wrong system clock
// still counts down in step with the projector.

function sample() {
  const t0 = Date.now();
  socket.emit('time:ping', t0, (reply) => {
    if (!reply) return;
    const rtt = Date.now() - t0;
    // Keep the least-delayed sample: a fast round trip gives the tightest
    // bound on where the server's "now" actually sits.
    if (rtt > bestRtt()) return;
    setClockOffset(reply.serverTime - (t0 + rtt / 2), rtt);
  });
}

socket.on('connect', () => {
  resetClockSamples();
  sample();
  setTimeout(sample, 350);
  setTimeout(sample, 900);
});
setInterval(sample, 20000);

/* ── session persistence ─────────────────────────────────────────────────── */
// Requirement 22: a refresh must not cost you your identity, your patient,
// your diagnosis or your score. The secret token lives only in this browser.

const KEY = 'feh.session.v1';

export function saveSession(session) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...session, savedAt: Date.now() })); }
  catch { /* private mode — the game still works, just not across refreshes */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // A stale session from last week is noise, not signal.
    if (Date.now() - (session.savedAt ?? 0) > 12 * 60 * 60 * 1000) return null;
    return session;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/* ── connection status ───────────────────────────────────────────────────── */

let hasConnected = false;

socket.on('connect', () => {
  emitConnection(hasConnected ? 'reconnected' : 'connected');
  hasConnected = true;
});
socket.on('disconnect', () => emitConnection('disconnected'));
socket.on('connect_error', () => emitConnection('error'));

/* ── misc ────────────────────────────────────────────────────────────────── */
//  Note: re-attaching after a reconnect is deliberately NOT handled here.
//  Socket.IO hands out a fresh socket on every reconnect and the server does
//  not know who it belongs to, so each page registers its own `connect`
//  handler that presents its token again — the host and the player need to
//  react differently when that fails, and hiding it in the transport made
//  those two paths harder to follow.

export const joinUrl = (code) => `${window.location.origin}/join/${code}`;

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http:// on a LAN IP is not a secure context, so the Clipboard API is
    // unavailable exactly where a classroom needs it most. Fall back.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
