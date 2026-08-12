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

// Render, Railway, Fly and every reverse proxy terminate TLS in front of us and
// forward the original scheme/host in X-Forwarded-*. Without this, req.protocol
// reports "http" on an https deployment and req.ip is the proxy, not the client.
app.set('trust proxy', 1);

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

// Pretty join links. All three of these serve the same screen, with the code
// pre-filled, because links get pasted into chat apps in whatever shape people
// happen to copy them:
//     /join/FH-4827
//     /join?room=FH-4827
//     /join?code=FH-4827
app.get('/join/:code', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'join.html'));
});

// The host console. Serving it explicitly (rather than leaning on the static
// middleware's `extensions` guess) keeps /host working identically whether or
// not a query string is attached — /host?room=FH-4827&key=… is how a host
// re-opens an existing room from a different device.
app.get('/host', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'host.html'));
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

server.listen(config.port, config.host, () => {
  const deployed = Boolean(config.publicOrigin);
  const base = config.publicOrigin || `http://localhost:${config.port}`;

  const lines = [
    '',
    '  🏥  FRONT-END HOSPITAL — Emergency Room online',
    '  ─────────────────────────────────────────────',
    `  Listening on   ${config.host}:${config.port}`,
    '',
    `  Host console   →  ${base}/host`,
    `  Join screen    →  ${base}/join`,
    `  Landing page   →  ${base}/`,
  ];

  if (!deployed) {
    const lan = lanAddresses();
    if (lan.length) {
      lines.push(
        '',
        '  Same Wi-Fi only (these addresses do NOT work over the internet —',
        '  deploy the server for that; see README § Deployment):',
      );
      lan.forEach((ip) => lines.push(`    →  http://${ip}:${config.port}/join`));
    }
  }

  lines.push(
    '',
    `  Doctors per room: ${config.minPlayers}–${config.maxPlayers}`,
    `  Snapshots: ${config.persist ? config.dataDir : 'disabled (in-memory only)'}`,
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
