/** Canonical Deep Learn session phase order (objective-driven, lecture-specific flow). */
export const DL_PHASE_ORDER = ["prime", "teach", "patient", "selftest", "gaps", "apply", "summary"];

export const DEEP_LEARN_PHASES = [
  { id: "prime", label: "Prime", icon: "🧠", title: "Brain Dump", subtitle: "PHASE 1 OF 6 · ACTIVATE PRIOR KNOWLEDGE" },
  { id: "teach", label: "Learn", icon: "📖", title: "Guided Teaching", subtitle: "PHASE 2 OF 6 · LEARN THE CONTENT" },
  { id: "patient", label: "Patient", icon: "🏥", title: "Patient Anchor", subtitle: "PHASE 3 OF 6 · APPLY TO A PATIENT" },
  { id: "selftest", label: "Test", icon: "⚡", title: "Self-Test", subtitle: "PHASE 4 OF 6 · RETRIEVE FROM MEMORY" },
  { id: "gaps", label: "Gaps", icon: "🔍", title: "Fix Your Gaps", subtitle: "PHASE 5 OF 6 · TARGETED REVIEW" },
  { id: "apply", label: "Apply", icon: "📝", title: "Clinical MCQ", subtitle: "PHASE 6 OF 6 · TEST APPLICATION" },
];

export function migrateDeepLearnPhase(p) {
  if (!p) return "prime";
  const legacy = {
    brainDump: "prime",
    patientCase: "patient",
    structureFunction: "gaps",
    algorithmDraw: "selftest",
    readRecall: "selftest",
    mcq: "apply",
  };
  if (legacy[p]) return legacy[p];
  return DL_PHASE_ORDER.includes(p) ? p : "prime";
}

export function normalizeSectionUnderstood(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (!Number.isNaN(i) && i >= 0) out[i] = !!v;
  }
  return out;
}

export function deepLearnPhaseNumber(phase) {
  const p = migrateDeepLearnPhase(phase);
  return (
    {
      prime: 1,
      teach: 2,
      patient: 3,
      selftest: 4,
      gaps: 5,
      apply: 6,
      summary: 7,
      saq: 1,
    }[p] ?? 1
  );
}

/** Normalize phase strings in saved rxt-dl-sessions map (localStorage). */
/** Restore index→number maps from JSON (e.g. structureSaqAttempts). */
export function normalizeNumericIndexRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (!Number.isNaN(i) && i >= 0) {
      const n = typeof v === "number" ? v : Number(v);
      out[i] = Number.isFinite(n) ? n : 0;
    }
  }
  return out;
}

export function migrateSavedDeepLearnSessionsMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out = { ...map };
  for (const id of Object.keys(out)) {
    const s = out[id];
    if (!s || typeof s !== "object") continue;
    if (typeof s.phase === "string") {
      out[id] = { ...s, phase: migrateDeepLearnPhase(s.phase) };
    }
  }
  return out;
}
