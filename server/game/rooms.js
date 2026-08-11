import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { publicId, roomCode, secretToken } from '../util/ids.js';
import { cleanDoctorName, cleanText, clampInt } from '../util/sanitize.js';
import {
  FINAL_PATIENT, PATIENTS, getCase, privatePatientFile, publicPatientInfo, revealAnswer,
} from './patients.js';
import { PHASE_IDS, isPhase, phaseMeta } from './phases.js';
import {
  MAX_SCORE, RUBRIC, autoSuggest, emptyScore, leaderboard, totalOf,
} from './scoring.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  THE SINGLE SOURCE OF TRUTH
 * ────────────────────────────────────────────────────────────────────────────
 *  Every room lives in this one Map, in this one Node process, and every
 *  mutation happens inside a synchronous function below. Node runs JavaScript
 *  on a single thread and never interrupts a function mid-execution, so
 *  `claimPatient` is atomic *by construction* — there is no window between
 *  "is it free?" and "take it" for a second doctor to slip through. Two clicks
 *  in the same millisecond are still two separate turns of the event loop, and
 *  the second one sees the patient already taken.
 *
 *  Clients never mutate anything. They send intents; the server decides.
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

const now = () => Date.now();

class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.expected = true;
  }
}
export const fail = (code, message) => { throw new RoomError(code, message); };
export const isExpected = (err) => Boolean(err?.expected);

// ── creation ────────────────────────────────────────────────────────────────

function freshPatientSlots() {
  return PATIENTS.map((p) => ({
    id: p.id,
    number: p.number,
    takenBy: null,
    takenAt: null,
    revealed: false,
  }));
}

export function createRoom({ hostName } = {}) {
  let code = roomCode();
  let guard = 0;
  while (rooms.has(code) && guard++ < 200) code = roomCode();
  if (rooms.has(code)) fail('NO_CAPACITY', 'The hospital is full. Try again in a moment.');

  const room = {
    code,
    hostToken: secretToken(),
    hostName: cleanDoctorName(hostName) || 'Chief of Medicine',
    hostSocketId: null,
    hostConnected: false,

    createdAt: now(),
    touchedAt: now(),

    phase: 'lobby',
    paused: false,

    /** Host switches for the rules students keep asking about. */
    rules: {
      selectionLocked: false,   // nobody may claim a new patient
      allowRechoose: false,     // a doctor may release and re-pick
      allowResubmit: false,     // globally re-open the diagnosis form
    },

    patients: freshPatientSlots(),

    /** @type {Map<string, Player>} */
    players: new Map(),
    nextDoctorNumber: 1,

    /** playerId -> submission */
    submissions: {},
    /** playerId -> score */
    scores: {},
    /** playerId -> per-player resubmit permission */
    resubmitAllowed: {},

    /** Server-authoritative shared clock. */
    timer: {
      label: '',
      running: false,
      endsAt: null,      // server epoch ms
      remainingMs: 0,    // meaningful while paused/stopped
      durationMs: 0,
    },

    conference: {
      order: [],
      index: 0,
      presented: [],
    },

    reveal: {
      mode: 'none',      // 'none' | 'one' | 'all'
      patientId: null,
    },

    final: {
      started: false,
      mode: 'individual', // 'individual' | 'team'
      submissions: {},    // playerId -> { findings: [{title, cause, fix}], submittedAt }
      scores: {},         // playerId -> { total, note }
      revealed: false,
    },

    log: [],
  };

  rooms.set(code, room);
  addLog(room, 'Room opened.');
  return room;
}

export const getRoom = (code) => rooms.get(code) ?? null;

export function requireRoom(code) {
  const room = rooms.get(code);
  if (!room) fail('NO_ROOM', 'That room code does not exist. Check the code and try again.');
  room.touchedAt = now();
  return room;
}

export const roomExists = (code) => rooms.has(code);

function addLog(room, message) {
  room.log.unshift({ at: now(), message });
  room.log.length = Math.min(room.log.length, 60);
}

// ── players ─────────────────────────────────────────────────────────────────

