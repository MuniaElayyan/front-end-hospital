/**
 * host.js — the Chief of Medicine's control panel.
 *
 * The host is the only client that sees the answer key, other people's
 * submissions and the scoring controls — and it sees them because the SERVER
 * sends a different projection to this socket, not because the UI hides things.
 */

import {
  socket, send, saveSession, loadSession, clearSession,
  joinUrl, hostUrl, consumeUrlParams, copyToClipboard,
} from './net.js';
import {
  $, el, mount, toast, toastError, installConnectionBanner, createClock,
  emptyState, ecgStrip, pad2, patientLabel, statTile, confirmDialog,
} from './ui.js';
import { renderEvidence } from './evidence.js';
import { play, soundToggleButton } from './sound.js';
import { celebrateBig } from './confetti.js';
import { strobe } from './cinematic.js';

installConnectionBanner();
$('#tb-sound').append(soundToggleButton());

const stage = $('#stage');
const clock = createClock({ onZero: () => play('timeup') });

let session = loadSession();
let state = null;
let tab = 'ward';

/* ── boot ────────────────────────────────────────────────────────────────── */

/**
 * A host link (/host?room=FH-4827&key=…) always wins over whatever this browser
 * had stored. That link is what makes the host role portable: it can be opened
 * on a different laptop, on a phone, or in a private window, and control of the
 * running room moves there. consumeUrlParams() wipes the token out of the
 * address bar immediately after reading it.
 */
const fromLink = consumeUrlParams();
if (fromLink.room && fromLink.key) {
  session = { role: 'host', roomCode: fromLink.room, hostToken: fromLink.key };
}

/**
 * Runs on EVERY connect, not just the first. Socket.IO hands us a brand new
 * socket after a drop and the server has no idea who it is until we present the
 * host token again — without this, a host who loses Wi-Fi for ten seconds comes
 * back as a spectator with dead buttons.
 */
socket.on('connect', async () => {
  if (session?.role === 'host' && session.hostToken) {
    try {
      await send('host:resume', { roomCode: session.roomCode, hostToken: session.hostToken });
      saveSession(session);
      if (state) toast('Reconnected — you still have control.', 'success');
      return;
    } catch {
      toast(`Room ${session.roomCode} is no longer open on this server.`, 'warn', 7000);
      clearSession();
      session = null;
      state = null;
    }
  }
  // No room yet. Deliberately do NOT create one automatically: on a public URL
  // that would mean every curious visitor silently spawns a room, and it would
  // hide the moment a code comes into existence from the person who has to
  // read it out.
  showCreateScreen();
});

socket.on('connect_error', () => {
  if (!state) showConnectingScreen(true);
});
socket.on('disconnect', () => {
  if (!state) showConnectingScreen(true);
});

/** Shown before the first connect — and on a free host, during the ~50s wake. */
function showConnectingScreen(slow = false) {
  mount(stage, el('div', { class: 'panel center screen', style: { padding: '56px 20px', maxWidth: '560px', margin: '0 auto' } },
    el('div', { class: 'spinner', style: { margin: '0 auto 18px' } }),
    el('h3', { text: slow ? 'Waking the hospital server…' : 'Connecting…' }),
    el('p', { class: 'dim', style: { maxWidth: '42ch', margin: '0 auto' },
      text: slow
        ? 'Free hosting puts the server to sleep when nobody is using it. The first visit takes up to a minute to wake it — this page will continue on its own.'
        : 'Reaching the emergency room.' })));
}
showConnectingScreen();

function showCreateScreen() {
  const codeInput = el('input', {
    class: 'input input--code', placeholder: 'FH-0000', maxlength: '8',
    inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false',
  });
  const keyInput = el('input', {
    class: 'input mono', style: { fontSize: '.8rem' }, placeholder: 'host key',
    autocomplete: 'off', spellcheck: 'false',
  });
  const error = el('div', { class: 'field__error' });

  const createBtn = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    text: '🏥  CREATE GAME',
    onClick: async () => {
      createBtn.disabled = true;
      createBtn.textContent = 'OPENING THE ER…';
      try {
        await createRoom();
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = '🏥  CREATE GAME';
      }
    },
  });

  mount(stage, el('div', { class: 'screen', style: { maxWidth: '520px', margin: '0 auto', display: 'grid', gap: 'var(--gap)' } },

    el('div', { class: 'panel panel--accent center' },
      el('div', { class: 'eyebrow', text: 'Chief of Medicine' }),
      el('h1', { style: { fontSize: 'clamp(1.4rem,4vw,2rem)', margin: '.2rem 0 .4rem' }, text: 'Open an Emergency Room' }),
      el('p', { class: 'dim', style: { margin: '0 0 18px' },
        text: 'You get a room code and a join link to share. Up to 12 doctors can connect from anywhere.' }),
      ecgStrip(),
      createBtn),

    el('div', { class: 'panel' },
      el('div', { class: 'panel__title', style: { marginBottom: '10px' }, text: 'Already running a room?' }),
      el('p', { class: 'mute', style: { fontSize: '.86rem', marginTop: 0 },
        text: 'Paste the host key from your other device to take control of a room that is already open.' }),
      el('div', { class: 'stack', style: { gap: '8px' } },
        codeInput,
        keyInput,
        error,
        el('button', {
          class: 'btn btn--block',
          text: 'Take control',
          onClick: async (e) => {
            const roomCode = codeInput.value.replace(/\D/g, '').slice(0, 4);
            const hostToken = keyInput.value.trim();
            error.textContent = '';
            if (roomCode.length !== 4 || !hostToken) {
              error.textContent = 'Enter the 4-digit room code and the host key.';
              return;
            }
            e.currentTarget.disabled = true;
            try {
              await send('host:resume', { roomCode: `FH-${roomCode}`, hostToken });
              session = { role: 'host', roomCode: `FH-${roomCode}`, hostToken };
              saveSession(session);
              toast('You now control this room.', 'success');
            } catch (err) {
              error.textContent = err.message;
              e.currentTarget.disabled = false;
            }
          },
        }))),

    el('p', { class: 'mute center', style: { fontSize: '.8rem' },
      text: 'Students never come here — send them the join link instead.' })));
}

