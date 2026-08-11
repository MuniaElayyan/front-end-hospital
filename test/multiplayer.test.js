/**
 * End-to-end multiplayer tests.
 *
 * These run against a REAL server over REAL sockets — no mocks — because the
 * only claims worth testing here are the ones about concurrency and privacy,
 * and neither survives being stubbed out.
 *
 *   node --test test/
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test as nodeTest } from 'node:test';

import { io as ioClient } from 'socket.io-client';

process.env.PERSIST = 'false';           // do not litter .data/ during tests
process.env.PORT = '0';

const { attachRealtime } = await import('../server/realtime.js');

let server;
let url;

/**
 * Everything here talks over a socket, so a bug shows up as a promise that
 * never settles. A hard per-test timeout turns that into a failure instead of
 * a hung terminal.
 */
const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);

before(async () => {
  server = http.createServer();
  attachRealtime(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // The realtime layer keeps a 1s heartbeat alive; let the process exit.
  process.exit(0);
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

const open = () => new Promise((resolve, reject) => {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true });
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', reject);
});

const rpc = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
  socket.emit(event, payload, (reply) => {
    clearTimeout(timer);
    if (reply?.ok) resolve(reply);
    else reject(Object.assign(new Error(reply?.message ?? 'failed'), { code: reply?.code }));
  });
});

/** Resolve with the next `state` this socket receives. */
const nextState = (socket) => new Promise((resolve) => socket.once('state', resolve));

/**
 * Resolve with the first `state` that satisfies `predicate`.
 * A room emits state for several reasons at once (a phase change also nudges
 * the roster), so "the very next one" is the wrong thing to wait for.
 */
const waitForState = (socket, predicate, ms = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off('state', onState);
    reject(new Error('no matching state arrived'));
  }, ms);
  function onState(state) {
    if (!predicate(state)) return;
    clearTimeout(timer);
    socket.off('state', onState);
    resolve(state);
  }
  socket.on('state', onState);
});

async function openRoom(playerNames) {
  const host = await open();
  const { roomCode, hostToken } = await rpc(host, 'host:create', {});
  const players = [];
  for (const name of playerNames) {
    const socket = await open();
    const reply = await rpc(socket, 'player:join', { name, roomCode });
    players.push({ socket, name, ...reply });
  }
  return { host, hostToken, roomCode, players };
}

const closeAll = (...sockets) => sockets.flat().forEach((s) => (s.socket ?? s).close());

/* ── tests ───────────────────────────────────────────────────────────────── */

test('a room issues an FH-#### code and accepts joins', async () => {
  const { host, roomCode, players } = await openRoom(['Munia', 'Ahmad']);
  assert.match(roomCode, /^FH-\d{4}$/);

  const state = await rpc(players[0].socket, 'player:resume', {
    roomCode, playerId: players[0].playerId, token: players[0].token,
  });
  assert.equal(state.state.players.length, 2);
  assert.deepEqual(state.state.players.map((p) => p.name).sort(), ['Ahmad', 'Munia']);
  closeAll(host, players);
});

test('the room is capped at 12 doctors', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `Doctor${i + 1}`);
  const { host, roomCode, players } = await openRoom(names);

  const extra = await open();
  await assert.rejects(
    () => rpc(extra, 'player:join', { name: 'Thirteen', roomCode }),
    (err) => err.code === 'ROOM_FULL',
  );
  extra.close();
  closeAll(host, players);
});

test('duplicate doctor names are refused', async () => {
  const { host, roomCode, players } = await openRoom(['Sara']);
  const dupe = await open();
  await assert.rejects(
    () => rpc(dupe, 'player:join', { name: 'sara', roomCode }),
    (err) => err.code === 'NAME_TAKEN',
  );
  dupe.close();
  closeAll(host, players);
});

test('THE RACE: eight doctors slam the same patient — exactly one wins', async () => {
  const names = Array.from({ length: 8 }, (_, i) => `Racer${i + 1}`);
  const { host, hostToken, roomCode, players } = await openRoom(names);

  await rpc(host, 'host:phase', { phase: 'selection' });

  // Every client fires at the same patient in the same tick.
  const results = await Promise.allSettled(
    players.map((p) => rpc(p.socket, 'patient:choose', { patientId: 'p04' })),
  );

  const winners = results.filter((r) => r.status === 'fulfilled');
  const losers = results.filter((r) => r.status === 'rejected');

  assert.equal(winners.length, 1, 'exactly one doctor may hold patient 04');
  assert.equal(losers.length, 7);
  losers.forEach((l) => assert.equal(l.reason.code, 'TAKEN'));

  // And the room agrees: p04 has exactly one owner.
  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  const p04 = state.patients.find((p) => p.id === 'p04');
  assert.ok(p04.takenBy, 'patient 04 is assigned');
  assert.equal(state.patients.filter((p) => p.takenBy).length, 1, 'no other patient was touched');
  assert.equal(state.assignedCount, 1);

  closeAll(host, players);
});