export function joinRoom(code, rawName) {
  const room = requireRoom(code);

  if (room.phase === 'ended') fail('ENDED', 'This emergency shift has already ended.');

  const name = cleanDoctorName(rawName);
  if (name.length < 2) fail('BAD_NAME', 'Please enter a doctor name (at least 2 characters).');

  const taken = [...room.players.values()]
    .some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (taken) fail('NAME_TAKEN', `Doctor ${name} is already on this shift. Try a different name.`);

  if (room.players.size >= config.maxPlayers) {
    fail('ROOM_FULL', `The emergency room is full (${config.maxPlayers} doctors).`);
  }

  // Joining after selection has started is allowed, but only while patients
  // remain — otherwise the newcomer has nothing to diagnose.
  if (room.phase !== 'lobby' && room.phase !== 'alert') {
    const free = room.patients.filter((p) => !p.takenBy).length;
    if (free === 0) fail('NO_PATIENTS', 'All patients have already been admitted. You joined too late.');
  }

  const player = {
    id: publicId(),
    token: secretToken(),
    name,
    doctorNumber: room.nextDoctorNumber++,
    patientId: null,
    connected: true,
    socketId: null,
    joinedAt: now(),
    lastSeenAt: now(),
    draft: null,
  };

  room.players.set(player.id, player);
  room.scores[player.id] = emptyScore();
  addLog(room, `Doctor ${name} checked in.`);
  room.touchedAt = now();
  return { room, player };
}

/**
 * Re-attach an existing identity after a refresh, a tab close, or a phone
 * going to sleep. The token is the proof — a player id alone is not enough.
 */
export function resumePlayer(code, playerId, token) {
  const room = requireRoom(code);
  const player = room.players.get(playerId);
  if (!player || player.token !== token) {
    fail('NO_SESSION', 'That session is no longer valid. Please join again.');
  }
  player.connected = true;
  player.lastSeenAt = now();
  return { room, player };
}

export function resumeHost(code, hostToken) {
  const room = requireRoom(code);
  if (room.hostToken !== hostToken) fail('NOT_HOST', 'You are not the host of this room.');
  room.hostConnected = true;
  return room;
}

export function requirePlayer(room, playerId, token) {
  const player = room.players.get(playerId);
  if (!player || player.token !== token) fail('NOT_PLAYER', 'Your session is not recognised.');
  return player;
}

export function requireHost(room, hostToken) {
  if (!room.hostToken || room.hostToken !== hostToken) {
    fail('NOT_HOST', 'Only the host can do that.');
  }
  return true;
}

export function setPlayerConnection(room, playerId, connected, socketId = null) {
  const player = room.players.get(playerId);
  if (!player) return;
  player.connected = connected;
  player.socketId = connected ? socketId : null;
  player.lastSeenAt = now();
}

export function removePlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  releasePatientOf(room, player);
  room.players.delete(playerId);
  delete room.submissions[playerId];
  delete room.scores[playerId];
  delete room.final.submissions[playerId];
  room.conference.order = room.conference.order.filter((id) => id !== playerId);
  addLog(room, `Doctor ${player.name} was removed from the shift.`);
}

// ── patient reservation (the atomic bit) ────────────────────────────────────

function releasePatientOf(room, player) {
  if (!player.patientId) return;
  const slot = room.patients.find((p) => p.id === player.patientId);
  if (slot && slot.takenBy === player.id) {
    slot.takenBy = null;
    slot.takenAt = null;
  }
  player.patientId = null;
}

/**
 * Claim a patient. Runs to completion without yielding, which is what makes
 * the check-then-set safe. Returns the claimed slot or throws with a reason
 * the losing doctor can be shown.
 */
export function claimPatient(room, player, patientId) {
  if (room.phase !== 'selection') {
    fail('WRONG_PHASE', 'Patient selection is not open right now.');
  }
  if (room.paused) fail('PAUSED', 'The shift is paused. Wait for the host.');
  if (room.rules.selectionLocked) {
    fail('SELECTION_LOCKED', 'The host has locked patient selection.');
  }

  const slot = room.patients.find((p) => p.id === patientId);
  if (!slot) fail('NO_PATIENT', 'That patient does not exist.');

  // Already holds one?
  if (player.patientId) {
    if (player.patientId === patientId) return slot; // idempotent re-click
    if (!room.rules.allowRechoose) {
      const held = room.patients.find((p) => p.id === player.patientId);
      fail('ALREADY_ASSIGNED', `You are already treating Patient ${String(held?.number).padStart(2, '0')}. One patient per doctor.`);
    }
    releasePatientOf(room, player);
  }

  // ── the critical section ──
  if (slot.takenBy && slot.takenBy !== player.id) {
    const owner = room.players.get(slot.takenBy);
    fail('TAKEN', `Patient already taken${owner ? ` — Doctor ${owner.name} got there first.` : '.'}`);
  }
  slot.takenBy = player.id;
  slot.takenAt = now();
  player.patientId = slot.id;
  // ── end critical section ──

  addLog(room, `Doctor ${player.name} admitted Patient ${String(slot.number).padStart(2, '0')}.`);
  room.touchedAt = now();
  return slot;
}