async function createRoom() {
  try {
    const reply = await send('host:create', {});
    session = { role: 'host', roomCode: reply.roomCode, hostToken: reply.hostToken };
    saveSession(session);
    play('monitor');
  } catch (err) {
    toastError(err);
    throw err;
  }
}

/* ── incoming ────────────────────────────────────────────────────────────── */

socket.on('state', (next) => {
  const prev = state;
  state = next;
  paintTopbar();
  clock.update(state.timer);
  if (prev && state.players.length > prev.players.length) play('join');
  render();
});

socket.on('fx', (payload) => {
  switch (payload?.type) {
    case 'claim': play('monitor'); break;
    case 'submitted': play('submit'); break;
    case 'all-admitted': play('reveal'); toast('All 12 patients admitted.', 'success'); break;
    case 'time-up': play('timeup'); break;
    case 'confetti': celebrateBig(); break;
    default: break;
  }
});

socket.on('error:game', (p) => toast(p?.message ?? 'Error', 'error'));

/* ── top bar ─────────────────────────────────────────────────────────────── */

function paintTopbar() {
  $('#tb-room').textContent = state.code;
  $('#tb-phase').textContent = `${state.phaseMeta.number}. ${state.phaseMeta.label}`;
  $('#tb-phase').className = `badge ${state.paused ? 'badge--warn' : 'badge--live'}`;
  $('#tb-count').textContent = `${state.players.filter((p) => p.connected).length} / ${state.limits.max}`;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const act = async (event, payload = {}, okMessage) => {
  try {
    const reply = await send(event, payload);
    if (okMessage) toast(okMessage, 'success');
    return reply;
  } catch (err) { toastError(err); throw err; }
};

const playerById = (id) => state.players.find((p) => p.id === id);
const patientById = (id) => state.patients.find((p) => p.id === id);
const patientNumber = (id) => patientById(id)?.number ?? 0;

/* ── layout ──────────────────────────────────────────────────────────────── */

function render() {
  if (!state) return;
  mount(stage, el('div', { class: 'host-grid screen' }, sidebar(), main()));
}

/* ── sidebar ─────────────────────────────────────────────────────────────── */

function sidebar() {
  return el('aside', { class: 'host-side' },
    roomCard(),
    phaseRail(),
    timerCard(),
    dangerCard());
}

function roomCard() {
  const link = joinUrl(state.code);
  const connected = state.players.filter((p) => p.connected).length;

  const copyBtn = (label, value) => el('button', {
    class: 'btn btn--sm btn--ghost',
    text: label,
    onClick: async (e) => {
      const ok = await copyToClipboard(value);
      e.currentTarget.textContent = ok ? 'Copied ✓' : 'Copy failed';
      setTimeout(() => { e.currentTarget.textContent = label; }, 1500);
      if (ok) play('click');
    },
  });

  return el('div', { class: 'panel panel--accent' },
    el('div', { class: 'eyebrow', text: 'Room code' }),
    el('div', { class: 'roomcode__value', style: { display: 'block', marginBottom: '4px' }, text: state.code }),
    el('p', { class: 'mute', style: { fontSize: '.8rem', margin: '0 0 12px' }, text: 'Share this code with your doctors.' }),

    el('div', { class: 'field', style: { marginBottom: '10px' } },
      el('label', { class: 'label', text: 'Join link' }),
      el('input', { class: 'input mono', style: { fontSize: '.76rem' }, readonly: true, value: link, onClick: (e) => e.currentTarget.select() })),

    el('div', { class: 'row-tight' }, copyBtn('Copy link', link), copyBtn('Copy code', state.code)),

    el('div', { class: 'divider' }),

    // The host's own escape hatch. Kept collapsed because it must never be
    // pasted into the class chat by mistake — whoever opens it becomes host.
    el('details', {},
      el('summary', { style: { cursor: 'pointer', fontSize: '.78rem', fontWeight: '700', color: 'var(--amber)' },
        text: '🔑 Host key — keep private' }),
      el('p', { class: 'mute', style: { fontSize: '.76rem', margin: '8px 0' },
        text: 'Open this link on another device to move control of THIS room there. Anyone who has it becomes the host — do not share it with students.' }),
      session?.hostToken
        ? el('div', { class: 'stack', style: { gap: '6px' } },
          el('input', {
            class: 'input mono', style: { fontSize: '.68rem' }, readonly: true,
            value: hostUrl(state.code, session.hostToken),
            onClick: (e) => e.currentTarget.select(),
          }),
          el('div', { class: 'row-tight' },
            copyBtn('Copy host link', hostUrl(state.code, session.hostToken)),
            copyBtn('Copy key only', session.hostToken)))
        : el('p', { class: 'mute', style: { fontSize: '.76rem' }, text: 'Unavailable in this session.' })),

    el('div', { class: 'divider' }),

    el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
      el('span', { class: 'label', text: 'Doctors connected' }),
      el('span', { class: 'mono', style: { fontWeight: '800', color: 'var(--cyan)' }, text: `${connected} / ${state.limits.max}` })),
    el('div', { class: 'meter' },
      el('div', { class: 'meter__fill', style: { width: `${(connected / state.limits.max) * 100}%` } })));
}

