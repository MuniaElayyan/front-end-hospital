/**
 * play.js — the doctor's station.
 *
 * One rule: this file renders whatever the server last told us, and nothing
 * else. There is no local game state to drift out of sync — `state` events are
 * the single input, and every button is a request the server may refuse.
 */

import {
  socket, send, saveSession, loadSession, clearSession,
} from './net.js';
import {
  $, el, mount, toast, toastError, installConnectionBanner, createClock,
  emptyState, ecgStrip, pad2, patientLabel, statTile, setPct, confirmDialog,
} from './ui.js';
import { renderEvidence } from './evidence.js';
import { play, soundToggleButton } from './sound.js';
import { playEmergencyAlert, announce, strobe } from './cinematic.js';
import { celebrateBig } from './confetti.js';

installConnectionBanner();
$('#tb-sound').append(soundToggleButton());

const stage = $('#stage');

let session = loadSession();
let state = null;
let lastPhase = null;
let seenClaims = new Set();
const clock = createClock({ onZero: () => play('timeup') });

if (!session || session.role !== 'player') {
  window.location.replace('/join');
}

socket.on('connect_error', () => {
  if (state) return; // already in the game; the connection banner covers it
  mount(stage, el('div', { class: 'panel center', style: { padding: '48px 20px' } },
    el('div', { class: 'spinner', style: { margin: '0 auto 18px' } }),
    el('h3', { text: 'Reaching the hospital…' }),
    el('p', { class: 'dim', style: { maxWidth: '44ch', margin: '0 auto' },
      text: 'This can take up to a minute the first time, while the server wakes up. Keep this page open — it will continue by itself.' })));
});

// Runs on EVERY connect. A reconnect gives us a fresh socket the server does
// not recognise, so the identity has to be re-presented each time — that is
// what makes a refresh, a sleeping phone or a dropped hotspot a non-event.
// If it fails outright (room closed, kicked, server wiped) → back to join.
socket.on('connect', async () => {
  try {
    const reply = await send('player:resume', {
      roomCode: session.roomCode,
      playerId: session.playerId,
      token: session.token,
    });
    session = { ...session, ...reply, role: 'player' };
    saveSession(session);
  } catch (err) {
    clearSession();
    toast(err.message, 'error');
    setTimeout(() => window.location.replace('/join'), 1400);
  }
});

socket.on('kicked', ({ message }) => {
  clearSession();
  toast(message, 'error');
  setTimeout(() => window.location.replace('/join'), 1500);
});

/* ── incoming state ──────────────────────────────────────────────────────── */

socket.on('state', (next) => {
  const prev = state;
  state = next;
  paintTopbar();
  clock.update(state.timer);

  // Phase transitions drive the cinematics.
  if (state.phase !== lastPhase) {
    const first = lastPhase === null;
    lastPhase = state.phase;
    if (!first && state.phase === 'alert') {
      playEmergencyAlert({ onDone: render });
      return;
    }
    if (!first && state.phase === 'final') {
      strobe(true);
      announce({ lines: ['🚨🚨🚨  EMERGENCY  🚨🚨🚨', 'THE FINAL PATIENT'] });
      setTimeout(() => strobe(false), 9000);
    }
    if (!first && state.phase === 'leaderboard') {
      play('fanfare');
      celebrateBig();
    }
  }

  // A patient we did not have before is now taken → flash it.
  if (prev) {
    state.patients.forEach((p) => {
      const before = prev.patients.find((q) => q.id === p.id);
      if (p.takenBy && !before?.takenBy) seenClaims.add(p.id);
    });
  }

  render();
});

socket.on('fx', (payload) => {
  switch (payload?.type) {
    case 'toast': toast(payload.message, payload.level ?? 'info'); break;
    case 'claim': play('monitor'); break;
    case 'all-admitted': play('reveal'); break;
    case 'submitted': play('submit'); break;
    case 'reveal': play('reveal'); break;
    case 'your-turn': play('yourturn'); toast('It is your turn to present!', 'success', 7000); break;
    case 'time-up': play('timeup'); toast('Time is up.', 'warn'); break;
    case 'confetti': celebrateBig(); play('fanfare'); break;
    case 'restart': toast('The host restarted the game.', 'warn'); break;
    default: break;
  }
});

socket.on('error:game', (payload) => toast(payload?.message ?? 'Something went wrong.', 'error'));

/* ── top bar ─────────────────────────────────────────────────────────────── */

function paintTopbar() {
  $('#tb-room').textContent = state.code;
  $('#tb-phase').textContent = `${state.phaseMeta.number}. ${state.phaseMeta.label}`;
  $('#tb-phase').className = `badge ${state.paused ? 'badge--warn' : 'badge--live'}`;
  const me = state.you;
  $('#tb-me').textContent = `🩺 Dr. ${me.name}${me.patientId ? ` · P${pad2(patientNumber(me.patientId))}` : ''}`;
}