/** A doctor gives their patient back — only when the host has allowed it. */
export function releasePatient(room, player) {
  if (!room.rules.allowRechoose) {
    fail('NOT_ALLOWED', 'The host has not allowed changing patients.');
  }
  if (!player.patientId) fail('NO_PATIENT', 'You have no patient to release.');
  const number = room.patients.find((p) => p.id === player.patientId)?.number;
  releasePatientOf(room, player);
  delete room.submissions[player.id];
  addLog(room, `Doctor ${player.name} released Patient ${String(number).padStart(2, '0')}.`);
}

/** Host force-frees a patient (student left, wrong pick, etc). */
export function hostResetPatient(room, patientId) {
  const slot = room.patients.find((p) => p.id === patientId);
  if (!slot) fail('NO_PATIENT', 'That patient does not exist.');
  if (slot.takenBy) {
    const player = room.players.get(slot.takenBy);
    if (player) {
      player.patientId = null;
      delete room.submissions[player.id];
      room.scores[player.id] = emptyScore();
    }
  }
  slot.takenBy = null;
  slot.takenAt = null;
  addLog(room, `Host reset Patient ${String(slot.number).padStart(2, '0')}.`);
}

export const assignedCount = (room) => room.patients.filter((p) => p.takenBy).length;

export const allDoctorsAssigned = (room) => room.players.size > 0
  && [...room.players.values()].every((p) => p.patientId);

// ── diagnosis ───────────────────────────────────────────────────────────────

export function saveDraft(room, player, draft) {
  player.draft = {
    diagnosis: cleanText(draft?.diagnosis, 2000),
    cause: cleanText(draft?.cause, 2000),
    treatment: cleanText(draft?.treatment, 2000),
    confidence: clampInt(draft?.confidence, 0, 100, 50),
    savedAt: now(),
  };
}

export function submitDiagnosis(room, player, payload) {
  if (room.phase !== 'diagnosis' && room.phase !== 'conference') {
    fail('WRONG_PHASE', 'Diagnosis submissions are not open right now.');
  }
  if (room.paused) fail('PAUSED', 'The shift is paused.');
  if (!player.patientId) fail('NO_PATIENT', 'You have not been assigned a patient.');

  const existing = room.submissions[player.id];
  const mayEdit = !existing
    || room.rules.allowResubmit
    || room.resubmitAllowed[player.id] === true;
  if (!mayEdit) {
    fail('LOCKED', 'Your diagnosis is already submitted. Ask the host to re-open it.');
  }

  const diagnosis = cleanText(payload?.diagnosis, 2000);
  const cause = cleanText(payload?.cause, 2000);
  const treatment = cleanText(payload?.treatment, 2000);
  if (!diagnosis || !cause || !treatment) {
    fail('INCOMPLETE', 'Please fill in Diagnosis, Cause and Treatment before submitting.');
  }

  room.submissions[player.id] = {
    playerId: player.id,
    patientId: player.patientId,
    diagnosis,
    cause,
    treatment,
    confidence: clampInt(payload?.confidence, 0, 100, 50),
    submittedAt: now(),
    revision: (existing?.revision ?? 0) + 1,
  };
  // Using the one-shot permission consumes it.
  delete room.resubmitAllowed[player.id];
  player.draft = null;

  addLog(room, `Doctor ${player.name} submitted a diagnosis.`);
  room.touchedAt = now();
  return room.submissions[player.id];
}

export function setResubmit(room, playerId, allowed) {
  if (playerId === 'all') {
    room.rules.allowResubmit = Boolean(allowed);
    addLog(room, `Host ${allowed ? 're-opened' : 'locked'} diagnosis editing for everyone.`);
    return;
  }
  const player = room.players.get(playerId);
  if (!player) fail('NO_PLAYER', 'No such doctor.');
  if (allowed) room.resubmitAllowed[playerId] = true;
  else delete room.resubmitAllowed[playerId];
  addLog(room, `Host ${allowed ? 're-opened' : 'locked'} editing for Doctor ${player.name}.`);
}