function phaseRail() {
  const order = ['lobby', 'alert', 'selection', 'diagnosis', 'conference', 'reveal', 'leaderboard', 'final'];
  const meta = {
    lobby: ['Waiting Room', 'Doctors check in'],
    alert: ['Emergency Alert', 'Plays the cinematic'],
    selection: ['Patient Selection', 'Claim one patient each'],
    diagnosis: ['Diagnosis', 'Private files + reports'],
    conference: ['Medical Conference', 'Present one by one'],
    reveal: ['Reveal', 'Show correct answers'],
    leaderboard: ['Leaderboard', 'Top doctors'],
    final: ['Final Patient', 'Everyone, one patient'],
  };
  const currentIdx = order.indexOf(state.phase);

  return el('div', { class: 'panel' },
    el('div', { class: 'panel__title', style: { marginBottom: '10px' }, text: 'Game phases' }),
    el('div', { class: 'rail' },
      order.map((id, i) => el('button', {
        class: `rail__item${id === state.phase ? ' is-current' : ''}${i < currentIdx ? ' is-done' : ''}`,
        onClick: () => goToPhase(id),
      },
      el('span', { class: 'rail__num', text: String(i + 1) }),
      el('span', { style: { flex: '1' } },
        el('span', { class: 'rail__label', style: { display: 'block' }, text: meta[id][0] }),
        el('span', { class: 'rail__hint', text: meta[id][1] })),
      i < currentIdx ? el('span', { text: '✓' }) : null))),

    el('div', { class: 'row-tight', style: { marginTop: '12px' } },
      el('button', {
        class: `btn btn--sm ${state.paused ? 'btn--success' : 'btn--ghost'}`,
        text: state.paused ? '▶ Resume game' : '⏸ Pause game',
        onClick: () => act('host:pause', { paused: !state.paused }),
      })));
}

async function goToPhase(phase) {
  if (phase === 'alert' && state.players.length < state.limits.min) {
    toast(`You need at least ${state.limits.min} doctors to start.`, 'warn');
    return;
  }
  if (phase === 'alert') {
    const ok = await confirmDialog({
      title: 'Start the emergency?',
      body: `${state.players.length} doctors are connected. The alert cinematic will play on every screen.`,
      confirmText: 'START EMERGENCY',
      danger: true,
    });
    if (!ok) return;
    play('alert');
  }
  try { await send('host:phase', { phase }); } catch (err) { toastError(err); }
}

function timerCard() {
  const presets = [
    { label: '1 min', seconds: 60 },
    { label: '3 min', seconds: 180 },
    { label: '5 min', seconds: 300 },
    { label: '10 min', seconds: 600 },
  ];
  const custom = el('input', { class: 'input', type: 'number', min: '5', max: '3600', value: '600', style: { width: '92px' } });
  const labelInput = el('input', { class: 'input', placeholder: 'Timer label', value: defaultTimerLabel(), style: { fontSize: '.84rem' } });

  return el('div', { class: 'panel' },
    el('div', { class: 'panel__title', style: { marginBottom: '10px' }, text: 'Shared timer' }),
    state.timer?.running || state.timer?.remainingMs
      ? el('div', { style: { marginBottom: '12px', textAlign: 'center' } }, clock.node)
      : el('p', { class: 'mute', style: { fontSize: '.82rem' }, text: 'Not running. Every device shows the same countdown.' }),

    el('div', { class: 'row-tight', style: { marginBottom: '8px' } },
      presets.map((p) => el('button', {
        class: 'btn btn--sm btn--ghost',
        text: p.label,
        onClick: () => act('host:timer', { action: 'start', seconds: p.seconds, label: labelInput.value }),
      }))),

    labelInput,

    el('div', { class: 'row-tight', style: { marginTop: '8px' } },
      custom,
      el('button', {
        class: 'btn btn--sm btn--primary', text: 'Start',
        onClick: () => act('host:timer', { action: 'start', seconds: Number(custom.value), label: labelInput.value }),
      })),

    el('div', { class: 'row-tight', style: { marginTop: '8px' } },
      el('button', { class: 'btn btn--sm btn--ghost', text: '+30s', onClick: () => act('host:timer', { action: 'add', seconds: 30 }) }),
      el('button', { class: 'btn btn--sm btn--ghost', text: '−30s', onClick: () => act('host:timer', { action: 'add', seconds: -30 }) }),
      el('button', {
        class: 'btn btn--sm btn--ghost',
        text: state.timer?.running ? 'Pause' : 'Resume',
        onClick: () => act('host:timer', { action: state.timer?.running ? 'pause' : 'resume' }),
      }),
      el('button', { class: 'btn btn--sm btn--ghost', text: 'Stop', onClick: () => act('host:timer', { action: 'stop' }) })));
}

function defaultTimerLabel() {
  return {
    selection: 'Patient selection closes in',
    diagnosis: 'Diagnosis time remaining',
    conference: 'Presenting',
    final: 'Final patient',
  }[state.phase] ?? 'Time remaining';
}

