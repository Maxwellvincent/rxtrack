// mcq.js — pure MCQ generation helpers (port of the monolith's
// genTopicVignettesWithContext prompt + validation into the shell/engine).
// The exam-bank questions the student uploaded become few-shot STYLE exemplars
// so the model asks questions in their school's exact style.
import { normAtomKey } from "./atomNorm.js";
import { canonicalObjectiveIds } from "./objectiveLinks.js";
import { alignSchoolQuestions, schoolEvidencePrompt, retrieveLectureEvidence } from "./schoolAlignment.js";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const MCQ_SYSTEM = "You are a USMLE Step 1 question writer. Return ONLY valid JSON — no markdown, no prose.";

function withSchoolContext(questions, cfg) {
  const chosen = selectStyleExemplars(cfg.examples || [], 5, cfg.difficulty, cfg);
  const references = alignSchoolQuestions(chosen, cfg.objectives, cfg.atoms).map(({question:q,links}) => ({
    sourceFile:q.sourceFile || 'Uploaded bank', sourceQuestionId:q.id || String(q.num || ''),
    links:links.slice(0,3).map(({targetId,basis,evidence})=>({targetId,basis,evidence})),
  }));
  return questions.map(q=>({...q,generationEvidence:{version:1,role:'retrieved prompt context; not independent question validation',references}}));
}

/** Generate MCQs via an injected callAIJSON (testable without a live model). */
export async function generateMcqs(cfg = {}, deps = {}) {
  const { callAIJSON, maxTokens = 8000 } = deps;
  const text = String(cfg.lectureText || "");
  const atoms = Array.isArray(cfg.atoms) ? cfg.atoms : [];
  if (text.trim().length < 150 && !atoms.length) return { error: "Not enough lecture text — convert/upload the lecture first.", questions: [] };
  try {
    const prompt = buildMcqPrompt(cfg);
    const result = await callAIJSON(MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    return { questions: withSchoolContext(normalizeQuestions(result), cfg) };
  } catch (e) {
    return { error: e?.message || String(e), questions: [] };
  }
}

/**
 * Shuffle choice positions so the correct answer is not always A/B.
 *
 * `whyWrong` is keyed by letter, and the letters move here — so it is remapped along with the
 * choices. Skipping that would relabel every per-choice explanation onto the wrong option, which
 * is worse than having none at all.
 */
function shuffleChoices(q) {
  const keys = Object.keys(q.choices);
  // Fisher-Yates on the values, then remap to original letter slots
  const vals = keys.map((l) => ({ origLetter: l, text: q.choices[l] }));
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  const newChoices = {};
  const newWhyWrong = {};
  let newCorrect = q.correct;
  vals.forEach((v, i) => {
    const newLetter = keys[i];
    newChoices[newLetter] = v.text;
    if (q.whyWrong && q.whyWrong[v.origLetter]) newWhyWrong[newLetter] = q.whyWrong[v.origLetter];
    if (v.origLetter === q.correct) newCorrect = newLetter;
  });
  return { ...q, choices: newChoices, correct: newCorrect, whyWrong: newWhyWrong };
}

/**
 * Keep only per-choice explanations that name a real choice.
 *
 * The model sometimes explains a letter it never offered, or returns a string instead of an
 * object. Either way the entry is dropped rather than rendered — a bullet labelled with a letter
 * the question never offered reads as a bug in the question.
 */
function normalizeWhyWrong(raw, letters) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const letter of letters) {
    const body = String(raw[letter] ?? "").trim();
    if (body) out[letter] = body;
  }
  return out;
}

/** A choice is real if it's a non-empty string, or a non-empty table-row object. */
function hasChoiceValue(v) {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return false;
}

