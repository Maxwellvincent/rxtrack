/**
 * Where you stopped in a lecture.
 *
 * The study screen is built on one promise: five atoms, then you may stop. That promise was
 * hollow while the round index lived in component state — leaving the screen sent you back to
 * round one, so stopping cost you your place and the cheapest move became "don't start". Your
 * answers were never lost (calibration writes on every question); only the bookmark was.
 *
 * Stored per lecture as the number of rounds COMPLETED, which is also the index of the next one
 * to run. localStorage matches `calibrationStore` — the prototype keeps its own progress until
 * there is a Firestore schema for it.
 */
export const PROGRESS_KEY = "rxt-lecture-round";

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Rounds completed for this lecture; 0 for one never studied. */
export function readRoundProgress(lectureId) {
  if (!lectureId) return 0;
  const n = readAll()[lectureId]?.round;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Record that `round` rounds are done.
 *
 * Monotonic on purpose: re-running an earlier round to review it is a normal thing to do, and
 * it must not throw away the rest of the lecture.
 */
export function saveRoundProgress(lectureId, round) {
  if (!lectureId || !Number.isInteger(round) || round < 0) return;
  const all = readAll();
  const prev = all[lectureId]?.round || 0;
  if (round <= prev) return;
  all[lectureId] = { round, at: Date.now() };
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* a full quota must not break studying */
  }
}

export function clearRoundProgress(lectureId) {
  if (!lectureId) return;
  const all = readAll();
  delete all[lectureId];
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/**
 * Which round to open on.
 *
 * A finished lecture starts over rather than opening on nothing, and so does a bookmark that no
 * longer fits — re-extracting a lecture can leave fewer rounds than you had already done.
 */
export function resumeRound(done, roundCount) {
  if (!roundCount || !Number.isInteger(done) || done <= 0) return 0;
  return done < roundCount ? done : 0;
}