// ── scoring ─────────────────────────────────────────────────────────────────

export function setScore(room, playerId, patch) {
  const player = room.players.get(playerId);
  if (!player) fail('NO_PLAYER', 'No such doctor.');

  const current = room.scores[playerId] ?? emptyScore();
  const next = { ...current };

  for (const rule of RUBRIC) {
    if (patch?.[rule.key] !== undefined) {
      next[rule.key] = clampInt(patch[rule.key], 0, rule.max, 0);
    }
  }
  if (patch?.bonus !== undefined) next.bonus = clampInt(patch.bonus, -20, 20, 0);
  if (patch?.approved !== undefined) {
    next.approved = patch.approved === null ? null : Boolean(patch.approved);
  }
  if (patch?.note !== undefined) next.note = cleanText(patch.note, 400);

  next.total = totalOf(next);
  next.gradedAt = now();
  room.scores[playerId] = next;
  addLog(room, `Host scored Doctor ${player.name}: ${next.total} pts.`);
  return next;
}

export function suggestScore(room, playerId) {
  const submission = room.submissions[playerId];
  const player = room.players.get(playerId);
  if (!submission || !player) fail('NO_SUBMISSION', 'That doctor has not submitted yet.');
  return autoSuggest(submission, getCase(submission.patientId));
}

export function setFinalScore(room, playerId, points, note) {
  const player = room.players.get(playerId);
  if (!player) fail('NO_PLAYER', 'No such doctor.');
  room.final.scores[playerId] = {
    total: clampInt(points, 0, 50, 0),
    note: cleanText(note, 300),
    gradedAt: now(),
  };
}

// ── phases, pause, timer ────────────────────────────────────────────────────

export function setPhase(room, phaseId) {
  if (!isPhase(phaseId)) fail('BAD_PHASE', 'Unknown phase.');
  if (room.phase === phaseId) return room.phase;

  room.phase = phaseId;
  room.paused = false;

  // Entering selection re-opens the ward; entering later phases seals it.
  if (phaseId === 'selection') {
    room.rules.selectionLocked = false;
  }
  if (phaseId === 'diagnosis') {
    room.rules.selectionLocked = true;
  }
  if (phaseId === 'conference' && room.conference.order.length === 0) {
    room.conference.order = [...room.players.values()]
      .filter((p) => p.patientId)
      .sort((a, b) => a.doctorNumber - b.doctorNumber)
      .map((p) => p.id);
    room.conference.index = 0;
  }
  if (phaseId === 'final') {
    room.final.started = true;
  }

  stopTimer(room);
  addLog(room, `Phase → ${phaseMeta(phaseId).label}.`);
  room.touchedAt = now();
  return room.phase;
}

export function setPaused(room, paused) {
  room.paused = Boolean(paused);
  if (room.paused) pauseTimer(room);
  else resumeTimer(room);
  addLog(room, room.paused ? 'Shift paused.' : 'Shift resumed.');
}

export function startTimer(room, seconds, label) {
  const secs = clampInt(seconds, 5, 3600, 60);
  room.timer = {
    label: cleanText(label, 60) || 'Time remaining',
    running: true,
    durationMs: secs * 1000,
    endsAt: now() + secs * 1000,
    remainingMs: secs * 1000,
  };
  addLog(room, `Timer started: ${secs}s.`);
}

export function pauseTimer(room) {
  if (!room.timer.running || room.timer.endsAt == null) return;
  room.timer.remainingMs = Math.max(0, room.timer.endsAt - now());
  room.timer.running = false;
  room.timer.endsAt = null;
}

export function resumeTimer(room) {
  if (room.timer.running || !room.timer.remainingMs) return;
  room.timer.endsAt = now() + room.timer.remainingMs;
  room.timer.running = true;
}

export function stopTimer(room) {
  room.timer = {
    label: '', running: false, endsAt: null, remainingMs: 0, durationMs: 0,
  };
}

export function addTime(room, seconds) {
  const delta = clampInt(seconds, -600, 600, 0) * 1000;
  if (room.timer.running && room.timer.endsAt != null) {
    room.timer.endsAt = Math.max(now(), room.timer.endsAt + delta);
  } else {
    room.timer.remainingMs = Math.max(0, room.timer.remainingMs + delta);
  }
}