/** Validate + normalize model output into a clean MCQ list. */
export function normalizeQuestions(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : [];
  const out = [];
  for (const q of list) {
    if (!q || typeof q !== "object") continue;
    const stem = String(q.stem || "").trim();
    const choices = q.choices && typeof q.choices === "object" ? q.choices : null;
    if (!stem || !choices) continue;
    const keys = LETTERS.filter((l) => hasChoiceValue(choices[l]));
    if (keys.length < 2) continue;
    const correct = String(q.correct || "").trim().toUpperCase();
    if (!keys.includes(correct)) continue;
    const validated = {
      stem,
      // A table-row choice (object) is kept as-is for a future table renderer; a plain string is trimmed.
      choices: Object.fromEntries(keys.map((l) => [l, typeof choices[l] === "string" ? choices[l].trim() : choices[l]])),
      correct,
      explanation: String(q.explanation || "").trim(),
      whyWrong: normalizeWhyWrong(q.whyWrong, keys),
      topic: q.topic ? String(q.topic).trim() : null,
      difficulty: q.difficulty ? String(q.difficulty).trim() : null,
      choiceLayout: q.choiceLayout === "table" ? "table" : null,
      choiceColumns: Array.isArray(q.choiceColumns) ? q.choiceColumns.map(String) : null,
      hasImage: !!q.hasImage,
      // Exact atom identity when the question was generated one-per-atom
      // (backfillTopicsFromAtoms stamps this before normalization) — the reliable half of atom
      // attribution, since `topic` is free text the model sometimes drifts on even when told to
      // echo the term.
      atomKey: q.atomKey ? String(q.atomKey) : null,
      objectiveIds: Array.isArray(q.objectiveIds) ? q.objectiveIds.map(String).filter(Boolean) : [],
    };
    out.push(shuffleChoices(validated));
    if (out.length >= 100) break;
  }
  return out;
}

// ── Exemplar parsing ─────────────────────────────────────────────────────
// Extract MCQs verbatim from an uploaded exam-bank .md so they can seed style.
export function buildExemplarParsePrompt(md) {
  return (
    `Extract EVERY multiple-choice question from the text below, verbatim.\n` +
    `For each: the full stem, EVERY option it offers (A-D or A-E — keep the count the source used),\n` +
    `the correct answer letter, and any explanation given.\n` +
    `Do not invent questions or answers; if the answer key is absent, infer the best-supported letter.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"..."}]}\n\n` +
    `TEXT:\n${String(md || "").slice(0, 14000)}`
  );
}

export async function parseExemplarsFromMd(md, deps = {}) {
  const { callAIJSON, maxTokens = 4000 } = deps;
  if (String(md || "").trim().length < 100) return { error: "Too short to hold questions.", questions: [] };
  try {
    const r = await callAIJSON(
      "You extract multiple-choice questions verbatim from text. Return ONLY JSON.",
      buildExemplarParsePrompt(md),
      { questions: [] },
      maxTokens
    );
    return { questions: normalizeQuestions(r) };
  } catch (e) {
    return { error: e?.message || String(e), questions: [] };
  }
}

// ── Atom-targeted generation ─────────────────────────────────────────────
// Turn the extracted lecture atoms (the curriculum) into questions that test
// EACH atom specifically — this is the study/calibration unit.
// Cap questions per call — too many overflow the model's output budget and
// truncate the JSON. 10 keeps one response well within limits.
export const ATOM_QUIZ_CAP = 10;

const IMAGE_NOTE =
  "  [AN IMAGE FROM THE LECTURE IS SHOWN WITH THIS QUESTION — have the stem refer to it " +
  '("the photomicrograph shown", "the image shown") and do NOT describe or name what it depicts.]';

/**
 * An exemplar's options, exactly as many as it has.
 *
 * These lines were hard-coded to A-D, which printed "D: undefined" for a three-option bank item
 * and silently dropped E from a five-option one — teaching the model the wrong option count from
 * the very examples meant to teach it the school's style.
 */
/** A table-row choice (e.g. {PTH: "increased", Calcium: "increased"}) rendered as prompt text. */
function choiceText(value) {
  if (value && typeof value === "object") {
    return Object.entries(value).map(([k, v]) => `${k}: ${v}`).join("; ");
  }
  return String(value ?? "");
}

