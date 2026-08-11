import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { config } from './config.js';
import { attachRealtime } from './realtime.js';
import { normalizeRoomCode } from './util/ids.js';
import * as R from './game/rooms.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// ── static client ───────────────────────────────────────────────────────────
app.use(express.static(config.publicDir, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

// ── tiny REST surface ───────────────────────────────────────────────────────
// Used by the Join screen so it can tell "wrong code" from "server is down"
// before it opens a socket, and by uptime checks on the deploy host.

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: R.roomCount(), uptime: Math.round(process.uptime()) });
});

app.get('/api/config', (_req, res) => {
  res.json({
    minPlayers: config.minPlayers,
    maxPlayers: config.maxPlayers,
    publicOrigin: config.publicOrigin || null,
  });
});

app.get('/api/room/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const room = code ? R.getRoom(code) : null;
  if (!room) {
    return res.status(404).json({ ok: false, code: 'NO_ROOM', message: 'No such room.' });
  }
  return res.json({
    ok: true,
    code: room.code,
    phase: room.phase,
    players: room.players.size,
    maxPlayers: config.maxPlayers,
    open: room.phase !== 'ended' && room.players.size < config.maxPlayers,
  });
});

// Pretty join links: /join/FH-4827  →  join screen with the code pre-filled.
app.get('/join/:code', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'join.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, message: 'Not found.' });
  }
  return res.status(404).sendFile(path.join(config.publicDir, '404.html'));
});

// ── boot ────────────────────────────────────────────────────────────────────

const server = http.createServer(app);
attachRealtime(server);

const restored = R.loadSnapshot();
if (restored) console.log(`[snapshot] restored ${restored} room(s) from disk`);

setInterval(() => R.saveSnapshot(), config.snapshotIntervalMs).unref();
setInterval(() => {
  const dropped = R.sweep();
  if (dropped.length) console.log(`[sweep] closed idle room(s): ${dropped.join(', ')}`);
}, config.sweepIntervalMs).unref();

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(config.port, () => {
  const lines = [
    '',
    '  🏥  FRONT-END HOSPITAL — Emergency Room online',
    '  ─────────────────────────────────────────────',
    `  Host screen   →  http://localhost:${config.port}/host`,
    `  Join screen   →  http://localhost:${config.port}/join`,
    `  Landing page  →  http://localhost:${config.port}/`,
  ];
  const lan = lanAddresses();
  if (lan.length) {
    lines.push('', '  Students on the same Wi-Fi should open:');
    lan.forEach((ip) => lines.push(`    →  http://${ip}:${config.port}/join`));
  }
  lines.push(
    '',
    `  Doctors per room: ${config.minPlayers}–${config.maxPlayers}`,
    `  Snapshots: ${config.persist ? config.dataDir : 'disabled'}`,
    '',
  );
  console.log(lines.join('\n'));
});

const shutdown = (signal) => {
  console.log(`\n[${signal}] saving snapshot and closing…`);
  R.saveSnapshot();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
