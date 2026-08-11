import { Server } from 'socket.io';

import { config } from './config.js';
import { normalizeRoomCode } from './util/ids.js';
import { PHASES } from './game/phases.js';
import * as R from './game/rooms.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  THE WIRE
 * ────────────────────────────────────────────────────────────────────────────
 *  One rule runs through every handler here: the socket's *identity* is
 *  established once, at join/resume time, from a secret token, and is then
 *  read from `socket.data` — never from the message payload. A client can ask
 *  to submit a diagnosis; it cannot say *whose* diagnosis it is. A client can
 *  ask to change a score; unless its socket is bound as the host, it is
 *  refused. That is what makes cheating from DevTools uninteresting.
 */

const HOST_ROOM = (code) => `host:${code}`;
const PLAY_ROOM = (code) => `play:${code}`;

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.publicOrigin || true, methods: ['GET', 'POST'] },
    pingTimeout: 25_000,
    pingInterval: 10_000,
  });

  // ── broadcasting ──────────────────────────────────────────────────────────

  /** Push the correct, role-filtered view of a room to everyone in it. */
  function broadcast(room) {
    if (!room) return;
    io.to(HOST_ROOM(room.code)).emit('state', R.hostView(room));
    for (const player of room.players.values()) {
      if (!player.socketId) continue;
      io.to(player.socketId).emit('state', R.playerView(room, player));
    }
  }

  function pushTo(socket, room) {
    if (socket.data.role === 'host') socket.emit('state', R.hostView(room));
    else {
      const player = room.players.get(socket.data.playerId);
      if (player) socket.emit('state', R.playerView(room, player));
    }
  }

  const fx = (room, payload) => io.to(HOST_ROOM(room.code))
    .to(PLAY_ROOM(room.code))
    .emit('fx', payload);

  const toastRoom = (room, message, type = 'info') => fx(room, { type: 'toast', message, level: type });

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Wrap a handler so expected game errors become a clean `error` reply. */
  const guard = (socket, ack, fn) => {
    try {
      const result = fn();
      if (typeof ack === 'function') ack({ ok: true, ...(result ?? {}) });
    } catch (err) {
      if (!R.isExpected(err)) console.error('[socket]', err);
      const payload = {
        ok: false,
        code: err.code ?? 'ERROR',
        message: R.isExpected(err) ? err.message : 'Something went wrong on the server.',
      };
      if (typeof ack === 'function') ack(payload);
      else socket.emit('error:game', payload);
    }
  };

  /** Resolve the room this socket is bound to, or throw. */
  function boundRoom(socket) {
    const code = socket.data.roomCode;
    if (!code) R.fail('NOT_JOINED', 'You are not in a room.');
    return R.requireRoom(code);
  }

  function boundPlayer(socket, room) {
    if (socket.data.role !== 'player') R.fail('NOT_PLAYER', 'Only doctors can do that.');
    return R.requirePlayer(room, socket.data.playerId, socket.data.token);
  }

  function asHost(socket) {
    const room = boundRoom(socket);
    if (socket.data.role !== 'host') R.fail('NOT_HOST', 'Only the host can do that.');
    R.requireHost(room, socket.data.hostToken);
    return room;
  }

  function bindHost(socket, room) {
    socket.data.role = 'host';
    socket.data.roomCode = room.code;
    socket.data.hostToken = room.hostToken;
    room.hostSocketId = socket.id;
    room.hostConnected = true;
    socket.join(HOST_ROOM(room.code));
  }

  function bindPlayer(socket, room, player) {
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.data.token = player.token;
    R.setPlayerConnection(room, player.id, true, socket.id);
    socket.join(PLAY_ROOM(room.code));
  }

  // ── connection ────────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    socket.data = { role: null };

    /** Clock sync. Client uses this to render one identical countdown everywhere. */
    socket.on('time:ping', (clientSentAt, ack) => {
      if (typeof ack === 'function') ack({ clientSentAt, serverTime: Date.now() });
    });

    socket.on('meta', (_payload, ack) => {
      if (typeof ack === 'function') {
        ack({
          ok: true,
          phases: PHASES,
          limits: { min: config.minPlayers, max: config.maxPlayers },
        });
      }
    });

    // ── host lifecycle ──────────────────────────────────────────────────────

    socket.on('host:create', (payload, ack) => guard(socket, ack, () => {
      const room = R.createRoom({ hostName: payload?.hostName });
      bindHost(socket, room);
      pushTo(socket, room);
      return {
        roomCode: room.code,
        hostToken: room.hostToken,
        state: R.hostView(room),
      };
    }));

    socket.on('host:resume', (payload, ack) => guard(socket, ack, () => {
      const code = normalizeRoomCode(payload?.roomCode);
      if (!code) R.fail('BAD_CODE', 'Invalid room code.');
      const room = R.resumeHost(code, payload?.hostToken);
      bindHost(socket, room);
      broadcast(room);
      return { roomCode: room.code, state: R.hostView(room) };
    }));

    // ── player lifecycle ────────────────────────────────────────────────────

    socket.on('player:join', (payload, ack) => guard(socket, ack, () => {
      const code = normalizeRoomCode(payload?.roomCode);
      if (!code) R.fail('BAD_CODE', 'Room codes look like FH-4827.');
      const { room, player } = R.joinRoom(code, payload?.name);
      bindPlayer(socket, room, player);
      broadcast(room);
      toastRoom(room, `Doctor ${player.name} joined the ER.`, 'info');
      return {
        roomCode: room.code,
        playerId: player.id,
        token: player.token,
        state: R.playerView(room, player),
      };
    }));

    socket.on('player:resume', (payload, ack) => guard(socket, ack, () => {
      const code = normalizeRoomCode(payload?.roomCode);
      if (!code) R.fail('BAD_CODE', 'Invalid room code.');
      const { room, player } = R.resumePlayer(code, payload?.playerId, payload?.token);
      bindPlayer(socket, room, player);
      broadcast(room);
      return {
        roomCode: room.code,
        playerId: player.id,
        token: player.token,
        state: R.playerView(room, player),
      };
    }));

    socket.on('player:leave', (_payload, ack) => guard(socket, ack, () => {
      const room = boundRoom(socket);
      const player = boundPlayer(socket, room);
      R.removePlayer(room, player.id);
      socket.leave(PLAY_ROOM(room.code));
      socket.data = { role: null };
      broadcast(room);
      return {};
    }));

    // ── the atomic claim ────────────────────────────────────────────────────

    socket.on('patient:choose', (payload, ack) => guard(socket, ack, () => {
      const room = boundRoom(socket);
      const player = boundPlayer(socket, room);
      const slot = R.claimPatient(room, player, payload?.patientId);

      broadcast(room);
      fx(room, {
        type: 'claim',
        patientNumber: slot.number,
        doctorName: player.name,
      });

      if (R.assignedCount(room) === room.patients.length) {
        toastRoom(room, 'ALL PATIENTS HAVE BEEN ADMITTED.', 'success');
        fx(room, { type: 'all-admitted' });
      }
      return { patientId: slot.id };
    }));

    socket.on('patient:release', (_payload, ack) => guard(socket, ack, () => {
      const room = boundRoom(socket);
      const player = boundPlayer(socket, room);
      R.releasePatient(room, player);
      broadcast(room);
      return {};
    }));

    // ── diagnosis ───────────────────────────────────────────────────────────

    socket.on('diagnosis:draft', (payload) => {
      // Fire-and-forget autosave. Never broadcast — a draft is nobody's business.
      try {
        const room = boundRoom(socket);
        const player = boundPlayer(socket, room);
        R.saveDraft(room, player, payload);
      } catch { /* drafts fail silently by design */ }
    });

    socket.on('diagnosis:submit', (payload, ack) => guard(socket, ack, () => {
      const room = boundRoom(socket);
      const player = boundPlayer(socket, room);
      R.submitDiagnosis(room, player, payload);
      broadcast(room);
      fx(room, { type: 'submitted', doctorName: player.name });
      return {};
    }));

    socket.on('final:submit', (payload, ack) => guard(socket, ack, () => {
      const room = boundRoom(socket);
      const player = boundPlayer(socket, room);
      R.submitFinal(room, player, payload);
      broadcast(room);
      return {};
    }));

    // ── host control panel ──────────────────────────────────────────────────

    socket.on('host:phase', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      if (payload?.phase === 'alert' || (payload?.phase === 'selection' && room.phase === 'lobby')) {
        if (room.players.size < config.minPlayers) {
          R.fail('TOO_FEW', `You need at least ${config.minPlayers} doctors to start.`);
        }
      }
      R.setPhase(room, payload?.phase);
      broadcast(room);
      fx(room, { type: 'phase', phase: room.phase });
      return { phase: room.phase };
    }));

    socket.on('host:pause', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.setPaused(room, payload?.paused);
      broadcast(room);
      return { paused: room.paused };
    }));

    socket.on('host:rules', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      if (payload?.selectionLocked !== undefined) {
        room.rules.selectionLocked = Boolean(payload.selectionLocked);
      }
      if (payload?.allowRechoose !== undefined) {
        room.rules.allowRechoose = Boolean(payload.allowRechoose);
      }
      if (payload?.allowResubmit !== undefined) {
        R.setResubmit(room, 'all', payload.allowResubmit);
      }
      broadcast(room);
      return { rules: room.rules };
    }));

    socket.on('host:resubmit', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.setResubmit(room, payload?.playerId, payload?.allowed);
      broadcast(room);
      return {};
    }));

    socket.on('host:resetPatient', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.hostResetPatient(room, payload?.patientId);
      broadcast(room);
      return {};
    }));

    socket.on('host:kick', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      const player = room.players.get(payload?.playerId);
      if (player?.socketId) {
        io.to(player.socketId).emit('kicked', { message: 'The host removed you from the room.' });
      }
      R.removePlayer(room, payload?.playerId);
      broadcast(room);
      return {};
    }));

    socket.on('host:score', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      const score = R.setScore(room, payload?.playerId, payload);
      broadcast(room);
      return { score };
    }));

    socket.on('host:suggestScore', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      return R.suggestScore(room, payload?.playerId);
    }));

    socket.on('host:finalScore', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.setFinalScore(room, payload?.playerId, payload?.points, payload?.note);
      broadcast(room);
      return {};
    }));

    socket.on('host:timer', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      switch (payload?.action) {
        case 'start': R.startTimer(room, payload.seconds, payload.label); break;
        case 'pause': R.pauseTimer(room); break;
        case 'resume': R.resumeTimer(room); break;
        case 'stop': R.stopTimer(room); break;
        case 'add': R.addTime(room, payload.seconds); break;
        default: R.fail('BAD_ACTION', 'Unknown timer action.');
      }
      broadcast(room);
      return { timer: room.timer };
    }));

    socket.on('host:conference', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.setConference(room, payload ?? {});
      broadcast(room);
      const currentId = room.conference.order[room.conference.index];
      if (currentId) {
        const player = room.players.get(currentId);
        if (player?.socketId) io.to(player.socketId).emit('fx', { type: 'your-turn' });
      }
      return {};
    }));

    socket.on('host:reveal', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.setReveal(room, payload ?? {});
      broadcast(room);
      fx(room, { type: 'reveal', mode: room.reveal.mode });
      return {};
    }));

    socket.on('host:finalReveal', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.revealFinal(room, payload?.revealed ?? true);
      broadcast(room);
      return {};
    }));

    socket.on('host:finalMode', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.setFinalMode(room, payload?.mode);
      broadcast(room);
      return {};
    }));

    socket.on('host:restart', (payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.restartRoom(room, { keepPlayers: payload?.keepPlayers !== false });
      broadcast(room);
      fx(room, { type: 'restart' });
      return {};
    }));

    socket.on('host:end', (_payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      R.endRoom(room);
      broadcast(room);
      return {};
    }));

    socket.on('host:celebrate', (_payload, ack) => guard(socket, ack, () => {
      const room = asHost(socket);
      fx(room, { type: 'confetti' });
      return {};
    }));

    // ── disconnect ──────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      const code = socket.data?.roomCode;
      if (!code) return;
      const room = R.getRoom(code);
      if (!room) return;

      if (socket.data.role === 'host' && room.hostSocketId === socket.id) {
        room.hostConnected = false;
        room.hostSocketId = null;
      }
      if (socket.data.role === 'player') {
        // The player is NOT removed — their patient, diagnosis and score stay
        // reserved. They come straight back on reconnect (requirement 22).
        R.setPlayerConnection(room, socket.data.playerId, false);
      }
      broadcast(room);
    });
  });

  // A low-frequency heartbeat keeps the shared clock honest across devices
  // whose tab was throttled, and fires the "time is up" moment exactly once.
  setInterval(() => {
    for (const room of R.allRooms()) {
      const t = room.timer;
      if (t.running && t.endsAt != null && Date.now() >= t.endsAt) {
        R.stopTimer(room);
        io.to(HOST_ROOM(room.code)).to(PLAY_ROOM(room.code)).emit('fx', { type: 'time-up' });
        broadcast(room);
      }
    }
  }, 1000);

  return io;
}
