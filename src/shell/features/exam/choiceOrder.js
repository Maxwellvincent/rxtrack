/** Firestore map insertion order is not a presentation contract. */
export function orderedChoiceEntries(choices = {}) {
  return Object.entries(choices || {}).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
  );
}