const patientNumber = (id) => state.patients.find((p) => p.id === id)?.number ?? 0;

/* ── router ──────────────────────────────────────────────────────────────── */

function render() {
  if (!state) return;
  if (state.paused && state.phase !== 'lobby') {
    mount(stage, pausedScreen());
    return;
  }
  const screens = {
    lobby: lobbyScreen,
    alert: waitingScreen,
    selection: selectionScreen,
    diagnosis: diagnosisScreen,
    conference: conferenceScreen,
    reveal: revealScreen,
    leaderboard: leaderboardScreen,
    final: finalScreen,
    ended: endedScreen,
  };
  mount(stage, (screens[state.phase] ?? waitingScreen)());
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function sectionHead(eyebrow, title, ...extras) {
  return el('div', { class: 'panel__head' },
    el('div', {},
      el('div', { class: 'eyebrow', text: eyebrow }),
      el('h2', { style: { margin: 0 }, text: title })),
    el('span', { class: 'spacer' }),
    ...extras);
}

function timerPanel() {
  if (!state.timer?.running && !state.timer?.remainingMs) return null;
  return el('div', { class: 'panel panel--accent', style: { textAlign: 'center' } }, clock.node);
}

function pausedScreen() {
  return el('div', { class: 'screen panel center', style: { padding: '60px 20px' } },
    el('div', { style: { fontSize: '3rem', marginBottom: '10px' } }, '⏸️'),
    el('h2', { text: 'The shift is paused' }),
    el('p', { class: 'dim', text: 'The host has paused the game. Everything you have done is safe — hold on.' }),
    ecgStrip({ flat: true }));
}

function waitingScreen() {
  return el('div', { class: 'screen panel center', style: { padding: '54px 20px' } },
    el('div', { class: 'spinner', style: { margin: '0 auto 18px' } }),
    el('h2', { text: state.phaseMeta.label }),
    el('p', { class: 'dim', text: 'Waiting for the host…' }));
}

function endedScreen() {
  return el('div', { class: 'screen panel center', style: { padding: '54px 20px' } },
    el('div', { style: { fontSize: '3rem' } }, '🏁'),
    el('h2', { text: 'Shift over' }),
    el('p', { class: 'dim', text: 'Thank you, doctor. The emergency room is closed.' }),
    el('a', { class: 'btn', href: '/', text: 'Back to reception' }));
}

/* ── PHASE 1 — waiting room ──────────────────────────────────────────────── */

function lobbyScreen() {
  const connected = state.players.filter((p) => p.connected).length;

  return el('div', { class: 'screen stack' },
    el('div', { class: 'panel center' },
      el('div', { class: 'eyebrow', text: 'Phase 1 · Waiting Room' }),
      el('h1', { style: { marginBottom: '4px' }, text: `Welcome, Doctor ${state.you.name} 👩‍⚕️` }),
      el('p', { class: 'dim', text: 'You are checked in. The chief will start the emergency shortly.' }),
      ecgStrip(),
      el('div', { class: 'roomcode', style: { marginTop: '8px' } },
        el('div', {},
          el('div', { class: 'label', text: 'Room' }),
          el('div', { class: 'roomcode__value', text: state.code })))),

    el('div', { class: 'panel' },
      sectionHead('On duty', 'Doctors connected',
        el('span', { class: 'badge badge--live' },
          el('span', { class: 'dot dot--pulse' }),
          `${connected} / ${state.limits.max}`)),
      el('div', { class: 'meter', style: { marginBottom: '14px' } },
        el('div', { class: 'meter__fill', style: { width: `${(connected / state.limits.max) * 100}%` } })),
      rosterList()),

    el('div', { class: 'panel' },
      el('div', { class: 'panel__title', style: { marginBottom: '10px' }, text: 'Your briefing' }),
      el('ul', { class: 'dim', style: { margin: 0, paddingLeft: '20px', lineHeight: '2' } },
        el('li', {}, 'Twelve patients will arrive. Each of you takes ', el('strong', { style: { color: 'var(--text)' } }, 'exactly one'), '.'),
        el('li', {}, 'First click wins. Once a patient is taken, nobody else can have them.'),
        el('li', {}, 'You will get symptoms and evidence — code, screenshots, console errors, folder structures.'),
        el('li', {}, 'Write a diagnosis, a cause and a treatment. Then defend it at the conference.'))));
}

function rosterList() {
  const rows = state.players.map((p) => el('div', {
    class: `roster__item${p.connected ? '' : ' is-offline'}${p.id === state.you.id ? ' is-you' : ''}`,
  },
  el('div', { class: 'roster__avatar', text: p.id === state.you.id ? '🫵' : '👨‍⚕️' }),
  el('div', { style: { flex: '1', minWidth: '0' } },
    el('div', { class: 'roster__name', text: p.name }),
    el('div', { class: 'roster__meta', text: `Doctor ${pad2(p.doctorNumber)}` })),
  p.connected
    ? el('span', { class: 'badge badge--live' }, el('span', { class: 'dot' }), 'Online')
    : el('span', { class: 'badge', text: 'Away' })));

  const free = Math.max(0, state.limits.max - state.players.length);
  for (let i = 0; i < Math.min(free, 4); i += 1) {
    rows.push(el('div', { class: 'roster__slot' },
      el('div', { class: 'roster__avatar', style: { opacity: '.4' }, text: '➕' }),
      el('span', { text: 'Waiting for a doctor…' })));
  }
  return el('div', { class: 'roster' }, rows);
}

/* ── PHASE 3 — patient selection ─────────────────────────────────────────── */

function selectionScreen() {
  const mine = state.you.patientId;

  return el('div', { class: 'screen stack' },
    timerPanel(),

    el('div', { class: 'panel' },
      sectionHead('Phase 3 · Triage', 'Choose your patient',
        el('span', { class: 'badge badge--cyan mono', text: `${state.assignedCount} / ${state.totalPatients} ADMITTED` })),

      mine
        ? el('div', { class: 'row', style: { padding: '12px 14px', borderRadius: '10px', background: 'rgba(41,216,240,.08)', border: '1px solid var(--cyan)' } },
          el('span', { style: { fontSize: '1.3rem' } }, '🩺'),
          el('div', { style: { flex: '1' } },
            el('strong', { text: `You are treating ${patientLabel(patientNumber(mine))}.` }),
            el('div', { class: 'mute', style: { fontSize: '.82rem' }, text: 'Waiting for the other doctors to finish triage.' })),
          state.you.canRechoose
            ? el('button', {
              class: 'btn btn--sm btn--ghost',
              text: 'Release patient',
              onClick: releasePatient,
            })
            : null)
        : el('p', { class: 'dim', style: { margin: '0 0 4px' } },
          'Every file is CLASSIFIED until it is opened. Pick one — you cannot change your mind afterwards.'),

      state.rules.selectionLocked
        ? el('div', { class: 'badge badge--warn', style: { marginTop: '10px' } }, '🔒 The host has locked selection.')
        : null,

      el('div', { class: 'ward', style: { marginTop: '16px' } },
        state.patients.map((p, i) => patientCard(p, i, mine)))),

    el('div', { class: 'panel' },
      el('div', { class: 'panel__title', style: { marginBottom: '10px' }, text: 'Ward status' }),
      el('div', { class: 'meter' },
        el('div', { class: 'meter__fill', style: { width: `${(state.assignedCount / state.totalPatients) * 100}%` } })),
      el('div', { class: 'row', style: { marginTop: '10px', justifyContent: 'space-between' } },
        el('span', { class: 'mute', style: { fontSize: '.82rem' }, text: `${state.totalPatients - state.assignedCount} patients still waiting` }),
        el('span', { class: 'mute', style: { fontSize: '.82rem' }, text: `${state.players.filter((p) => p.patientId).length} of ${state.players.length} doctors assigned` }))));
}

function patientCard(p, index, minePatientId) {
  const isMine = p.takenBy === state.you.id;
  const isTaken = Boolean(p.takenBy) && !isMine;
  const iHaveOne = Boolean(minePatientId);

  const cls = isMine ? 'pcard pcard--mine'
    : isTaken ? 'pcard pcard--taken'
      : 'pcard pcard--available';

  const justTaken = seenClaims.has(p.id) && isTaken;
  if (justTaken) setTimeout(() => seenClaims.delete(p.id), 1200);

  const status = isMine ? '🩺 YOUR PATIENT' : isTaken ? '🔒 TAKEN' : '🟢 AVAILABLE';

  const body = isTaken
    ? el('div', { class: 'pcard__classified' },
      el('div', {},
        el('div', { class: 'pcard__lock' }, '🔒'),
        el('div', { class: 'pcard__doctor', style: { justifyContent: 'center', marginTop: '6px' } },
          el('span', {}, '👨‍⚕️'),
          el('span', { text: `Doctor ${p.takenByName ?? ''}` }))))
    : el('div', { class: 'pcard__classified', text: 'CLASSIFIED' });

  const action = isMine
    ? el('div', { class: 'badge badge--cyan', style: { justifyContent: 'center' }, text: 'ADMITTED BY YOU' })
    : isTaken
      ? el('div', { class: 'badge badge--danger', style: { justifyContent: 'center' }, text: 'UNAVAILABLE' })
      : el('button', {
        class: 'btn btn--primary btn--sm btn--block',
        disabled: (iHaveOne && !state.you.canRechoose) || state.rules.selectionLocked,
        text: 'CHOOSE PATIENT',
        onClick: (e) => choosePatient(p.id, e.currentTarget),
      });

  return el('div', {
    class: `${cls}${justTaken ? ' pcard--just-taken' : ''}`,
    style: { '--i': index },
  },
  el('div', { class: 'row', style: { justifyContent: 'space-between', gap: '6px' } },
    el('span', { class: 'pcard__num', text: `🩺 ${patientLabel(p.number)}` })),
  el('div', { class: 'pcard__status', text: status }),
  body,
  action);
}

async function choosePatient(patientId, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'ADMITTING…';
  try {
    await send('patient:choose', { patientId });
    play('claim');
    toast('Patient admitted. Open their file.', 'success');
  } catch (err) {
    play('denied');
    toast(err.message, err.code === 'TAKEN' ? 'error' : 'warn');
    button.disabled = false;
    button.textContent = original;
    button.closest('.pcard')?.classList.add('shake');
    setTimeout(() => button.closest('.pcard')?.classList.remove('shake'), 500);
  }
}

async function releasePatient() {
  const ok = await confirmDialog({
    title: 'Release your patient?',
    body: 'Another doctor will be able to take them, and your diagnosis will be cleared.',
    confirmText: 'Release',
    danger: true,
  });
  if (!ok) return;
  try {
    await send('patient:release');
    toast('Patient released.', 'warn');
  } catch (err) { toastError(err); }
}

/* ── PHASE 4 — diagnosis ─────────────────────────────────────────────────── */

function diagnosisScreen() {
  if (!state.myCase) {
    return el('div', { class: 'screen panel center', style: { padding: '54px 20px' } },
      el('div', { style: { fontSize: '3rem' } }, '🕳️'),
      el('h2', { text: 'You have no patient' }),
      el('p', { class: 'dim', text: 'Selection has closed and no patient was assigned to you. Ask the host to reset a patient for you.' }));
  }
  return el('div', { class: 'screen stack' },
    timerPanel(),
    patientFilePanel(state.myCase),
    diagnosisFormPanel());
}

function patientFilePanel(file) {
  const sev = { Critical: 'danger', 'Code Blue': 'danger', Serious: 'warn', Stable: 'live' }[file.severity] ?? 'warn';

  return el('div', { class: 'panel' },
    el('div', { class: 'file__header' },
      el('div', { style: { flex: '1', minWidth: '200px' } },
        el('div', { class: 'eyebrow', text: 'Confidential patient file' }),
        el('div', { class: 'file__id', text: `🩺 PATIENT #${pad2(file.number)}` }),
        el('div', { class: 'dim', text: file.patientType })),
      el('div', { class: 'stack', style: { gap: '10px' } },
        el('span', { class: `badge badge--${sev}` },
          el('span', { class: 'dot dot--pulse' }), file.severity.toUpperCase()),
        el('div', { class: 'vitals' },
          el('div', { class: 'vital' },
            el('div', { class: 'vital__label', text: 'HR' }),
            el('div', { class: 'vital__value vital--hr', text: String(file.vitals?.heartRate ?? '—') })),
          el('div', { class: 'vital' },
            el('div', { class: 'vital__label', text: 'BP' }),
            el('div', { class: 'vital__value vital--bp', text: file.vitals?.bp ?? '—' })),
          el('div', { class: 'vital' },
            el('div', { class: 'vital__label', text: 'O₂' }),
            el('div', { class: 'vital__value vital--o2', text: `${file.vitals?.o2 ?? '—'}%` }))))),

    ecgStrip({ danger: file.severity === 'Critical' || file.severity === 'Code Blue' }),

    file.admitted ? el('p', { class: 'mute', style: { fontStyle: 'italic' }, text: file.admitted }) : null,

    el('h3', { style: { marginTop: '18px' }, text: 'Symptoms' }),
    el('ul', { class: 'symptoms' }, file.symptoms.map((s) => el('li', { text: s }))),

    el('h3', { style: { marginTop: '22px' }, text: 'Evidence' }),
    el('p', { class: 'mute', style: { fontSize: '.84rem', marginTop: '-4px' },
      text: 'Not every patient hands you the same kind of clue. Read what you were given.' }),
    renderEvidence(file.evidence));
}

function diagnosisFormPanel() {
  const submitted = state.you.submission;
  const canEdit = state.you.canEditDiagnosis;
  const draft = state.you.draft;

  const start = submitted ?? draft ?? { diagnosis: '', cause: '', treatment: '', confidence: 50 };

  const dx = el('textarea', {
    class: 'textarea', id: 'dx', maxlength: '2000', disabled: !canEdit,
    placeholder: 'What is actually wrong with this website?',
  });
  const cs = el('textarea', {
    class: 'textarea', id: 'cs', maxlength: '2000', disabled: !canEdit,
    placeholder: 'Why is it happening? Point at the exact line, file or property.',
  });
  const tx = el('textarea', {
    class: 'textarea', id: 'tx', maxlength: '2000', disabled: !canEdit,
    placeholder: 'How would you fix it? Be specific enough that another dev could apply it.',
  });
  dx.value = start.diagnosis ?? '';
  cs.value = start.cause ?? '';
  tx.value = start.treatment ?? '';

  const confVal = el('span', { class: 'mono', style: { color: 'var(--cyan)', fontWeight: '800' }, text: `${start.confidence ?? 50}%` });
  const conf = el('input', {
    class: 'slider', type: 'range', min: '0', max: '100', step: '5',
    value: String(start.confidence ?? 50), disabled: !canEdit,
  });
  setPct(conf);
  conf.addEventListener('input', () => {
    setPct(conf);
    confVal.textContent = `${conf.value}%`;
  });

  // Autosave: a phone that dies mid-sentence should not cost the student
  // their paragraph. Drafts are private — the host never sees them.
  let saveTimer = null;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      socket.emit('diagnosis:draft', {
        diagnosis: dx.value, cause: cs.value, treatment: tx.value, confidence: Number(conf.value),
      });
      savedHint.textContent = 'Draft saved';
      setTimeout(() => { savedHint.textContent = ''; }, 1600);
    }, 900);
  };
  const savedHint = el('span', { class: 'mute', style: { fontSize: '.76rem' } });
  [dx, cs, tx].forEach((t) => t.addEventListener('input', queueSave));
  conf.addEventListener('change', queueSave);

  const submitBtn = el('button', {
    class: 'btn btn--primary btn--lg', disabled: !canEdit,
    text: submitted ? 'UPDATE DIAGNOSIS' : 'SUBMIT DIAGNOSIS',
    onClick: async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'SUBMITTING…';
      try {
        await send('diagnosis:submit', {
          diagnosis: dx.value, cause: cs.value, treatment: tx.value, confidence: Number(conf.value),
        });
        play('submit');
        toast('Diagnosis filed. Well done, doctor.', 'success');
      } catch (err) {
        toastError(err);
        play('denied');
        submitBtn.disabled = false;
        submitBtn.textContent = submitted ? 'UPDATE DIAGNOSIS' : 'SUBMIT DIAGNOSIS';
      }
    },
  });

  return el('div', { class: 'panel' },
    sectionHead('Phase 4 · Your report', 'Doctor diagnosis',
      submitted
        ? el('span', { class: 'badge badge--live' }, el('span', { class: 'dot' }), `SUBMITTED · rev ${submitted.revision}`)
        : el('span', { class: 'badge badge--warn', text: 'NOT SUBMITTED' })),

    !canEdit
      ? el('div', { class: 'badge badge--warn', style: { marginBottom: '14px' } },
        '🔒 Your answer is locked. Ask the host to re-open it if you need to edit.')
      : null,

    el('div', { class: 'stack' },
      el('div', { class: 'field' },
        el('label', { for: 'dx', text: 'Diagnosis — what is wrong?' }), dx),
      el('div', { class: 'field' },
        el('label', { for: 'cs', text: 'Cause — why is it happening?' }), cs),
      el('div', { class: 'field' },
        el('label', { for: 'tx', text: 'Treatment — how would you fix it?' }), tx),
      el('div', { class: 'field' },
        el('div', { class: 'row', style: { justifyContent: 'space-between' } },
          el('label', { class: 'label', text: 'Confidence' }), confVal),
        conf),
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '6px' } },
        savedHint, submitBtn)));
}