test('a doctor may hold only one patient', async () => {
  const { host, roomCode, players } = await openRoom(['Solo', 'Bystander']);
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(players[0].socket, 'patient:choose', { patientId: 'p01' });

  await assert.rejects(
    () => rpc(players[0].socket, 'patient:choose', { patientId: 'p02' }),
    (err) => err.code === 'ALREADY_ASSIGNED',
  );

  // …unless the host opens re-picking.
  await rpc(host, 'host:rules', { allowRechoose: true });
  await rpc(players[0].socket, 'patient:choose', { patientId: 'p02' });

  const { state } = await rpc(players[0].socket, 'player:resume', {
    roomCode, playerId: players[0].playerId, token: players[0].token,
  });
  assert.equal(state.you.patientId, 'p02');
  assert.equal(state.patients.find((p) => p.id === 'p01').takenBy, null, 'p01 was released');

  closeAll(host, players);
});

test('a claim is broadcast to every other client immediately', async () => {
  const { host, players } = await openRoom(['Ali', 'Bea', 'Cem']);
  await rpc(host, 'host:phase', { phase: 'selection' });

  const watchers = [players[1].socket, players[2].socket].map((s) => waitForState(
    s, (state) => Boolean(state.patients.find((p) => p.id === 'p07').takenBy),
  ));
  await rpc(players[0].socket, 'patient:choose', { patientId: 'p07' });

  const states = await Promise.all(watchers);
  states.forEach((s) => {
    const p07 = s.patients.find((p) => p.id === 'p07');
    assert.equal(p07.takenBy, players[0].playerId);
    assert.equal(p07.takenByName, 'Ali');
  });
  closeAll(host, players);
});

test('a player never receives another doctor\'s patient file or any answer key', async () => {
  const { host, players } = await openRoom(['Alice', 'Bob']);
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(players[0].socket, 'patient:choose', { patientId: 'p03' });
  await rpc(players[1].socket, 'patient:choose', { patientId: 'p09' });

  const alice = (await rpc(players[0].socket, 'player:resume', {
    roomCode: players[0].roomCode, playerId: players[0].playerId, token: players[0].token,
  })).state;

  assert.equal(alice.myCase.id, 'p03', 'Alice sees her own file');
  assert.ok(alice.myCase.evidence.length > 0);

  // Nothing in Alice's payload mentions the disease names or Bob's evidence.
  const wire = JSON.stringify(alice);
  assert.ok(!wire.includes('Missing JavaScript Event Listener'));
  assert.ok(!wire.includes('Event Listener Never Attached'), 'no answer titles leak');
  assert.ok(!wire.includes('DOMContentLoad'), 'no evidence from Bob\'s patient leaks');
  assert.equal(alice.cases, undefined, 'the answer key is host-only');
  assert.equal(alice.submissions, undefined, 'other submissions are host-only');

  // The public list still shows p09 as taken, with only a name attached.
  const p09 = alice.patients.find((p) => p.id === 'p09');
  assert.equal(p09.takenByName, 'Bob');
  assert.equal(p09.patientType, undefined);

  closeAll(host, players);
});

test('a player cannot act as the host', async () => {
  const { host, roomCode, hostToken, players } = await openRoom(['Sneaky']);

  await assert.rejects(
    () => rpc(players[0].socket, 'host:phase', { phase: 'leaderboard' }),
    (err) => err.code === 'NOT_HOST',
  );
  await assert.rejects(
    () => rpc(players[0].socket, 'host:score', { playerId: players[0].playerId, diagnosis: 5 }),
    (err) => err.code === 'NOT_HOST',
  );
  // Even knowing the room code is not enough — the token is what counts.
  await assert.rejects(
    () => rpc(players[0].socket, 'host:resume', { roomCode, hostToken: 'not-the-token' }),
    (err) => err.code === 'NOT_HOST',
  );

  // The real token still works, of course.
  await rpc(host, 'host:resume', { roomCode, hostToken });
  closeAll(host, players);
});

test('a diagnosis locks after submit and re-opens only when the host says so', async () => {
  const { host, roomCode, players } = await openRoom(['Layla', 'Bystander']);
  const p = players[0];

  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(p.socket, 'patient:choose', { patientId: 'p05' });
  await rpc(host, 'host:phase', { phase: 'diagnosis' });

  await assert.rejects(
    () => rpc(p.socket, 'diagnosis:submit', { diagnosis: 'x', cause: '', treatment: '' }),
    (err) => err.code === 'INCOMPLETE',
  );

  await rpc(p.socket, 'diagnosis:submit', {
    diagnosis: 'Horizontal overflow', cause: 'box-sizing content-box', treatment: 'border-box', confidence: 80,
  });
  await assert.rejects(
    () => rpc(p.socket, 'diagnosis:submit', { diagnosis: 'a', cause: 'b', treatment: 'c' }),
    (err) => err.code === 'LOCKED',
  );

  await rpc(host, 'host:resubmit', { playerId: p.playerId, allowed: true });
  await rpc(p.socket, 'diagnosis:submit', { diagnosis: 'a', cause: 'b', treatment: 'c' });

  const { state } = await rpc(p.socket, 'player:resume', {
    roomCode, playerId: p.playerId, token: p.token,
  });
  assert.equal(state.you.submission.revision, 2);
  closeAll(host, players);
});