// ── conference ──────────────────────────────────────────────────────────────

export function setConference(room, { action, order, index }) {
  const c = room.conference;
  const valid = (ids) => ids.filter((id) => room.players.has(id));

  switch (action) {
    case 'set':
      if (!Array.isArray(order)) fail('BAD_ORDER', 'Invalid presentation order.');
      c.order = valid(order);
      c.index = 0;
      break;
    case 'shuffle': {
      const ids = valid(c.order.length ? c.order : [...room.players.keys()]);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      c.order = ids;
      c.index = 0;
      break;
    }
    case 'next':
      if (c.order[c.index] && !c.presented.includes(c.order[c.index])) {
        c.presented.push(c.order[c.index]);
      }
      c.index = Math.min(c.order.length - 1, c.index + 1);
      break;
    case 'prev':
      c.index = Math.max(0, c.index - 1);
      break;
    case 'goto':
      c.index = clampInt(index, 0, Math.max(0, c.order.length - 1), 0);
      break;
    default:
      fail('BAD_ACTION', 'Unknown conference action.');
  }
}

// ── reveal ──────────────────────────────────────────────────────────────────

export function setReveal(room, { mode, patientId }) {
  if (mode === 'all') {
    room.patients.forEach((p) => { p.revealed = true; });
    room.reveal = { mode: 'all', patientId: null };
    addLog(room, 'Host revealed every diagnosis.');
    return;
  }
  if (mode === 'none') {
    room.reveal = { mode: 'none', patientId: null };
    return;
  }
  const slot = room.patients.find((p) => p.id === patientId);
  if (!slot) fail('NO_PATIENT', 'That patient does not exist.');
  slot.revealed = true;
  room.reveal = { mode: 'one', patientId };
  addLog(room, `Host revealed Patient ${String(slot.number).padStart(2, '0')}.`);
}

export function revealFinal(room, revealed = true) {
  room.final.revealed = Boolean(revealed);
}

// ── final patient ───────────────────────────────────────────────────────────

export function submitFinal(room, player, payload) {
  if (room.phase !== 'final') fail('WRONG_PHASE', 'The final patient is not open yet.');
  if (room.paused) fail('PAUSED', 'The shift is paused.');

  const findings = (Array.isArray(payload?.findings) ? payload.findings : [])
    .slice(0, 8)
    .map((f) => ({
      title: cleanText(f?.title, 160),
      cause: cleanText(f?.cause, 600),
      fix: cleanText(f?.fix, 600),
    }))
    .filter((f) => f.title);

  if (!findings.length) fail('INCOMPLETE', 'Add at least one finding before submitting.');

  room.final.submissions[player.id] = {
    playerId: player.id,
    findings,
    submittedAt: now(),
  };
  addLog(room, `Doctor ${player.name} submitted ${findings.length} finding(s) on the final patient.`);
}

export function setFinalMode(room, mode) {
  room.final.mode = mode === 'team' ? 'team' : 'individual';
}

// ── lifecycle ───────────────────────────────────────────────────────────────

export function restartRoom(room, { keepPlayers = true } = {}) {
  room.phase = 'lobby';
  room.paused = false;
  room.rules = { selectionLocked: false, allowRechoose: false, allowResubmit: false };
  room.patients = freshPatientSlots();
  room.submissions = {};
  room.scores = {};
  room.resubmitAllowed = {};
  room.conference = { order: [], index: 0, presented: [] };
  room.reveal = { mode: 'none', patientId: null };
  room.final = {
    started: false, mode: room.final.mode, submissions: {}, scores: {}, revealed: false,
  };
  stopTimer(room);

  if (keepPlayers) {
    for (const player of room.players.values()) {
      player.patientId = null;
      player.draft = null;
      room.scores[player.id] = emptyScore();
    }
  } else {
    room.players.clear();
    room.nextDoctorNumber = 1;
  }
  addLog(room, keepPlayers ? 'Game restarted (doctors kept).' : 'Game restarted (room cleared).');
}

export function endRoom(room) {
  room.phase = 'ended';
  stopTimer(room);
  addLog(room, 'Shift ended.');
}

export function closeRoom(code) {
  rooms.delete(code);
}