/* ── PHASE 5 — medical conference ────────────────────────────────────────── */

function conferenceScreen() {
  const { order, currentId, index } = state.conference;
  const isMe = currentId === state.you.id;
  const current = order.find((o) => o.id === currentId);

  return el('div', { class: 'screen stack' },
    el('div', { class: `panel ${isMe ? 'beacon' : ''}`, style: { textAlign: 'center' } },
      el('div', { class: 'eyebrow', text: 'Phase 5 · Medical Conference' }),
      isMe
        ? el('div', {},
          el('h1', { style: { color: 'var(--green)' }, text: '🎤 Your turn to present.' }),
          el('p', { class: 'dim', text: 'Walk the room through your patient, the symptoms, your diagnosis, the cause and the treatment.' }))
        : el('div', {},
          el('h2', { text: current ? `Doctor ${current.name} is presenting` : 'Waiting for the host…' }),
          el('p', { class: 'dim', text: current ? `Patient ${pad2(patientNumberOf(current))} · presenter ${index + 1} of ${order.length}` : '' })),
      state.timer?.running || state.timer?.remainingMs ? clock.node : null),

    isMe && state.myCase ? presenterCard() : null,

    el('div', { class: 'panel' },
      el('div', { class: 'panel__title', style: { marginBottom: '12px' }, text: 'Running order' }),
      el('div', { class: 'roster' },
        order.map((o, i) => el('div', {
          class: `roster__item${o.id === currentId ? ' is-you' : ''}`,
          style: state.conference.presented.includes(o.id) ? { opacity: '.55' } : {},
        },
        el('div', { class: 'roster__avatar', text: o.id === currentId ? '🎤' : '👨‍⚕️' }),
        el('div', { style: { flex: '1' } },
          el('div', { class: 'roster__name', text: o.name }),
          el('div', { class: 'roster__meta', text: `Patient ${pad2(patientNumberOf(o))}` })),
        el('span', { class: 'badge', text: `#${i + 1}` }))))));
}

