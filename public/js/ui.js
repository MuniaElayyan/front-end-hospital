/**
 * ui.js — tiny DOM helpers, toasts, the shared clock renderer and the
 * connection banner. No framework: every element is created explicitly and
 * every piece of user text goes in as `textContent`, never as HTML.
 */

import { onConnectionChange, serverNow } from './bus.js';

/* ── element factory ─────────────────────────────────────────────────────── */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = value;          // only ever for our own markup
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function mount(node, ...children) {
  clear(node);
  children.flat().filter(Boolean).forEach((c) => node.append(c));
  return node;
}

/* ── formatting ──────────────────────────────────────────────────────────── */

export const pad2 = (n) => String(n).padStart(2, '0');

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export const patientLabel = (number) => `PATIENT ${pad2(number)}`;

/* ── toasts ──────────────────────────────────────────────────────────────── */

const ICONS = { success: '✅', error: '⛔', warn: '⚠️', info: '💬' };

function toastHost() {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

export function toast(message, level = 'info', ms = 4200) {
  if (!message) return;
  const node = el('div', { class: `toast toast--${level}`, role: 'status' },
    el('span', { class: 'toast__icon', text: ICONS[level] ?? ICONS.info }),
    el('span', { text: message }));
  toastHost().append(node);

  const kill = () => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 280);
  };
  const timer = setTimeout(kill, ms);
  node.addEventListener('click', () => { clearTimeout(timer); kill(); });
}

export const toastError = (err) => toast(err?.message || String(err), 'error', 5200);

/* ── connection banner ───────────────────────────────────────────────────── */

export function installConnectionBanner() {
  const banner = el('div', { class: 'conn', hidden: true, role: 'status' });
  document.body.append(banner);

  let hideTimer = null;
  onConnectionChange((status) => {
    clearTimeout(hideTimer);
    banner.hidden = false;
    banner.className = 'conn';

    if (status === 'disconnected' || status === 'error') {
      banner.classList.add('conn--down');
      mount(banner,
        el('span', { class: 'dot dot--pulse' }),
        el('span', { text: 'Connection lost — reconnecting' }),
        el('span', { class: 'loading-dots' }));
    } else if (status === 'reconnected') {
      banner.classList.add('conn--up');
      mount(banner, el('span', { class: 'dot' }), el('span', { text: 'Back online' }));
      hideTimer = setTimeout(() => { banner.hidden = true; }, 2200);
    } else {
      banner.hidden = true;
    }
  });
}

/* ── the shared countdown ────────────────────────────────────────────────── */
// Rendered from the server's `endsAt`, corrected by our measured clock offset.
// Every device therefore shows the same number, whatever its own clock says.

export function createClock({ onZero } = {}) {
  const value = el('div', { class: 'clock', text: '--:--' });
  const label = el('div', { class: 'label', text: '' });
  const fill = el('div', { class: 'clockbar__fill', style: { width: '0%' } });
  const bar = el('div', { class: 'clockbar' }, fill);
  const root = el('div', { class: 'stack', style: { gap: '4px' } }, label, value, bar);

  let timer = null;
  let firedZero = false;

  function paint(state) {
    if (!state || (!state.running && !state.remainingMs)) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    label.textContent = state.label || 'Time remaining';

    const left = state.running && state.endsAt != null
      ? Math.max(0, state.endsAt - serverNow())
      : state.remainingMs;

    value.textContent = formatClock(left);
    const ratio = state.durationMs ? left / state.durationMs : 0;
    fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;

    value.classList.toggle('clock--danger', left <= 10_000);
    value.classList.toggle('clock--warn', left > 10_000 && left <= 30_000);
    fill.classList.toggle('is-danger', left <= 10_000);
    fill.classList.toggle('is-warn', left > 10_000 && left <= 30_000);

    if (left <= 0 && state.running && !firedZero) {
      firedZero = true;
      onZero?.();
    }
    if (left > 0) firedZero = false;
  }

  return {
    node: root,
    update(state) {
      clearInterval(timer);
      paint(state);
      if (state?.running) timer = setInterval(() => paint(state), 250);
    },
    stop() { clearInterval(timer); },
  };
}

/* ── confirm dialog ──────────────────────────────────────────────────────── */

export function confirmDialog({ title, body, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const close = (answer) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(answer); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };

    const card = el('div', { class: 'panel overlay__card' },
      el('h3', { text: title }),
      body ? el('p', { class: 'dim', text: body }) : null,
      el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '18px' } },
        el('button', { class: 'btn btn--ghost', onClick: () => close(false), text: 'Cancel' }),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          onClick: () => close(true),
          text: confirmText,
        })));

    const overlay = el('div', {
      class: 'overlay',
      onClick: (e) => { if (e.target === overlay) close(false); },
    }, card);

    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    card.querySelector('.btn--primary, .btn--danger')?.focus();
  });
}

/* ── small bits ──────────────────────────────────────────────────────────── */

export function emptyState(icon, message) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty__icon', text: icon }),
    el('div', { text: message }));
}

export function ecgStrip({ danger = false, flat = false } = {}) {
  // One period of a plausible-looking trace, drawn twice so the scroll loops.
  const beat = 'l14 0 l4 -6 l4 14 l5 -26 l5 22 l4 -4 l16 0';
  const flatBeat = 'l52 0';
  const seg = flat ? flatBeat : beat;
  const d = `M0 29 ${seg} ${seg} ${seg} ${seg} ${seg} ${seg} ${seg} ${seg}`;
  return el('div', {
    class: `ecg${danger ? ' ecg--danger' : ''}${flat ? ' ecg--flat' : ''}`,
    html: `<svg viewBox="0 0 832 58" preserveAspectRatio="none"><path d="${d}"/></svg>`,
    'aria-hidden': 'true',
  });
}

export function statTile(label, value, tone) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat__label', text: label }),
    el('div', { class: 'stat__value', style: tone ? { color: `var(--${tone})` } : {}, text: String(value) }));
}

/** Swap the visible screen inside a container, with a soft cross-fade. */
export function showScreen(container, node) {
  const current = container.firstElementChild;
  if (current) {
    current.style.transition = 'opacity .16s';
    current.style.opacity = '0';
  }
  setTimeout(() => { mount(container, node); }, current ? 150 : 0);
}

export function setPct(input) {
  input.style.setProperty('--pct', `${input.value}%`);
}
