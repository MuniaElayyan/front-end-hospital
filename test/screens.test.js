/**
 * Screen tests — the client renderers driven by REAL server projections.
 *
 * `play.js` renders from exactly one input: the `state` payload the server
 * sends. So this test builds a genuine room with the server's own room module,
 * takes the same `playerView` a browser would receive, feeds it through a fake
 * socket, and inspects the DOM that comes out. If a projection and a renderer
 * ever disagree, this is where it shows up.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { parseHTML } from 'linkedom';

process.env.PERSIST = 'false';

let R;
let handlers;
let doc;

/** A socket that goes nowhere — we drive the client by hand. */
function fakeSocket() {
  handlers = new Map();
  const add = (event, fn) => {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  };
  return {
    on: add,
    once: add,
    off: (event, fn) => {
      const list = handlers.get(event) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit: (event, payload, ack) => {
      // The client only awaits acks for actions; none are exercised here.
      if (typeof ack === 'function') ack({ ok: true });
      if (typeof payload === 'function') payload({ ok: true });
    },
    close() {},
    connect() {},
  };
}

const fire = (event, payload) => (handlers.get(event) ?? []).forEach((fn) => fn(payload));

const TOPBAR = `
  <header class="topbar">
    <span id="tb-room"></span><span id="tb-phase"></span>
    <span id="tb-me"></span><span id="tb-count"></span><span id="tb-sound"></span>
  </header>
  <main id="stage"></main>`;

before(async () => {
  const dom = parseHTML(`<!doctype html><html><body>${TOPBAR}</body></html>`);
  doc = dom.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.Node = dom.Node;
  globalThis.HTMLElement = dom.HTMLElement;

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  // Reduced motion ON: confetti and the cinematics stay out of the way, which
  // is exactly what we want when asserting on markup.
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
  dom.window.matchMedia = globalThis.matchMedia;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.io = () => fakeSocket();

  R = await import('../server/game/rooms.js');
});

after(async () => {
  // createClock() leaves a repeating interval behind, so the process would
  // otherwise hang. Give the reporter a tick to flush before pulling the plug.
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.exit(0);
});

/* ── a full room, driven through every phase ─────────────────────────────── */

function buildRoom() {
  const room = R.createRoom({ hostName: 'Chief' });
  const names = ['Munia', 'Ahmad', 'Sara'];
  const players = names.map((name) => R.joinRoom(room.code, name).player);

  R.setPhase(room, 'selection');
  R.claimPatient(room, players[0], 'p04');
  R.claimPatient(room, players[1], 'p09');
  R.claimPatient(room, players[2], 'p12');

  R.setPhase(room, 'diagnosis');
  R.submitDiagnosis(room, players[0], {
    diagnosis: 'The image paths are broken so the browser 404s.',
    cause: 'The HTML says images/ but the folder is image/.',
    treatment: 'Fix the relative path and lowercase the filenames.',
    confidence: 85,
  });
  R.setScore(room, players[0].id, {
    diagnosis: 5, cause: 5, treatment: 4, explanation: 3, approved: true, note: 'Sharp work.',
  });

  return { room, players };
}

let world;
let sessionSet = false;

async function loadClient(room, player) {
  if (!sessionSet) {
    localStorage.setItem('feh.session.v1', JSON.stringify({
      role: 'player', roomCode: room.code, playerId: player.id, token: player.token,
      savedAt: Date.now(),
    }));
    sessionSet = true;
    await import('../public/js/play.js');
  }
}

/** Push the server's real projection into the client and return #stage. */
function renderPhase(phase) {
  const { room, players } = world;
  if (room.phase !== phase) R.setPhase(room, phase);
  fire('state', R.playerView(room, players[0]));
  return doc.getElementById('stage');
}

test('the doctor station boots from a stored session', async () => {
  world = buildRoom();
  await loadClient(world.room, world.players[0]);

  // First state ever seen — no cinematic, straight to the screen.
  fire('state', R.playerView(world.room, world.players[0]));
  assert.equal(doc.getElementById('tb-room').textContent, world.room.code);
  assert.match(doc.getElementById('tb-me').textContent, /Dr\. Munia/);
  assert.match(doc.getElementById('tb-me').textContent, /P04/);
});

test('waiting room lists every doctor and the capacity', () => {
  const stage = renderPhase('lobby');
  const text = stage.textContent;
  assert.match(text, /Welcome, Doctor Munia/);
  ['Munia', 'Ahmad', 'Sara'].forEach((n) => assert.ok(text.includes(n), `${n} is on the roster`));
  assert.ok(stage.querySelector('.meter__fill'), 'capacity meter is drawn');
});

test('patient selection shows 12 cards: mine, taken, and available', () => {
  const stage = renderPhase('selection');
  const cards = stage.querySelectorAll('.pcard');
  assert.equal(cards.length, 12);

  assert.equal(stage.querySelectorAll('.pcard--mine').length, 1);
  assert.equal(stage.querySelectorAll('.pcard--taken').length, 2, 'the other two doctors');
  assert.equal(stage.querySelectorAll('.pcard--available').length, 9);

  // Nothing on the board leaks a diagnosis.
  assert.match(stage.textContent, /CLASSIFIED/);
  assert.ok(!/Broken File Path/i.test(stage.textContent));

  // The taken cards name their owner, and offer no button.
  const taken = stage.querySelector('.pcard--taken');
  assert.match(taken.textContent, /Doctor (Ahmad|Sara)/);
  assert.equal(taken.querySelector('button'), null, 'you cannot click someone else\'s patient');

  // Available cards do offer one — but it is disabled, because I hold a patient.
  const free = stage.querySelector('.pcard--available button');
  assert.equal(free.textContent, 'CHOOSE PATIENT');
  assert.ok(free.hasAttribute('disabled'), 'one patient per doctor');
});

test('the diagnosis screen shows my file, my evidence and the three fields', () => {
  const stage = renderPhase('diagnosis');

  assert.match(stage.textContent, /PATIENT #04/);
  assert.match(stage.textContent, /E-Commerce Website/);
  assert.equal(stage.querySelectorAll('.symptoms li').length, 4);
  assert.ok(stage.querySelectorAll('.ev').length >= 4, 'all four evidence blocks render');
  assert.ok(stage.querySelector('.filetree'), 'the folder tree is there');
  assert.ok(stage.querySelector('.console__line--error'), 'so is the 404');

  ['#dx', '#cs', '#tx'].forEach((sel) => assert.ok(stage.querySelector(sel), `${sel} exists`));
  assert.ok(stage.querySelector('.slider'), 'confidence slider');

  // Already submitted, so the form is locked and pre-filled.
  assert.equal(stage.querySelector('#dx').value, 'The image paths are broken so the browser 404s.');
  assert.ok(stage.querySelector('#dx').hasAttribute('disabled'));
  assert.match(stage.textContent, /SUBMITTED/);
});

test('the conference screen shows the running order and the presenter', () => {
  const { room } = world;
  const stage = renderPhase('conference');
  assert.match(stage.textContent, /Medical Conference/);
  assert.equal(room.conference.order.length, 3, 'order seeded from the assigned doctors');
  assert.match(stage.textContent, /Running order/);
  // Munia is first, so it is her turn.
  assert.match(stage.textContent, /Your turn to present/);
  assert.ok(stage.querySelector('.beacon'), 'the presenter gets the beacon');
});

test('reveal shows the answer key only for revealed patients', () => {
  const { room, players } = world;

  let stage = renderPhase('reveal');
  assert.match(stage.textContent, /about to reveal/i, 'nothing revealed yet');

  R.setReveal(room, { mode: 'one', patientId: 'p04' });
  fire('state', R.playerView(room, players[0]));
  stage = doc.getElementById('stage');

  assert.match(stage.textContent, /Broken File Path/, 'the disease is finally named');
  assert.match(stage.textContent, /while the real folder is named/, 'the model cause is shown');
  assert.match(stage.textContent, /Doctor Munia/);
  assert.match(stage.textContent, /17 \/ 20 PTS/);
  assert.match(stage.textContent, /Sharp work/);
  // Only one card — patient 09 and 12 are still sealed.
  assert.equal(stage.querySelectorAll('.answer-block').length, 6, '3 correct + 3 submitted');
  assert.ok(!/Event Listener/.test(stage.textContent), 'p09 stays hidden');
});

test('the leaderboard ranks, and shows my own card', () => {
  const stage = renderPhase('leaderboard');
  assert.match(stage.textContent, /TOP DOCTORS/);
  assert.equal(stage.querySelectorAll('.lb-row').length, 3);

  const mine = stage.querySelector('.lb-row.is-you');
  assert.ok(mine, 'my row is highlighted');
  assert.match(mine.textContent, /Munia/);
  assert.match(mine.textContent, /17/);
  assert.match(stage.textContent, /Your card/);
  assert.ok(stage.querySelector('.podium'), 'podium is drawn');
});

test('the final patient shows one shared case and a multi-fault form', () => {
  const stage = renderPhase('final');
  assert.match(stage.textContent, /THE FINAL PATIENT/);
  assert.match(stage.textContent, /5 FAULTS TO FIND/);
  assert.match(stage.textContent, /MEDCART/);
  assert.equal(stage.querySelectorAll('input.input').length, 3, 'three blank fault rows');
  assert.ok(!/assets\/img vs img/.test(stage.textContent), 'the post-op report is hidden');
});

test('a paused shift replaces the screen for everyone', () => {
  const { room, players } = world;
  R.setPaused(room, true);
  fire('state', R.playerView(room, players[0]));
  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /shift is paused/i);
  R.setPaused(room, false);
});

test('a doctor with no patient is told so rather than shown a blank screen', () => {
  const { room, players } = world;
  R.hostResetPatient(room, 'p04');
  R.setPhase(room, 'diagnosis');
  fire('state', R.playerView(room, players[0]));
  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /You have no patient/);
});
