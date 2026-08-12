/**
 * Deployment / networking tests.
 *
 * Everything else in test/ drives the game logic in-process. This file does
 * something different: it SPAWNS the real `node server/index.js`, exactly as a
 * hosting platform would, and then talks to it the way a remote browser does —
 * over a non-loopback network interface, with a foreign Origin header, from
 * clients that share no storage with each other.
 *
 * What that proves, and what it does not:
 *   ✔ the server binds 0.0.0.0, so it is reachable on a real interface and not
 *     only on localhost — this is the difference between working in a container
 *     and being refused by the platform router
 *   ✔ cross-origin sockets connect (CORS is not going to bite after deploy)
 *   ✔ many independent clients share one room in real time
 *   ✘ it does NOT prove anything about the public internet, NAT, or a mobile
 *     carrier. Only a real deployment proves that. See the report.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';

import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3477;

/** A routable IPv4 on this machine — deliberately NOT 127.0.0.1. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

const LAN = lanAddress();
const BASE = `http://${LAN ?? '127.0.0.1'}:${PORT}`;

/** A browser that is NOT the one serving the app — exercises the CORS path. */
const FOREIGN_ORIGIN = 'https://front-end-hospital.onrender.com';

let child;

const test = (name, fn) => nodeTest(name, { timeout: 25_000 }, fn);

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PERSIST: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => console.error('[server]', String(d).trim()));

  // Wait for the process to actually accept requests.
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 250));
  }
});

after(async () => {
  child?.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 120));
  process.exit(0);
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * A fresh client. `forceNew` guarantees its own transport, and no two clients
 * here share storage or identity — the same isolation two physical devices have.
 */
const device = (opts = {}) => new Promise((resolve, reject) => {
  const socket = ioClient(BASE, {
    transports: opts.transports ?? ['websocket'],
    forceNew: true,
    extraHeaders: { Origin: FOREIGN_ORIGIN },
    timeout: 15000,
  });
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', reject);
});

const rpc = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 12000);
  socket.emit(event, payload, (reply) => {
    clearTimeout(timer);
    if (reply?.ok) resolve(reply);
    else reject(Object.assign(new Error(reply?.message ?? 'failed'), { code: reply?.code }));
  });
});

const waitForState = (socket, predicate, ms = 10000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off('state', onState); reject(new Error('no matching state')); }, ms);
  function onState(state) {
    if (!predicate(state)) return;
    clearTimeout(timer);
    socket.off('state', onState);
    resolve(state);
  }
  socket.on('state', onState);
});

const closeAll = (...s) => s.flat().forEach((x) => (x?.socket ?? x)?.close?.());

/* ═══ Test 0 — the binding itself ═══════════════════════════════════════════ */

test('Test 0 · the server binds a real interface, not just localhost', async () => {
  assert.ok(LAN, 'this machine has a routable IPv4 to test against');

  // Reached over the LAN address. If server/index.js bound 127.0.0.1 — the
  // classic "works on my machine, refused in the container" bug — this fails.
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  console.log(`      reached the server on ${BASE} (not loopback)`);
});