const patientNumberOf = (entry) => state.patients.find((p) => p.id === entry.patientId)?.number ?? 0;

function presenterCard() {
  const s = state.you.submission;
  return el('div', { class: 'panel panel--accent' },
    el('div', { class: 'panel__title', style: { marginBottom: '12px' }, text: 'Your notes — present these five things' }),
    el('ol', { style: { margin: 0, paddingLeft: '20px', lineHeight: '1.9' } },
      el('li', {}, el('strong', {}, 'Patient: '), `#${pad2(state.myCase.number)} — ${state.myCase.patientType}`),
      el('li', {}, el('strong', {}, 'Symptoms: '), state.myCase.symptoms[0]),
      el('li', {}, el('strong', {}, 'Diagnosis: '), s?.diagnosis ?? '— not submitted —'),
      el('li', {}, el('strong', {}, 'Cause: '), s?.cause ?? '—'),
      el('li', {}, el('strong', {}, 'Treatment: '), s?.treatment ?? '—')));
}

/* ── PHASE 6 — reveal ────────────────────────────────────────────────────── */

function revealScreen() {
  const revealed = Object.entries(state.revealed ?? {});
  if (!revealed.length) {
    return el('div', { class: 'screen panel center', style: { padding: '54px 20px' } },
      el('div', { style: { fontSize: '3rem' } }, '📋'),
      el('h2', { text: 'Reveal' }),
      el('p', { class: 'dim', text: 'The chief is about to reveal the correct diagnoses. Hold on…' }),
      ecgStrip());
  }

  const focus = state.reveal.mode === 'one' ? state.reveal.patientId : null;
  const list = focus
    ? revealed.filter(([id]) => id === focus)
    : revealed.sort((a, b) => (a[1].file.number - b[1].file.number));

  return el('div', { class: 'screen stack' },
    el('div', { class: 'panel center' },
      el('div', { class: 'eyebrow', text: 'Phase 6 · Reveal' }),
      el('h1', { style: { margin: 0 }, text: focus ? 'The correct diagnosis' : 'All diagnoses revealed' })),
    list.map(([, entry]) => revealCard(entry)));
}

