import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  // Platforms (Render, Railway, Fly…) inject PORT. Never hard-code one.
  port: int(process.env.PORT, 3000),

  /**
   * Bind address. MUST be 0.0.0.0 in a container: binding to 127.0.0.1 would
   * make the process reachable only from inside the container, and the
   * platform's router would get connection-refused on every request. There is
   * no reason to change this; it is an env var only so a local dev can bind to
   * a single interface if they really want to.
   */
  host: process.env.HOST || '0.0.0.0',

  /**
   * Optional. ONLY used to print a friendly link in the boot banner and to
   * report back from /api/config. The browser never needs it — every URL the
   * app builds comes from window.location.origin, so the app works on any
   * domain it happens to be served from without being told what that is.
   */
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),

  /** Hard ceiling. The game is designed around exactly 12 patients. */
  maxPlayers: Math.min(12, Math.max(1, int(process.env.MAX_PLAYERS, 12))),
  minPlayers: Math.max(1, int(process.env.MIN_PLAYERS, 2)),

  roomTtlMs: int(process.env.ROOM_TTL_MINUTES, 240) * 60 * 1000,

  persist: (process.env.PERSIST ?? 'true').toLowerCase() !== 'false',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || '.data'),

  publicDir: path.resolve(ROOT, 'public'),

  /** How often the in-memory world is snapshotted to disk. */
  snapshotIntervalMs: 4000,
  /** How often expired rooms / stale timers are swept. */
  sweepIntervalMs: 30_000,
};
