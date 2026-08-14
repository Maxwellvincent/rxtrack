/**
 * Weak concept tracker — shared storage with App.jsx (rxt-weak-concepts).
 * Used by Tracker quick log without modifying App.jsx.
 */
import { callAI } from "./aiClient";
import { supabase, scheduleDebouncedCloudPush } from "./supabase";

/**
 * A lecture is "available" (i.e. it has happened) when it has no scheduled
 * date, or its date is today or earlier. Used to exclude upcoming lectures
 * from weak/must-do surfacing.
 */
export function isLectureAvailable(lec, todayISO) {
  if (!lec) return true;
  if (!lec.lectureDate) return true;
  const today = todayISO || new Date().toISOString().slice(0, 10);
  return String(lec.lectureDate).slice(0, 10) <= today;
}

/**
 * Filter a weak-concept list to those anchored to at least one lecture
 * that has already happened. Concepts with no linkedLecIds at all are kept
 * (they're block-level and not tied to any particular lecture).
 */
export function filterAvailableWeakConcepts(concepts, lectures, todayISO) {
  if (!Array.isArray(concepts)) return [];
  if (!Array.isArray(lectures) || lectures.length === 0) return concepts;
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const byId = new Map(lectures.map((l) => [l.id, l]));
  return concepts.filter((c) => {
    const ids = Array.isArray(c?.linkedLecIds) ? c.linkedLecIds : [];
    if (ids.length === 0) return true;
    return ids.some((id) => {
      const lec = byId.get(id);
      return !lec || isLectureAvailable(lec, today);
    });
  });
}

async function triggerWeakConceptPush() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) scheduleDebouncedCloudPush(user.id);
  } catch (e) {
    // Offline / not signed in — localStorage write still persists.
  }
}

function tryParseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text.trim());
  } catch (e) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (e) {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) {}
  }
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1));
    } catch (e) {}
  }
  return null;
}

function getWeakConcepts(blockId) {
  try {
    const stored = JSON.parse(localStorage.getItem("rxt-weak-concepts") || "{}");
    return {
      block: Array.isArray(stored[blockId]) ? stored[blockId] : [],
      lifetime: Array.isArray(stored.lifetime) ? stored.lifetime : [],
    };
  } catch (e) {
    return { block: [], lifetime: [] };
  }
}

function saveWeakConcepts(blockId, blockConcepts, lifetimeConcepts) {
  try {
    const stored = JSON.parse(localStorage.getItem("rxt-weak-concepts") || "{}");
    stored[blockId] = blockConcepts;
    stored.lifetime = lifetimeConcepts;
    localStorage.setItem("rxt-weak-concepts", JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent("rxt-weak-concepts-updated"));
    triggerWeakConceptPush();
  } catch (e) {
    console.error("saveWeakConcepts failed:", e);
  }
}

async function extractWeakConcept(question, wrongAnswer, correctAnswer, lectureContext) {
  try {
    const raw = await callAI(
      `Extract the core medical concept being tested.
Return JSON only: {"concept":"short concept name","description":"1 sentence what to understand","angle":"anatomy|physiology|clinical|pathology"}
concept = 2-5 words max, the specific thing missed
e.g. "radial nerve innervation" not "upper limb anatomy"`,
      `Question: ${String(question || "").slice(0, 200)}
Wrong answer: ${String(wrongAnswer || "").slice(0, 100)}
Correct answer: ${String(correctAnswer || "").slice(0, 100)}
Lecture: ${String(lectureContext || "")}`,
      300
    );
    const parsed = tryParseJSON(raw);
    return (
      parsed || {
        concept: "Unknown concept",
        description: "",
        angle: "general",
      }
    );
  } catch (e) {
    return { concept: "Unknown concept", description: "", angle: "general" };
  }
}

