/**
 * The eight phases of a shift. The host drives the room from one to the next
 * and every connected client follows automatically — nobody navigates by hand.
 */

export const PHASES = [
  { id: 'lobby', number: 1, label: 'Waiting Room', hint: 'Doctors are checking in.' },
  { id: 'alert', number: 2, label: 'Emergency Alert', hint: 'The cinematic. Plays once, for everyone.' },
  { id: 'selection', number: 3, label: 'Patient Selection', hint: 'Each doctor claims exactly one patient.' },
  { id: 'diagnosis', number: 4, label: 'Diagnosis', hint: 'Private patient files. Doctors write their reports.' },
  { id: 'conference', number: 5, label: 'Medical Conference', hint: 'Doctors present one by one, on a shared timer.' },
  { id: 'reveal', number: 6, label: 'Reveal', hint: 'Correct answers, patient by patient.' },
  { id: 'leaderboard', number: 7, label: 'Leaderboard', hint: 'Top doctors.' },
  { id: 'final', number: 8, label: 'Final Patient', hint: 'One patient. Every doctor. One clock.' },
];

export const PHASE_IDS = PHASES.map((p) => p.id);

export const isPhase = (id) => PHASE_IDS.includes(id);

export const phaseMeta = (id) => PHASES.find((p) => p.id === id) ?? PHASES[0];

export function nextPhase(id) {
  const i = PHASE_IDS.indexOf(id);
  if (i < 0 || i === PHASE_IDS.length - 1) return null;
  return PHASE_IDS[i + 1];
}

export function prevPhase(id) {
  const i = PHASE_IDS.indexOf(id);
  if (i <= 0) return null;
  return PHASE_IDS[i - 1];
}

/** Default countdown suggested by the host panel when a phase begins. */
export const SUGGESTED_TIMER = {
  selection: { seconds: 90, label: 'Patient selection closes in' },
  diagnosis: { seconds: 600, label: 'Diagnosis time remaining' },
  conference: { seconds: 60, label: 'Presenting' },
  final: { seconds: 600, label: 'Final patient' },
};
