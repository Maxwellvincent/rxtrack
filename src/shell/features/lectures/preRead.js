/**
 * Pre-Read — the 5-question prediction pass you run the night before a lecture.
 *
 * Not Deep Learn. Deep Learn assumes you have been taught the material and
 * spends six phases proving mastery; a pre-read has the opposite job: surface
 * what you do not know yet, name the concepts to go look up, and stop. It is a
 * fixed, closable unit — five questions, one reveal screen — because the study
 * protocol's rule is that a session must have something to FINISH.
 *
 * Questions are shown BEFORE reading and are never graded into objective
 * status. Their only job downstream is `preReadGaps`: the objectives you missed
 * are what the first post-lecture session opens on.
 */
import { getChunkBody } from "../../../lectureText.js";
import { MIN_TEXT, lectureTextFrom } from "./lectureStudy.js";

/** How many prediction questions a pre-read asks. Matches the study-flow round size. */
export const PRE_READ_QUESTION_COUNT = 5;

/** Soft cap in minutes — the banner offers "done" or "keep going" at this point. */
export const PRE_READ_SOFT_CAP_MINUTES = 15;

/**
 * What this pre-read can actually be built from, best source first.
 *
 * The cascade exists because a schedule import creates dated lecture stubs with
 * no body and often no objectives, and the night before a lecture is precisely
 * when that stub still has to be pre-readable. A title is enough for a model to
 * produce searchable subject-level topics.
 *
 * @returns {{kind: "text"|"atoms"|"objectives"|"title"|"none", text: string, subject: string}}
 */
export function preReadSource(lecture, objectives = []) {
  const subject =
    lecture?.lectureTitle || lecture?.fileName || lecture?.subject || "this lecture";

  const body = lectureTextFrom(lecture) || (lecture?.chunks || []).map(getChunkBody).join("\n\n");
  if (String(body || "").trim().length >= MIN_TEXT) {
    return { kind: "text", text: body, subject };
  }

  const atomText = (lecture?.atoms || [])
    .map((a) => `${a?.term || ""}: ${a?.content || ""}`.trim())
    .filter((s) => s.length > 8);
  if (atomText.length) return { kind: "atoms", text: atomText.join("\n"), subject };

  const objText = (objectives || [])
    .map((o) => o?.objective || o?.text || "")
    .filter((s) => String(s).trim().length > 5);
  if (objText.length) {
    return {
      kind: "objectives",
      text: objText.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      subject,
    };
  }

  if (lecture?.lectureTitle || lecture?.fileName || lecture?.subject) {
    const parts = [lecture?.lectureTitle || lecture?.fileName, lecture?.subject].filter(Boolean);
    return { kind: "title", text: parts.join(" — "), subject };
  }

  return { kind: "none", text: "", subject };
}

const SYSTEM =
  "You are a medical school pre-lecture study coach. Return ONLY valid JSON — no markdown, no prose.";

export function buildPreReadPrompt({ source, objectives = [], count = PRE_READ_QUESTION_COUNT }) {
  const objLines = (objectives || [])
    .map((o) => `- id=${o.id}: ${o.objective || o.text || ""}`)
    .filter((s) => s.length > 12)
    .slice(0, 40);

  const sourceLabel = {
    text: "LECTURE MATERIAL",
    atoms: "EXTRACTED HIGH-YIELD LECTURE FACTS",
    objectives: "LEARNING OBJECTIVES (no lecture material uploaded yet)",
    title: "LECTURE TITLE ONLY (nothing uploaded yet)",
    none: "NOTHING",
  }[source.kind];

  return (
    `A medical student is about to attend a lecture on "${source.subject}". They have NOT been taught ` +
    `this material yet. Prepare a short pre-read.\n\n` +
    `Produce a compact orientation scaffold, not a full lesson:\n` +
    `1. "bigPicture": 2-3 sentences explaining what system or clinical problem this lecture organizes.\n` +
    `2. "roadmap": 4-7 major headings in the order the student should expect them.\n` +
    `3. "vocabulary": 4-8 unfamiliar terms with a very short meaning, formatted "term — meaning".\n` +
    `4. "diagramTargets": 2-5 pathways, spatial relationships, tables, or figures worth locating in the slides.\n` +
    `5. "topics": 5-8 concise, subject-level concept phrases (3-7 words) they can search for and study ` +
    `on their own — mechanisms, pathways, drug classes, disease processes. Do NOT copy objective text ` +
    `verbatim; distill to the searchable core concept.\n` +
    `6. "questions": exactly ${count} prediction questions asked BEFORE they study. These are not a test — ` +
    `they exist to expose what the student does not know yet and make them curious. Prefer the highest-yield ` +
    `concepts. Each has 4 choices, a 0-based correctIndex, a one-sentence explanation, and "objectiveId" set ` +
    `to the id of the learning objective it maps to (use null when none applies).\n\n` +
    (objLines.length ? `LEARNING OBJECTIVES:\n${objLines.join("\n")}\n\n` : "") +
    `${sourceLabel}:\n${String(source.text || "").slice(0, 12000)}\n\n` +
    `Return ONLY valid JSON: {"bigPicture":"...","roadmap":["..."],"vocabulary":["..."],"diagramTargets":["..."],"topics":["..."],"questions":[{"question":"...","choices":["...","...","...","..."],` +
    `"correctIndex":0,"explanation":"...","objectiveId":"..."}]}`
  );
}