function dangerCard() {
  return el('div', { class: 'panel panel--danger' },
    el('div', { class: 'panel__title', style: { marginBottom: '10px', color: 'var(--red)' }, text: 'Game control' }),
    el('div', { class: 'stack', style: { gap: '8px' } },
      el('button', {
        class: 'btn btn--sm btn--ghost btn--block', text: '🎉 Fire confetti',
        onClick: () => act('host:celebrate'),
      }),
      el('button', {
        class: 'btn btn--sm btn--ghost btn--block', text: '🔄 Restart (keep doctors)',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Restart the game?',
            body: 'Patients, diagnoses and scores are wiped. Everyone stays in the room.',
            confirmText: 'Restart', danger: true,
          });
          if (ok) act('host:restart', { keepPlayers: true }, 'Game restarted.');
        },
      }),
      el('button', {
        class: 'btn btn--sm btn--ghost btn--block', text: '🧹 Restart (clear room)',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Clear the whole room?',
            body: 'Every doctor is removed and has to join again.',
            confirmText: 'Clear room', danger: true,
          });
          if (ok) act('host:restart', { keepPlayers: false }, 'Room cleared.');
        },
      }),
      el('button', {
        class: 'btn btn--sm btn--danger btn--block', text: '🏁 End game',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'End the shift?',
            body: 'Everyone sees the closing screen. This cannot be undone.',
            confirmText: 'End game', danger: true,
          });
          if (ok) act('host:end');
        },
      })));
}

/* ── main column ─────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'ward', label: '🛏 Ward' },
  { id: 'doctors', label: '👨‍⚕️ Doctors' },
  { id: 'reports', label: '📋 Reports & scoring' },
  { id: 'reveal', label: '💡 Reveal' },
  { id: 'board', label: '🏆 Leaderboard' },
  { id: 'final', label: '🚨 Final patient' },
  { id: 'log', label: '📜 Log' },
];

function main() {
  const bar = el('div', { class: 'tabs', style: { marginBottom: 'var(--gap)' } },
    TABS.map((t) => el('button', {
      class: `tab${t.id === tab ? ' is-active' : ''}`,
      text: t.label,
      onClick: () => { tab = t.id; render(); },
    })));

  const views = {
    ward: wardView,
    doctors: doctorsView,
    reports: reportsView,
    reveal: revealView,
    board: boardView,
    final: finalView,
    log: logView,
  };

  return el('section', {},
    headline(),
    // The conference is driven from a panel rather than a tab, so the running
    // order stays on screen no matter which tab the host is reading.
    state.phase === 'conference' ? conferencePanel() : null,
    state.phase === 'conference' ? el('div', { style: { height: 'var(--gap)' } }) : null,
    bar,
    (views[tab] ?? wardView)());
}

function headline() {
  const startable = state.phase === 'lobby';
  return el('div', { class: 'panel', style: { marginBottom: 'var(--gap)' } },
    el('div', { class: 'row' },
      el('div', { style: { flex: '1', minWidth: '220px' } },
        el('div', { class: 'eyebrow', text: `Phase ${state.phaseMeta.number} · ${state.phaseMeta.label}` }),
        el('h2', { style: { margin: '0 0 2px' }, text: state.phaseMeta.hint }),
        el('div', { class: 'mute', style: { fontSize: '.84rem' },
          text: `${state.assignedCount}/${state.totalPatients} patients admitted · ${Object.keys(state.submissions).length} diagnoses submitted` })),
      startable
        ? el('button', {
          class: 'btn btn--danger btn--lg',
          disabled: state.players.length < state.limits.min,
          text: '🚨 START EMERGENCY',
          onClick: () => goToPhase('alert'),
        })
        : el('button', {
          class: 'btn btn--primary',
          text: 'Next phase →',
          onClick: () => {
            const order = ['lobby', 'alert', 'selection', 'diagnosis', 'conference', 'reveal', 'leaderboard', 'final'];
            const next = order[order.indexOf(state.phase) + 1];
            if (next) goToPhase(next);
          },
        })),
    state.players.length < state.limits.min && startable
      ? el('p', { class: 'mute', style: { margin: '10px 0 0', fontSize: '.84rem' },
        text: `Waiting for at least ${state.limits.min} doctors (currently ${state.players.length}).` })
      : null,
    ecgStrip({ danger: state.phase === 'final' }));
}

/* ── tab: ward ───────────────────────────────────────────────────────────── */

function wardView() {
  return el('div', { class: 'stack' },
    el('div', { class: 'panel' },
      el('div', { class: 'panel__head' },
        el('h3', { style: { margin: 0 }, text: 'Ward overview' }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'badge badge--cyan mono', text: `${state.assignedCount} / ${state.totalPatients}` }),
        el('button', {
          class: `btn btn--sm ${state.rules.selectionLocked ? 'is-on' : 'btn--ghost'}`,
          text: state.rules.selectionLocked ? '🔒 Selection locked' : '🔓 Lock selection',
          onClick: () => act('host:rules', { selectionLocked: !state.rules.selectionLocked }),
        }),
        el('button', {
          class: `btn btn--sm ${state.rules.allowRechoose ? 'is-on' : 'btn--ghost'}`,
          text: state.rules.allowRechoose ? '↺ Re-picking allowed' : '↺ Allow re-picking',
          onClick: () => act('host:rules', { allowRechoose: !state.rules.allowRechoose }),
        })),

      el('div', { class: 'ward' },
        state.patients.map((p, i) => hostPatientCard(p, i)))));
}

