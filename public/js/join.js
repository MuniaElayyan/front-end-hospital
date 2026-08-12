/**
 * join.js — the student's front door.
 *
 * Small, but it carries two important behaviours:
 *   • a pre-filled code when arriving via /join/FH-4827
 *   • an "already in this room" fast-path, so a refresh here does not force a
 *     re-join and does not lose the patient you already claimed.
 */

import {
  send, saveSession, loadSession, socket, consumeUrlParams,
} from './net.js';
import { $, toast, installConnectionBanner } from './ui.js';
import { play } from './sound.js';

installConnectionBanner();

const form = $('#join-form');
const nameInput = $('#name');
const codeInput = $('#code');
const errorBox = $('#error');
const statusBox = $('#room-status');
const submitBtn = $('#submit');

/* ── prefill ─────────────────────────────────────────────────────────────── */

// Accepts every shape a room link gets pasted in:
//   /join/FH-4827   ·   /join?room=FH-4827   ·   /join?code=FH-4827
const { room: fromUrl } = consumeUrlParams();
const prior = loadSession();

const prefillCode = fromUrl || prior?.roomCode || '';
if (prefillCode) codeInput.value = formatCode(prefillCode);
if (prior?.name) nameInput.value = prior.name;

try {
  const lastName = localStorage.getItem('feh.name');
  if (lastName && !nameInput.value) nameInput.value = lastName;
} catch { /* ignore */ }

setTimeout(() => (nameInput.value ? codeInput : nameInput).focus(), 120);

/* ── code field behaviour ────────────────────────────────────────────────── */

function formatCode(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 4);
  return digits ? `FH-${digits}` : '';
}

codeInput.addEventListener('input', () => {
  const caretAtEnd = codeInput.selectionStart === codeInput.value.length;
  codeInput.value = formatCode(codeInput.value);
  if (caretAtEnd) codeInput.setSelectionRange(codeInput.value.length, codeInput.value.length);
  errorBox.textContent = '';
  checkRoom();
});

/* ── live room lookup ────────────────────────────────────────────────────── */
// Tells "that code doesn't exist" apart from "the server is unreachable"
// *before* we open a socket, which makes the failure messages honest.

let lookupTimer = null;
function checkRoom() {
  clearTimeout(lookupTimer);
  const code = codeInput.value;
  if (!/^FH-\d{4}$/.test(code)) {
    statusBox.textContent = 'Ask the host for the code on screen.';
    statusBox.style.color = '';
    return;
  }
  statusBox.textContent = 'Checking room…';
  statusBox.style.color = '';

  lookupTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/room/${code}`);
      const data = await res.json();
      if (!data.ok) {
        statusBox.textContent = 'No emergency room with that code.';
        statusBox.style.color = 'var(--red)';
        return;
      }
      statusBox.textContent = data.open
        ? `Room found — ${data.players}/${data.maxPlayers} doctors connected.`
        : `Room is full (${data.players}/${data.maxPlayers}).`;
      statusBox.style.color = data.open ? 'var(--green)' : 'var(--amber)';
    } catch {
      statusBox.textContent = 'Cannot reach the hospital server.';
      statusBox.style.color = 'var(--red)';
    }
  }, 320);
}
if (codeInput.value) checkRoom();

/* ── resume an existing session ──────────────────────────────────────────── */

async function tryResume() {
  if (!prior?.role || prior.role !== 'player' || !prior.playerId || !prior.token) return;
  try {
    await send('player:resume', {
      roomCode: prior.roomCode,
      playerId: prior.playerId,
      token: prior.token,
    });
    window.location.replace('/play');
  } catch {
    // Stale session — leave the form alone and let them join normally.
  }
}
socket.once('connect', tryResume);

/* ── submit ──────────────────────────────────────────────────────────────── */

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';

  const name = nameInput.value.trim();
  const roomCode = codeInput.value;

  if (name.length < 2) {
    errorBox.textContent = 'Please enter a doctor name (at least 2 characters).';
    nameInput.focus();
    form.classList.add('shake');
    setTimeout(() => form.classList.remove('shake'), 500);
    return;
  }
  if (!/^FH-\d{4}$/.test(roomCode)) {
    errorBox.textContent = 'Room codes look like FH-4827.';
    codeInput.focus();
    form.classList.add('shake');
    setTimeout(() => form.classList.remove('shake'), 500);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'ADMITTING…';

  try {
    const reply = await send('player:join', { name, roomCode });
    saveSession({
      role: 'player',
      roomCode: reply.roomCode,
      playerId: reply.playerId,
      token: reply.token,
      name,
    });
    try { localStorage.setItem('feh.name', name); } catch { /* ignore */ }
    play('join');
    submitBtn.textContent = 'WELCOME, DOCTOR ✓';
    setTimeout(() => window.location.assign('/play'), 320);
  } catch (err) {
    errorBox.textContent = err.message;
    toast(err.message, 'error');
    play('denied');
    submitBtn.disabled = false;
    submitBtn.textContent = 'JOIN HOSPITAL';
    form.classList.add('shake');
    setTimeout(() => form.classList.remove('shake'), 500);
  }
});
