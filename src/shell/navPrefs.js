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

/**
 * Last tab/block/more-view on screen — restored on reload so refreshing the
 * page doesn't bounce back to Today.
 */
export function readLastView() {
  const v = readPrefs().lastView;
  return v && typeof v === "object" ? v : {};
}

export function writeLastView({ tab, selectedBlockId, moreView } = {}) {
  writePrefs({ ...readPrefs(), lastView: { tab, selectedBlockId, moreView } });
}

/** A collapsed term still has to show the active block, or the nav lies. */
export function isTermVisible(term, { collapsed, activeBlockId }) {
  if (!collapsed?.has(term.id)) return true;
  return (term.blocks || []).some((b) => b.id === activeBlockId);
}

/** "YYYY-MM-DD" as a LOCAL calendar date — the convention the schedulers use. */
function asLocalDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Which block to land on when nothing is selected.
 *
 * The block being studied is the one whose exam is next, not the first in the
 * list — landing in Term 1 / FTM 1 every reload while Term 2 is underway is
 * just wrong, and collapsing Term 1 did not fix it because the active block's
 * term is always shown, which re-expanded it.
 *
 * Order: the soonest exam still ahead, then the most recently passed exam (the
 * block just finished beats one from a year ago), then a block in a term that is
 * not collapsed, then whatever is first.
 */
export function defaultBlockId(blocks, collapsed, examDates = {}, now = new Date()) {
  const list = blocks || [];
  if (!list.length) return null;

  const dated = list
    .map((b) => ({ block: b, exam: asLocalDate(examDates?.[b.id]) }))
    .filter((x) => x.exam);

  const upcoming = dated
    .filter((x) => x.exam >= now)
    .sort((a, b) => a.exam - b.exam);
  if (upcoming.length) return upcoming[0].block.id;

  const past = dated.sort((a, b) => b.exam - a.exam);
  if (past.length) return past[0].block.id;

  const open = list.find((b) => !collapsed?.has(b.termId));
  return (open ?? list[0])?.id ?? null;
}