function renderChoices(choices) {
  return LETTERS.filter((l) => choices?.[l]).map((l) => `${l}: ${choiceText(choices[l])}`).join("  ");
}

/**
 * A small but representative school-style sample.
 *
 * Taking the first five questions overfits to the beginning of one file (and in the supplied
 * ExamSoft bank misses its 6-8-option formats). Prefer option-count diversity, then fill from
 * across the remaining bank. Image-dependent exemplars are excluded because their image is not
 * sent with the text prompt and would teach the model to reference a figure it cannot provide.
 */
export function selectStyleExemplars(examples = [], limit = 5, difficulty = "medium", targets = {}) {
  if (limit <= 0) return [];
  const challenge = ["hard", "expert"].includes(String(difficulty).toLowerCase());
  const relevance = new Map(alignSchoolQuestions(examples, targets.objectives, targets.atoms).map(x => [x.question,x.score]));
  const candidates = examples.filter((q) => q?.stem && q?.choices && !q.hasImage && q.answerKeyVerified !== false);
  const linked = candidates.filter(q => (relevance.get(q) || 0) > 0);
  const valid = (linked.length ? linked : candidates)
    .sort((a, b) => (relevance.get(b) || 0) - (relevance.get(a) || 0) || (challenge
      ? Number(b.sourceKind === "imcq") - Number(a.sourceKind === "imcq")
      : Number(a.sourceKind === "imcq") - Number(b.sourceKind === "imcq")));
  const selected = [];
  const seenCounts = new Set();
  for (const q of valid) {
    const optionCount = Object.keys(q.choices).length;
    if (seenCounts.has(optionCount)) continue;
    selected.push(q);
    seenCounts.add(optionCount);
    if (selected.length >= limit) return selected;
  }
  const selectedSet = new Set(selected);
  const remaining = valid.filter((q) => !selectedSet.has(q));
  while (selected.length < limit && remaining.length) {
    const index = selected.length === limit - 1
      ? remaining.length - 1
      : Math.floor((selected.length / limit) * remaining.length);
    selected.push(remaining.splice(Math.max(0, index), 1)[0]);
  }
  return selected;
}

export function buildAtomQuestionsPrompt({ atoms = [], objectives = [], difficulty = "medium", examples = [], avoidStems = [], subject = "this lecture" } = {}) {
  const diff = String(difficulty).toLowerCase();
  // A fact with `hasImage` gets a photomicrograph rendered above its question. The model is
  // told an image is coming so the stem can point at it, but never told what it shows —
  // naming the tissue in the stem is the answer.
  const factList = atoms
    .slice(0, ATOM_QUIZ_CAP)
    .map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}${a.objectiveIds?.length ? ` [linked objectives: ${a.objectiveIds.join(", ")}]` : ""}${a.hasImage ? IMAGE_NOTE : ""}`)
    .join("\n");

  const styleExamples = selectStyleExemplars(examples, 5, diff, { objectives, atoms });
  const examplesSection = styleExamples.length
    ? "\n\nMATCH THE STYLE of these real school exam questions:\n" +
      styleExamples.map((q, i) =>
        `EXAMPLE ${i + 1}${q.sourceKind === "imcq" ? " (IMCQ challenge reference; not a calibrated exam-difficulty benchmark)" : ""}:\nQ: ${q.stem}\n${renderChoices(q.choices)}\nCorrect: ${q.correct}`
      ).join("\n\n")
    : "";

  const avoidSection = avoidStems.length
    ? "\n\nQUESTIONS ALREADY USED — do not repeat, paraphrase, or test the same clue-to-answer route:\n" +
      avoidStems.slice(-30).map((stem, i) => `${i + 1}. ${String(stem).slice(0, 240)}`).join("\n")
    : "";

  return (
    `Write ONE USMLE Step 1 clinical-vignette question that tests EACH numbered fact below, in order — one question per fact.\n` +
    `Each question must test that specific fact (not adjacent trivia). Use a patient scenario ending in a question mark, with enough clinical evidence for the requested reasoning depth; do not force challenging vignettes into a short recall stem. ` +
    `Examples guide structure, not factual scope: use the supplied facts, write new cases, and honor the requested difficulty rather than copying an IMCQ's difficulty. ` +
    `Match the option count and lettering of the real exam examples below, if given (real exams often run 4-6 options, A-F); otherwise exactly 5 options A-E.\n\n` +
    WHY_WRONG_RULE + `\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n\n` +
    `FACTS TO TEST (from "${subject}"):\n${factList}` +
    `\n\nLECTURE OBJECTIVES (source data):\n${objectives.map(o => `[${o.id}] ${o.code || ""} ${o.objective || o.text || ""}`).join("\n") || "No objectives available; do not claim objective coverage."}\n` +
    `Test the atom in the context of the relevant objective's task (explain, compare, predict, identify). Return objectiveIds containing ONLY the one primary objective ID actually tested. Use [] when no supplied objective fits. Never attach every objective just because it shares terminology. Cover different relevant objectives across the set.\n` +
    examplesSection + schoolEvidencePrompt(styleExamples, objectives, atoms) + avoidSection +
    `\n\nReturn ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...",${WHY_WRONG_JSON},"topic":"the fact's term","objectiveIds":["primary objective id"],"difficulty":"${diff}"}]}`
  );
}

