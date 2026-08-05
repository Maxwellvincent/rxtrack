/**
 * Where you stopped in a lecture.
 *
 * The study screen is built on one promise: five atoms, then you may stop. That promise was
 * hollow while the round index lived in component state — leaving the screen sent you back to
 * round one, so stopping cost you your place and the cheapest move became "don't start".
 *
 * Storage is Firestore-first (src/stores/lectureRounds.js), so the bookmark follows you to the
 * phone; signed out it falls back to localStorage. Progress is the number of rounds COMPLETED,
 * which is also the index of the next one to run.
 */
import * as store from "../../../stores/lectureRounds.js";

export const PROGRESS_KEY = store.key;

/** Rounds completed for this lecture; 0 for one never studied. */
export function readRoundProgress(userId, lectureId) {
  if (!lectureId) return 0;
  const n = store.read(userId)?.[lectureId]?.round;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Record that `round` rounds are done.
 *
 * Monotonic on purpose: re-running an earlier round to review it is a normal thing to do, and it
 * must not throw away the rest of the lecture — nor may a device that is behind undo one ahead.
 */
export function saveRoundProgress(userId, lectureId, round) {
  store.markRoundDone(userId, lectureId, round);
}

export function clearRoundProgress(userId, lectureId) {
  store.clearLecture(userId, lectureId);
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