function hostPatientCard(p, index) {
  const owner = p.takenBy ? playerById(p.takenBy) : null;
  const submitted = owner ? Boolean(state.submissions[owner.id]) : false;
  const kase = state.cases?.[p.id];

  return el('div', {
    class: `pcard ${p.takenBy ? 'pcard--taken' : 'pcard--available'}`,
    style: { '--i': index },
  },
  el('div', { class: 'row', style: { justifyContent: 'space-between' } },
    el('span', { class: 'pcard__num', text: patientLabel(p.number) }),
    p.revealed ? el('span', { class: 'badge badge--violet', text: 'REVEALED' }) : null),
  el('div', { class: 'pcard__status', text: p.takenBy ? '🔒 ASSIGNED' : '🟢 AVAILABLE' }),

  el('div', { class: 'pcard__classified', style: { fontFamily: 'var(--font-ui)', letterSpacing: 'normal' } },
    owner
      ? el('div', { style: { textAlign: 'center' } },
        el('div', { style: { fontSize: '1.3rem' } }, '👨‍⚕️'),
        el('strong', { text: owner.name }),
        el('div', { class: 'mute', style: { fontSize: '.72rem' }, text: submitted ? 'Diagnosis submitted ✓' : 'Not submitted' }))
      : el('span', { class: 'mute', text: 'Waiting' })),

  el('div', { class: 'row-tight' },
    el('button', {
      class: 'btn btn--sm btn--ghost',
      style: { flex: '1' },
      text: 'File',
      onClick: () => showCase(kase, p.number),
    }),
    p.takenBy
      ? el('button', {
        class: 'btn btn--sm btn--ghost',
        text: 'Reset',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Reset ${patientLabel(p.number)}?`,
            body: `${owner?.name ?? 'The assigned doctor'} loses this patient and their diagnosis.`,
            confirmText: 'Reset patient', danger: true,
          });
          if (ok) act('host:resetPatient', { patientId: p.id });
        },
      })
      : null));
}

function showCase(kase, number) {
  if (!kase) return;
  const overlay = el('div', {
    class: 'overlay',
    onClick: (e) => { if (e.target === overlay) overlay.remove(); },
  },
  el('div', { class: 'panel overlay__card', style: { width: 'min(860px,100%)' } },
    el('div', { class: 'panel__head' },
      el('div', {},
        el('div', { class: 'eyebrow', text: kase.patientType }),
        el('h3', { style: { margin: 0 }, text: `${patientLabel(number)} — ${kase.answer.title}` })),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--sm btn--ghost', text: 'Close', onClick: () => overlay.remove() })),

    el('h4', { text: 'Symptoms' }),
    el('ul', { class: 'symptoms' }, kase.symptoms.map((s) => el('li', { text: s }))),

    el('h4', { style: { marginTop: '18px' }, text: 'Evidence' }),
    renderEvidence(kase.evidence),

    el('h4', { style: { marginTop: '18px' }, text: 'Answer key' }),
    el('div', { class: 'answer-block' }, el('h4', { text: 'Diagnosis' }), el('p', { text: kase.answer.diagnosis })),
    el('div', { class: 'answer-block' }, el('h4', { text: 'Cause' }), el('p', { text: kase.answer.cause })),
    el('div', { class: 'answer-block' }, el('h4', { text: 'Treatment' }), el('p', { text: kase.answer.treatment }))));
  document.body.append(overlay);
}

/* ── tab: doctors ────────────────────────────────────────────────────────── */

function doctorsView() {
  if (!state.players.length) {
    return el('div', { class: 'panel' }, emptyState('🧑‍⚕️', 'No doctors have joined yet. Share the room code.'));
  }
  return el('div', { class: 'panel panel--flush' },
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', { text: '#' }), el('th', { text: 'Doctor' }), el('th', { text: 'Status' }),
          el('th', { text: 'Patient' }), el('th', { text: 'Diagnosis' }), el('th', { text: 'Score' }),
          el('th', { text: 'Actions' }))),
        el('tbody', {}, state.players.map((p) => {
          const score = state.scores[p.id];
          const canEdit = state.rules.allowResubmit || state.resubmitAllowed[p.id];
          return el('tr', {},
            el('td', { class: 'mono', text: pad2(p.doctorNumber) }),
            el('td', {}, el('strong', { text: p.name })),
            el('td', {}, p.connected
              ? el('span', { class: 'badge badge--live' }, el('span', { class: 'dot' }), 'Online')
              : el('span', { class: 'badge badge--warn', text: 'Away' })),
            el('td', { class: 'mono', text: p.patientId ? pad2(patientNumber(p.patientId)) : '—' }),
            el('td', {}, p.submitted
              ? el('span', { class: 'badge badge--live', text: 'Submitted' })
              : el('span', { class: 'badge', text: '—' })),
            el('td', { class: 'mono', text: score?.gradedAt ? `${score.total}` : '—' }),
            el('td', {}, el('div', { class: 'row-tight' },
              el('button', {
                class: `btn btn--sm ${canEdit ? 'is-on' : 'btn--ghost'}`,
                text: canEdit ? 'Editing open' : 'Re-open',
                onClick: () => act('host:resubmit', { playerId: p.id, allowed: !canEdit }),
              }),
              el('button', {
                class: 'btn btn--sm btn--ghost',
                text: 'Remove',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `Remove Doctor ${p.name}?`,
                    body: 'Their patient is freed and their work is deleted.',
                    confirmText: 'Remove', danger: true,
                  });
                  if (ok) act('host:kick', { playerId: p.id });
                },
              }))));
        })))));
}

/* ── tab: reports & scoring ──────────────────────────────────────────────── */

function reportsView() {
  const entries = Object.values(state.submissions)
    .sort((a, b) => patientNumber(a.patientId) - patientNumber(b.patientId));

  if (!entries.length) {
    return el('div', { class: 'panel' }, emptyState('📋', 'No diagnoses submitted yet.'));
  }

  return el('div', { class: 'stack' },
    el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('span', { class: 'badge badge--cyan', text: `${entries.length} SUBMITTED` }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: `btn btn--sm ${state.rules.allowResubmit ? 'is-on' : 'btn--ghost'}`,
          text: state.rules.allowResubmit ? '🔓 Everyone can edit' : '🔒 Editing locked',
          onClick: () => act('host:rules', { allowResubmit: !state.rules.allowResubmit }),
        }))),
    entries.map((s) => reportCard(s)));
}

function reportCard(submission) {
  const player = playerById(submission.playerId);
  if (!player) return null;
  const kase = state.cases[submission.patientId];
  const score = state.scores[player.id] ?? {};

  const pointRow = (rule) => {
    const buttons = [];
    for (let v = 0; v <= rule.max; v += 1) {
      buttons.push(el('button', {
        class: (score[rule.key] ?? 0) === v ? 'is-on' : '',
        text: String(v),
        onClick: () => act('host:score', { playerId: player.id, [rule.key]: v }),
      }));
    }
    return el('div', { class: 'scorebox__row' },
      el('span', { class: 'label', text: rule.label }),
      el('div', { class: 'pointsel' }, buttons));
  };

  const noteInput = el('input', { class: 'input', placeholder: 'Feedback for this doctor (optional)', value: score.note ?? '' });
  noteInput.addEventListener('change', () => act('host:score', { playerId: player.id, note: noteInput.value }));

  const suggestBtn = el('button', {
    class: 'btn btn--sm btn--ghost',
    text: '✨ Suggest score',
    onClick: async () => {
      try {
        const reply = await send('host:suggestScore', { playerId: player.id });
        const s = reply.suggestion;
        await act('host:score', {
          playerId: player.id,
          diagnosis: s.diagnosis, cause: s.cause, treatment: s.treatment, explanation: s.explanation,
        });
        toast(`Suggested ${s.total}/20 — coverage ${reply.signals.coverage.diagnosis}/${reply.signals.coverage.cause}/${reply.signals.coverage.treatment}%. Adjust as you see fit.`, 'info', 6500);
      } catch (err) { toastError(err); }
    },
  });

  return el('div', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('div', {},
        el('div', { class: 'eyebrow', text: `${patientLabel(patientNumber(submission.patientId))} · ${kase?.patientType ?? ''}` }),
        el('h3', { style: { margin: 0 }, text: `👨‍⚕️ Doctor ${player.name}` })),
      el('span', { class: 'spacer' }),
      el('span', { class: 'badge', text: `Confidence ${submission.confidence}%` }),
      score.gradedAt
        ? el('span', { class: 'badge badge--live', text: `${score.total} / ${state.limits.maxScore}` })
        : el('span', { class: 'badge badge--warn', text: 'UNGRADED' })),

    el('div', { style: { display: 'grid', gap: 'var(--gap)', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' } },
      el('div', {},
        el('div', { class: 'answer-block answer-block--doctor' },
          el('h4', { text: 'Their diagnosis' }), el('p', { text: submission.diagnosis })),
        el('div', { class: 'answer-block answer-block--doctor' },
          el('h4', { text: 'Their cause' }), el('p', { text: submission.cause })),
        el('div', { class: 'answer-block answer-block--doctor' },
          el('h4', { text: 'Their treatment' }), el('p', { text: submission.treatment }))),

      el('div', {},
        el('details', { style: { marginBottom: '12px' } },
          el('summary', { style: { cursor: 'pointer', color: 'var(--green)', fontWeight: '700' }, text: 'Show answer key' }),
          el('div', { style: { marginTop: '10px' } },
            el('div', { class: 'answer-block' }, el('h4', { text: 'Diagnosis' }), el('p', { text: kase?.answer.diagnosis ?? '' })),
            el('div', { class: 'answer-block' }, el('h4', { text: 'Cause' }), el('p', { text: kase?.answer.cause ?? '' })),
            el('div', { class: 'answer-block' }, el('h4', { text: 'Treatment' }), el('p', { text: kase?.answer.treatment ?? '' })))),

        el('div', { class: 'scorebox' },
          state.rubric.map(pointRow),
          el('div', { class: 'scorebox__row' },
            el('span', { class: 'label', text: 'Bonus' }),
            el('div', { class: 'row-tight' },
              [-5, 0, 5].map((v) => el('button', {
                class: `btn btn--sm ${(score.bonus ?? 0) === v ? 'is-on' : 'btn--ghost'}`,
                text: v > 0 ? `+${v}` : String(v),
                onClick: () => act('host:score', { playerId: player.id, bonus: v }),
              })))),
          noteInput,
          el('div', { class: 'row-tight' },
            suggestBtn,
            el('button', {
              class: `btn btn--sm ${score.approved === true ? 'btn--success' : 'btn--ghost'}`,
              text: '✓ Approve',
              onClick: () => act('host:score', { playerId: player.id, approved: true }),
            }),
            el('button', {
              class: `btn btn--sm ${score.approved === false ? 'btn--danger' : 'btn--ghost'}`,
              text: '✗ Reject',
              onClick: () => act('host:score', { playerId: player.id, approved: false }),
            }))))));
}

/* ── tab: reveal ─────────────────────────────────────────────────────────── */

function revealView() {
  return el('div', { class: 'stack' },
    el('div', { class: 'panel' },
      el('div', { class: 'panel__head' },
        el('h3', { style: { margin: 0 }, text: 'Reveal control' }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn btn--primary',
          text: '💡 REVEAL ALL DIAGNOSES',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Reveal every diagnosis?',
              body: 'All 12 answer keys become visible to every doctor at once.',
              confirmText: 'Reveal all',
            });
            if (ok) { act('host:reveal', { mode: 'all' }); play('reveal'); }
          },
        })),
      el('p', { class: 'mute', style: { fontSize: '.86rem' },
        text: 'Reveal one patient at a time to walk the class through the cases, or reveal everything at once.' }),

      el('div', { class: 'stack', style: { gap: '8px' } },
        state.patients.map((p) => {
          const owner = p.takenBy ? playerById(p.takenBy) : null;
          return el('div', { class: 'roster__item' },
            el('div', { class: 'roster__avatar', text: p.revealed ? '💡' : '🔒' }),
            el('div', { style: { flex: '1', minWidth: '0' } },
              el('div', { class: 'roster__name', text: `${patientLabel(p.number)} — ${state.cases?.[p.id]?.answer.title ?? ''}` }),
              el('div', { class: 'roster__meta', text: owner ? `Doctor ${owner.name}` : 'Unassigned' })),
            el('button', {
              class: `btn btn--sm ${p.revealed ? 'is-on' : 'btn--ghost'}`,
              text: p.revealed ? 'Revealed' : 'Reveal',
              onClick: () => { act('host:reveal', { mode: 'one', patientId: p.id }); play('reveal'); },
            }));
        }))));
}

/* ── tab: leaderboard ────────────────────────────────────────────────────── */

function boardView() {
  const board = state.leaderboard ?? [];
  const graded = board.filter((r) => r.graded).length;

  return el('div', { class: 'stack' },
    el('div', { class: 'panel' },
      el('div', { class: 'stats' },
        statTile('Doctors', String(board.length), 'cyan'),
        statTile('Graded', `${graded}/${board.length}`, 'green'),
        statTile('Top score', String(board[0]?.total ?? 0), 'amber'),
        statTile('Average', String(board.length ? Math.round(board.reduce((s, r) => s + r.total, 0) / board.length) : 0), 'violet'))),

    el('div', { class: 'panel panel--flush' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Rank' }), el('th', { text: 'Doctor' }), el('th', { text: 'Patient' }),
            el('th', { text: 'Dx' }), el('th', { text: 'Cause' }), el('th', { text: 'Tx' }),
            el('th', { text: 'Expl.' }), el('th', { text: 'Bonus' }), el('th', { text: 'Final' }),
            el('th', { text: 'Total' }))),
          el('tbody', {}, board.map((r) => el('tr', {},
            el('td', { class: 'mono', text: r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}` }),
            el('td', {}, el('strong', { text: r.name })),
            el('td', { class: 'mono', text: r.patientId ? pad2(patientNumber(r.patientId)) : '—' }),
            el('td', { class: 'mono', text: String(r.breakdown.diagnosis) }),
            el('td', { class: 'mono', text: String(r.breakdown.cause) }),
            el('td', { class: 'mono', text: String(r.breakdown.treatment) }),
            el('td', { class: 'mono', text: String(r.breakdown.explanation) }),
            el('td', { class: 'mono', text: String(r.breakdown.bonus) }),
            el('td', { class: 'mono', text: String(r.breakdown.final) }),
            el('td', { class: 'mono', style: { color: 'var(--cyan)', fontWeight: '800' }, text: String(r.total) }))))))));
}

