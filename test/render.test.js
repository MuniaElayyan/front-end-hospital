/**
 * Client-side rendering tests.
 *
 * The browser modules are pure DOM builders, so they can be exercised against
 * a lightweight DOM. What matters most here is the syntax highlighter: it runs
 * over snippets of deliberately-broken HTML, and if it ever emitted its input
 * as live markup the game would be injecting `<script>` tags into its own page.
 */

import assert from 'node:assert/strict';
import test, { before } from 'node:test';

import { parseHTML } from 'linkedom';

let el;
let renderEvidence;
let highlight;
let PATIENTS;
let FINAL_PATIENT;

before(async () => {
  // Install a DOM before the modules under test touch `document`.
  const dom = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.Node = dom.Node;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

  ({ el } = await import('../public/js/ui.js'));
  ({ renderEvidence, highlight } = await import('../public/js/evidence.js'));
  ({ PATIENTS, FINAL_PATIENT } = await import('../server/game/patients.js'));
});

/* ── the element factory ─────────────────────────────────────────────────── */

test('el() builds elements and escapes user text', () => {
  const node = el('div', { class: 'x', dataset: { id: '7' } },
    el('span', { text: '<img src=x onerror=alert(1)>' }));

  assert.equal(node.tagName, 'DIV');
  assert.equal(node.className, 'x');
  assert.equal(node.dataset.id, '7');
  // The payload survives as *text* — no element was created from it.
  assert.equal(node.querySelector('img'), null);
  assert.equal(node.textContent, '<img src=x onerror=alert(1)>');
});

test('el() skips null and false children', () => {
  const node = el('div', {}, 'a', null, false, undefined, 'b');
  assert.equal(node.textContent, 'ab');
});

/* ── the highlighter ─────────────────────────────────────────────────────── */

test('highlight() never emits live markup from a snippet', () => {
  const nasty = '<script>alert("xss")</script><img src=x onerror="steal()">';
  const out = highlight(nasty, 'html');

  assert.ok(!/<script/i.test(out), 'no live <script> survives');
  assert.ok(!/<img/i.test(out), 'no live <img> survives');
  assert.ok(out.includes('&lt;script'), 'it is escaped instead');

  // And when parsed as HTML, the only elements are our own <span> wrappers.
  const { document: doc } = parseHTML(`<!doctype html><body><pre>${out}</pre></body>`);
  const tags = new Set([...doc.querySelectorAll('pre *')].map((n) => n.tagName));
  assert.deepEqual([...tags], ['SPAN']);
  assert.match(doc.querySelector('pre').textContent, /alert\("xss"\)/);
});

test('highlight() tokenises each language without losing characters', () => {
  const samples = {
    html: '<img src="images/laptop.png" alt="Laptop"> <!-- gone -->',
    css: '.page { width: 100%; padding: 0 25px; color: #fff !important; }',
    js: 'const a = 1; // note\nbutton.addEventListener("click", () => {});',
  };
  for (const [lang, source] of Object.entries(samples)) {
    const out = highlight(source, lang);
    const { document: doc } = parseHTML(`<!doctype html><body><pre>${out}</pre></body>`);
    assert.equal(doc.querySelector('pre').textContent, source, `${lang} round-trips exactly`);
    assert.ok(out.includes('<span class="tok-'), `${lang} produced tokens`);
  }
});

/* ── evidence blocks ─────────────────────────────────────────────────────── */

test('every evidence kind used by the 12 cases has a renderer', () => {
  const kinds = new Set();
  [...PATIENTS, FINAL_PATIENT].forEach((p) => p.evidence.forEach((e) => kinds.add(e.kind)));

  for (const kind of kinds) {
    const node = renderEvidence([{ kind, label: 'x', content: 'a', lines: [], tree: [], rows: [], html: '<p>hi</p>', text: 't' }]);
    assert.ok(node.querySelector('.ev'), `${kind} renders an evidence block`);
    assert.ok(!node.querySelector('.ev--note') || kind === 'note', `${kind} did not fall through to the note renderer`);
  }
  // The set is genuinely mixed — that is the pedagogical point of the ward.
  assert.ok(kinds.size >= 5, `expected varied evidence, got ${[...kinds].join(', ')}`);
});

test('screenshot evidence renders into a locked-down iframe', () => {
  const node = renderEvidence([{ kind: 'screenshot', label: 'Mobile', html: '<h1>hi</h1>', caption: 'c' }]);
  const frame = node.querySelector('iframe');
  assert.ok(frame, 'an iframe is used');
  assert.equal(frame.getAttribute('sandbox'), '', 'sandboxed with no capabilities granted');
  assert.ok(frame.getAttribute('srcdoc').includes('<h1>hi</h1>'));
  assert.equal(frame.getAttribute('src'), null, 'no network fetch');
});

test('all 12 patient cases render end to end', () => {
  assert.equal(PATIENTS.length, 12);
  PATIENTS.forEach((p) => {
    const node = renderEvidence(p.evidence);
    assert.equal(node.querySelectorAll('.ev').length, p.evidence.length,
      `patient ${p.number} rendered every evidence block`);
  });
});

/* ── content sanity ──────────────────────────────────────────────────────── */

test('each case is complete, distinct and keeps its disease name out of the file', () => {
  const titles = new Set();
  PATIENTS.forEach((p) => {
    assert.ok(p.symptoms.length >= 3, `patient ${p.number} has enough symptoms`);
    assert.ok(p.evidence.length >= 2, `patient ${p.number} has enough evidence`);
    assert.ok(p.answer.diagnosis.length > 40, `patient ${p.number} has a real diagnosis`);
    assert.ok(p.answer.cause.length > 40);
    assert.ok(p.answer.treatment.length > 40);
    assert.ok(p.answer.keywords.diagnosis.length && p.answer.keywords.cause.length
      && p.answer.keywords.treatment.length, `patient ${p.number} is auto-gradable`);

    assert.ok(!titles.has(p.title), `"${p.title}" is used once`);
    titles.add(p.title);

    // The disease name must not appear in anything the student is shown.
    const shown = JSON.stringify({ s: p.symptoms, e: p.evidence, t: p.patientType }).toLowerCase();
    assert.ok(!shown.includes(p.title.toLowerCase()),
      `patient ${p.number} does not give its own answer away`);
  });
});

test('the final patient carries five independent faults', () => {
  assert.equal(FINAL_PATIENT.bugCount, 5);
  assert.equal(FINAL_PATIENT.answer.findings.length, 5);
  assert.equal(FINAL_PATIENT.symptoms.length, 5);
  FINAL_PATIENT.answer.findings.forEach((f) => {
    assert.ok(f.title && f.cause && f.fix);
  });
});
