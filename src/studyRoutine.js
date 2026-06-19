// studyRoutine.js
//
// Daily study-routine engine. Self-contained, localStorage-backed.
//
// History: the original module + StudyRoutineModal.jsx were never committed to
// `main` (lived only on the author's machine) — their absence broke every
// recent Vercel build. This is a clean reconstruction matching the consumers
// in App.jsx (user-menu summary: evaluateToday / getSuggestions) plus the
// write helpers the rebuilt StudyRoutineModal needs.
//
// Storage shape (rxt-study-routine):
//   {
//     items: [{ id, label, recurring, completedDates: ["YYYY-MM-DD", ...] }],
//     createdAt: ISO
//   }

const ROUTINE_KEY = "rxt-study-routine";

const DEFAULT_ITEMS = [
  { label: "Review today's SRS-due objectives", recurring: true },
  { label: "Drill weakest block (1 session)", recurring: true },
  { label: "Anki — clear due cards", recurring: true },
  { label: "Deep Learn one new lecture", recurring: true },
];

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function uid() {
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function normalizeItem(it) {
  return {
    id: it.id || uid(),
    label: String(it.label || "").trim(),
    recurring: it.recurring !== false,
    completedDates: Array.isArray(it.completedDates) ? it.completedDates.slice() : [],
  };
}

export function getRoutine() {
  try {
    const raw = localStorage.getItem(ROUTINE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        return { ...parsed, items: parsed.items.map(normalizeItem) };
      }
    }
  } catch {
    // fall through to seed
  }
  // Seed first-run defaults.
  const seeded = {
    items: DEFAULT_ITEMS.map(normalizeItem),
    createdAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(seeded));
  } catch {}
  return seeded;
}

export function saveRoutine(routine) {
  try {
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(routine));
  } catch {}
  return routine;
}

export function isDoneToday(item, day = todayKey()) {
  return Array.isArray(item.completedDates) && item.completedDates.includes(day);
}

/** Toggle an item's completion for today. Returns the updated routine. */
export function toggleItem(id, day = todayKey()) {
  const routine = getRoutine();
  routine.items = routine.items.map((it) => {
    if (it.id !== id) return it;
    const dates = new Set(it.completedDates);
    dates.has(day) ? dates.delete(day) : dates.add(day);
    return { ...it, completedDates: [...dates] };
  });
  return saveRoutine(routine);
}

export function addItem(label) {
  const routine = getRoutine();
  const clean = String(label || "").trim();
  if (!clean) return routine;
  routine.items.push(normalizeItem({ label: clean, recurring: true }));
  return saveRoutine(routine);
}

export function removeItem(id) {
  const routine = getRoutine();
  routine.items = routine.items.filter((it) => it.id !== id);
  return saveRoutine(routine);
}

/**
 * Evaluate today's progress.
 * @returns {{ doneCount, totalCount, items }}
 */
export function evaluateToday(day = todayKey()) {
  const routine = getRoutine();
  const items = routine.items || [];
  const doneCount = items.reduce((n, it) => n + (isDoneToday(it, day) ? 1 : 0), 0);
  return { doneCount, totalCount: items.length, items };
}

// ---- Suggestions ---------------------------------------------------------
// Lightweight heuristics over existing localStorage caches. Each helper is
// wrapped so a missing/oddly-shaped key never throws.

function safeJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function countSrsDue() {
  const day = todayKey();
  let due = 0;
  const objs = safeJSON("rxt-block-objectives", {});
  const buckets = objs && typeof objs === "object" ? Object.values(objs) : [];
  for (const bucket of buckets) {
    const list = Array.isArray(bucket)
      ? bucket
      : bucket && typeof bucket === "object"
      ? [...(bucket.imported || []), ...(bucket.extracted || [])]
      : [];
    for (const o of list) {
      if (o && o.srsNextReview && o.srsNextReview <= day) due++;
    }
  }
  return due;
}

function countWeakConcepts() {
  const weak = safeJSON("rxt-weak-concepts", null);
  if (Array.isArray(weak)) return weak.length;
  if (weak && typeof weak === "object") return Object.keys(weak).length;
  return 0;
}

/**
 * Today's suggestions, derived from study state. Returns an array of
 * { id, label, kind } — empty when nothing is actionable.
 */
export function getSuggestions() {
  const out = [];
  try {
    const due = countSrsDue();
    if (due > 0) {
      out.push({ id: "srs", kind: "srs", label: `${due} objective${due === 1 ? "" : "s"} due for SRS review` });
    }
    const weak = countWeakConcepts();
    if (weak > 0) {
      out.push({ id: "weak", kind: "weak", label: `${weak} weak concept${weak === 1 ? "" : "s"} to shore up` });
    }
    const { doneCount, totalCount } = evaluateToday();
    if (totalCount > 0 && doneCount < totalCount) {
      out.push({ id: "routine", kind: "routine", label: `${totalCount - doneCount} routine task${totalCount - doneCount === 1 ? "" : "s"} left today` });
    }
  } catch {
    // never block the UI on a suggestion failure
  }
  return out;
}