function revealCard(entry) {
  const { file, answer, doctor, submission, score } = entry;
  const mine = doctor?.id === state.you.id;

  return el('div', { class: `panel${mine ? ' panel--accent' : ''}` },
    el('div', { class: 'panel__head' },
      el('div', {},
        el('div', { class: 'file__id', style: { fontSize: '1.3rem' }, text: `PATIENT ${pad2(file.number)}` }),
        el('div', { class: 'dim', text: file.patientType })),
      el('span', { class: 'spacer' }),
      el('span', { class: 'badge badge--violet', text: answer.title })),

    el('div', { class: 'answer-block' },
      el('h4', { text: 'Correct diagnosis' }), el('p', { text: answer.diagnosis })),
    el('div', { class: 'answer-block' },
      el('h4', { text: 'Correct cause' }), el('p', { text: answer.cause })),
    el('div', { class: 'answer-block' },
      el('h4', { text: 'Correct treatment' }), el('p', { text: answer.treatment })),

    doctor
      ? el('div', { style: { marginTop: '18px' } },
        el('div', { class: 'row', style: { marginBottom: '10px' } },
          el('span', { style: { fontSize: '1.2rem' } }, mine ? '🫵' : '👨‍⚕️'),
          el('strong', { text: `Doctor ${doctor.name}` }),
          mine ? el('span', { class: 'badge badge--cyan', text: 'YOU' }) : null,
          el('span', { class: 'spacer' }),
          score
            ? el('span', { class: `badge ${score.total >= 15 ? 'badge--live' : score.total >= 8 ? 'badge--warn' : 'badge--danger'}`, text: `${score.total} / ${state.limits.maxScore} PTS` })
            : el('span', { class: 'badge', text: 'NOT SCORED' })),
        submission
          ? el('div', {},
            el('div', { class: 'answer-block answer-block--doctor' },
              el('h4', { text: 'Their diagnosis' }), el('p', { text: submission.diagnosis })),
            el('div', { class: 'answer-block answer-block--doctor' },
              el('h4', { text: 'Their cause' }), el('p', { text: submission.cause })),
            el('div', { class: 'answer-block answer-block--doctor' },
              el('h4', { text: 'Their treatment' }), el('p', { text: submission.treatment })))
          : el('p', { class: 'mute', text: 'No diagnosis was submitted for this patient.' }),
        score ? scoreBreakdown(score) : null)
      : el('p', { class: 'mute', text: 'No doctor was assigned to this patient.' }));
}

