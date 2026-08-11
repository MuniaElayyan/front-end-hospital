/**
 * evidence.js — renders the mixed evidence attached to a patient file.
 *
 * Includes a deliberately small syntax highlighter. It tokenises in ONE pass
 * over the raw source and escapes every captured chunk as it goes, so the
 * highlighter can never turn a `<script>` in a snippet into a real one — which
 * matters, because these snippets are literally examples of broken HTML.
 */

import { el } from './ui.js';

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Ordered alternatives per language. First match wins, like a real lexer. */
const GRAMMARS = {
  html: [
    ['tok-com', /<!--[\s\S]*?-->/],
    ['tok-str', /"[^"]*"|'[^']*'/],
    ['tok-tag', /<\/?[a-zA-Z][\w-]*|\/?>/],
    ['tok-attr', /\b[a-zA-Z-]+(?==)/],
  ],
  css: [
    ['tok-com', /\/\*[\s\S]*?\*\//],
    ['tok-str', /"[^"]*"|'[^']*'/],
    ['tok-sel', /^[.#]?[\w-]+(?=[^{}]*\{)/m],
    ['tok-prop', /\b[a-z-]+(?=\s*:)/],
    ['tok-num', /\b\d+(\.\d+)?(px|%|rem|em|vh|vw|s|ms|deg|fr)?\b|#[0-9a-fA-F]{3,8}\b/],
    ['tok-kw', /!important|@media|@keyframes|@import/],
  ],
  js: [
    ['tok-com', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
    ['tok-str', /"[^"]*"|'[^']*'|`[^`]*`/],
    ['tok-kw', /\b(const|let|var|function|return|if|else|for|while|new|class|import|export|from|async|await|try|catch|null|undefined|true|false|this)\b/],
    ['tok-num', /\b\d+(\.\d+)?\b/],
    ['tok-prop', /\.\w+(?=\()/],
  ],
};

function highlight(source, lang) {
  const rules = GRAMMARS[lang];
  if (!rules) return escapeHtml(source);

  const combined = new RegExp(
    rules.map(([, re]) => `(${re.source})`).join('|'),
    'gm',
  );

  let out = '';
  let last = 0;
  let match = combined.exec(source);

  while (match) {
    out += escapeHtml(source.slice(last, match.index));
    // Which alternative fired? Group indices line up with the rule order only
    // if we count each rule's own capture groups, so find the first non-empty
    // top-level group by re-testing each rule against the matched text.
    const text = match[0];
    const rule = rules.find(([, re]) => new RegExp(`^(?:${re.source})$`, re.flags.replace('g', '')).test(text));
    out += rule
      ? `<span class="${rule[0]}">${escapeHtml(text)}</span>`
      : escapeHtml(text);
    last = match.index + text.length;
    if (combined.lastIndex === match.index) combined.lastIndex += 1; // zero-width guard
    match = combined.exec(source);
  }
  out += escapeHtml(source.slice(last));
  return out;
}

/* ── individual renderers ────────────────────────────────────────────────── */

const KIND_LABEL = {
  code: 'Code',
  console: 'Console',
  files: 'File structure',
  screenshot: 'Screenshot',
  network: 'Network',
  note: 'Note',
};

function head(ev) {
  return el('div', { class: 'ev__head' },
    el('span', { class: 'ev__kind', text: KIND_LABEL[ev.kind] ?? ev.kind }),
    el('span', { text: ev.label || '' }),
    ev.file ? el('span', { class: 'ev__file', text: ev.file }) : null);
}

function renderCode(ev) {
  const pre = el('pre', { class: 'code', tabindex: '0' });
  const code = document.createElement('code');
  code.innerHTML = highlight(ev.content ?? '', ev.lang);
  pre.append(code);
  return el('div', { class: 'ev ev--code' }, head(ev), el('div', { class: 'ev__body' }, pre));
}

function renderConsole(ev) {
  const icons = { error: '⛔', warn: '⚠️', info: '›' };
  const body = el('div', { class: 'console' },
    (ev.lines ?? []).map((line) => el('div', { class: `console__line console__line--${line.level ?? 'info'}` },
      el('span', { class: 'console__icon', text: icons[line.level] ?? icons.info }),
      el('span', { text: line.text }))));
  return el('div', { class: 'ev ev--console' }, head(ev), el('div', { class: 'ev__body' }, body));
}

function renderFiles(ev) {
  const pre = el('pre', { class: 'filetree', tabindex: '0' });
  (ev.tree ?? []).forEach((line) => {
    const isDir = line.trimEnd().endsWith('/');
    pre.append(el('span', { class: isDir ? 'is-dir' : '', text: `${line}\n` }));
  });
  return el('div', { class: 'ev ev--files' }, head(ev), el('div', { class: 'ev__body' }, pre));
}

function renderScreenshot(ev) {
  // srcdoc + sandbox with no allow-* flags: the mock renders, but it cannot run
  // scripts, navigate, or reach anything outside its own little box.
  const frame = el('iframe', {
    class: 'shotframe',
    sandbox: '',
    loading: 'lazy',
    title: ev.label || 'Screenshot',
    srcdoc: ev.html ?? '',
    scrolling: 'no',
  });
  frame.style.height = '260px';

  // Grow the frame to fit its content once it has painted.
  frame.addEventListener('load', () => {
    try {
      const h = frame.contentDocument?.body?.scrollHeight;
      if (h) frame.style.height = `${Math.min(560, Math.max(140, h + 8))}px`;
    } catch { /* cross-origin guard — the fixed height is a fine fallback */ }
  });

  const chrome = el('div', {
    class: 'shot__chrome',
    style: ev.width ? { maxWidth: `${ev.width}px` } : {},
  },
  el('div', { class: 'shot__bar' },
    el('i'), el('i'), el('i'),
    el('span', { class: 'shot__url', text: 'https://patient.local' })),
  frame);

  return el('div', { class: 'ev ev--shot' }, head(ev),
    el('div', { class: 'ev__body' },
      el('div', { class: 'shot' }, chrome,
        ev.caption ? el('div', { class: 'shot__caption', text: ev.caption }) : null)));
}

function renderNetwork(ev) {
  const heavy = (size) => /(\d+(\.\d+)?)\s*MB/i.test(size) && parseFloat(size) >= 1;
  const table = el('table', { class: 'nettable' },
    el('thead', {}, el('tr', {},
      el('th', { text: 'Name' }),
      el('th', { text: 'Type' }),
      el('th', { class: 'num', text: 'Size' }),
      el('th', { class: 'num', text: 'Time' }),
      el('th', { class: 'num', text: 'Status' }))),
    el('tbody', {}, (ev.rows ?? []).map((r) => el('tr', { class: heavy(r.size) ? 'is-heavy' : '' },
      el('td', { text: r.name }),
      el('td', { text: r.type }),
      el('td', { class: 'num', text: r.size }),
      el('td', { class: 'num', text: r.time }),
      el('td', { class: 'num', text: String(r.status) })))));

  return el('div', { class: 'ev ev--net' }, head(ev),
    el('div', { class: 'ev__body' }, el('div', { style: { overflowX: 'auto' } }, table)));
}

function renderNote(ev) {
  return el('div', { class: 'ev ev--note' }, head(ev),
    el('div', { class: 'ev__body' }, el('span', { text: ev.text ?? '' })));
}

const RENDERERS = {
  code: renderCode,
  console: renderConsole,
  files: renderFiles,
  screenshot: renderScreenshot,
  network: renderNetwork,
  note: renderNote,
};

export function renderEvidence(list = []) {
  return el('div', { class: 'evidence' },
    list.map((ev) => (RENDERERS[ev.kind] ?? renderNote)(ev)));
}

export { highlight };
