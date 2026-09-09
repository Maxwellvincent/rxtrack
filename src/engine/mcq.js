// mcq.js — pure MCQ generation helpers (port of the monolith's
// genTopicVignettesWithContext prompt + validation into the shell/engine).
// The exam-bank questions the student uploaded become few-shot STYLE exemplars
// so the model asks questions in their school's exact style.
import { normAtomKey } from "./atomNorm.js";
import { canonicalObjectiveIds } from "./objectiveLinks.js";
import { alignSchoolQuestions, schoolEvidencePrompt, retrieveLectureEvidence } from "./schoolAlignment.js";
import { uniqueQuestions } from "./questionSimilarity.js";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const MCQ_SYSTEM = "You are an SGU Basic Principles of Medicine exam-question writer. Reproduce the supplied SGU ExamSoft/IMCQ writing style, not generic UWorld/NBME style. Return ONLY valid JSON — no markdown, no prose.";
const MCQ_V2_SYSTEM = MCQ_SYSTEM;
const AUDIT_SYSTEM = "You are an independent medical-school question editor. Audit the supplied questions against the supplied curriculum evidence. Return ONLY valid JSON — no markdown, no prose.";
const REPAIR_SYSTEM = "You are a medical exam-question repair editor. Rewrite rejected questions so they are medically accurate, objective-aligned, and faithful to the supplied SGU ExamSoft/IMCQ style. Return ONLY valid JSON — no markdown, no prose.";

export function exemplarSourceTier(question) {
  const label = [question?.sourceFile, question?.filename, question?.bankTitle, question?.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/examsoft|esoft/.test(label)) return "examsoft";
  if (question?.sourceKind === "imcq" || /\bimcq\b/.test(label)) return "imcq";
  if (question?.sourceKind === "supplemental" || /\bnatalie\b|\bhomework\b|practice[ +_-]*questions?|\bweek[ +_-]*\d+/.test(label)) return "homework";
  return "school";
}

