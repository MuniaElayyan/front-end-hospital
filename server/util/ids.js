import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Secret, unguessable token. Used as the bearer credential for a host or a
 * player — whoever holds it *is* that participant, so it never leaves the
 * owner's own browser (it is not included in any broadcast state).
 */
export const secretToken = () => randomBytes(24).toString('base64url');

/** Public identifier. Safe to broadcast. */
export const publicId = () => randomUUID();

/**
 * Human-friendly room code: FH-4827.
 * Digits only — easy to read out loud in a classroom and easy to type on a
 * phone keypad. 9000 possibilities is plenty for concurrent rooms; the caller
 * retries on collision anyway.
 */
export const roomCode = () => `FH-${1000 + Math.floor(Math.random() * 9000)}`;

/** Accepts "fh-4827", "FH4827", " 4827 " → "FH-4827". Returns null if hopeless. */
export function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length !== 4) return null;
  return `FH-${digits}`;
}
