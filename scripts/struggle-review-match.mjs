export const normalizeReviewLabel = (value) => String(value || "")
  .toLowerCase()
  .replace(/\b(anking|proper learning|term|week|lecture|lec|dla|cards?)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

/** Conservative deck-path → lecture matcher. Returns null below 60% title-token overlap. */
export function matchReviewToLecture(review, lectures) {
  const deck = normalizeReviewLabel(review?.deck);
  if (!deck) return null;
  const deckTokens = new Set(deck.split(" ").filter((token) => token.length > 2));
  let best = null;
  let bestScore = 0;
  for (const lecture of lectures || []) {
    const title = normalizeReviewLabel(lecture.lectureTitle || lecture.fileName || lecture.filename);
    if (!title) continue;
    const titleTokens = title.split(" ").filter((token) => token.length > 2);
    const overlap = titleTokens.filter((token) => deckTokens.has(token)).length;
    const score = deck.includes(title) ? 100 + titleTokens.length : overlap / Math.max(titleTokens.length, 1);
    if (score > bestScore) { best = lecture; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}