/** Drop rooms nobody has touched in a long while. */
export function sweep() {
  const cutoff = now() - config.roomTtlMs;
  const dropped = [];
  for (const [code, room] of rooms) {
    const anyoneHere = room.hostConnected
      || [...room.players.values()].some((p) => p.connected);
    if (!anyoneHere && room.touchedAt < cutoff) {
      rooms.delete(code);
      dropped.push(code);
    }
  }
  return dropped;
}

// ── state views ─────────────────────────────────────────────────────────────
//  Two projections of the same room. The player view is built so that a
//  student poking at DevTools simply does not receive other people's patient
//  files, other people's answers, or any answer key.

function playerSummary(room, p) {
  return {
    id: p.id,
    name: p.name,
    doctorNumber: p.doctorNumber,
    patientId: p.patientId,
    connected: p.connected,
    submitted: Boolean(room.submissions[p.id]),
    graded: Boolean(room.scores[p.id]?.gradedAt),
    finalSubmitted: Boolean(room.final.submissions[p.id]),
  };
}

function timerView(room) {
  const t = room.timer;
  return {
    label: t.label,
    running: t.running,
    endsAt: t.endsAt,
    remainingMs: t.running && t.endsAt != null
      ? Math.max(0, t.endsAt - now())
      : t.remainingMs,
    durationMs: t.durationMs,
  };
}

function baseView(room) {
  return {
    code: room.code,
    phase: room.phase,
    phaseMeta: phaseMeta(room.phase),
    paused: room.paused,
    rules: { ...room.rules },
    hostConnected: room.hostConnected,
    hostName: room.hostName,
    limits: { min: config.minPlayers, max: config.maxPlayers, maxScore: MAX_SCORE },
    rubric: RUBRIC,
    serverTime: now(),
    timer: timerView(room),
    players: [...room.players.values()]
      .sort((a, b) => a.doctorNumber - b.doctorNumber)
      .map((p) => playerSummary(room, p)),
    patients: room.patients.map((slot) => {
      const owner = slot.takenBy ? room.players.get(slot.takenBy) : null;
      return {
        ...publicPatientInfo(getCase(slot.id)),
        takenBy: slot.takenBy,
        takenByName: owner?.name ?? null,
        takenByNumber: owner?.doctorNumber ?? null,
        revealed: slot.revealed,
      };
    }),
    assignedCount: assignedCount(room),
    totalPatients: room.patients.length,
    conference: {
      order: room.conference.order.map((id) => {
        const p = room.players.get(id);
        return p ? { id, name: p.name, doctorNumber: p.doctorNumber, patientId: p.patientId } : null;
      }).filter(Boolean),
      index: room.conference.index,
      currentId: room.conference.order[room.conference.index] ?? null,
      presented: [...room.conference.presented],
    },
    reveal: { ...room.reveal },
    final: {
      started: room.final.started,
      mode: room.final.mode,
      revealed: room.final.revealed,
      submittedCount: Object.keys(room.final.submissions).length,
      case: room.final.started ? privatePatientFile(FINAL_PATIENT) : null,
      answer: room.final.revealed ? FINAL_PATIENT.answer : null,
      bugCount: FINAL_PATIENT.bugCount,
    },
  };
}

/** Everything a revealed patient discloses to the whole room. */
function revealedBundle(room) {
  const out = {};
  for (const slot of room.patients) {
    if (!slot.revealed) continue;
    const kase = getCase(slot.id);
    const owner = slot.takenBy ? room.players.get(slot.takenBy) : null;
    const submission = owner ? room.submissions[owner.id] : null;
    const score = owner ? room.scores[owner.id] : null;
    out[slot.id] = {
      file: privatePatientFile(kase),
      answer: revealAnswer(kase),
      doctor: owner ? { id: owner.id, name: owner.name, doctorNumber: owner.doctorNumber } : null,
      submission: submission
        ? {
          diagnosis: submission.diagnosis,
          cause: submission.cause,
          treatment: submission.treatment,
          confidence: submission.confidence,
        }
        : null,
      score: score?.gradedAt
        ? {
          diagnosis: score.diagnosis,
          cause: score.cause,
          treatment: score.treatment,
          explanation: score.explanation,
          bonus: score.bonus,
          total: score.total,
          approved: score.approved,
          note: score.note,
        }
        : null,
    };
  }
  return out;
}

export function boardFor(room) {
  return leaderboard([...room.players.values()], room.scores, room.final.scores);
}

