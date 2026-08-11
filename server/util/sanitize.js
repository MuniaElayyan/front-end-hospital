/**
 * Every string that arrives from a client passes through here before it is
 * stored or re-broadcast. The client renders with textContent, so this is
 * belt-and-braces — but a room's state is echoed to 12 other people, and
 * untrusted text should never be trusted twice.
 */

// Control characters, except \n and \t, which we keep so pasted code snippets
// survive intact. Built with RegExp() so the source file stays 7-bit clean.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

/** Normalise line endings, strip control chars, clamp length. */
export function cleanText(value, maxLength = 2000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .slice(0, maxLength)
    .trim();
}

/** Single-line variant — names, labels, short answers. */
export function cleanLine(value, maxLength = 40) {
  return cleanText(value, maxLength).replace(/\s+/g, ' ');
}

/**
 * Doctor names. Letters (any script, so Arabic names work), digits, spaces and
 * a few joiners. Emoji are stripped — the game assigns the medical badge itself.
 */
export function cleanDoctorName(value) {
  return cleanLine(value, 24)
    .replace(/[^\p{L}\p{M}\p{N} '._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

export function clampInt(value, min, max, fallback = min) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