function scoreBreakdown(score) {
  const rows = state.rubric.map((r) => {
    const v = score[r.key] ?? 0;
    return el('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' } },
      el('span', { text: `${v >= r.max ? '✓' : v > 0 ? '~' : '✗'} ${r.label}` }),
      el('span', { class: 'mono', style: { color: v > 0 ? 'var(--green)' : 'var(--text-mute)', fontWeight: '800' }, text: `+${v}` }));
  });
  if (score.bonus) {
    rows.push(el('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0' } },
      el('span', { text: 'Bonus' }),
      el('span', { class: 'mono', style: { fontWeight: '800', color: 'var(--amber)' }, text: `${score.bonus > 0 ? '+' : ''}${score.bonus}` })));
  }
  return el('div', { class: 'scorebox', style: { marginTop: '12px' } },
    ...rows,
    score.note ? el('p', { class: 'mute', style: { margin: '6px 0 0', fontStyle: 'italic' }, text: `“${score.note}”` }) : null);
}

/* ── PHASE 7 — leaderboard ───────────────────────────────────────────────── */

function leaderboardScreen() {
  const board = state.leaderboard ?? [];
  const me = board.find((r) => r.playerId === state.you.id);
  const top3 = board.slice(0, 3);

  return el('div', { class: 'screen stack' },
    el('div', { class: 'panel center' },
      el('div', { class: 'eyebrow', text: 'Phase 7 · Results' }),
      el('h1', { style: { margin: '0 0 4px' }, text: '🏆 TOP DOCTORS' }),
      el('p', { class: 'dim', text: 'Scored by the chief of medicine.' })),

    top3.length
      ? el('div', { class: 'podium' },
        [top3[1], top3[0], top3[2]].map((row, i) => {
          const place = [2, 1, 3][i];
          if (!row) return el('div');
          return el('div', { class: `podium__slot podium__slot--${place}` },
            el('div', { class: 'podium__medal', text: ['🥇', '🥈', '🥉'][place - 1] }),
            el('div', { class: 'podium__name', text: row.name }),
            el('div', { class: 'mute', style: { fontSize: '.74rem' }, text: `Doctor ${pad2(row.doctorNumber)}` }),
            el('div', { class: 'podium__pts', text: `${row.total} pts` }));
        }))
      : null,

    me
      ? el('div', { class: 'panel panel--accent' },
        el('div', { class: 'panel__title', style: { marginBottom: '12px' }, text: 'Your card' }),
        el('div', { class: 'stats' },
          statTile('Rank', `#${me.rank}`, 'cyan'),
          statTile('Score', `${me.total}`, 'green'),
          statTile('Accuracy', me.accuracy === null ? '—' : `${me.accuracy}%`, 'amber'),
          statTile('Patients solved', String(me.solved), 'violet')))
      : null,

    el('div', { class: 'panel' },
      el('div', { class: 'panel__title', style: { marginBottom: '12px' }, text: 'Full standings' }),
      el('div', { class: 'stack', style: { gap: '8px' } },
        board.map((row, i) => el('div', {
          class: `lb-row${row.playerId === state.you.id ? ' is-you' : ''}`,
          style: { animationDelay: `${i * 45}ms` },
        },
        el('div', { class: 'lb-row__rank', text: row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : `#${row.rank}` }),
        el('div', { style: { minWidth: '0' } },
          el('div', { style: { fontWeight: '700' } }, row.name,
            row.playerId === state.you.id ? el('span', { class: 'badge badge--cyan', style: { marginLeft: '8px' }, text: 'YOU' }) : null),
          el('div', { class: 'lb-row__sub', text: `Patient ${row.patientId ? pad2(patientNumber(row.patientId)) : '—'} · accuracy ${row.accuracy === null ? '—' : `${row.accuracy}%`}` })),
        el('div', { class: 'lb-row__pts', text: `${row.total}` }))))));
}

