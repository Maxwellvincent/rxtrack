import * as terms from "./terms.js";
import * as lectures from "./lectures.js";
import * as blockObjectives from "./blockObjectives.js";
import * as weakConcepts from "./weakConcepts.js";
import * as performance from "./performance.js";
import * as completion from "./completion.js";
import * as examDates from "./examDates.js";
import * as calibration from "./calibration.js";
import * as trackerV2 from "./trackerV2.js";
import * as mcqBank from "./mcqBank.js";

export { terms, lectures, blockObjectives, weakConcepts, performance, completion, examDates, calibration, trackerV2, mcqBank };

const byKey = Object.fromEntries(
  [terms, lectures, blockObjectives, weakConcepts, performance, completion, examDates, calibration, trackerV2, mcqBank]
    .map((mod) => [mod.key, mod])
);

// Returns the store module that owns a logical localStorage key, or undefined
// for keys that are still plain localStorage (out of scope for SP1 T0.3).
export function storeForKey(logicalKey) {
  return byKey[logicalKey];
}