/**
 * The prompt asks for one question per fact, in the same order the facts were
 * listed — so a fact's own atom `term` is a reliable stand-in whenever the
 * model leaves `topic` out (it happens). Without this, normalizeQuestions'
 * `topic` ends up null and callers fall back to slicing the raw question
 * stem for display — unreadable as a "concept to review" label.
 *
 * `atomKey` is stamped unconditionally (not just when topic is missing) — it's the
 * exact join back to atomProgress tracking, positional and not dependent on the
 * model's own wording ever matching. This is the ONLY place that link gets made;
 * normalizeQuestions just carries the field through afterward.
 */
export function backfillTopicsFromAtoms(raw, atoms, objectives = []) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : [];
  const questions = list.map((q, i) => {
    if (!q || typeof q !== "object") return q;
    const atom = atoms[i];
    if (!atom?.term) return q;
    const atomKey = normAtomKey(atom.term);
    return {
      ...q,
      topic: String(q.topic || "").trim() || atom.term,
      atomKey,
      objectiveIds: objectives.length
        ? canonicalObjectiveIds(Array.isArray(q.objectiveIds) ? q.objectiveIds : (atom.objectiveIds?.length === 1 ? atom.objectiveIds : []), objectives).slice(0, 1)
        : Array.isArray(atom.objectiveIds) ? atom.objectiveIds.filter(Boolean) : [],
    };
  });
  return Array.isArray(raw) ? questions : { ...raw, questions };
}