/* ── tab: final patient ──────────────────────────────────────────────────── */

function finalView() {
  const f = state.final;
  const subs = Object.values(state.finalSubmissions ?? {});

  return el('div', { class: 'stack' },
    el('div', { class: 'panel panel--danger' },
      el('div', { class: 'panel__head' },
        el('div', {},
          el('div', { class: 'eyebrow', style: { color: 'var(--red)' }, text: 'Phase 8' }),
          el('h3', { style: { margin: 0 }, text: 'The Final Patient' })),
        el('span', { class: 'spacer' }),
        el('button', {
          class: `btn btn--sm ${f.mode === 'team' ? 'is-on' : 'btn--ghost'}`,
          text: f.mode === 'team' ? '👥 Team mode' : '👤 Individual mode',
          onClick: () => act('host:finalMode', { mode: f.mode === 'team' ? 'individual' : 'team' }),
        }),
        el('button', {
          class: 'btn btn--danger btn--sm',
          text: f.started ? 'Restart phase 8' : '🚨 Launch final patient',
          onClick: () => { goToPhase('final'); strobe(true); setTimeout(() => strobe(false), 6000); },
        })),
      el('p', { class: 'mute', style: { fontSize: '.86rem', margin: 0 },
        text: `${f.bugCount} independent faults are planted in this one site. Start a 10-minute timer from the sidebar once everyone is in.` }),
      el('div', { class: 'row', style: { marginTop: '12px' } },
        el('span', { class: 'badge badge--cyan', text: `${subs.length} DOCTORS SUBMITTED` }),
        f.revealed
          ? el('span', { class: 'badge badge--live', text: 'ANSWERS REVEALED' })
          : el('button', {
            class: 'btn btn--sm btn--primary',
            text: '💡 Reveal the post-op report',
            onClick: () => { act('host:finalReveal', { revealed: true }); play('reveal'); },
          }))),

    subs.length
      ? el('div', { class: 'stack' }, subs.map((s) => {
        const player = playerById(s.playerId);
        const fscore = state.finalScores?.[s.playerId];
        const input = el('input', { class: 'input', type: 'number', min: '0', max: '50', style: { width: '90px' }, value: String(fscore?.total ?? s.findings.length * 2) });
        return el('div', { class: 'panel' },
          el('div', { class: 'panel__head' },
            el('h4', { style: { margin: 0 }, text: `👨‍⚕️ Doctor ${player?.name ?? '—'}` }),
            el('span', { class: 'spacer' }),
            el('span', { class: 'badge', text: `${s.findings.length} findings` }),
            input,
            el('button', {
              class: 'btn btn--sm btn--primary', text: 'Award',
              onClick: () => act('host:finalScore', { playerId: s.playerId, points: Number(input.value) }, 'Points awarded.'),
            })),
          s.findings.map((find, i) => el('div', { class: 'answer-block answer-block--doctor' },
            el('h4', { text: `Fault ${i + 1} — ${find.title}` }),
            find.cause ? el('p', {}, el('strong', {}, 'Cause: '), find.cause) : null,
            find.fix ? el('p', {}, el('strong', {}, 'Fix: '), find.fix) : null)));
      }))
      : el('div', { class: 'panel' }, emptyState('🚑', 'No findings submitted yet.')),

    el('div', { class: 'panel' },
      el('div', { class: 'panel__title', style: { marginBottom: '12px' }, text: 'Answer key — the five planted faults' }),
      (state.finalAnswer?.findings ?? []).map((find, i) => el('div', { class: 'answer-block' },
        el('h4', { text: `Fault ${i + 1} — ${find.title}` }),
        el('p', {}, el('strong', {}, 'Cause: '), find.cause),
        el('p', {}, el('strong', {}, 'Fix: '), find.fix)))));
}

