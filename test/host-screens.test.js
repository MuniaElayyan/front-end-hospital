/**
 * Host control panel tests — same technique as screens.test.js, but fed the
 * server's `hostView` instead of `playerView`.
 *
 * The point worth proving here is the asymmetry: the host projection carries
 * the answer key, every submission and the scoring controls, and the panel
 * actually surfaces them.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { parseHTML } from 'linkedom';

process.env.PERSIST = 'false';

let R;
let handlers;
let doc;

function fakeSocket() {
  handlers = new Map();
  const add = (event, fn) => {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  };
  return {
    on: add,
    once: add,
    off: () => {},
    emit: (_event, payload, ack) => {
      if (typeof ack === 'function') ack({ ok: true });
      if (typeof payload === 'function') payload({ ok: true });
    },
    close() {},
  };
}

const fire = (event, payload) => (handlers.get(event) ?? []).forEach((fn) => fn(payload));

const SHELL = `
  <header class="topbar">
    <span id="tb-room"></span><span id="tb-phase"></span>
    <span id="tb-count"></span><span id="tb-sound"></span>
  </header>
  <main id="stage"></main>`;

before(async () => {
  const dom = parseHTML(`<!doctype html><html><body>${SHELL}</body></html>`);
  doc = dom.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.Node = dom.Node;
  globalThis.HTMLElement = dom.HTMLElement;
  dom.window.location = { origin: 'http://localhost:3000', pathname: '/host', search: '' };
  globalThis.location = dom.window.location;

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
  dom.window.matchMedia = globalThis.matchMedia;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.io = () => fakeSocket();

  R = await import('../server/game/rooms.js');
  await import('../public/js/host.js');

  room = R.createRoom({ hostName: 'Chief' });
  players = ['Munia', 'Ahmad'].map((name) => R.joinRoom(room.code, name).player);
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.exit(0);
});

let room;
let players;

const paint = () => { fire('state', R.hostView(room)); return doc.getElementById('stage'); };

test('the lobby offers START EMERGENCY and shows the shareable link', () => {
  const stage = paint();
  assert.match(doc.getElementById('tb-room').textContent, /^FH-\d{4}$/);
  assert.equal(doc.getElementById('tb-count').textContent, '2 / 12');

  assert.match(stage.textContent, /START EMERGENCY/);
  assert.match(stage.textContent, /Share this code with your doctors/);

  const linkField = [...stage.querySelectorAll('input')].find((i) => i.value?.includes('/join/'));
  assert.ok(linkField, 'a copyable join link is rendered');
  assert.equal(linkField.value, `http://localhost:3000/join/${room.code}`);
});

test('the phase rail lists all eight phases and marks the current one', () => {
  const stage = paint();
  const rail = stage.querySelectorAll('.rail__item');
  assert.equal(rail.length, 8);
  assert.equal(stage.querySelectorAll('.rail__item.is-current').length, 1);
  assert.match(stage.querySelector('.rail__item.is-current').textContent, /Waiting Room/);
});

test('the ward tab shows every patient and the host-only answer titles', () => {
  R.setPhase(room, 'selection');
  R.claimPatient(room, players[0], 'p04');
  const stage = paint();

  assert.equal(stage.querySelectorAll('.pcard').length, 12);
  assert.equal(stage.querySelectorAll('.pcard--taken').length, 1);
  assert.match(stage.querySelector('.pcard--taken').textContent, /Munia/);
  assert.match(stage.textContent, /Lock selection/);
  assert.match(stage.textContent, /Allow re-picking/);
});

test('the reports tab surfaces submissions, the answer key and the rubric', () => {
  R.setPhase(room, 'diagnosis');
  R.submitDiagnosis(room, players[0], {
    diagnosis: 'Images 404.', cause: 'images/ vs image/.', treatment: 'Fix the path.', confidence: 90,
  });
  paint();

  // Click through to the Reports tab the way a host would.
  const tabButton = [...doc.querySelectorAll('.tab')].find((b) => /Reports/.test(b.textContent));
  assert.ok(tabButton, 'the Reports tab exists');
  tabButton.dispatchEvent(new window.Event('click'));

  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /Doctor Munia/);
  assert.match(stage.textContent, /Images 404\./, 'their answer');
  assert.match(stage.textContent, /Show answer key/, 'the key is available to the host');
  assert.match(stage.textContent, /UNGRADED/);

  // The rubric renders as 0–5 point pickers, four of them.
  assert.equal(stage.querySelectorAll('.pointsel').length, 4);
  assert.equal(stage.querySelector('.pointsel').querySelectorAll('button').length, 6);
  assert.match(stage.textContent, /Approve/);
  assert.match(stage.textContent, /Reject/);
});

test('the reveal tab lists all 12 patients with their disease names', () => {
  const tabButton = [...doc.querySelectorAll('.tab')].find((b) => /Reveal/.test(b.textContent));
  tabButton.dispatchEvent(new window.Event('click'));

  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /REVEAL ALL DIAGNOSES/);
  assert.equal(stage.querySelectorAll('.roster__item').length, 12);
  assert.match(stage.textContent, /Broken File Path/, 'host sees the answers up front');
  assert.match(stage.textContent, /Dark Mode \/ Theme Toggle Failure/);
});

test('the final-patient tab shows the five-fault answer key', () => {
  const tabButton = [...doc.querySelectorAll('.tab')].find((b) => /Final patient/.test(b.textContent));
  tabButton.dispatchEvent(new window.Event('click'));

  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /The Final Patient/);
  assert.match(stage.textContent, /the five planted faults/);
  assert.match(stage.textContent, /Add-to-cart button is dead/);
  assert.match(stage.textContent, /Individual mode/);
});

test('the conference panel appears in phase 5 regardless of the open tab', () => {
  R.setPhase(room, 'conference');
  const stage = paint();
  assert.match(stage.textContent, /Medical Conference/);
  assert.match(stage.textContent, /Next presenter/);
  assert.match(stage.textContent, /Shuffle order/);
});