export async function generateFromAtoms(cfg = {}, deps = {}) {
  const { callAIJSON, maxTokens = 8000 } = deps;
  const atoms = Array.isArray(cfg.atoms) ? cfg.atoms : [];
  if (!atoms.length) return { error: "No atoms to quiz — extract a lecture first.", questions: [] };
  try {
    const prompt = buildAtomQuestionsPrompt(cfg);
    const result = await callAIJSON(MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    const questions = normalizeQuestions(backfillTopicsFromAtoms(result, atoms, cfg.objectives || [])).map(q => ({
      ...q,
      objectiveTexts: (cfg.objectives || []).filter(o => q.objectiveIds?.includes(o.id)).map(o => ({ id: o.id, code: o.code || "", text: o.objective || o.text || "" })),
    }));
    return { questions: withSchoolContext(questions, cfg) };
  } catch (e) {
    return { error: e?.message || String(e), questions: [] };
  }
}

/**
 * The per-choice explanation contract.
 *
 * A vignette teaches twice: once by saying why the key is right, and once by saying why each
 * distractor was tempting and where it breaks. Asking for the second half as a letter-keyed
 * object rather than as prose keeps it attached to the option after the shuffle relabels it.
 */
const WHY_WRONG_RULE =
  `"explanation" = why the correct answer is correct (2-3 sentences, states the tested fact).\n` +
  `"whyWrong" = an object keyed by EVERY option letter INCLUDING the correct one. For a wrong ` +
  `option: one sentence naming what it would be right for and why it fails here. For the correct ` +
  `option: one short sentence on the finding that confirms it. Never leave a letter out.`;

const WHY_WRONG_JSON = `"whyWrong":{"A":"...","B":"...","C":"...","D":"...","E":"..."}`;

const DIFF_LINE = {
  easy: "Straightforward single-concept questions, direct recall.",
  medium: "USMLE Step 1 standard — 2-step clinical reasoning.",
  hard: "Multi-step reasoning, integrated concepts, challenging plausible distractors.",
  expert: "Hardest transfer level — require 3+ reasoning steps, combine the tested fact with at least one other provided fact, conceal the diagnosis, use indirect clinical/lab clues, and make every distractor plausible. Never produce a direct-definition or simple recall question.",
};

/** Assemble the generation prompt. Exemplars + objectives + atoms + lecture drive style/scope. */
export function buildMcqPrompt({ subject = "this lecture", lectureText = "", examples = [], objectives = [], atoms = [], difficulty = "medium", count = 10 } = {}) {
  const diff = String(difficulty).toLowerCase();

  const styleExamples = selectStyleExemplars(examples, 5, diff, { objectives, atoms });
  const examplesSection = styleExamples.length
    ? "\n\nEXAMPLE QUESTIONS FROM YOUR SCHOOL'S EXAM BANK:\n" +
      "(Use their structure and plausible distractors, not their exact cases. Keep factual scope within the supplied lecture/objectives and honor the requested difficulty. IMCQs are challenge references, not calibrated exam-difficulty benchmarks.)\n" +
      styleExamples.map((q, i) =>
        `EXAMPLE ${i + 1}${q.sourceKind === "imcq" ? " (IMCQ challenge reference)" : ""}:\nQ: ${q.stem}\n${renderChoices(q.choices)}\nCorrect: ${q.correct}\nExplanation: ${q.explanation || "N/A"}`
      ).join("\n\n")
    : "";

  const objectivesSection = objectives.length
    ? "\n\nLEARNING OBJECTIVES TO COVER (every question maps to one):\n" +
      objectives.map((o, i) => `${i + 1}. [${o.code || o.id || ""}] ${o.objective || o.text || ""}`).join("\n")
    : "";

  const atomsSection = atoms.length
    ? "\n\nKEY FACTS EXTRACTED FROM THE LECTURE (ground your questions in these specific concepts):\n" +
      atoms.slice(0, 50).map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}`).join("\n")
    : "";

  const contentSection = lectureText
    ? "\n\nLECTURE CONTENT (retrieved across the lecture for these targets):\n" + retrieveLectureEvidence(lectureText, objectives, atoms)
    : "";

  return (
    `Generate exactly ${count} USMLE Step 1 clinical-vignette questions on "${subject}".\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n` +
    `Each stem: a 3-5 sentence patient scenario (age, sex, complaint, relevant history, vitals/labs/exam) ENDING in a question mark.\n` +
    `Match the option count and lettering of the exam-bank examples below, if given (real exams often run 4-6 options, A-F); otherwise exactly 5 options A-E, each a complete answer.\n` +
    WHY_WRONG_RULE +
    examplesSection +
    schoolEvidencePrompt(styleExamples, objectives, atoms) + objectivesSection +
    atomsSection +
    contentSection +
    `\n\nRULES: every question UNIQUE; vary format/demographics; base strictly on the lecture content; set objectiveIds to the exact ID/code of the ONE primary objective tested; distribute correct answers evenly across A/B/C/D/E — no single letter should be correct more than 30% of the time.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"B","explanation":"...",${WHY_WRONG_JSON},"topic":"<3-6 word specific medical concept tested, e.g. zona glomerulosa aldosterone control>","objectiveIds":["exact objective id"],"difficulty":"${diff}"}]}`
  );
}
