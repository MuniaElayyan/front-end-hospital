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

/**
 * `io()` with NO url. This is the single most important line for making the
 * game work over the internet: Socket.IO connects back to the exact origin
 * that served this page. Open the app on localhost and it talks to localhost;
 * open it on https://your-app.onrender.com and it talks to that — same code,
 * no configuration, no hard-coded address anywhere in the project.
 */
export const socket = io({
  // WebSocket first, HTTP long-polling as a fallback for networks that block
  // or mangle the upgrade (some campus, corporate and carrier networks do).
  transports: ['websocket', 'polling'],

  reconnectionDelay: 500,
  reconnectionDelayMax: 8000,
  reconnectionAttempts: Infinity,

  /**
   * 45s, not the 12s you would pick for a LAN. On a free hosting tier the
   * server sleeps when idle and takes ~50s to wake; on mobile data the first
   * handshake can take several seconds. A short timeout here turns "the server
   * is waking up" into "connection failed", which is the same screen a student
   * sees when they typed the wrong address — the most misleading error the app
   * could possibly show.
   */
  timeout: 45000,
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

/**
 * Every shareable URL is built from the origin the page was actually served
 * from, so a link copied on a deployed instance points at that deployment and
 * a link copied locally points at localhost. Nothing here knows or cares which.
 */
export const joinUrl = (code) => `${window.location.origin}/join/${code}`;

/**
 * The host's recovery link. It carries the secret host token, which is the ONLY
 * thing that grants control of a room — so this link is a bearer credential,
 * exactly like a private share link: whoever holds it is the host.
 *
 * It exists because the token otherwise lives only in one browser's
 * localStorage. Without a way to carry it, a host who switches laptops, opens
 * a private window, or clears site data loses their room permanently while it
 * is still running on the server.
 */
export const hostUrl = (code, token) => `${window.location.origin}/host?room=${encodeURIComponent(code)}&key=${encodeURIComponent(token)}`;

/**
 * Reads ?room= / ?key= (and the /join/CODE path form), then ERASES them from
 * the address bar with replaceState. The page keeps working, but the token
 * stops sitting in the URL where it would be captured by screen shares,
 * shoulder-surfers, browser history and any Referer header the page sends.
 */
export function consumeUrlParams() {
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const pathCode = url.pathname.match(/^\/join\/([A-Za-z]{0,2}-?\d{4})$/)?.[1] ?? null;
    const room = params.get('room') || params.get('code') || pathCode;
    const key = params.get('key');

    if (params.has('room') || params.has('code') || params.has('key')) {
      ['room', 'code', 'key'].forEach((p) => params.delete(p));
      const clean = url.pathname + (params.toString() ? `?${params}` : '');
      window.history?.replaceState?.({}, '', clean);
    }

    return { room, key };
  } catch {
    // A non-browser host (or a locked-down embedding) — no URL to read.
    return { room: null, key: null };
  }
}

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
