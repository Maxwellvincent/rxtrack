/**
 * Weak concept tracker — shared storage with App.jsx (rxt-weak-concepts).
 * Used by Tracker quick log without modifying App.jsx.
 */
import { callAI } from "./aiClient";

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
