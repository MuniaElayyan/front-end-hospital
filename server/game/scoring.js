/**
 * Scoring is the HOST's job — a human reads the answer and awards the points.
 * The auto-grader below never writes a score by itself; it only pre-fills a
 * *suggestion* in the host panel, which the host accepts, edits or ignores.
 *
 * Rubric (max 20 per doctor):
 *   Correct Diagnosis  +5
 *   Correct Cause      +5
 *   Correct Treatment  +5
 *   Good Explanation   +5
 */

export const RUBRIC = [
  { key: 'diagnosis', label: 'Correct Diagnosis', max: 5 },
  { key: 'cause', label: 'Correct Cause', max: 5 },
  { key: 'treatment', label: 'Correct Treatment', max: 5 },
  { key: 'explanation', label: 'Good Explanation', max: 5 },
];

export const MAX_SCORE = RUBRIC.reduce((sum, r) => sum + r.max, 0);

export const emptyScore = () => ({
  diagnosis: 0,
  cause: 0,
  treatment: 0,
  explanation: 0,
  bonus: 0,
  total: 0,
  approved: null, // null = not reviewed, true = approved, false = rejected
  note: '',
  gradedAt: null,
});

export function totalOf(score) {
  const s = score ?? emptyScore();
  return (s.diagnosis || 0) + (s.cause || 0) + (s.treatment || 0)
    + (s.explanation || 0) + (s.bonus || 0);
}

const normalise = (text) => (text || '').toLowerCase().replace(/\s+/g, ' ');

/** How many of the model keywords the doctor's answer touches, 0..1. */
function keywordHitRate(answer, keywords = []) {
  if (!keywords.length) return 0;
  const text = normalise(answer);
  if (!text) return 0;
  const hits = keywords.filter((k) => text.includes(k.toLowerCase())).length;
  return hits / keywords.length;
}

/** Word count of real words — used only for the "good explanation" hint. */
const wordCount = (text) => normalise(text).split(' ').filter(Boolean).length;

/**
 * Suggest a score from a submission. Deliberately conservative: it rewards
 * hitting the key terms but caps itself below full marks, because judging a
 * genuinely good explanation is something only the host can do.
 *
 * @returns {{ suggestion: object, signals: object }}
 */
export function autoSuggest(submission, patientCase) {
  if (!submission || !patientCase?.answer?.keywords) {
    return { suggestion: emptyScore(), signals: {} };
  }

  const kw = patientCase.answer.keywords;
  const rates = {
    diagnosis: keywordHitRate(submission.diagnosis, kw.diagnosis),
    cause: keywordHitRate(submission.cause, kw.cause),
    treatment: keywordHitRate(submission.treatment, kw.treatment),
  };

  // A single strong hit is usually enough to be "on the right track", so the
  // curve is generous at the low end and needs real coverage for full marks.
  const toPoints = (rate) => {
    if (rate >= 0.5) return 5;
    if (rate >= 0.3) return 4;
    if (rate >= 0.15) return 3;
    if (rate > 0) return 2;
    return 0;
  };

  const words = wordCount(submission.diagnosis) + wordCount(submission.cause)
    + wordCount(submission.treatment);

  let explanation = 0;
  if (words >= 90) explanation = 4;
  else if (words >= 50) explanation = 3;
  else if (words >= 25) explanation = 2;
  else if (words >= 10) explanation = 1;

  const suggestion = {
    ...emptyScore(),
    diagnosis: toPoints(rates.diagnosis),
    cause: toPoints(rates.cause),
    treatment: toPoints(rates.treatment),
    explanation,
  };
  suggestion.total = totalOf(suggestion);

  return {
    suggestion,
    signals: {
      words,
      coverage: {
        diagnosis: Math.round(rates.diagnosis * 100),
        cause: Math.round(rates.cause * 100),
        treatment: Math.round(rates.treatment * 100),
      },
      matched: {
        diagnosis: (kw.diagnosis || []).filter((k) => normalise(submission.diagnosis).includes(k.toLowerCase())),
        cause: (kw.cause || []).filter((k) => normalise(submission.cause).includes(k.toLowerCase())),
        treatment: (kw.treatment || []).filter((k) => normalise(submission.treatment).includes(k.toLowerCase())),
      },
    },
  };
}

/** Ranked leaderboard rows. Ties share a rank. */
export function leaderboard(players, scores, finalScores = {}) {
  const rows = players.map((p) => {
    const s = scores[p.id];
    const finalPts = finalScores[p.id]?.total || 0;
    const caseTotal = totalOf(s);
    const total = caseTotal + finalPts;
    const graded = Boolean(s?.gradedAt);
    return {
      playerId: p.id,
      name: p.name,
      doctorNumber: p.doctorNumber,
      patientId: p.patientId,
      breakdown: {
        diagnosis: s?.diagnosis || 0,
        cause: s?.cause || 0,
        treatment: s?.treatment || 0,
        explanation: s?.explanation || 0,
        bonus: s?.bonus || 0,
        final: finalPts,
      },
      approved: s?.approved ?? null,
      graded,
      accuracy: graded ? Math.round((caseTotal / MAX_SCORE) * 100) : null,
      solved: (s?.approved === true) ? 1 : 0,
      total,
    };
  });

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  let rank = 0;
  let lastTotal = null;
  rows.forEach((row, i) => {
    if (row.total !== lastTotal) {
      rank = i + 1;
      lastTotal = row.total;
    }
    row.rank = rank;
  });

  return rows;
}
