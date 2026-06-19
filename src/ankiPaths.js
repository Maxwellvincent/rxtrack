// Parse + map Proper Learning deck paths to the app's term/block model.

const ANCHOR = "Proper Learning";

/** Normalize a name for matching: lowercase, collapse non-alphanumerics. */
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Slugify a name for a fallback block id. */
function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse a deck path anchored on the exact `Proper Learning` segment.
 * Returns null for `Proper Learning+` or any path without that anchor.
 */
export function parseProperLearningPath(deckPath) {
  if (!deckPath || typeof deckPath !== "string") return null;
  const parts = deckPath.split("::").map((s) => s.trim());
  const anchorIdx = parts.findIndex((p) => p === ANCHOR);
  if (anchorIdx === -1) return null;
  const rest = parts.slice(anchorIdx + 1);
  if (rest.length < 2) return null; // need at least term + block
  return {
    term: rest[0],
    block: rest[1],
    subject: rest[2] ?? null,
    lecture: rest[3] ?? null,
    author: rest[4] ?? null,
  };
}

/** Resolve a parsed block name to an app block id + term id, else a slug fallback. */
export function resolveBlock(blockName, appTerms) {
  const target = norm(blockName);
  for (const t of appTerms || []) {
    for (const b of t.blocks || []) {
      if (norm(b.name) === target || norm(b.id) === target) {
        return { blockId: b.id, termId: t.id };
      }
    }
  }
  return { blockId: slug(blockName), termId: null };
}