/* ── PHASE 8 — final patient ─────────────────────────────────────────────── */

function finalScreen() {
  const f = state.final;
  if (!f.case) return waitingScreen();

  const submitted = state.you.finalSubmission;

  return el('div', { class: 'screen stack' },
    el('div', { class: 'panel panel--danger center' },
      el('div', { class: 'eyebrow', style: { color: 'var(--red)' }, text: 'Phase 8 · Code Blue' }),
      el('h1', { style: { margin: '0 0 4px', color: 'var(--red)' }, text: 'THE FINAL PATIENT' }),
      el('p', { class: 'dim', style: { margin: 0 }, text: 'Every doctor works on this one. Find as many faults as you can.' }),
      el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } },
        el('span', { class: 'badge badge--danger', text: `${f.bugCount} FAULTS TO FIND` }),
        el('span', { class: 'badge', text: f.mode === 'team' ? 'TEAM MODE' : 'INDIVIDUAL MODE' }),
        el('span', { class: 'badge badge--cyan', text: `${f.submittedCount} SUBMITTED` })),
      ecgStrip({ danger: true }),
      state.timer?.running || state.timer?.remainingMs ? clock.node : null),

    patientFilePanel(f.case),

    f.revealed ? finalAnswerPanel(f.answer) : finalFormPanel(submitted));
}