test('a refresh restores identity, patient, diagnosis and score', async () => {
  const { host, roomCode, players } = await openRoom(['Persist', 'Bystander']);
  const p = players[0];

  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(p.socket, 'patient:choose', { patientId: 'p11' });
  await rpc(host, 'host:phase', { phase: 'diagnosis' });
  await rpc(p.socket, 'diagnosis:submit', {
    diagnosis: 'Broken anchors', cause: 'id mismatch', treatment: 'match hrefs', confidence: 70,
  });
  await rpc(host, 'host:score', { playerId: p.playerId, diagnosis: 5, cause: 5, treatment: 4, explanation: 3 });

  // Simulate closing the tab and reopening it.
  p.socket.close();
  await new Promise((r) => setTimeout(r, 60));
  const revived = await open();
  const { state } = await rpc(revived, 'player:resume', {
    roomCode, playerId: p.playerId, token: p.token,
  });

  assert.equal(state.you.name, 'Persist');
  assert.equal(state.you.patientId, 'p11');
  assert.equal(state.you.submission.diagnosis, 'Broken anchors');
  assert.equal(state.you.score.total, 17);
  assert.equal(state.phase, 'diagnosis');
  assert.equal(state.myCase.id, 'p11');

  revived.close();
  closeAll(host, players);
});

test('a stolen player id without the token is refused', async () => {
  const { host, roomCode, players } = await openRoom(['Victim']);
  const attacker = await open();
  await assert.rejects(
    () => rpc(attacker, 'player:resume', {
      roomCode, playerId: players[0].playerId, token: 'guessed',
    }),
    (err) => err.code === 'NO_SESSION',
  );
  attacker.close();
  closeAll(host, players);
});

test('the host cannot start below the minimum, and phase changes reach everyone', async () => {
  const host = await open();
  const { roomCode } = await rpc(host, 'host:create', {});

  await assert.rejects(
    () => rpc(host, 'host:phase', { phase: 'alert' }),
    (err) => err.code === 'TOO_FEW',
  );

  const a = await open();
  const b = await open();
  await rpc(a, 'player:join', { name: 'One', roomCode });
  await rpc(b, 'player:join', { name: 'Two', roomCode });

  const watching = [nextState(a), nextState(b)];
  await rpc(host, 'host:phase', { phase: 'alert' });
  const states = await Promise.all(watching);
  states.forEach((s) => assert.equal(s.phase, 'alert'));

  closeAll(host, a, b);
});

test('the shared timer is expressed as an absolute server deadline', async () => {
  const { host, players } = await openRoom(['Tick', 'Tock']);
  const watching = players.map((p) => nextState(p.socket));
  await rpc(host, 'host:timer', { action: 'start', seconds: 600, label: 'Diagnosis' });

  const states = await Promise.all(watching);
  const deadlines = states.map((s) => s.timer.endsAt);
  assert.ok(deadlines.every(Boolean), 'every client gets an endsAt');
  assert.equal(new Set(deadlines).size, 1, 'and it is the SAME instant for all of them');
  assert.equal(states[0].timer.label, 'Diagnosis');
  assert.ok(states[0].timer.remainingMs > 595_000);

  closeAll(host, players);
});

test('reveal exposes answers only after the host triggers it', async () => {
  const { host, roomCode, players } = await openRoom(['Reader', 'Bystander']);
  const p = players[0];
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(p.socket, 'patient:choose', { patientId: 'p12' });

  let { state } = await rpc(p.socket, 'player:resume', { roomCode, playerId: p.playerId, token: p.token });
  assert.deepEqual(state.revealed, {}, 'nothing is revealed yet');

  await rpc(host, 'host:reveal', { mode: 'one', patientId: 'p12' });
  ({ state } = await rpc(p.socket, 'player:resume', { roomCode, playerId: p.playerId, token: p.token }));

  assert.ok(state.revealed.p12, 'p12 is now revealed');
  assert.equal(state.revealed.p12.answer.title, 'Dark Mode / Theme Toggle Failure');
  assert.ok(state.revealed.p12.answer.treatment.length > 20);
  assert.equal(Object.keys(state.revealed).length, 1, 'only the revealed one');

  closeAll(host, players);
});

