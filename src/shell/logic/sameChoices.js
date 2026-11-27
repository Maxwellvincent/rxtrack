// Firestore does not keep map key order, so a reloaded question can list the
// same choices as {E,A,C,...}. Compare choices by key, never by serialized order.
const choiceKey = choices => JSON.stringify(Object.entries(choices || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** True when two choice maps hold the same letters and texts, in any key order. */
export function sameChoices(a, b) {
  return choiceKey(a) === choiceKey(b);
}