export async function recordWrongAnswer({
  blockId,
  blockName,
  question,
  wrongAnswer,
  correctAnswer,
  linkedLecId,
  lectureLabel,
  source = "drill",
  objectiveId = null,
}) {
  try {
    if (!blockId) return;
    const conceptData = await extractWeakConcept(question, wrongAnswer, correctAnswer, lectureLabel || "");
    let { block: blockConcepts, lifetime } = getWeakConcepts(blockId);
    blockConcepts = [...blockConcepts];
    lifetime = [...lifetime];
    const now = new Date().toISOString();
    const normalizedNew = (conceptData.concept || "unknown").toLowerCase().trim();

    const sourceQ = {
      question: String(question || "").slice(0, 300),
      wrongAnswer: String(wrongAnswer || "").slice(0, 200),
      correctAnswer: String(correctAnswer || "").slice(0, 200),
      date: now,
      source,
      objectiveId: objectiveId || null,
    };

    const existingBlockIdx = blockConcepts.findIndex(
      (c) =>
        (c.concept || "").toLowerCase() === normalizedNew ||
        normalizedNew.includes((c.concept || "").toLowerCase()) ||
        (c.concept || "").toLowerCase().includes(normalizedNew)
    );

    let blockEntryId = null;

    if (existingBlockIdx !== -1) {
      const existing = blockConcepts[existingBlockIdx];
      blockEntryId = existing.id;
      blockConcepts[existingBlockIdx] = {
        ...existing,
        missCount: (existing.missCount || 0) + 1,
        lastMissed: now,
        consecutiveCorrect: 0,
        totalAttempts: (existing.totalAttempts || 0) + 1,
        masteryLevel: "struggling",
        description: existing.description || conceptData.description || "",
        angle: existing.angle || conceptData.angle || "general",
        sourceQuestions: [sourceQ, ...(existing.sourceQuestions || [])].slice(0, 10),
        linkedLecIds: [...new Set([...(existing.linkedLecIds || []), linkedLecId].filter(Boolean))],
        lectureLabels: [...new Set([...(existing.lectureLabels || []), lectureLabel].filter(Boolean))],
        objectiveIds: [...new Set([...(existing.objectiveIds || []), objectiveId].filter(Boolean))],
      };
    } else {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `wc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      blockEntryId = id;
      blockConcepts.unshift({
        id,
        concept: conceptData.concept || "Unknown concept",
        description: conceptData.description || "",
        angle: conceptData.angle || "general",
        blockId,
        blockName: blockName || "",
        linkedLecIds: [linkedLecId].filter(Boolean),
        lectureLabels: [lectureLabel].filter(Boolean),
        objectiveIds: [objectiveId].filter(Boolean),
        missCount: 1,
        lastMissed: now,
        lastCorrect: null,
        consecutiveCorrect: 0,
        totalAttempts: 1,
        masteryLevel: "struggling",
        questionHistory: [],
        sourceQuestions: [sourceQ],
        dateFirstSeen: now,
        tags: [],
      });
    }

    const newBlockEntry = blockConcepts.find((c) => c.id === blockEntryId);
    const existingLifetimeIdx = lifetime.findIndex(
      (c) =>
        (c.concept || "").toLowerCase() === normalizedNew ||
        normalizedNew.includes((c.concept || "").toLowerCase()) ||
        (c.concept || "").toLowerCase().includes(normalizedNew)
    );

    if (existingLifetimeIdx !== -1) {
      const L = lifetime[existingLifetimeIdx];
      lifetime[existingLifetimeIdx] = {
        ...L,
        missCount: (L.missCount || 0) + 1,
        lastMissed: now,
        consecutiveCorrect: 0,
        masteryLevel: "struggling",
        linkedLecIds: [...new Set([...(L.linkedLecIds || []), linkedLecId].filter(Boolean))],
        lectureLabels: [...new Set([...(L.lectureLabels || []), lectureLabel].filter(Boolean))],
      };
    } else if (newBlockEntry) {
      lifetime.push({
        ...newBlockEntry,
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `wl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      });
    }

    saveWeakConcepts(blockId, blockConcepts, lifetime);
  } catch (e) {
    console.error("recordWrongAnswer failed:", e);
  }
}

const STOPWORDS = new Set([
  "the","a","an","of","to","in","on","and","or","for","with","by","is","are","be","as","at","from",
  "that","this","these","those","it","its","their","which","what","how","why","when","where","who",
  "not","no","than","then","so","into","about","via","vs","will","can","may","do","does","did",
]);

function tokenize(s) {
  if (!s) return [];
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  let hits = 0;
  for (const t of aTokens) if (bSet.has(t)) hits++;
  return hits / Math.sqrt(aTokens.length * bTokens.length);
}

/**
 * For weak concepts with linkedLecIds but empty objectiveIds, attach the best
 * matching objective (by word overlap) from within those lectures.
 * Returns { scanned, updated }.
 */
export function backfillObjectiveLinks(objectives) {
  if (!Array.isArray(objectives) || objectives.length === 0) {
    return { scanned: 0, updated: 0 };
  }
  const byLec = new Map();
  for (const o of objectives) {
    const lid = o?.linkedLecId;
    if (!lid) continue;
    if (!byLec.has(lid)) byLec.set(lid, []);
    byLec.get(lid).push(o);
  }

  let stored;
  try {
    stored = JSON.parse(localStorage.getItem("rxt-weak-concepts") || "{}");
  } catch {
    return { scanned: 0, updated: 0 };
  }

  let scanned = 0;
  let updated = 0;

  const patch = (concept) => {
    scanned++;
    const hasObj = Array.isArray(concept.objectiveIds) && concept.objectiveIds.length > 0;
    const lecIds = Array.isArray(concept.linkedLecIds) ? concept.linkedLecIds : [];
    if (hasObj || lecIds.length === 0) return concept;
    const conceptTokens = tokenize(`${concept.concept || ""} ${concept.description || ""}`);
    if (!conceptTokens.length) return concept;
    let best = null;
    let bestScore = 0;
    for (const lecId of lecIds) {
      const pool = byLec.get(lecId) || [];
      for (const obj of pool) {
        const text = obj.objective || obj.text || "";
        const score = overlapScore(conceptTokens, tokenize(text));
        if (score > bestScore) {
          bestScore = score;
          best = obj;
        }
      }
    }
    if (best && bestScore >= 0.2) {
      updated++;
      return { ...concept, objectiveIds: [best.id].filter(Boolean) };
    }
    return concept;
  };

  const next = { ...stored };
  for (const key of Object.keys(next)) {
    if (!Array.isArray(next[key])) continue;
    next[key] = next[key].map(patch);
  }

  try {
    localStorage.setItem("rxt-weak-concepts", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("rxt-weak-concepts-updated"));
    triggerWeakConceptPush();
  } catch (e) {
    console.error("backfillObjectiveLinks save failed:", e);
  }

  return { scanned, updated };
}