test('Test 0b · every entry URL is served, in every shape a link gets pasted', async () => {
  const paths = [
    '/', '/host', '/join', '/play',
    '/host?room=FH-1234&key=abc',       // host recovery link
    '/join/FH-4827',                    // pretty path
    '/join?room=FH-4827',               // the query form
    '/join?code=FH-4827',               // legacy form
    '/socket.io/socket.io.js',          // the client library, self-hosted
  ];
  for (const p of paths) {
    const res = await fetch(`${BASE}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
  }
});

/* ═══ Tests 1–14 ════════════════════════════════════════════════════════════ */

test('Test 1 · a host opens /host and creates a room', async () => {
  const host = await device();
  const reply = await rpc(host, 'host:create', {});
  assert.match(reply.roomCode, /^FH-\d{4}$/);
  assert.ok(reply.hostToken?.length > 20, 'a secret host token is issued');
  assert.equal(reply.state.phase, 'lobby');
  closeAll(host);
});

test('Test 2 · Doctor 1 joins from a separate client', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});

  const d1 = await device();
  const joined = await rpc(d1, 'player:join', { name: 'Munia', roomCode });
  assert.equal(joined.state.you.name, 'Munia');
  assert.equal(joined.state.players.length, 1);
  closeAll(host, d1);
});

test('Test 3 · Doctor 2 joins and both see each other', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});
  const d1 = await device();
  await rpc(d1, 'player:join', { name: 'Munia', roomCode });

  const d1Sees = waitForState(d1, (s) => s.players.length === 2);
  const d2 = await device();
  await rpc(d2, 'player:join', { name: 'Ahmad', roomCode });

  const state = await d1Sees;
  assert.deepEqual(state.players.map((p) => p.name).sort(), ['Ahmad', 'Munia']);
  closeAll(host, d1, d2);
});

test('Test 4 · 12 doctors from 12 independent clients share one room', async () => {
  const host = await device();
  const { roomCode, hostToken } = await rpc(host, 'host:create', {});

  const doctors = [];
  for (let i = 1; i <= 12; i += 1) {
    const s = await device();
    doctors.push({ s, ...(await rpc(s, 'player:join', { name: `Doctor${i}`, roomCode })) });
  }

  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  assert.equal(state.players.length, 12);
  assert.equal(new Set(state.players.map((p) => p.id)).size, 12, 'twelve distinct identities');

  // The 13th is refused — the room is capped, not silently over-filled.
  const extra = await device();
  await assert.rejects(
    () => rpc(extra, 'player:join', { name: 'Thirteen', roomCode }),
    (e) => e.code === 'ROOM_FULL',
  );

  closeAll(host, extra, doctors.map((d) => d.s));
});

test('Test 5 · two doctors grab the same patient at once — one wins', async () => {
  const host = await device();
  const { roomCode, hostToken } = await rpc(host, 'host:create', {});
  const d1 = await device();
  const d2 = await device();
  await rpc(d1, 'player:join', { name: 'Racer1', roomCode });
  await rpc(d2, 'player:join', { name: 'Racer2', roomCode });
  await rpc(host, 'host:phase', { phase: 'selection' });

  const results = await Promise.allSettled([
    rpc(d1, 'patient:choose', { patientId: 'p04' }),
    rpc(d2, 'patient:choose', { patientId: 'p04' }),
  ]);

  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1, 'exactly one doctor holds patient 04');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, 'TAKEN');
  assert.match(lost[0].reason.message, /already taken/i);

  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  assert.equal(state.patients.filter((p) => p.takenBy).length, 1);
  closeAll(host, d1, d2);
});

test('Test 6 · a phase change reaches every doctor', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});
  const docs = [];
  for (const name of ['A1', 'B2', 'C3']) {
    const s = await device();
    await rpc(s, 'player:join', { name, roomCode });
    docs.push(s);
  }

  const watching = docs.map((s) => waitForState(s, (st) => st.phase === 'selection'));
  await rpc(host, 'host:phase', { phase: 'selection' });
  const states = await Promise.all(watching);
  states.forEach((s) => assert.equal(s.phase, 'selection'));
  closeAll(host, docs);
});

test('Test 7 · the timer arrives as one identical deadline everywhere', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});
  const docs = [];
  for (const name of ['T1', 'T2', 'T3']) {
    const s = await device();
    await rpc(s, 'player:join', { name, roomCode });
    docs.push(s);
  }

  const watching = docs.map((s) => waitForState(s, (st) => st.timer?.running));
  await rpc(host, 'host:timer', { action: 'start', seconds: 600, label: 'Diagnosis' });
  const states = await Promise.all(watching);

  const deadlines = states.map((s) => s.timer.endsAt);
  assert.equal(new Set(deadlines).size, 1, 'one instant, shared by all clients');
  assert.ok(states.every((s) => s.timer.remainingMs > 590_000));
  closeAll(host, docs);
});

test('Test 8 · a submitted diagnosis reaches the host', async () => {
  const host = await device();
  const { roomCode, hostToken } = await rpc(host, 'host:create', {});
  const d1 = await device();
  const d2 = await device();
  const p1 = await rpc(d1, 'player:join', { name: 'Layla', roomCode });
  await rpc(d2, 'player:join', { name: 'Filler', roomCode });

  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(d1, 'patient:choose', { patientId: 'p04' });
  await rpc(host, 'host:phase', { phase: 'diagnosis' });

  const hostSees = waitForState(host, (s) => Object.keys(s.submissions ?? {}).length === 1);
  await rpc(d1, 'diagnosis:submit', {
    diagnosis: 'Broken image paths', cause: 'images/ vs image/', treatment: 'Fix the src', confidence: 80,
  });

  const state = await hostSees;
  const sub = state.submissions[p1.playerId];
  assert.equal(sub.diagnosis, 'Broken image paths');
  assert.equal(sub.patientId, 'p04');
  closeAll(host, d1, d2);
});

test('Test 9 · a reveal reaches the students', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});
  const d1 = await device();
  const d2 = await device();
  await rpc(d1, 'player:join', { name: 'Reader', roomCode });
  const w = await rpc(d2, 'player:join', { name: 'Watcher', roomCode });
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(d1, 'patient:choose', { patientId: 'p12' });

  // Before the reveal, nobody has the answer.
  const before = (await rpc(d2, 'player:resume', {
    roomCode, playerId: w.playerId, token: w.token,
  })).state;
  assert.ok(before.patients.some((p) => p.takenBy), 'the claim is visible to others');
  assert.deepEqual(before.revealed, {}, 'but no answer key is');

  const bothSee = [d1, d2].map((s) => waitForState(s, (st) => Boolean(st.revealed?.p12)));
  await rpc(host, 'host:reveal', { mode: 'one', patientId: 'p12' });
  const states = await Promise.all(bothSee);

  states.forEach((s) => {
    assert.equal(s.revealed.p12.answer.title, 'Dark Mode / Theme Toggle Failure');
    assert.ok(s.revealed.p12.answer.treatment.length > 20);
  });
  closeAll(host, d1, d2);
});

test('Test 10 · the leaderboard updates for everyone', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});
  const d1 = await device();
  const d2 = await device();
  const p1 = await rpc(d1, 'player:join', { name: 'Ann', roomCode });
  await rpc(d2, 'player:join', { name: 'Ben', roomCode });
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(d1, 'patient:choose', { patientId: 'p01' });
  await rpc(host, 'host:phase', { phase: 'leaderboard' });

  const bothSee = [d1, d2].map((s) => waitForState(s, (st) => st.leaderboard?.[0]?.total === 20));
  await rpc(host, 'host:score', {
    playerId: p1.playerId, diagnosis: 5, cause: 5, treatment: 5, explanation: 5,
  });
  const states = await Promise.all(bothSee);

  states.forEach((s) => {
    const ann = s.leaderboard.find((r) => r.name === 'Ann');
    assert.equal(ann.total, 20);
    assert.equal(ann.rank, 1);
  });
  closeAll(host, d1, d2);
});

test('Test 11 · a student refreshes and loses nothing', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});
  const d1 = await device();
  const d2 = await device();
  const me = await rpc(d1, 'player:join', { name: 'Persist', roomCode });
  await rpc(d2, 'player:join', { name: 'Filler', roomCode });

  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(d1, 'patient:choose', { patientId: 'p07' });
  await rpc(host, 'host:phase', { phase: 'diagnosis' });
  await rpc(d1, 'diagnosis:submit', {
    diagnosis: 'Huge images', cause: 'no compression', treatment: 'webp + lazy', confidence: 75,
  });

  // A refresh = the old socket dies, a brand new one presents the same token.
  d1.close();
  await new Promise((r) => setTimeout(r, 200));
  const reopened = await device();
  const { state } = await rpc(reopened, 'player:resume', {
    roomCode, playerId: me.playerId, token: me.token,
  });

  assert.equal(state.you.name, 'Persist');
  assert.equal(state.you.patientId, 'p07');
  assert.equal(state.you.submission.diagnosis, 'Huge images');
  assert.equal(state.phase, 'diagnosis');
  assert.equal(state.myCase.id, 'p07', 'the private file comes back too');
  closeAll(host, d2, reopened);
});

test('Test 12 · a dropped connection recovers on its own', async () => {
  const host = await device();
  const { roomCode, hostToken } = await rpc(host, 'host:create', {});
  const d1 = await device();
  const d2 = await device();
  const me = await rpc(d1, 'player:join', { name: 'Flaky', roomCode });
  await rpc(d2, 'player:join', { name: 'Steady', roomCode });
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(d1, 'patient:choose', { patientId: 'p03' });

  // Simulate the network vanishing, the way a phone entering a lift does.
  d1.io.engine.close();
  await new Promise((r) => setTimeout(r, 400));

  // The server marks them away but keeps their seat AND their patient.
  const away = (await rpc(host, 'host:resume', { roomCode, hostToken })).state;
  const flaky = away.players.find((p) => p.name === 'Flaky');
  assert.equal(flaky.connected, false, 'shown as away');
  assert.equal(flaky.patientId, 'p03', 'patient still reserved while away');

  // Socket.IO reconnects by itself; the client then re-presents its token.
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('never reconnected')), 15000);
    if (d1.connected) { clearTimeout(t); resolve(); return; }
    d1.once('connect', () => { clearTimeout(t); resolve(); });
  });
  const { state } = await rpc(d1, 'player:resume', {
    roomCode, playerId: me.playerId, token: me.token,
  });
  assert.equal(state.you.patientId, 'p03', 'walks back in holding the same patient');

  closeAll(host, d1, d2);
});

test('Test 13 · a doctor cannot reach host controls, even knowing the room code', async () => {
  const host = await device();
  const { roomCode, hostToken } = await rpc(host, 'host:create', {});
  const sneaky = await device();
  const player = await rpc(sneaky, 'player:join', { name: 'Sneaky', roomCode });

  const forbidden = [
    ['host:phase', { phase: 'leaderboard' }],
    ['host:score', { playerId: player.playerId, diagnosis: 5, cause: 5, treatment: 5, explanation: 5 }],
    ['host:reveal', { mode: 'all' }],
    ['host:timer', { action: 'start', seconds: 60 }],
    ['host:end', {}],
    ['host:restart', { keepPlayers: false }],
    ['host:kick', { playerId: player.playerId }],
    ['host:resetPatient', { patientId: 'p01' }],
    ['host:rules', { allowRechoose: true }],
    ['host:finalReveal', { revealed: true }],
    ['host:suggestScore', { playerId: player.playerId }],
  ];
  for (const [event, payload] of forbidden) {
    await assert.rejects(
      () => rpc(sneaky, event, payload),
      (e) => e.code === 'NOT_HOST',
      `${event} must be refused`,
    );
  }

  // Knowing the room code is not enough — the token is the credential.
  await assert.rejects(
    () => rpc(sneaky, 'host:resume', { roomCode, hostToken: 'guessed-token' }),
    (e) => e.code === 'NOT_HOST',
  );

  // And nothing actually changed.
  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  assert.equal(state.phase, 'lobby');
  assert.equal(state.players.length, 1);
  closeAll(host, sneaky);
});

test('Test 14 · the host role moves to a different device via the host key', async () => {
  // Device A opens the room.
  const deviceA = await device();
  const { roomCode, hostToken } = await rpc(deviceA, 'host:create', {});

  const d1 = await device();
  const d2 = await device();
  await rpc(d1, 'player:join', { name: 'Sara', roomCode });
  await rpc(d2, 'player:join', { name: 'Omar', roomCode });

  // Device B is a completely separate client — it shares no storage with A.
  // All it has is what a /host?room=…&key=… link carries.
  const deviceB = await device();
  const { state } = await rpc(deviceB, 'host:resume', { roomCode, hostToken });

  assert.equal(state.code, roomCode);
  assert.equal(state.isHost, true);
  assert.equal(state.players.length, 2, 'B sees the doctors already in the room');
  assert.ok(state.cases, 'B receives the host-only answer key');

  // B genuinely has control, and the students follow B.
  const studentsFollow = [d1, d2].map((s) => waitForState(s, (st) => st.phase === 'selection'));
  await rpc(deviceB, 'host:phase', { phase: 'selection' });
  const seen = await Promise.all(studentsFollow);
  seen.forEach((s) => assert.equal(s.phase, 'selection'));

  closeAll(deviceA, deviceB, d1, d2);
});

/* ═══ networking specifics ══════════════════════════════════════════════════ */

test('polling-only clients work — for networks that block WebSocket', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});

  // Force the fallback transport, as a restrictive campus proxy would.
  const polling = await device({ transports: ['polling'] });
  const joined = await rpc(polling, 'player:join', { name: 'Blocked', roomCode });
  assert.equal(joined.state.players.length, 1);
  assert.equal(polling.io.engine.transport.name, 'polling');

  const mate = await device();
  await rpc(mate, 'player:join', { name: 'Mate', roomCode });

  // And it still receives live broadcasts.
  const sees = waitForState(polling, (s) => s.phase === 'selection');
  await rpc(host, 'host:phase', { phase: 'selection' });
  await sees;

  closeAll(host, polling, mate);
});

test('two rooms on one server stay completely isolated', async () => {
  const hostA = await device();
  const hostB = await device();
  const a = await rpc(hostA, 'host:create', {});
  const b = await rpc(hostB, 'host:create', {});
  assert.notEqual(a.roomCode, b.roomCode);

  const sa = await device();
  const sa2 = await device();
  const sb = await device();
  await rpc(sa, 'player:join', { name: 'InRoomA', roomCode: a.roomCode });
  await rpc(sa2, 'player:join', { name: 'AlsoRoomA', roomCode: a.roomCode });
  await rpc(sb, 'player:join', { name: 'InRoomB', roomCode: b.roomCode });

  await rpc(hostA, 'host:phase', { phase: 'selection' });
  await rpc(sa, 'patient:choose', { patientId: 'p05' });

  // Room B is untouched by anything that happened in room A.
  const stateB = (await rpc(hostB, 'host:resume', { roomCode: b.roomCode, hostToken: b.hostToken })).state;
  assert.equal(stateB.phase, 'lobby');
  assert.equal(stateB.assignedCount, 0);
  assert.equal(stateB.players.length, 1);
  assert.equal(stateB.players[0].name, 'InRoomB');

  // A host token is bound to its own room, not to "being a host".
  await assert.rejects(
    () => rpc(hostA, 'host:resume', { roomCode: b.roomCode, hostToken: a.hostToken }),
    (e) => e.code === 'NOT_HOST',
  );

  closeAll(hostA, hostB, sa, sa2, sb);
});

test('/api/room reports a room that exists, and 404s one that does not', async () => {
  const host = await device();
  const { roomCode } = await rpc(host, 'host:create', {});

  const found = await fetch(`${BASE}/api/room/${roomCode}`);
  assert.equal(found.status, 200);
  const body = await found.json();
  assert.equal(body.code, roomCode);
  assert.equal(body.open, true);

  const missing = await fetch(`${BASE}/api/room/FH-0000`);
  assert.equal(missing.status, 404);

  closeAll(host);
});
