/**
 * The /host entry screen.
 *
 * Two behaviours matter here and both only show up when there is NO stored
 * session, which is exactly the state a public URL is opened in by someone who
 * has never used it before:
 *
 *   1. a visitor is offered CREATE GAME rather than having a room spawned for
 *      them — on a public deployment the old auto-create meant every stray
 *      visit created a room, and the moment a code came into existence was
 *      invisible to the person who has to read it out;
 *   2. a /host?room=…&key=… link takes control of a room that is already
 *      running, from a device that has never seen it.
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { parseHTML } from 'linkedom';

let doc;
let handlers;
let sent;

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
    emit: (event, payload, ack) => {
      sent.push({ event, payload });
      const reply = event === 'host:create'
        ? { ok: true, roomCode: 'FH-7777', hostToken: 'brand-new-token', state: null }
        : { ok: true };
      if (typeof ack === 'function') ack(reply);
      if (typeof payload === 'function') payload(reply);
    },
    close() {},
  };
}

const fire = (event, payload) => (handlers.get(event) ?? []).forEach((fn) => fn(payload));

before(async () => {
  const dom = parseHTML(`<!doctype html><html><body>
    <header class="topbar">
      <span id="tb-room"></span><span id="tb-phase"></span>
      <span id="tb-count"></span><span id="tb-sound"></span>
    </header>
    <main id="stage"></main></body></html>`);
  doc = dom.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.Node = dom.Node;
  globalThis.HTMLElement = dom.HTMLElement;

  // A brand-new visitor: empty storage, plain /host URL, no query string.
  dom.window.location = {
    href: 'http://localhost:3000/host',
    origin: 'http://localhost:3000',
    pathname: '/host',
    search: '',
  };
  globalThis.location = dom.window.location;
  dom.window.history = { replaceState() {} };

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

  sent = [];
  await import('../public/js/host.js');
});

after(async () => {
  await new Promise((r) => setTimeout(r, 50));
  process.exit(0);
});

test('before connecting, the page says it is connecting — not that it failed', () => {
  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /Connecting/);
});

test('a failed connect is reported as the server waking, not as an error', () => {
  fire('connect_error');
  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /Waking the hospital server/);
  // The wording matters: on a free tier this is the normal first-visit path,
  // and "connection failed" would send the host chasing a problem that is not
  // there.
  assert.ok(!/failed|error/i.test(stage.textContent));
  assert.match(stage.textContent, /up to a minute/);
});

test('a visitor with no room is offered CREATE GAME — no room is auto-created', () => {
  sent = [];
  fire('connect');

  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /Open an Emergency Room/);
  assert.match(stage.textContent, /CREATE GAME/);
  assert.match(stage.textContent, /Students never come here/);

  assert.equal(
    sent.filter((m) => m.event === 'host:create').length, 0,
    'connecting must NOT create a room by itself',
  );
});

test('the entry screen also offers to take over a room already running', () => {
  const stage = doc.getElementById('stage');
  assert.match(stage.textContent, /Already running a room\?/);
  assert.match(stage.textContent, /host key/i);

  const inputs = [...stage.querySelectorAll('input')];
  assert.equal(inputs.length, 2, 'a room code field and a host key field');
});

test('pressing CREATE GAME asks the server for a room', () => {
  sent = [];
  const btn = [...doc.querySelectorAll('button')].find((b) => /CREATE GAME/.test(b.textContent));
  assert.ok(btn, 'the button exists');
  btn.dispatchEvent(new window.Event('click'));

  const created = sent.filter((m) => m.event === 'host:create');
  assert.equal(created.length, 1, 'exactly one room, and only on an explicit press');
});

test('the stored session now carries the token, so a refresh keeps the room', () => {
  const saved = JSON.parse(localStorage.getItem('feh.session.v1'));
  assert.equal(saved.role, 'host');
  assert.equal(saved.roomCode, 'FH-7777');
  assert.equal(saved.hostToken, 'brand-new-token');
});