/**
 * Build one pre-read: searchable topics plus the prediction questions.
 *
 * `callAIJSON` is injected so this is testable without a provider, and so the
 * caller decides whether the llm-bridge or a cloud provider serves it.
 */
export async function generatePreRead({ lecture, objectives = [], count = PRE_READ_QUESTION_COUNT }, deps = {}) {
  const { callAIJSON, maxTokens = 2500 } = deps;
  const source = preReadSource(lecture, objectives);

  const empty = { bigPicture: "", roadmap: [], vocabulary: [], diagramTargets: [], topics: [], questions: [], sourceKind: source.kind, subject: source.subject };
  if (source.kind === "none") {
    return { ...empty, error: "Nothing to pre-read — this lecture has no title, objectives or material." };
  }

  const validIds = new Set((objectives || []).map((o) => o?.id).filter(Boolean));

  try {
    const raw = await callAIJSON(
      SYSTEM,
      buildPreReadPrompt({ source, objectives, count }),
      { bigPicture: "", roadmap: [], vocabulary: [], diagramTargets: [], topics: [], questions: [] },
      maxTokens
    );

    const topics = Array.isArray(raw?.topics)
      ? raw.topics.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim())
      : [];

    const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
      .filter((q) => q && typeof q.question === "string" && Array.isArray(q.choices) && q.choices.length >= 2)
      .slice(0, count)
      .map((q, i) => ({
        id: `pr_${i + 1}`,
        question: q.question,
        choices: q.choices,
        correctIndex: Number.isInteger(q.correctIndex) ? q.correctIndex : 0,
        explanation: q.explanation || "",
        // A hallucinated id would silently break lecture-day gap ordering, so
        // anything not matching a real objective is dropped to null.
        objectiveId: validIds.has(q.objectiveId) ? q.objectiveId : null,
      }));

    const cleanList = (value, limit) => Array.isArray(value)
      ? value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()).slice(0, limit)
      : [];
    return {
      ...empty,
      bigPicture: typeof raw?.bigPicture === "string" ? raw.bigPicture.trim() : "",
      roadmap: cleanList(raw?.roadmap, 7),
      vocabulary: cleanList(raw?.vocabulary, 8),
      diagramTargets: cleanList(raw?.diagramTargets, 5),
      topics,
      questions,
    };
  } catch (e) {
    return { ...empty, error: e?.message || String(e) };
  }
}

/**
 * Which objectives the pre-read exposed as gaps.
 *
 * An unanswered question counts as a gap — skipping is itself the signal that
 * you had no idea, which is the same information a wrong answer carries.
 */
export function preReadGaps(questions = [], answers = {}) {
  const objectiveIds = [];
  let missed = 0;
  let correct = 0;

  for (const q of questions) {
    if (!q) continue;
    const given = answers?.[q.id];
    const isCorrect = given != null && given === q.correctIndex;
    if (isCorrect) {
      correct += 1;
      continue;
    }
    missed += 1;
    if (q.objectiveId && !objectiveIds.includes(q.objectiveId)) objectiveIds.push(q.objectiveId);
  }

  return { objectiveIds, missed, correct };
}