test('the host resetting a patient frees it for someone else', async () => {
  const { host, hostToken, roomCode, players } = await openRoom(['First', 'Second']);
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(players[0].socket, 'patient:choose', { patientId: 'p02' });

  await assert.rejects(
    () => rpc(players[1].socket, 'patient:choose', { patientId: 'p02' }),
    (err) => err.code === 'TAKEN',
  );

  await rpc(host, 'host:resetPatient', { patientId: 'p02' });
  await rpc(players[1].socket, 'patient:choose', { patientId: 'p02' });

  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  const p02 = state.patients.find((p) => p.id === 'p02');
  assert.equal(p02.takenByName, 'Second', 'the second doctor now holds it');
  assert.equal(state.players.find((p) => p.name === 'First').patientId, null);
  closeAll(host, players);
});

test('the leaderboard ranks by total and shares ranks on ties', async () => {
  const { host, hostToken, roomCode, players } = await openRoom(['Ann', 'Ben', 'Cat']);
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(players[0].socket, 'patient:choose', { patientId: 'p01' });
  await rpc(players[1].socket, 'patient:choose', { patientId: 'p02' });
  await rpc(players[2].socket, 'patient:choose', { patientId: 'p03' });

  await rpc(host, 'host:score', { playerId: players[0].playerId, diagnosis: 5, cause: 5, treatment: 5, explanation: 5 });
  await rpc(host, 'host:score', { playerId: players[1].playerId, diagnosis: 5, cause: 5, treatment: 5, explanation: 5 });
  await rpc(host, 'host:score', { playerId: players[2].playerId, diagnosis: 1 });

  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  const byName = Object.fromEntries((state.leaderboard ?? []).map((r) => [r.name, r]));
  assert.equal(byName.Ann.total, 20);
  assert.equal(byName.Ann.rank, 1);
  assert.equal(byName.Ben.rank, 1, 'a tie shares the rank');
  assert.equal(byName.Cat.rank, 3);
  assert.equal(byName.Ann.accuracy, 100);

  closeAll(host, players);
});

test('the auto-grader suggests points without ever awarding them', async () => {
  const { host, hostToken, roomCode, players } = await openRoom(['Grader', 'Bystander']);
  const p = players[0];
  await rpc(host, 'host:phase', { phase: 'selection' });
  await rpc(p.socket, 'patient:choose', { patientId: 'p04' });
  await rpc(host, 'host:phase', { phase: 'diagnosis' });
  await rpc(p.socket, 'diagnosis:submit', {
    diagnosis: 'The images 404 — the path is broken so the browser shows the broken icon.',
    cause: 'The HTML says images/ but the folder is image/, and the capital letter in Laptop.png breaks on Linux.',
    treatment: 'Correct the relative path and rename everything to lowercase so it is case-safe.',
    confidence: 90,
  });

  const reply = await rpc(host, 'host:suggestScore', { playerId: p.playerId });
  assert.ok(reply.suggestion.diagnosis > 0);
  assert.ok(reply.suggestion.cause > 0);
  assert.ok(reply.suggestion.treatment > 0);
  assert.ok(reply.signals.matched.cause.includes('image'));

  // Crucially: asking for a suggestion did NOT write a score. Grading stays
  // an explicit human act.
  const { state } = await rpc(host, 'host:resume', { roomCode, hostToken });
  assert.equal(state.scores[p.playerId].gradedAt, null);
  assert.equal(state.scores[p.playerId].total, 0);

  closeAll(host, players);
});

test('the final patient accepts multi-fault findings from every doctor', async () => {
  const { host, roomCode, players } = await openRoom(['Op1', 'Op2']);
  await rpc(host, 'host:phase', { phase: 'final' });

  await rpc(players[0].socket, 'final:submit', {
    findings: [
      { title: 'Broken image path', cause: 'assets/img vs img', fix: 'fix the src' },
      { title: 'Dead button', cause: 'wrong class in querySelectorAll', fix: 'use .add-to-cart' },
    ],
  });
  await rpc(players[1].socket, 'final:submit', {
    findings: [{ title: 'Not responsive', cause: 'no viewport meta', fix: 'add the meta tag' }],
  });

  const { state } = await rpc(players[0].socket, 'player:resume', {
    roomCode, playerId: players[0].playerId, token: players[0].token,
  });
  assert.equal(state.final.submittedCount, 2);
  assert.equal(state.you.finalSubmission.findings.length, 2);
  assert.equal(state.final.answer, null, 'the post-op report stays hidden until revealed');

  await rpc(host, 'host:finalReveal', { revealed: true });
  const after = (await rpc(players[0].socket, 'player:resume', {
    roomCode, playerId: players[0].playerId, token: players[0].token,
  })).state;
  assert.equal(after.final.answer.findings.length, 5);

  closeAll(host, players);
});