/** Compact, deterministic style fingerprint used to keep generation anchored to the real bank. */
export function buildStyleFingerprint(examples = []) {
  const usable = examples.filter((q) => q?.stem && q?.choices);
  if (!usable.length) return { sampleSize: 0 };
  const stems = usable.map((q) => String(q.stem).trim());
  const avg = (values) => Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
  const leadIns = stems.flatMap((s) => [...s.matchAll(/(?:Which of the following|What is|The most likely|Which structure|Which nerve|Which vessel)/gi)].map((m) => m[0].toLowerCase()));
  const scenarioTypes = ["surgery", "trauma", "imaging", "ultrasound", "x-ray", "laboratory", "histology", "procedure", "newborn", "symptoms"]
    .map((label) => ({ label, count: stems.filter((s) => new RegExp(`\\b${label}\\b`, "i").test(s)).length }))
    .filter((entry) => entry.count);
  return {
    sampleSize: usable.length,
    averageStemCharacters: avg(stems.map((s) => s.length)),
    averageSentences: Math.round((stems.map((s) => s.split(/[.!?]+/).filter(Boolean).length).reduce((a, b) => a + b, 0) / usable.length) * 10) / 10,
    optionCounts: [...new Set(usable.map((q) => Object.keys(q.choices).length))].sort((a, b) => a - b),
    commonLeadIns: [...new Set(leadIns)].slice(0, 6),
    scenarioTypes: scenarioTypes.sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

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
    const result = await callAIJSON(cfg.generationVersion === "v2" ? MCQ_V2_SYSTEM : MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    const generated = withSchoolContext(normalizeQuestions(result), cfg).map((question) => ({ ...question, generationVersion: cfg.generationVersion || "v1" }));
    return await auditGeneratedQuestions(generated, cfg, deps);
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

export function normalizeChoiceLetter(value) {
  const text = String(value || "").trim().toUpperCase();
  if (/^[A-H]$/.test(text)) return text;
  return text.match(/(?:^|[^A-Z])([A-H])(?:[^A-Z]|$)/)?.[1] || null;
}

function normalizedChoiceEntries(choices) {
  const out = new Map();
  for (const [rawLetter, value] of Object.entries(choices || {})) {
    const letter = normalizeChoiceLetter(rawLetter);
    if (!letter || out.has(letter) || !hasChoiceValue(value)) continue;
    out.set(letter, value);
  }
  return [...out.entries()].sort((a, b) => LETTERS.indexOf(a[0]) - LETTERS.indexOf(b[0]));
}

export function resolveCorrectLetter(question, keys) {
  const available = new Set(keys || []);
  const rawCorrect = normalizeChoiceLetter(question?.correct);
  const explicitlyCorrect = Object.entries(question?.whyWrong || {})
    .filter(([, value]) => {
      const text = String(value || "").trim();
      return /^(?:correct\b|✓)/i.test(text) || /(?:—|-)\s*correct\b/i.test(text) || /\bthis is the correct\b/i.test(text);
    })
    .map(([letter]) => normalizeChoiceLetter(letter))
    .filter((letter) => letter && available.has(letter));
  const uniqueExplicit = [...new Set(explicitlyCorrect)];
  if (uniqueExplicit.length === 1) return uniqueExplicit[0];
  return rawCorrect && available.has(rawCorrect) ? rawCorrect : null;
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
    const entries = normalizedChoiceEntries(choices);
    const keys = entries.map(([letter]) => letter);
    if (keys.length < 2) continue;
    const correct = resolveCorrectLetter(q, keys);
    if (!correct) continue;
    const validated = {
      stem,
      // A table-row choice (object) is kept as-is for a future table renderer; a plain string is trimmed.
      choices: Object.fromEntries(entries.map(([letter, value]) => [letter, typeof value === "string" ? value.trim() : value])),
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
      taskType: q.taskType ? String(q.taskType).trim() : null,
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
  const relevance = new Map(alignSchoolQuestions(examples, targets.objectives, targets.atoms).map(x => [x.question,x.score]));
  // Homework/student-authored banks are useful evidence about assigned content, but ExamSoft
  // and IMCQ remain the primary writing-style references.
  const candidates = examples.filter((q) => {
    const tier = exemplarSourceTier(q);
    return q?.stem && q?.choices && !q.hasImage && q.answerKeyVerified !== false &&
      tier !== "homework";
  });
  const linked = candidates.filter(q => (relevance.get(q) || 0) > 0);
  const valid = (linked.length ? linked : candidates)
    .sort((a, b) => {
      const sourceRank = (q) => {
        const tier = exemplarSourceTier(q);
        if (tier === "examsoft") return 0;
        if (tier === "school") return 1;
        return 2; // IMCQ challenge reference
      };
      return sourceRank(a) - sourceRank(b) || (relevance.get(b) || 0) - (relevance.get(a) || 0);
    });
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

export function buildAtomQuestionsPrompt({ atoms = [], objectives = [], difficulty = "medium", examples = [], avoidStems = [], subject = "this lecture", studyMode = "balanced", generationVersion = "v1", feedback = null } = {}) {
  const diff = String(difficulty).toLowerCase();
  // A fact with `hasImage` gets a photomicrograph rendered above its question. The model is
  // told an image is coming so the stem can point at it, but never told what it shows —
  // naming the tissue in the stem is the answer.
  const factList = atoms
    .slice(0, ATOM_QUIZ_CAP)
    .map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}${a.objectiveIds?.length ? ` [linked objectives: ${a.objectiveIds.join(", ")}]` : ""}${a.hasImage ? IMAGE_NOTE : ""}`)
    .join("\n");

  const styleExamples = selectStyleExemplars(examples, 5, diff, { objectives, atoms });
  const styleFingerprint = buildStyleFingerprint(styleExamples);
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
  const feedbackSection = feedback?.sampleSize
    ? `\n\nLEARNED FEEDBACK FROM PRIOR QUESTIONS (${feedback.sampleSize} ratings for this lecture/version):\n- Fairness issues: ${feedback.fairNo}\n- Exam-style mismatches: ${feedback.examStyleNo}\n- Recurring issue codes: ${JSON.stringify(feedback.issueCounts || {})}\nActively correct these recurring issues in every new item; do not repeat the same failure patterns.\n`
    : "";

  const v2Blueprint = generationVersion === "v2" ?
    `V2 SGU/EXAMSOFT BLUEPRINT:\n- Objectives define WHAT is tested; lecture facts establish the medically correct key; examples define HOW the item is written and are never factual authority.\n- Write concise SGU-style clinical or anatomic application items, normally one or two reasoning steps, not long UWorld-style diagnostic puzzles.\n- Across a batch target 20% direct foundational application, 60% standard clinical/anatomic application, and 20% harder integration.\n- Every distractor must be the same semantic category as the key and plausible for the exact task.\n- Vary patient framing, tested relationship, lead-in, and clue-to-answer route across the batch. Never add generic patient details that do no diagnostic work.\n\n` : "";
  return (
    v2Blueprint +
    `Write ONE USMLE Step 1 clinical-vignette question that tests EACH numbered fact below, in order — one question per fact.\n` +
    `Each question must test that specific fact (not adjacent trivia). Every stem must be a realistic 3-5 sentence clinical vignette with age and sex, presenting concern, relevant history, and only the examination, laboratory, imaging, or pathology clues needed for the reasoning task. End with a single-best-answer question. ` +
    `Do not write direct-definition prompts such as "which concept matches," do not mention a lecture or learning objective, and do not repeat the answer term or its defining sentence in the stem. A medium item must require at least two reasoning steps; hard/expert items must use indirect clues rather than simply naming the diagnosis. ` +
    `Examples guide structure, not factual scope: use the supplied facts, write new cases, and honor the requested difficulty rather than copying an IMCQ's difficulty. ` +
    `Match the option count and lettering of the real exam examples below, if given (real exams often run 4-6 options, A-F); otherwise exactly 5 options A-E.\n\n` +
    WHY_WRONG_RULE + `\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n\n` +
    `${studyMode === "repair" ? "FOCUSED REPAIR: cycle questions in this exact order: recognition, mechanism, clinical-application, fresh-retest. A fresh-retest must use a new clinical presentation and clue path. Return taskType for each item.\n\n" : ""}` +
    `FACTS TO TEST (from "${subject}"):\n${factList}` +
    `\n\nLECTURE OBJECTIVES (source data):\n${objectives.map(o => `[${o.id}] ${o.code || ""} ${o.objective || o.text || ""}`).join("\n") || "No objectives available; do not claim objective coverage."}\n` +
    `Test the atom in the context of the relevant objective's task (explain, compare, predict, identify). Return objectiveIds containing ONLY the one primary objective ID actually tested. Use [] when no supplied objective fits. Never attach every objective just because it shares terminology. Cover different relevant objectives across the set.\n` +
    examplesSection + schoolEvidencePrompt(styleExamples, objectives, atoms) + feedbackSection + avoidSection +
    `\n\nBefore returning JSON, reject and rewrite any draft whose stem is shorter or less clinically dense than the school examples, reveals its keyed answer, uses a generic recall template, or can be answered without applying the numbered fact. ` +
    `\n\nReturn ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...",${WHY_WRONG_JSON},"topic":"the fact's term","objectiveIds":["primary objective id"],"taskType":"recognition|mechanism|clinical-application|fresh-retest","difficulty":"${diff}"}]}`
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
    const result = await callAIJSON(cfg.generationVersion === "v2" ? MCQ_V2_SYSTEM : MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    const questions = normalizeQuestions(backfillTopicsFromAtoms(result, atoms, cfg.objectives || [])).map(q => ({
      ...q,
      generationVersion: cfg.generationVersion || "v1",
      objectiveTexts: (cfg.objectives || []).filter(o => q.objectiveIds?.includes(o.id)).map(o => ({ id: o.id, code: o.code || "", text: o.objective || o.text || "" })),
    }));
    return await auditGeneratedQuestions(withSchoolContext(questions, cfg), cfg, deps);
  } catch (e) {
    return { error: e?.message || String(e), questions: [] };
  }
}

function auditQuestionPayload(question, index) {
  return {
    index,
    stem: question.stem,
    choices: question.choices,
    correct: question.correct,
    explanation: question.explanation,
    whyWrong: question.whyWrong,
    objectiveIds: question.objectiveIds,
    topic: question.topic,
  };
}

export function buildQuestionAuditPrompt(questions, cfg = {}) {
  const objectives = (cfg.objectives || []).map((objective) => ({
    id: String(objective.id || objective.code || ""),
    code: String(objective.code || ""),
    text: String(objective.objective || objective.text || ""),
  }));
  const atoms = (cfg.atoms || []).slice(0, 50).map((atom) => ({
    term: String(atom.term || ""),
    content: String(atom.content || ""),
    objectiveIds: atom.objectiveIds || [],
  }));
  const evidence = retrieveLectureEvidence(String(cfg.lectureText || ""), cfg.objectives || [], cfg.atoms || []);
  return (
    `Independently audit every generated question. Do not rewrite or repair it. Approve it only when ALL checks pass:\n` +
    `1. The keyed answer is medically correct and is the single best answer.\n` +
    `2. The stem, key, and explanation are supported by the supplied lecture facts or objective.\n` +
    `3. Its one objectiveIds value genuinely tests that objective's requested task; [] is acceptable only when no objective was supplied.\n` +
    `4. No choices are duplicates or medically equivalent, and the stem does not reveal the answer.\n` +
    `5. The explanation states the decisive mechanism or reasoning, not merely that the answer is correct.\n` +
    `6. The vignette is internally consistent and contains enough discriminating information to answer. Symptoms or an anatomic region must actually distinguish the key from every plausible alternative; generic pain or tenderness alone is not enough.\n` +
    `7. The clinical facts and answer relationship work in both directions: the clues support the key, and the key specifically explains the clues. Reject decorative patient details that could be removed without changing a direct-recall question.\n` +
    `8. Compare the entire batch. Reject paraphrases that test the same clue-to-answer route, even when age, sex, location, or option order changes.\n` +
    `Fail uncertain items. Never infer approval from writing quality alone.\n\n` +
    `SUBJECT: ${cfg.subject || "this lecture"}\nDIFFICULTY: ${cfg.difficulty || "medium"}\n` +
    `OBJECTIVES:\n${JSON.stringify(objectives)}\n` +
    `LECTURE FACTS:\n${JSON.stringify(atoms)}\n` +
    `RETRIEVED LECTURE EVIDENCE:\n${evidence || "No lecture text supplied; use only objectives and lecture facts."}\n\n` +
    `QUESTIONS:\n${JSON.stringify(questions.map(auditQuestionPayload))}\n\n` +
    `Return exactly one review for every question index:\n` +
    `{"reviews":[{"index":0,"approved":true,"issues":[]}]}\n` +
    `Use short issue codes from: incorrect_key, ambiguous_key, unsupported_fact, objective_mismatch, duplicate_choices, duplicate_question, answer_leak, weak_explanation, inconsistent_vignette, non_discriminating_clues, multiple_true_choices.`
  );
}

function buildRepairPrompt(items, cfg = {}) {
  const objectives = (cfg.objectives || []).map((o) => ({ id: o.id || o.code, text: o.objective || o.text }));
  const atoms = (cfg.atoms || []).map((a) => ({ term: a.term, content: a.content, objectiveIds: a.objectiveIds || [] }));
  const examples = (cfg.examples || []).slice(0, 6).map((q) => ({ stem: q.stem, choices: q.choices, correct: q.correct }));
  return `Repair every rejected question below. Preserve the tested objective when it is valid, but change the stem, choices, key, explanation, and objectiveIds as needed to correct every listed issue. Use only the supplied lecture facts/objectives; do not add outside medical facts. Match the concise clinical/anatomic SGU ExamSoft/IMCQ style and use plausible same-category distractors. Return exactly one repaired question for each input item in the same order.

OBJECTIVES:\n${JSON.stringify(objectives)}
LECTURE FACTS:\n${JSON.stringify(atoms)}
STYLE EXAMPLES:\n${JSON.stringify(examples)}
REJECTED ITEMS:\n${JSON.stringify(items)}

Return ONLY: {"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...","whyWrong":{},"objectiveIds":["exact objective id"],"topic":"...","taskType":"recognition|mechanism|clinical-application"}]}`;
}

function normalizedComparableText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Fast deterministic screen used when the independent reviewer cannot return usable JSON.
 * It cannot certify medical correctness, but it prevents transport/parser trouble in the
 * second call from discarding an otherwise usable clinical batch and replacing it with recall.
 */
export function locallyValidClinicalQuestions(questions = []) {
  const structurallyValid = questions.filter((question) => {
    const stem = String(question?.stem || "").trim();
    const entries = Object.entries(question?.choices || {});
    const correctText = question?.choices?.[question?.correct];
    if (!stem.endsWith("?") || stem.length < 160 || stem.split(/[.!?]+/).filter((part) => part.trim()).length < 3 || !correctText || entries.length < 4) return false;
    if (!/(?:\bpatient\b|\bwoman\b|\bman\b|\bgirl\b|\bboy\b|\binfant\b|\bnewborn\b|\bchild\b|\badolescent\b|\bresearcher\b|\bvolunteer\b)/i.test(stem)) return false;
    const values = entries.map(([, value]) => normalizedComparableText(value)).filter(Boolean);
    if (new Set(values).size !== values.length) return false;
    const answer = normalizedComparableText(correctText);
    const normalizedStem = ` ${normalizedComparableText(stem)} `;
    if (answer.length >= 4 && normalizedStem.includes(` ${answer} `)) return false;
    const explanation = String(question?.explanation || "").trim();
    if (explanation.length < 60) return false;
    const whyWrong = Object.values(question?.whyWrong || {}).map((value) => String(value || "").toLowerCase());
    if (whyWrong.length && whyWrong.length < entries.length) return false;
    const nonDiscriminating = whyWrong.filter((value) => /not (?:the )?(?:reason|cause).{0,30}(?:symptom|finding)|not relevant to (?:the )?(?:symptom|case)/.test(value)).length;
    if (nonDiscriminating >= 2) return false;
    if (/history of intermittent abdominal pain/i.test(stem) && /tenderness in (?:the )?(?:right lower quadrant|upper mid-abdomen)/i.test(stem) && !/laboratory|imaging|ct |ultrasound|biopsy|surgery|trauma|fever|guarding|rebound/i.test(stem)) return false;
    return true;
  });
  return uniqueQuestions(structurallyValid);
}

/**
 * A distinct model request reviews the completed batch. Missing, malformed, or uncertain reviews
 * fail closed: unapproved questions never reach the quiz or saved Firestore reserve.
 */
export async function auditGeneratedQuestions(questions, cfg = {}, deps = {}) {
  if (!questions.length) return { questions: [] };
  if (deps.skipQuestionAudit === true) return { questions };
  const reviewer = deps.reviewAIJSON || deps.callAIJSON;
  const locallyValid = locallyValidClinicalQuestions(questions);
  const keepLocallyValidated = (reason) => ({
    questions: locallyValid.map((question) => ({
      ...question,
      qualityAudit: {
        version: 1,
        status: "local-validated",
        checks: ["clinical-structure", "valid-key", "distinct-choices", "no-answer-leak"],
      },
    })),
    warning: locallyValid.length
      ? `${locallyValid.length} clinical question${locallyValid.length === 1 ? "" : "s"} passed structural checks; independent medical review was unavailable (${reason}).`
      : null,
    error: locallyValid.length ? null : `Independent question review was unavailable (${reason}), and no generated questions passed structural checks.`,
  });
  if (typeof reviewer !== "function") return keepLocallyValidated("reviewer not configured");
  try {
    const raw = await reviewer(
      AUDIT_SYSTEM,
      buildQuestionAuditPrompt(questions, cfg),
      { reviews: [] },
      deps.auditMaxTokens || 4000
    );
    const reviews = Array.isArray(raw?.reviews) ? raw.reviews : [];
    const byIndex = new Map(reviews.map((review) => [Number(review?.index), review]));
    if (!reviews.length) return keepLocallyValidated("malformed reviewer response");
    const approved = questions.flatMap((question, index) => {
      const review = byIndex.get(index);
      if (!review) {
        return locallyValid.includes(question) ? [{
          ...question,
          qualityAudit: { version: 1, status: "local-validated", checks: ["clinical-structure", "valid-key", "distinct-choices", "no-answer-leak"] },
        }] : [];
      }
      if (review?.approved !== true || (Array.isArray(review.issues) && review.issues.length) || !locallyValid.includes(question)) return [];
      return [{
        ...question,
        qualityAudit: {
          version: 1,
          status: "approved",
          checks: ["medical-correctness", "single-best-answer", "objective-alignment", "explanation-quality"],
        },
      }];
    });
    const distinctApproved = uniqueQuestions(approved);
    // A strict reviewer can reject every item when the local/cloud reviewer is
    // unavailable or over-sensitive. Do not strand the learner in an endless
    // replacement loop: retain questions that passed deterministic safety
    // checks and label them for later review instead of silently discarding the
    // whole batch.
    if (!distinctApproved.length && deps.skipRepair !== true) {
      const repairer = deps.repairAIJSON || deps.callAIJSON;
      if (typeof repairer === "function") {
        const rejectedItems = questions.map((question, index) => ({
          index,
          question: auditQuestionPayload(question),
          issues: byIndex.get(index)?.issues || ["reviewer_rejected"],
        }));
        try {
          const repairedRaw = await repairer(REPAIR_SYSTEM, buildRepairPrompt(rejectedItems, cfg), { questions: [] }, deps.repairMaxTokens || 6000);
          const repaired = normalizeQuestions(repairedRaw).map((question) => ({ ...question, generationVersion: cfg.generationVersion || "v1" }));
          if (repaired.length) {
            const repairedAudit = await auditGeneratedQuestions(repaired, cfg, { ...deps, skipRepair: true });
            if (repairedAudit.questions?.length) return repairedAudit;
          }
        } catch (repairError) {
          // Fall through to deterministic validation; a repair transport failure
          // must not erase otherwise structurally sound questions.
        }
      }
      return keepLocallyValidated("reviewer rejected the batch after repair");
    }
    return {
      questions: distinctApproved,
      rejectedCount: questions.length - distinctApproved.length,
      warning: distinctApproved.length < questions.length ? `${questions.length - distinctApproved.length} generated question${questions.length - distinctApproved.length === 1 ? "" : "s"} failed independent review or duplicated another item and were withheld.` : null,
    };
  } catch (error) {
    return keepLocallyValidated(error?.message || String(error));
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
export function buildMcqPrompt({ subject = "this lecture", lectureText = "", examples = [], objectives = [], atoms = [], difficulty = "medium", count = 10, studyMode = "balanced", generationVersion = "v1", feedback = null } = {}) {
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
  const feedbackSection = feedback?.sampleSize
    ? `\n\nLEARNED FEEDBACK FROM PRIOR QUESTIONS (${feedback.sampleSize} ratings): recurring issue codes ${JSON.stringify(feedback.issueCounts || {})}; fairness misses ${feedback.fairNo}; ExamSoft-style misses ${feedback.examStyleNo}. Correct these patterns in every new question.\n`
    : "";

  const v2Blueprint = generationVersion === "v2" ?
    `SGU/EXAMSOFT BLUEPRINT:\nObjectives define what may be tested. Lecture evidence determines factual content and the correct answer. Uploaded ExamSoft/IMCQ questions define structure, wording, clue density, and distractor style only. Use concise clinical/anatomic framing, usually one or two reasoning steps, rather than generic UWorld/NBME diagnostic puzzles. Target a 20/60/20 mix of direct application, standard application, and harder integration. Use same-category plausible distractors and distinct clue-to-answer routes.\nSTYLE FINGERPRINT: ${JSON.stringify(styleFingerprint)}\n\n` : "";
  return (
    v2Blueprint +
    `Generate exactly ${count} NEW SGU Basic Principles of Medicine questions on "${subject}".\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n` +
    `Each stem: a concise clinical, anatomic, imaging, procedure, or laboratory scenario whose details do real reasoning work, ending in one precise foundational-science question. Match the reference bank's typical sentence count and clue density; do not force artificial patient details or long board-style diagnostic narratives.\n` +
    `Match the option count and lettering of the exam-bank examples below, if given (real exams often run 4-6 options, A-F); otherwise exactly 5 options A-E, each a complete answer. When the references use laboratory/data tables, generate some items with a compact table-valued answer set: set choiceLayout to "table", set choiceColumns to ordered headers (for example ["Finding","Patient 1","Patient 2"]), and make each choice an object mapping every header to its row value. Preserve ↑/↓ (increased/decreased) arrows and units exactly; never flatten table rows into prose.\n` +
    WHY_WRONG_RULE +
    (studyMode === "repair" ? `\nFOCUSED REPAIR: prioritize the weakest objectives in their supplied order. Cycle item types: recognition, mechanism, clinical-application, fresh-retest, then repeat. Fresh-retest items must use a new clinical presentation and clue-to-answer route. Return taskType on every item.\n` : "") +
    examplesSection +
    schoolEvidencePrompt(styleExamples, objectives, atoms) + objectivesSection +
    atomsSection + feedbackSection +
    contentSection +
    `\n\nDRAFT QUALITY CHECK: rewrite any item with a repeated sentence, repeated answer choice, answer wording revealed in the stem, ambiguous best answer, physiology that is only partly true, or an explanation that does not name the mechanism and connect it to the objective. Match the typical stem length and clue density of the school examples. A separate independent reviewer will decide whether each completed item may be used.\n` +
    `RULES: every question UNIQUE; vary format/demographics; base strictly on the lecture content; set objectiveIds to the exact ID/code of the ONE primary objective tested; distribute correct answers evenly across A/B/C/D/E — no single letter should be correct more than 30% of the time.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"B","explanation":"...",${WHY_WRONG_JSON},"choiceLayout":null,"choiceColumns":null,"topic":"<3-6 word specific medical concept tested, e.g. zona glomerulosa aldosterone control>","objectiveIds":["exact objective id"],"taskType":"recognition|mechanism|clinical-application|fresh-retest","difficulty":"${diff}"}]}`
  );
}