/** What a specific doctor is allowed to know. */
export function playerView(room, player) {
  const view = baseView(room);
  const myCase = player.patientId ? getCase(player.patientId) : null;

  view.you = {
    id: player.id,
    name: player.name,
    doctorNumber: player.doctorNumber,
    patientId: player.patientId,
    draft: player.draft,
    canEditDiagnosis: !room.submissions[player.id]
      || room.rules.allowResubmit
      || room.resubmitAllowed[player.id] === true,
    canRechoose: room.rules.allowRechoose,
    submission: room.submissions[player.id] ?? null,
    finalSubmission: room.final.submissions[player.id] ?? null,
    score: room.scores[player.id]?.gradedAt ? room.scores[player.id] : null,
  };
  view.myCase = myCase ? privatePatientFile(myCase) : null;
  view.revealed = revealedBundle(room);
  view.leaderboard = (room.phase === 'leaderboard' || room.phase === 'reveal' || room.phase === 'ended')
    ? boardFor(room)
    : null;
  return view;
}

/** The host sees everything — that is the whole point of the control panel. */
export function hostView(room) {
  const view = baseView(room);
  view.isHost = true;
  view.log = room.log.slice(0, 40);
  view.cases = Object.fromEntries(
    room.patients.map((slot) => {
      const kase = getCase(slot.id);
      return [slot.id, { ...privatePatientFile(kase), answer: revealAnswer(kase) }];
    }),
  );
  view.submissions = Object.fromEntries(
    Object.entries(room.submissions).map(([playerId, s]) => [playerId, { ...s }]),
  );
  view.scores = Object.fromEntries(
    Object.entries(room.scores).map(([playerId, s]) => [playerId, { ...s }]),
  );
  view.resubmitAllowed = { ...room.resubmitAllowed };
  view.finalSubmissions = { ...room.final.submissions };
  view.finalScores = { ...room.final.scores };
  view.finalAnswer = FINAL_PATIENT.answer;
  view.leaderboard = boardFor(room);
  view.revealed = revealedBundle(room);
  return view;
}

// ── crash-recovery snapshots ────────────────────────────────────────────────
//  Rooms live in memory. A snapshot on disk means a server restart mid-class
//  (a crash, a redeploy, an accidental Ctrl-C) does not end the game — every
//  doctor's browser reconnects and finds its identity and patient intact.

const snapshotFile = () => path.join(config.dataDir, 'rooms.json');

export function saveSnapshot() {
  if (!config.persist) return;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const payload = {
      version: 1,
      savedAt: now(),
      rooms: [...rooms.values()].map((room) => ({
        ...room,
        hostSocketId: null,
        hostConnected: false,
        players: [...room.players.values()].map((p) => ({
          ...p, socketId: null, connected: false,
        })),
      })),
    };
    fs.writeFileSync(`${snapshotFile()}.tmp`, JSON.stringify(payload));
    fs.renameSync(`${snapshotFile()}.tmp`, snapshotFile());
  } catch (err) {
    console.error('[snapshot] failed to write:', err.message);
  }
}

export function loadSnapshot() {
  if (!config.persist) return 0;
  try {
    if (!fs.existsSync(snapshotFile())) return 0;
    const raw = JSON.parse(fs.readFileSync(snapshotFile(), 'utf8'));
    if (raw?.version !== 1 || !Array.isArray(raw.rooms)) return 0;

    let restored = 0;
    for (const saved of raw.rooms) {
      if (!saved?.code || now() - (saved.touchedAt ?? 0) > config.roomTtlMs) continue;
      const room = {
        ...saved,
        players: new Map(saved.players.map((p) => [p.id, p])),
        hostSocketId: null,
        hostConnected: false,
      };
      // Patient content may have changed between versions; keep only ids we know.
      if (!Array.isArray(room.patients) || room.patients.length !== PATIENTS.length) {
        room.patients = freshPatientSlots();
      }
      // A timer cannot survive downtime meaningfully — freeze it instead.
      if (room.timer?.running) {
        room.timer.remainingMs = Math.max(0, (room.timer.endsAt ?? 0) - now());
        room.timer.running = false;
        room.timer.endsAt = null;
      }
      rooms.set(room.code, room);
      restored += 1;
    }
    return restored;
  } catch (err) {
    console.error('[snapshot] failed to read:', err.message);
    return 0;
  }
}

export const roomCount = () => rooms.size;
export const allRooms = () => [...rooms.values()];
export { PHASE_IDS };