function finalFormPanel(submitted) {
  const rows = [];
  const listNode = el('div', { class: 'stack' });

  function addRow(preset = {}, index = rows.length) {
    const title = el('input', { class: 'input', placeholder: `Fault ${index + 1} — what is broken?`, maxlength: '160' });
    const cause = el('textarea', { class: 'textarea', style: { minHeight: '70px' }, placeholder: 'Why? (file, line, property…)', maxlength: '600' });
    const fix = el('textarea', { class: 'textarea', style: { minHeight: '70px' }, placeholder: 'How would you fix it?', maxlength: '600' });
    title.value = preset.title ?? '';
    cause.value = preset.cause ?? '';
    fix.value = preset.fix ?? '';

    const entry = { title, cause, fix };
    rows.push(entry);

    const card = el('div', { class: 'panel', style: { background: 'rgba(9,17,30,.5)', padding: '14px' } },
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
        el('span', { class: 'badge badge--cyan', text: `FAULT ${rows.length}` }),
        el('button', {
          class: 'btn btn--ghost btn--sm', text: 'Remove',
          onClick: () => { card.remove(); const i = rows.indexOf(entry); if (i >= 0) rows.splice(i, 1); },
        })),
      el('div', { class: 'stack', style: { gap: '8px' } }, title, cause, fix));

    listNode.append(card);
  }

  const preset = submitted?.findings?.length ? submitted.findings : [{}, {}, {}];
  preset.forEach((p, i) => addRow(p, i));

  const submitBtn = el('button', {
    class: 'btn btn--danger btn--lg',
    text: submitted ? 'UPDATE FINDINGS' : 'SUBMIT FINDINGS',
    onClick: async () => {
      submitBtn.disabled = true;
      try {
        await send('final:submit', {
          findings: rows.map((r) => ({ title: r.title.value, cause: r.cause.value, fix: r.fix.value })),
        });
        play('submit');
        toast('Findings filed.', 'success');
      } catch (err) { toastError(err); }
      submitBtn.disabled = false;
    },
  });

  return el('div', { class: 'panel' },
    sectionHead('Your findings', 'Operate',
      submitted ? el('span', { class: 'badge badge--live', text: `${submitted.findings.length} SUBMITTED` }) : null),
    listNode,
    el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '14px' } },
      el('button', { class: 'btn btn--ghost btn--sm', text: '+ Add another fault', onClick: () => addRow() }),
      submitBtn));
}

function finalAnswerPanel(answer) {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { style: { margin: 0 }, text: 'Post-op report' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'badge badge--live', text: `${answer.findings.length} FAULTS` })),
    answer.findings.map((f, i) => el('div', { class: 'answer-block' },
      el('h4', { text: `Fault ${i + 1} — ${f.title}` }),
      el('p', { style: { marginBottom: '6px' } }, el('strong', {}, 'Cause: '), f.cause),
      el('p', {}, el('strong', {}, 'Fix: '), f.fix))));
}
