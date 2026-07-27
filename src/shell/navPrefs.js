/**
 * Sidebar preferences — which terms are collapsed.
 *
 * Local-only and deliberately not synced: this is a per-device view preference,
 * not study data. Storing collapsed ids (rather than expanded ones) means a term
 * imported later shows up expanded instead of silently hidden.
 */

export const NAV_PREFS_KEY = "rxt-shell-nav";

function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_PREFS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(NAV_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* preference only — losing it costs nothing */ }
}

export function readCollapsedTerms() {
  const ids = readPrefs().collapsedTerms;
  return new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);
}

export function writeCollapsedTerms(collapsed) {
  writePrefs({ ...readPrefs(), collapsedTerms: [...(collapsed || [])] });
}

/** Toggle one term, returning the new set (never mutates the one passed in). */
export function toggleTerm(collapsed, termId) {
  const next = new Set(collapsed || []);
  if (next.has(termId)) next.delete(termId);
  else next.add(termId);
  return next;
}

/**
 * Collapse every term except the one given — "I'm only working in Term 2".
 * A term with no id is left alone; it could not be reopened.
 */
export function collapseAllExcept(terms, keepTermId) {
  return new Set((terms || []).map((t) => t.id).filter((id) => id && id !== keepTermId));
}

/** A collapsed term still has to show the active block, or the nav lies. */
export function isTermVisible(term, { collapsed, activeBlockId }) {
  if (!collapsed?.has(term.id)) return true;
  return (term.blocks || []).some((b) => b.id === activeBlockId);
}

/**
 * Which block to land on when nothing is selected.
 *
 * Prefers a block in a term that is NOT collapsed: collapsing Term 1 to focus on
 * Term 2 and then being dropped back into Term 1 on every reload — which
 * re-expands it, since the active block's term is always shown — defeats the
 * point. Falls back to the first block when every term is collapsed.
 */
export function defaultBlockId(blocks, collapsed) {
  const list = blocks || [];
  const open = list.find((b) => !collapsed?.has(b.termId));
  return (open ?? list[0])?.id ?? null;
}