/* ── tab: log ────────────────────────────────────────────────────────────── */

function logView() {
  const entries = state.log ?? [];
  return el('div', { class: 'panel' },
    el('div', { class: 'panel__title', style: { marginBottom: '12px' }, text: 'Room activity' }),
    entries.length
      ? el('div', { class: 'stack', style: { gap: '6px' } },
        entries.map((entry) => el('div', { class: 'row', style: { gap: '12px', padding: '7px 10px', borderRadius: '8px', background: 'rgba(9,17,30,.5)' } },
          el('span', { class: 'mono mute', style: { fontSize: '.75rem' }, text: new Date(entry.at).toLocaleTimeString() }),
          el('span', { style: { fontSize: '.88rem' }, text: entry.message }))))
      : emptyState('📜', 'Nothing has happened yet.'));
}

/* ── conference: a phase-specific panel, not a permanent tab ─────────────── */

function conferencePanel() {
  const { order, index, currentId } = state.conference;
  const current = order.find((o) => o.id === currentId);

  return el('div', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h3', { style: { margin: 0 }, text: '🎤 Medical Conference' }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--sm btn--ghost', text: '🔀 Shuffle order', onClick: () => act('host:conference', { action: 'shuffle' }) }),
      el('button', { class: 'btn btn--sm btn--ghost', text: '← Previous', onClick: () => act('host:conference', { action: 'prev' }) }),
      el('button', { class: 'btn btn--sm btn--primary', text: 'Next presenter →', onClick: () => act('host:conference', { action: 'next' }) })),

    current
      ? el('div', { class: 'row', style: { padding: '14px', borderRadius: '10px', background: 'rgba(61,220,151,.08)', border: '1px solid var(--green)', marginBottom: '14px' } },
        el('span', { style: { fontSize: '1.6rem' } }, '🎤'),
        el('div', { style: { flex: '1' } },
          el('strong', { style: { fontSize: '1.1rem' }, text: `Doctor ${current.name}` }),
          el('div', { class: 'mute', style: { fontSize: '.84rem' }, text: `Presenting ${patientLabel(patientNumber(current.patientId))} · ${index + 1} of ${order.length}` })),
        el('button', {
          class: 'btn btn--sm btn--primary',
          text: '⏱ 60s',
          onClick: () => act('host:timer', { action: 'start', seconds: 60, label: `Dr ${current.name} presenting` }),
        }))
      : el('p', { class: 'mute', text: 'No presenter selected.' }),

    el('div', { class: 'stack', style: { gap: '6px' } },
      order.map((o, i) => el('button', {
        class: `rail__item${o.id === currentId ? ' is-current' : ''}`,
        onClick: () => act('host:conference', { action: 'goto', index: i }),
      },
      el('span', { class: 'rail__num', text: String(i + 1) }),
      el('span', { style: { flex: '1' } },
        el('span', { class: 'rail__label', style: { display: 'block' }, text: o.name }),
        el('span', { class: 'rail__hint', text: `Patient ${pad2(patientNumber(o.patientId))}` })),
      state.conference.presented.includes(o.id) ? el('span', { text: '✓' }) : null))));
}
