import { numberedAuditEvidence, resolveAuditEvidence } from "./auditEvidence.js";
import { questionWritingBenchmarkPrompt } from "./questionWritingStandard.js";
// mcq.js — pure MCQ generation helpers (port of the monolith's
// genTopicVignettesWithContext prompt + validation into the shell/engine).
// Verified ExamSoft/IMCQ questions become few-shot STYLE exemplars; Homework
// remains separate task-pattern evidence so the source roles stay auditable.
import { normAtomKey } from "./atomNorm.js";
import { canonicalObjectiveIds } from "./objectiveLinks.js";
import { alignSchoolQuestions, schoolEvidencePrompt, retrieveLectureEvidence } from "./schoolAlignment.js";
import { uniqueQuestions } from "./questionSimilarity.js";
import { renderClinicalCorrelateLibrary } from "./clinicalCorrelates.js";
import { buildOrderBlueprint, normalizeQuestionOrder, stampQuestionOrders, questionOrderDescription, verifyReasoningReview, hasCurrentReasoningAudit } from "./questionOrder.js";
import { objectiveFacetCoveragePrompt } from "./objectiveFacets.js";
import { buildReasoningDepthPlan } from "./questionReasoning.js";

// Prefer local Ollama for every question-writing stage, including independent review
// and repair. Otherwise the bridge's Codex-first default can exhaust the browser
// deadline before Ollama gets a turn, sending routine quizzes to paid APIs.
export function withQuestionAIRouting(call) {
  if (typeof call !== "function") return call;
  return (system, prompt, fallback, maxTokens, provider, temperature, options = {}) => call(
    system, prompt, fallback, maxTokens, provider, temperature,
    { ...options, bridgeBackend: options.bridgeBackend || "ollama" }
  );
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const CONNECTED_REASONING_CONTRACT = `CONNECTED REASONING CONTRACT: Ask for one focused endpoint. Second-order requires discriminating findings -> inferred process -> requested mechanism/structure. Third-order requires findings -> inferred process -> mechanism -> a new downstream prediction. These are causal dependencies, not a count of recalled facts. Reject two unrelated recall tasks joined together (for example, an ICP cutoff plus a measurement-method ranking). Do not manufacture order with bundled mechanism/tracer/ventricle combinations that let one recalled fact reveal the key. All options should answer the same focused lead-in at comparable specificity. Mentally hide the options: the vignette and lead-in must support an answer. Then test the shortest route with the options visible: if one label or giveaway eliminates every distractor, downgrade or rewrite. Preserve legitimate school table formats when supported, but never count extra columns as extra reasoning. Relevant clinical, experimental, imaging, or laboratory clues must change the inference; a long patient story is not required.\n`;

const MCQ_SYSTEM = "You are an SGU Basic Principles of Medicine exam-question writer. Reproduce the supplied SGU ExamSoft/IMCQ writing style, not generic UWorld/NBME style. Return ONLY valid JSON — no markdown, no prose.";
const MCQ_V2_SYSTEM = MCQ_SYSTEM;
const AUDIT_SYSTEM = "You are an independent medical-school question editor. Audit the supplied questions against the supplied curriculum evidence. Return ONLY valid JSON — no markdown, no prose.";
const REPAIR_SYSTEM = "You are a medical exam-question repair editor. Rewrite rejected questions so they are medically accurate, objective-aligned, and faithful to the supplied SGU ExamSoft/IMCQ style. Return ONLY valid JSON — no markdown, no prose.";

// A generation batch may be five questions, but the uploaded school bank is a
// much larger calibration set. Aggregate all available examples into a compact
// fingerprint and expose a diverse prompt sample separately.
export const STYLE_FINGERPRINT_LIMIT = 50;
export const STYLE_PROMPT_EXEMPLAR_LIMIT = 12;

export function styleProfilePrompt(profile, questionCount = null) {
  if (!profile?.sampleSize) return "";
  const reportOutcomes = profile.reportOutcomePerformance || [];
  const weakOutcomes = reportOutcomes.filter((entry) => entry.attempts >= 2 && entry.accuracy < 60).slice(0, 8);
  // The persisted profile can contain hundreds of report-outcome rows. They are
  // useful for local analytics, but serializing the entire array into every AI
  // request made a five-question prompt tens of thousands of characters larger
  // and materially slowed the local bridge. Only the compact style aggregates
  // and the bounded weak-outcome sample below affect generation.
  const promptProfile = {
    version: profile.version,
    sampleSize: profile.sampleSize,
    sourceCounts: profile.sourceCounts || {},
    optionCounts: profile.optionCounts || {},
    officialStyle: profile.officialStyle || {},
    homeworkStyle: profile.homeworkStyle || {},
    clickerStyle: profile.clickerStyle || {},
  };
  const weakness = weakOutcomes.length
    ? `\nREPORT-DERIVED LEARNER GAPS (the learner previously missed items tagged to these school outcomes): ${JSON.stringify(weakOutcomes)}. Prioritize these only when they map to the requested lecture objectives and supplied lecture evidence supports the tested relationship; do not expand scope or copy source questions.\n`
    : "";
  const official = profile.officialStyle || {};
  const optionDistribution = official.optionCountDistribution || [];
  let scaledOptionCounts = [];
  if (optionDistribution.length && Number.isFinite(Number(questionCount)) && Number(questionCount) > 0) {
    const total = optionDistribution.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const exact = optionDistribution.map((row) => ({
      options: Number(row.options),
      exact: Number(questionCount) * Number(row.count || 0) / Math.max(1, total),
    }));
    scaledOptionCounts = exact.map((row) => ({ options: row.options, count: Math.floor(row.exact), remainder: row.exact - Math.floor(row.exact) }));
    let remaining = Number(questionCount) - scaledOptionCounts.reduce((sum, row) => sum + row.count, 0);
    [...scaledOptionCounts].sort((a, b) => b.remainder - a.remainder).slice(0, remaining).forEach((row) => { row.count++; });
    scaledOptionCounts = scaledOptionCounts.filter((row) => row.count > 0).map(({ options, count }) => ({ options, count }));
  }
  const optionRule = optionDistribution.length
    ? `For this ${questionCount || "requested-size"}-item quiz, use this scaled verified ExamSoft option-count quota: ${JSON.stringify(scaledOptionCounts)}. Assign exactly these counts across the batch, shuffle their order, and label each item's complete choices consecutively from A (e.g. 6 choices = A-F). Do not default every item to five choices.`
    : `Use the option counts present in the supplied school exemplars; otherwise use five choices.`;
  const shapeRule = official.sampleSize >= 5
    ? `Match the source bank's aggregate stem length and sentence-count profile (not one convenient exemplar): target about ${official.medianStemWords || official.averageStemWords || "the observed"} words and ${official.medianSentences || official.averageSentences || "the observed"} sentences, with natural variation inside the observed range. Match its clinical-case, laboratory/data, image/table, and task-ending proportions where the requested objectives and available assets support them.`
    : `The style sample is small; follow the supplied verified exemplars closely and do not infer a precise bank-wide distribution.`;
  return `PERSISTED SCHOOL STYLE PROFILE (${profile.sampleSize} verified uploaded questions; aggregate statistics, not factual authority):\n${JSON.stringify(promptProfile)}\nSTYLE-MATCHING CONTRACT: ${shapeRule} ${optionRule} Match the source's construction and reasoning demand, not merely its topic: preserve relevant demographics/context, discriminating findings, a focused single-best-answer lead-in, and plausible homogeneous distractors of comparable specificity and length. Use varied, medically plausible distractors; no throwaway choices, joke options, duplicated choices, or answer-length giveaway. Objectives define scope and lecture evidence defines medical correctness.${weakness}`;
}

export function exemplarSourceTier(question) {
  const label = [question?.sourceFile, question?.filename, question?.bankTitle, question?.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (question?.sourceKind === "examsoft" || /examsoft|esoft/.test(label)) return "examsoft";
  if (question?.sourceKind === "imcq" || /\bimcq\b/.test(label)) return "imcq";
  if (question?.sourceKind === "clicker" || /clicker|in-class/.test(label)) return "clicker";
  if (question?.sourceKind === "supplemental" || /\bnatalie\b|\bhomework\b|practice[ +_-]*questions?|\bweek[ +_-]*\d+/.test(label)) return "homework";
  return "school";
}

const TASK_FAMILY_LABELS = {
  mechanism: "mechanism or explanation",
  prediction: "predicted finding, lab, hormone, pathway, or physiologic change",
  identification: "structure, enzyme, receptor, cell, pathway, or component identification",
  diagnosis: "diagnosis or named process",
  relationship: "relationship, comparison, or best-characterizing statement",
  decision: "next step, treatment, or intervention",
  other: "other focused single-best-answer task",
};

/** Classify the final ask so prompt examples and generated batches can be audited for variety. */
export function questionEndingTask(stem = "") {
  const text = String(stem).replace(/\s+/g, " ").trim().replace(/[?!.]+$/, "").toLowerCase();
  const lastSentence = text.split(/(?<=[.!?])\s+/).at(-1) || text;
  const ask = lastSentence;
  if (/\b(next step|treatment|management|intervention|administered|should be done)\b/.test(ask)) return "decision";
  if (/\b(best explain|explains|mechanism|responsible for|cause of|due to|why does|why is|pathogenesis)\b/.test(ask)) return "mechanism";
  if (/\b(additional|expected|observed|finding|laboratory|lab|concentration|level|acid-base|physiologic effect|alteration|change|increased|decreased|result|associated with|would occur|would be expected)\b/.test(ask)) return "prediction";
  if (/\b(diagnosis|diagnose|condition|disorder|process)\b/.test(ask)) return "diagnosis";
  if (/\b(best describe|best characteriz|relationship|statement|compare|comparison|normal course|chemical nature)\b/.test(ask)) return "relationship";
  if (/\b(structure|nerve|vessel|enzyme|hormone|cell|receptor|intermediate|pathway|component|layer|ligament|muscle|gene|transporter|coenzyme)\b/.test(ask)) return "identification";
  return "other";
}

function isSecondOrderStem(stem = "") {
  return ["mechanism", "prediction", "relationship", "decision"].includes(questionEndingTask(stem));
}

function isThirdOrderStem(stem = "") {
  const sentenceCount = String(stem).split(/[.!?]+/).filter(Boolean).length;
  return sentenceCount >= 3 && /\b(after|because|therefore|consequently|downstream|if .*blocked|in addition|combined with|both .* and|which change would result|what would be expected next)\b/i.test(stem);
}

function taskFamilyCounts(stems = []) {
  return stems.reduce((counts, stem) => {
    const family = questionEndingTask(stem);
    counts[family] = (counts[family] || 0) + 1;
    return counts;
  }, {});
}

function taskVariationPrompt(styleFingerprint, difficulty, batchLabel = "batch") {
  const diff = String(difficulty).toLowerCase();
  const secondOrderTarget = diff === "easy" ? "at least 40%" : "at least 60%";
  const observed = styleFingerprint?.sampleSize
    ? `Observed school ending families: ${JSON.stringify(styleFingerprint.endingFamilies)}; observed second-order signal: ${Math.round((styleFingerprint.secondOrderRate || 0) * 100)}%.`
    : "No school ending fingerprint was available; use the distribution below.";
  return `\n\nQUESTION-TASK VARIATION (${batchLabel}): ${observed}\n` +
    `- The school questions may often begin with "Which," but their final task varies. Do not repeat the generic phrase "Which of the following" as the complete template; use it no more than twice in a batch and vary the noun being requested.\n` +
    `- Rotate among these ending families when the supplied facts support them: mechanism/explanation ("Which mechanism best explains...?"), predicted downstream finding or lab ("What additional finding would be expected...?" or "Which change is most likely...?"), identification ("Which structure/enzyme/receptor...?"), diagnosis/process ("Which diagnosis or process...?"), relationship/characterization ("Which statement best describes the relationship...?"), and conditional prediction ("If this step were blocked, what would change...?"). Do not force a family that the lecture cannot support.\n` +
    `- At least ${secondOrderTarget} of ${batchLabel} should require clue -> underlying mechanism or lesion -> downstream consequence. The final ask should test the consequence, relationship, or mechanism when the objective allows it, rather than merely naming the first recognizable term.\n` +
    `- Across ${batchLabel}, avoid repeating the same final sentence pattern, answer object, or clue-to-answer route. A different patient age or reordered options does not make a repeated task new.\n` +
    `- Use the exact medical relationship supported by the lecture, objectives, and uploaded ExamSoft/IMCQ/homework evidence. Return taskType as recognition, mechanism, clinical-application, or fresh-retest, but vary the natural-language ending independently of that label.\n`;
}

/** Compact, deterministic style fingerprint used to keep generation anchored to the real bank. */
export function buildStyleFingerprint(examples = []) {
  const usable = examples.filter((q) => q?.stem && q?.choices);
  if (!usable.length) return { sampleSize: 0 };
  const stems = usable.map((q) => String(q.stem).trim());
  const avg = (values) => Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const wordCounts = stems.map((s) => s.split(/\s+/).filter(Boolean).length);
  const sentenceCounts = stems.map((s) => s.split(/[.!?]+/).filter(Boolean).length);
  const optionWordCounts = usable.flatMap((q) => Object.values(q.choices || {}).map((choice) => {
    const value = choice && typeof choice === "object" ? Object.values(choice).join(" ") : choice;
    return String(value || "").split(/\s+/).filter(Boolean).length;
  }));
  const leadIns = stems.flatMap((s) => [...s.matchAll(/(?:Which of the following|What is|The most likely|Which structure|Which nerve|Which vessel)/gi)].map((m) => m[0].toLowerCase()));
  const endingCounts = taskFamilyCounts(stems);
  const scenarioTypes = ["surgery", "trauma", "imaging", "ultrasound", "x-ray", "laboratory", "histology", "procedure", "newborn", "symptoms"]
    .map((label) => ({ label, count: stems.filter((s) => new RegExp(`\\b${label}\\b`, "i").test(s)).length }))
    .filter((entry) => entry.count);
  const formatSignals = [
    ["table", (q) => q.choiceLayout === "table" || Object.values(q.choices || {}).some((value) => value && typeof value === "object")],
    ["image-or-label", (q) => q.hasImage || /\b(image|figure|label(?:ed)?|photomicrograph|histolog(?:y|ic))\b/i.test(String(q.stem))],
    ["laboratory-data", (q) => /\b(laboratory|lab(?:oratory)?|serum|plasma|urine|concentration|level|\bNa\+|\bK\+|\bCa\+?\+|pH)\b/i.test(String(q.stem))],
    ["timeline", (q) => /\b(\d+\s*(?:hours?|days?|weeks?|months?|years?)|since|after|during|progressive|sudden|newborn|postoperative|postpartum)\b/i.test(String(q.stem))],
  ].map(([label, test]) => ({ label, count: usable.filter(test).length }))
    .filter((entry) => entry.count);
  return {
    sampleSize: usable.length,
    averageStemCharacters: avg(stems.map((s) => s.length)),
    averageStemWords: avg(wordCounts),
    medianStemWords: median(wordCounts),
    minStemWords: Math.min(...wordCounts),
    maxStemWords: Math.max(...wordCounts),
    averageSentences: Math.round((sentenceCounts.reduce((a, b) => a + b, 0) / usable.length) * 10) / 10,
    medianSentences: median(sentenceCounts),
    averageOptionWords: avg(optionWordCounts),
    optionCounts: [...new Set(usable.map((q) => Object.keys(q.choices).length))].sort((a, b) => a - b),
    optionCountDistribution: Object.entries(usable.reduce((counts, q) => {
      const count = Object.keys(q.choices).length;
      counts[count] = (counts[count] || 0) + 1;
      return counts;
    }, {})).sort(([a], [b]) => Number(a) - Number(b)).map(([options, count]) => ({ options: Number(options), count })),
    commonLeadIns: [...new Set(leadIns)].slice(0, 6),
    endingFamilies: Object.entries(endingCounts).sort((a, b) => b[1] - a[1]).map(([family, count]) => ({ family, label: TASK_FAMILY_LABELS[family], count })),
    secondOrderRate: stems.filter(isSecondOrderStem).length / stems.length,
    thirdOrderRate: stems.filter(isThirdOrderStem).length / stems.length,
    scenarioTypes: scenarioTypes.sort((a, b) => b.count - a.count).slice(0, 6),
    formatSignals,
  };
}

const OBJECTIVE_MODALITIES = [
  ["computed tomography", "CT"],
  ["\\bCT\\b", "CT"],
  ["magnetic resonance imaging", "MRI"],
  ["\\bMRI\\b", "MRI"],
  ["radiological? images?", "radiograph/radiologic imaging"],
  ["x[- ]?ray", "radiograph"],
  ["ultrasound|sonograph", "ultrasound"],
  ["angiograph(?:y|ic)", "angiography"],
  ["endoscop(?:y|ic)", "endoscopy"],
];

function objectiveModalitySection(objectives = []) {
  const rows = objectives.map((objective) => {
    const text = String(objective?.objective || objective?.text || "");
    const modalities = OBJECTIVE_MODALITIES
      .filter(([pattern]) => new RegExp(pattern, "i").test(text))
      .map(([, label]) => label)
      .filter((label, index, all) => all.indexOf(label) === index);
    return modalities.length ? `[${objective?.id || objective?.code || "objective"}] ${modalities.join(", ")}` : null;
  }).filter(Boolean);
  if (!rows.length) return "";
  return "\n\nOBJECTIVE MODALITY / SETTING COVERAGE:\n" + rows.join("\n") +
    "\nWhen an objective names multiple imaging or clinical settings, preserve that breadth. Across the quiz batch, distribute questions across the named modalities when the requested count permits; do not let every item collapse onto the first modality. Each item should name the modality or setting that supplies its discriminating clue, and the final ask should test interpretation in that setting. Use only modality-specific relationships supported by the supplied lecture evidence.\n";
}

/**
 * Keep source roles explicit: official ExamSoft/IMCQ questions teach wording and
 * option conventions; Homework teaches the kinds of relationships and traps the
 * learner is assigned to practice. Neither source silently becomes lecture truth.
 */
export function buildQuestionSourceBlueprint(examples = [], objectives = [], count = 10) {
  const homework = examples.filter((question) => exemplarSourceTier(question) === "homework" && question?.stem && question?.choices && question.answerKeyVerified !== false);
  const clicker = examples.filter((question) => exemplarSourceTier(question) === "clicker" && question?.stem && question?.choices);
  const homeworkFingerprint = buildStyleFingerprint(homework.slice(0, STYLE_FINGERPRINT_LIMIT));
  const clickerFingerprint = buildStyleFingerprint(clicker.slice(0, STYLE_FINGERPRINT_LIMIT));
  const official = selectStyleExemplars(examples, STYLE_FINGERPRINT_LIMIT, "medium", { objectives, atoms: [] });
  return {
    officialStyle: buildStyleFingerprint(official),
    homeworkTypes: homeworkFingerprint,
    clickerTypes: clickerFingerprint,
    order: buildOrderBlueprint({ objectives, count }),
  };
}

function homeworkEvidencePrompt(examples = []) {
  const homework = examples.filter((question) => exemplarSourceTier(question) === "homework" && question?.stem && question?.choices && question.answerKeyVerified !== false).slice(0, 6);
  if (!homework.length) return "";
  const blueprint = buildStyleFingerprint(homework);
  return `\n\nHOMEWORK TASK EVIDENCE (assigned-practice signal, not official style or answer authority):\n` +
    `Observed task families: ${JSON.stringify(blueprint.endingFamilies || [])}; observed second-order signal: ${Math.round((blueprint.secondOrderRate || 0) * 100)}%.\n` +
    homework.map((question, index) => `HOMEWORK ${index + 1}: ${question.stem}`).join("\n") +
    `\nUse Homework to include the relationships, misconception patterns, and problem types your assignments actually practice. Rewrite them as NEW questions in the verified ExamSoft/IMCQ structure; do not copy wording, import unsupported facts, or treat a homework key as an independent medical audit. Objectives still determine what may be tested.\n`;
}

function clickerEvidencePrompt(examples = []) {
  const clickers = examples.filter((question) => exemplarSourceTier(question) === "clicker" && question?.stem && question?.choices).slice(0, 6);
  if (!clickers.length) return "";
  const keyed = clickers.filter((question) => question.answerKeyVerified === true && question.correct).length;
  return `\n\nIN-CLASS CLICKER TASK EVIDENCE (lecture-discussion signal, not official exam style or answer authority):\n` +
    `Imported ${clickers.length} complete clicker examples; ${keyed} had an unambiguous visible answer marking. Use these to learn the kinds of clinical clues, image dependence, and downstream reasoning the instructor asks students to perform. Preserve image-based task patterns when the lecture/objective supports them, but do not copy wording, infer an answer for an unkeyed image, or promote clicker content into verified practice questions without a source key.\n` +
    clickers.map((question, index) => `CLICKER ${index + 1}${question.hasImage ? " [image-dependent]" : ""}: ${question.stem}`).join("\n") + "\n";
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
  cfg = { ...cfg, promptProfile: cfg.promptProfile || "compact" };
  const { maxTokens = 8000 } = deps;
  const callAIJSON = withQuestionAIRouting(deps.callAIJSON);
  const text = String(cfg.lectureText || "");
  const atoms = Array.isArray(cfg.atoms) ? cfg.atoms : [];
  if (text.trim().length < 150 && !atoms.length) return { error: "Not enough lecture text — convert/upload the lecture first.", questions: [] };
  try {
    const prompt = buildMcqPrompt(cfg);
    // Quiz generation must not mistake the AI client's empty fallback for a valid
    // (but empty) generation result. Preserve provider/bridge failures so the
    // preparation UI can stop promptly and tell the learner what actually failed.
    const result = await callAIJSON(MCQ_V2_SYSTEM, prompt, { questions: [] }, maxTokens, undefined, undefined, {
      ...(deps.aiOptions || {}),
      throwOnError: true,
    });
    if (result?.error) return { error: String(result.error), questions: [] };
    const candidates = questionCandidates(result);
    const generated = withSchoolContext(stampQuestionOrders(ensureObjectiveAttribution(normalizeQuestions(result), cfg.objectives || []), cfg.objectives || []), cfg).map((question) => ({ ...question, generationVersion: "v2" }));
    if (!generated.length) {
      const fields = result && typeof result === "object" && !Array.isArray(result) ? Object.keys(result).slice(0, 8).join(", ") : typeof result;
      const detail = candidates.length
        ? `The response contained ${candidates.length} candidate question${candidates.length === 1 ? "" : "s"}, but none had a usable stem, choices, and answer key.`
        : `No question list was found (response fields: ${fields || "none"}; expected { questions: [...] }).`;
      return { error: `Question generation returned no usable items. ${detail} Retry once; if it repeats, check the selected provider/model output format.`, questions: [] };
    }
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
  if (Array.isArray(choices)) {
    choices = Object.fromEntries(choices.map((choice, index) => {
      const letter = choice?.letter || choice?.label || LETTERS[index];
      const value = choice?.text ?? choice?.choice ?? choice?.option ?? choice;
      return [letter, value];
    }));
  }
  const out = new Map();
  for (const [rawLetter, value] of Object.entries(choices || {})) {
    const letter = normalizeChoiceLetter(rawLetter);
    if (!letter || out.has(letter) || !hasChoiceValue(value)) continue;
    out.set(letter, value);
  }
  return [...out.entries()].sort((a, b) => LETTERS.indexOf(a[0]) - LETTERS.indexOf(b[0]));
}

function questionCandidates(raw, depth = 0) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object" || depth > 3) return [];
  for (const key of ["questions", "items", "mcqs", "data", "result", "output"]) {
    const value = raw[key];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const nested = questionCandidates(JSON.parse(value), depth + 1);
        if (nested.length) return nested;
      } catch { /* not a JSON-wrapped question list */ }
    } else if (value && typeof value === "object") {
      const nested = questionCandidates(value, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
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
  const list = questionCandidates(raw);
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
      objectiveFacet: q.objectiveFacet ? String(q.objectiveFacet).trim().slice(0, 100) : null,
      taskType: q.taskType ? String(q.taskType).trim() : null,
      reasoningDepth: ["state-recognition", "pathway-process", "mechanism", "enzyme-structure", "regulation-cofactor", "clinical-consequence"].includes(q.reasoningDepth) ? q.reasoningDepth : null,
      orderLevel: normalizeQuestionOrder(q.orderLevel || q.questionOrder),
      reasoningSteps: Array.isArray(q.reasoningSteps) ? q.reasoningSteps.map(String).slice(0, 6) : [],
      questionPlan: q.questionPlan && typeof q.questionPlan === "object" && !Array.isArray(q.questionPlan) ? {
        relationship: String(q.questionPlan.relationship || "").slice(0, 800),
        perturbation: String(q.questionPlan.perturbation || "").slice(0, 500),
        inference: String(q.questionPlan.inference || "").slice(0, 800),
        endpoint: String(q.questionPlan.endpoint || "").slice(0, 300),
        nearestDistractor: String(q.questionPlan.nearestDistractor || "").slice(0, 500),
        discriminator: String(q.questionPlan.discriminator || "").slice(0, 500),
        sourceQuotes: Array.isArray(q.questionPlan.sourceQuotes) ? q.questionPlan.sourceQuotes.map(String).slice(0, 3) : [],
      } : null,
      bloomLevel: Number.isFinite(Number(q.bloomLevel)) ? Math.max(1, Math.min(6, Number(q.bloomLevel))) : null,
      clinicalCorrelate: q.clinicalCorrelate ? String(q.clinicalCorrelate).trim() : null,
      clinicalCueUsed: q.clinicalCueUsed ? String(q.clinicalCueUsed).trim() : null,
    };
    out.push(shuffleChoices(validated));
    if (out.length >= 100) break;
  }
  return out;
}

// Objective attribution is required for progress tracking. Models occasionally omit the field
// even after being instructed to return it; use a deterministic round-robin only for an omitted
// or invalid value, while preserving a valid single-objective attribution.
export function ensureObjectiveAttribution(questions = [], objectives = []) {
  const targets = (objectives || []).filter((objective) => objective?.id || objective?.code);
  if (!targets.length) return questions;
  const ids = new Set(targets.map((objective) => String(objective.id || objective.code)));
  return questions.map((question, index) => {
    const valid = Array.isArray(question.objectiveIds)
      ? question.objectiveIds.map(String).filter((id) => ids.has(id)).slice(0, 1)
      : [];
    return valid.length ? { ...question, objectiveIds: valid } : {
      ...question,
      objectiveIds: [String(targets[index % targets.length].id || targets[index % targets.length].code)],
    };
  });
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
  const { maxTokens = 4000 } = deps;
  const callAIJSON = withQuestionAIRouting(deps.callAIJSON);
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
export function selectStyleExemplars(examples = [], limit = 5, _difficulty = "medium", targets = {}) {
  if (limit <= 0) return [];
  const relevance = new Map(alignSchoolQuestions(examples, targets.objectives, targets.atoms).map(x => [x.question,x.score]));
  // Homework/student-authored and in-class clicker banks are useful task evidence,
  // but ExamSoft and IMCQ remain the primary writing-style references.
  const candidates = examples.filter((q) => {
    const tier = exemplarSourceTier(q);
    return q?.stem && q?.choices && !q.hasImage && q.answerKeyVerified !== false &&
      tier !== "homework" && tier !== "clicker";
  });
  // Keep the entire uploaded bank in the candidate pool. Previously, the
  // presence of one objective-linked example discarded every unrelated example,
  // which made a 50+ question bank behave like a tiny lecture-specific set.
  // Relevance now ranks examples without removing the broader style library.
  const valid = candidates.sort((a, b) => {
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

export function buildAtomQuestionsPrompt({ atoms = [], objectives = [], difficulty = "medium", examples = [], styleProfile = null, avoidStems = [], subject = "this lecture", studyMode = "balanced", generationVersion = "v2", feedback = null, clinicalCorrelateLibrary = [], orderBlueprint = null, focusNotes = "", reasoningDepthPlan = null, requireReasoningAudit = false } = {}) {
  const diff = String(difficulty).toLowerCase();
  // A fact with `hasImage` gets a photomicrograph rendered above its question. The model is
  // told an image is coming so the stem can point at it, but never told what it shows —
  // naming the tissue in the stem is the answer.
  const factList = atoms
    .slice(0, ATOM_QUIZ_CAP)
    .map((a, i) => `${i + 1}. [${a.importanceTier || "unranked"}] [${a.detailRole || a.type}] ${a.term}${a.parentTerm ? ` (parent: ${a.parentTerm})` : ""}: ${a.content}${a.clinicalCorrelate ? ` [clinical correlate: ${a.clinicalCorrelate}]` : ""}${a.clinicalCues?.length ? ` [clinical cues: ${a.clinicalCues.join(", ")}]` : ""}${a.buzzwords?.length ? ` [lecture buzzwords: ${a.buzzwords.join(", ")}]` : ""}${a.testableDetails?.length ? ` [testable details: ${a.testableDetails.join("; ")}]` : ""}${a.exceptions?.length ? ` [exceptions: ${a.exceptions.join("; ")}]` : ""}${a.quantitativeDetails?.length ? ` [quantitative details: ${a.quantitativeDetails.join("; ")}]` : ""}${a.inheritancePattern ? ` [inheritance: ${a.inheritancePattern}]` : ""}${a.objectiveIds?.length ? ` [linked objectives: ${a.objectiveIds.join(", ")}]` : ""}${a.hasImage ? IMAGE_NOTE : ""}`)
    .join("\n");

  const styleExamples = selectStyleExemplars(examples, STYLE_PROMPT_EXEMPLAR_LIMIT, diff, { objectives, atoms });
  const styleFingerprint = buildStyleFingerprint(selectStyleExemplars(examples, STYLE_FINGERPRINT_LIMIT, diff, { objectives, atoms }));
  const sourceBlueprint = buildQuestionSourceBlueprint(examples, objectives, atoms.length);
  const resolvedOrderBlueprint = orderBlueprint || sourceBlueprint.order;
  const depthPlan = Array.isArray(reasoningDepthPlan) && reasoningDepthPlan.length ? reasoningDepthPlan : buildReasoningDepthPlan(atoms.length);
  const depthSection = `\n\nREASONING-DEPTH TRAINING PLAN: ${JSON.stringify(depthPlan)}\nFor each question, return the matching reasoningDepth from state-recognition|pathway-process|mechanism|enzyme-structure|regulation-cofactor|clinical-consequence. Vary the requested layer across the batch. When multiple questions can validly target the same objective, build a shallow-to-deep progression or a same-patient mini-sequence (2-3 items maximum), then later transfer the mechanism to a different presentation. Sometimes state/process is obvious or explicitly supplied and the ask must go one level deeper. Distractors should encode plausible pathway, direction, level, or regulator errors, not random facts. Difficulty comes from supported causal depth, never vague wording.\n`;
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
  const clinicalSection = clinicalCorrelateLibrary?.length
    ? `\n\nRECURRENT CLINICAL CORRELATES FROM THE LECTURE AND UPLOADED QUESTIONS:\n${renderClinicalCorrelateLibrary(clinicalCorrelateLibrary)}\nUse these recurring signals as optional clue-to-mechanism practice when the numbered atom supports them. Do not force a signal into every item, do not make the signal itself the answer unless the atom supports that relationship, and do not add facts that are absent from the supplied atoms/objectives.\n`
    : "";
  const focusSection = String(focusNotes || "").trim()
    ? `\n\nINSTRUCTOR/LEARNER EMPHASIS (high-priority targeting guidance, not a substitute for lecture evidence):\n${String(focusNotes).trim()}\nDistribute questions across these requested topics when the supplied lecture facts/objectives support them. Give extra attention to stated blockers, rate-limiting steps, cofactors, enzyme reactions, and regulatory consequences. Do not invent unsupported facts.\n`
    : "";

  const v2Blueprint = generationVersion === "v2" ?
    `V2 SGU/EXAMSOFT BLUEPRINT:\n- Objectives define WHAT is tested; lecture facts establish the medically correct key; examples define HOW the item is written and are never factual authority.\n- Write concise SGU-style clinical or anatomic application items, normally one or two reasoning steps, not long UWorld-style diagnostic puzzles.\n- Across a batch target 20% direct foundational application, 60% standard clinical/anatomic application, and 20% harder integration.\n- Every distractor must be the same semantic category as the key and plausible for the exact task.\n- Vary patient framing, tested relationship, lead-in, and clue-to-answer route across the batch. Never add generic patient details that do no diagnostic work.\n\n` : "";
  const taskSection = taskVariationPrompt(styleFingerprint, diff, "atom-question batch");
  const orderSection = `ORDER-OF-REASONING BLUEPRINT (separate from difficulty): ${JSON.stringify(resolvedOrderBlueprint.targets)}\n` +
    `${resolvedOrderBlueprint.rationale}\n` +
    `For each item set orderLevel to first-order, second-order, or third-order. First-order = ${questionOrderDescription("first-order")}; second-order = ${questionOrderDescription("second-order")}; third-order = ${questionOrderDescription("third-order")}. Objective targets: ${JSON.stringify(resolvedOrderBlueprint.objectiveTargets)}. Use each objective's allowed orders as its ceiling; never label a question third-order when its objective/facts cannot support integration. ${requireReasoningAudit ? "Return reasoningSteps for every item: the shortest necessary cue-to-relationship-to-answer chain. Follow objective nextOrder targets; second-order needs one relationship after interpreting clues, third-order needs two distinct lecture-supported relationships. Do not manufacture complexity through stem length." : ""}\n`;
  return (
    CONNECTED_REASONING_CONTRACT + questionWritingBenchmarkPrompt({ objectives, atoms }) +
    objectiveFacetCoveragePrompt(objectives, atoms.length) +
    v2Blueprint + styleProfilePrompt(styleProfile, atoms.length) + orderSection + taskSection +
    `Write ONE USMLE Step 1 clinical-vignette question that tests EACH numbered fact below, in order — one question per fact.\n` +
    `Each question must test that specific fact (not adjacent trivia). Respect the hierarchy: anchor/core atoms establish the big picture; supporting atoms explain the mechanism; discriminator atoms supply the small exam-defining clue. For a discriminator, name its parent concept and test the distinction. For comparison atoms, explicitly contrast the parent entities using the supplied characteristic rather than asking an isolated definition. Use the supplied clinical correlate, cues, buzzwords, testable details, exceptions, quantitative details, or inheritance pattern when present so the learner practices recognizing the lecturer's exact discriminators. Preserve qualifiers such as only/except/first/rate-limiting, timing, thresholds, laterality, anatomic level, cell type, compartment, sequence, and direction of change; these small details are often the tested distinction. Every stem must be a realistic 3-5 sentence clinical vignette with age and sex, presenting concern, relevant history, and only the examination, laboratory, imaging, or pathology clues needed for the reasoning task. End with a single-best-answer question. ` +
    `Do not write direct-definition prompts such as "which concept matches," do not mention a lecture or learning objective, and do not repeat the answer term or its defining sentence in the stem. Never ask what an objective says, which item is named in the objective, or test the learner's ability to read objective wording; test the underlying medical fact or relationship instead. Use an ExamSoft + STEP 1 hybrid: clinical-application items should include a meaningful timeline plus the relevant exam, laboratory, imaging, or physiologic finding, usually 3–5 sentences; recognition/mechanism items may remain shorter and use 1–2 reasoning steps when the objective is genuinely narrow. ` +
    `Examples guide structure, not factual scope: use the supplied facts, write new cases, and honor the requested difficulty rather than copying an IMCQ's difficulty. ` +
    `Match the option count and lettering of the real exam examples below, if given (real exams often run 4-6 options, A-F); otherwise exactly 5 options A-E.\n\n` +
    WHY_WRONG_RULE + `\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n\n` +
    `${studyMode === "repair" ? "FOCUSED REPAIR: cycle questions in this exact order: recognition, mechanism, clinical-application, fresh-retest. A fresh-retest must use a new clinical presentation and clue path. Return taskType for each item.\n\n" : ""}` +
    `FACTS TO TEST (from "${subject}"):\n${factList}` +
    `\n\nLECTURE OBJECTIVES (source data):\n${objectives.map(o => `[${o.id}] ${o.code || ""} ${o.objective || o.text || ""}`).join("\n") || "No objectives available; do not claim objective coverage."}\n` +
    `Test the atom in the context of the relevant objective's task (explain, compare, predict, identify). Return objectiveIds containing ONLY the one primary objective ID actually tested. Use [] when no supplied objective fits. Never attach every objective just because it shares terminology. Cover different relevant objectives across the set.\n` +
    examplesSection + schoolEvidencePrompt(styleExamples, objectives, atoms) + homeworkEvidencePrompt(examples) + clickerEvidencePrompt(examples) + clinicalSection + focusSection + feedbackSection + avoidSection +
    `\n\nBefore returning JSON, reject and rewrite any draft whose stem is shorter or less clinically dense than the school examples, reveals its keyed answer, uses a generic recall template, or can be answered without applying the numbered fact. ` +
    depthSection + `\nReturn ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...",${WHY_WRONG_JSON},"topic":"the fact's term","objectiveIds":["primary objective id"],"objectiveFacet":"specific clause tested","taskType":"recognition|mechanism|clinical-application|fresh-retest","reasoningDepth":"state-recognition|pathway-process|mechanism|enzyme-structure|regulation-cofactor|clinical-consequence","orderLevel":"first-order|second-order|third-order","reasoningSteps":["interpret clue","apply supplied relationship","integrate a second relationship only when needed"],"difficulty":"${diff}"}]}`
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
  const { maxTokens = 8000 } = deps;
  const callAIJSON = withQuestionAIRouting(deps.callAIJSON);
  const atoms = Array.isArray(cfg.atoms) ? cfg.atoms : [];
  if (!atoms.length) return { error: "No atoms to quiz — extract a lecture first.", questions: [] };
  try {
    const prompt = buildAtomQuestionsPrompt(cfg);
    const result = await callAIJSON(MCQ_V2_SYSTEM, prompt, { questions: [] }, maxTokens);
    const questions = stampQuestionOrders(ensureObjectiveAttribution(normalizeQuestions(backfillTopicsFromAtoms(result, atoms, cfg.objectives || [])), cfg.objectives || []), cfg.objectives || []).map(q => ({
      ...q,
      generationVersion: "v2",
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
    objectiveFacet: question.objectiveFacet || null,
    taskType: question.taskType || null,
    topic: question.topic,
    orderLevel: question.orderLevel,
    reasoningSteps: question.reasoningSteps || [],
    questionPlan: question.questionPlan || null,
    bloomLevel: question.bloomLevel,
    clinicalCorrelate: question.clinicalCorrelate,
    clinicalCueUsed: question.clinicalCueUsed,
  };
}

export function buildQuestionAuditPrompt(questions, cfg = {}) {
  if (cfg.promptProfile === "compact") return buildCompactAuditPrompt(questions, cfg);
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
  const reviewQuery = questions.map(question => ({ term: question.topic || "", content: `${question.stem || ""} ${Object.values(question.choices || {}).join(" ")} ${question.explanation || ""}` }));
  const evidence = retrieveLectureEvidence(String(cfg.lectureText || ""), cfg.objectives || [], [...(cfg.atoms || []), ...reviewQuery], cfg.requireReasoningAudit ? 14000 : 7000);
  const clinicalCorrelates = renderClinicalCorrelateLibrary(cfg.clinicalCorrelateLibrary || []);
  return (
    `Independently audit every generated question. Approve it only when ALL checks pass:\n` +
    CONNECTED_REASONING_CONTRACT + questionWritingBenchmarkPrompt(cfg) +
    `SCHOOL COMPARISON EXAMPLES (style only; never factual authority):\n${JSON.stringify(selectStyleExemplars(cfg.examples || [], 6, cfg.difficulty, { objectives: cfg.objectives, atoms: cfg.atoms }).map(q => ({ sourceFile: q.sourceFile || q.filename, sourceKind: exemplarSourceTier(q), stem: q.stem, choices: q.choices })))}\nCompare clue density, focused lead-in, and plausible distractor distinctions to these actual uploads. Reject material departures as school_style_mismatch. Homework informs task patterns, not official exam style.\n` +
    `1. The keyed answer is medically correct and is the single best answer.\n` +
    `2. The stem, key, and explanation are supported by the supplied lecture facts or objective.\n` +
    `3. Its one objectiveIds value genuinely tests that objective's requested task; [] is acceptable only when no objective was supplied. Reject gross domain mismatches even if the item is otherwise medically correct (for example, an isolated peripheral nerve lesion question is not evidence for an amino-acid metabolism objective). Return objectiveAligned true only when the specific medical relationship actually tests the mapped objective; judge meaning, not exact keyword overlap. objectiveFacet must name the specific clause/task actually tested. For broad objectives, compare the batch against every independently assessable clause; when the requested count and evidence permit, distinct clauses must be represented by distinct questions before a facet is repeated.\n` +
    `4. No choices are duplicates or medically equivalent, and the stem does not reveal the answer.\n` +
    `5. The explanation states the decisive mechanism or reasoning, not merely that the answer is correct.\n` +
    `6. The vignette is internally consistent and contains enough discriminating information to answer. Symptoms or an anatomic region must actually distinguish the key from every plausible alternative; generic pain or tenderness alone is not enough.\n` +
    `7. The clinical facts and answer relationship work in both directions: the clues support the key, and the key specifically explains the clues. Reject decorative patient details that could be removed without changing a direct-recall question.\n` +
    `8. Do not allow named diseases, syndromes, treatments, or laboratory findings absent from the supplied lecture evidence/objectives. A fact may be clinically true yet still fail this curriculum-grounding check; reject it as unsupported_fact.\n` +
    `9. Compare the entire batch. Reject paraphrases that test the same clue-to-answer route, even when age, sex, location, or option order changes.\n` +
    `10. Compare the final asks across the batch. The school style may use "Which" often, but the target must vary. For batches of five or more, expect at least three supported task families and at least half of the items to require a second-order clue -> mechanism or lesion -> downstream finding/relationship step. Flag a repetitive generic ending or first-order-only batch as repetitive_task_ending when it materially reduces practice value.\n` +
    `11. Treat orderLevel as a reasoning claim, not a synonym for difficulty: first-order recognizes one supplied fact; second-order applies one supplied relationship; third-order integrates at least two supplied relationships before selecting a downstream result. The stated order must be supported by the item's objective and lecture facts. Flag order_level_mismatch when it is overstated or the item is mislabeled.\n` +
    `12. If the mapped objective explicitly names multiple imaging modalities or clinical settings (for example CT, MRI, and radiologic images), preserve that scope across the batch when the requested count permits. Reject an item only when it claims modality-specific findings absent from the supplied evidence; do not treat a single modality as complete coverage of a multi-modality objective.\n` +
    (cfg.requireReasoningAudit ? `REASONING VERIFICATION: In each review return reasoning: {"orderLevel":"first-order|second-order|third-order","steps":["cue interpretation","apply the supplied relationship","integrate another relationship if required"],"sourceQuotes":["exact lecture excerpt"],"allStepsRequired":true,"connectedChain":true,"singleEndpoint":true,"choiceShortcut":false}. Evaluate the ACTUAL shortest route to the key. Second-order needs cue interpretation plus one relationship; third-order needs at least two distinct relationships after interpreting the clues. Set connectedChain true only when each relationship depends on the preceding inference, singleEndpoint true only for one focused requested result, and choiceShortcut false only after checking that the options do not reveal the answer through a one-fact shortcut. These fields are explicit judgments, not defaults. Each step must depend on the preceding inference. Explicitly test whether the choices allow a one-fact shortcut. All steps must be necessary: a padded stem or an answer obtainable by one recalled label is first-order. Copy short, verbatim, contiguous excerpts from the supplied lecture facts/text supporting the relationship(s), at least two distinct quotes for third-order. Prefer 20-160 character prose excerpts; never paraphrase or merge separate table columns into a quotation. Never use the objective wording as factual evidence. If you cannot verify the order, omit reasoning and reject as order_level_mismatch.\n` : "") +
    homeworkEvidencePrompt(cfg.examples || []) +
    `OBJECTIVE ALIGNMENT: An objective's action verb is a guide to scope, not a ban on applying its supporting lecture relationships. For example, an objective identifying causes of brain edema can be tested by inferring the cause from the source's barrier, composition, and distribution relationships. An objective correlating CSF composition with disease can require linking cellular content to impaired absorption and downstream findings. Flag objective_mismatch only for a different curricular target, not because an application question goes beyond repeating the verbatim objective. For every rejection include a brief rationale naming the unsupported fact or mismatched target.\n` +
    `Fail uncertain items. Never infer approval from writing quality alone.\n\n` +
    `SUBJECT: ${cfg.subject || "this lecture"}\nDIFFICULTY: ${cfg.difficulty || "medium"}\n` +
    `OBJECTIVES:\n${JSON.stringify(objectives)}\n` +
    objectiveModalitySection(cfg.objectives || []) +
    `LECTURE FACTS:\n${JSON.stringify(atoms)}\n` +
    `RETRIEVED LECTURE EVIDENCE:\n${evidence || "No lecture text supplied; use only objectives and lecture facts."}\n\n` +
    `RECURRENT CLINICAL CORRELATES (optional; use only when supported by the lecture facts):\n${clinicalCorrelates || "none"}\n\n` +
    `QUESTIONS:\n${JSON.stringify(questions.map(auditQuestionPayload))}\n\n` +
    `Return exactly one review for every question index. When approved is false, also return a corrected replacement that fixes every issue while testing the same supplied objective. The replacement must be a complete question with 4-6 choices, one valid key, explanation, whyWrong for every option, objectiveIds, objectiveFacet, topic, taskType, and orderLevel. Do not return a replacement when the supplied evidence cannot support one.\n` +
    `{"reviews":[{"index":0,"approved":true,"objectiveAligned":true,"issues":[],"reasoning":{"orderLevel":"second-order","steps":["interpret a discriminating clue","apply the supplied relationship to choose the key"],"sourceQuotes":["exact supporting quote from lecture facts or text"],"allStepsRequired":true,"connectedChain":true,"singleEndpoint":true,"choiceShortcut":false},"replacement":null},{"index":1,"approved":false,"issues":["weak_explanation"],"replacement":{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...","whyWrong":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"objectiveIds":["exact objective id"],"objectiveFacet":"...","topic":"...","taskType":"mechanism","orderLevel":"second-order"}}]}\n` +
    `Use short issue codes from: incorrect_key, ambiguous_key, unsupported_fact, objective_mismatch, duplicate_choices, duplicate_question, answer_leak, weak_explanation, inconsistent_vignette, non_discriminating_clues, multiple_true_choices, repetitive_task_ending, school_style_mismatch, disconnected_recall_tasks, answer_choice_shortcut.`
  );
}

function buildRepairPrompt(items, cfg = {}) {
  const objectives = (cfg.objectives || []).map((o) => ({ id: o.id || o.code, text: o.objective || o.text, targetOrder: o._targetOrder }));
  const atoms = (cfg.atoms || []).map((a) => ({ term: a.term, content: a.content, objectiveIds: a.objectiveIds || [] }));
  const examples = selectStyleExemplars(cfg.examples || [], cfg.promptProfile === "compact" ? 2 : 6, cfg.difficulty, { objectives: cfg.objectives, atoms: cfg.atoms }).map((q) => ({ stem: q.stem, choices: q.choices, correct: q.correct }));
  return `Repair every rejected question below. Preserve the tested objective when it is valid, but change the stem, choices, key, explanation, and objectiveIds as needed to correct every listed issue. Use only the supplied lecture facts/objectives; do not add outside medical facts. Match the concise clinical/anatomic SGU ExamSoft/IMCQ style and use plausible same-category distractors. Return exactly one repaired question for each input item in the same order.
${CONNECTED_REASONING_CONTRACT}
${QUESTION_PLAN_CONTRACT}
Honor each objective's targetOrder. Replace recall with an actual lecture-supported perturbation and downstream prediction when application is requested. Do not decorate a definition with a vague symptom. Correct the causal sequence using the supplied lecture evidence. Return reasoningSteps and a concise whyWrong rationale for EVERY choice, including the key. An independent reviewer will verify each repair; a repaired item is not automatically approved.

OBJECTIVES:\n${JSON.stringify(objectives)}
LECTURE FACTS:\n${JSON.stringify(atoms)}
LECTURE EVIDENCE:\n${retrieveLectureEvidence(cfg.lectureText || "", cfg.objectives || [], items.map(item => ({ term: item.question?.topic || "", content: item.question?.stem || "" })), 6000)}
STYLE EXAMPLES:\n${JSON.stringify(examples)}
REJECTED ITEMS:\n${JSON.stringify(items)}

Return ONLY: {"questions":[{${QUESTION_PLAN_JSON},"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...","whyWrong":{},"reasoningSteps":["required inference","downstream relationship when required"],"objectiveIds":["exact objective id"],"objectiveFacet":"specific clause tested","topic":"...","taskType":"recognition|mechanism|clinical-application","orderLevel":"first-order|second-order|third-order"}]}`;
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
    // This is a deterministic safety screen, not a second style gate. Valid
    // anatomy/mechanism items may be shorter than a full patient vignette and
    // not every objective requires a named patient.
    if (!stem.endsWith("?") || stem.length < 100 || stem.split(/[.!?]+/).filter((part) => part.trim()).length < 2 || !correctText || entries.length < 4) return false;
    const values = entries.map(([, value]) => normalizedComparableText(value)).filter(Boolean);
    if (new Set(values).size !== values.length) return false;
    const answer = normalizedComparableText(correctText);
    const normalizedStem = ` ${normalizedComparableText(stem)} `;
    if (answer.length >= 4 && normalizedStem.includes(` ${answer} `)) return false;
    const explanation = String(question?.explanation || "").trim();
    if (explanation.length < 40) return false;
    const whyWrong = Object.values(question?.whyWrong || {}).map((value) => String(value || "").toLowerCase());
    if (whyWrong.length && whyWrong.length < entries.length) return false;
    const nonDiscriminating = whyWrong.filter((value) => /not (?:the )?(?:reason|cause).{0,30}(?:symptom|finding)|not relevant to (?:the )?(?:symptom|case)/.test(value)).length;
    if (nonDiscriminating >= 2) return false;
    if (/history of intermittent abdominal pain/i.test(stem) && /tenderness in (?:the )?(?:right lower quadrant|upper mid-abdomen)/i.test(stem) && !/laboratory|imaging|ct |ultrasound|biopsy|surgery|trauma|fever|guarding|rebound/i.test(stem)) return false;
    return true;
  });
  return uniqueQuestions(structurallyValid);
}

/** Minimal recovery screen when independent review and repair cannot return a verdict. */
export function locallyUsableQuestions(questions = []) {
  return uniqueQuestions((questions || []).filter((question) => {
    const stem = String(question?.stem || "").trim();
    const entries = Object.entries(question?.choices || {});
    const correctText = question?.choices?.[question?.correct];
    const explanation = String(question?.explanation || "").trim();
    if (!stem.endsWith("?") || stem.length < 100 || !correctText || entries.length < 4 || explanation.length < 40) return false;
    // Generated items must not refer to a figure/table that the question object
    // cannot actually supply. Otherwise the learner sees an unanswerable item.
    const visualCue = /\b(?:figure|image|graph|chart|table|photomicrograph|radiograph|x[- ]ray|ultrasound)\b.{0,90}\b(?:shown|below|above|provided|attached|following|numbered|labeled)\b|\b(?:shown|below|above|provided|attached|following)\b.{0,70}\b(?:figure|image|graph|chart|table|photomicrograph|radiograph|x[- ]ray|ultrasound)\b/i.test(stem);
    const hasSourceVisual = !!(question.sourceImageUrl || question.sourceImageDataUrl || question.image?.url || typeof question.image === "string");
    if (visualCue && !hasSourceVisual) return false;
    if (question.hasImage && !hasSourceVisual) return false;
    const values = entries.map(([, value]) => normalizedComparableText(value)).filter(Boolean);
    return new Set(values).size === values.length;
  }));
}

export function questionMatchesObjectiveDomain(question, cfg = {}) {
  // Wording overlap is a fallback screen, not semantic authority. Broad
  // objectives such as CSF composition can legitimately be tested via cells.
  const reviewedObjective = question?.qualityAudit?.objectiveId;
  if (hasCurrentReasoningAudit(question) && question.qualityAudit?.semanticObjectiveAlignment === true
    && (question.objectiveIds || []).length === 1 && question.objectiveIds[0] === reviewedObjective
    && (cfg.objectives || []).some(o => String(o.id || o.code) === reviewedObjective)) return true;
  const objectiveIds = Array.isArray(question?.objectiveIds) ? question.objectiveIds.map(String) : [];
  if (!objectiveIds.length) return true;
  const linkedObjectives = (cfg.objectives || []).filter((objective) => objectiveIds.includes(String(objective.id || objective.code || "")));
  if (!linkedObjectives.length) return true;
  const stop = new Set("about after again against all also among and any are because been before being both but can could describe determine during each explain following from have how identify into involving itself most other overview provide related should some such than that their them then these they this through toward under until using what when where which while with would structure function role association associated relationship relationships".split(" "));
  const tokens = (value) => String(value || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 3 && !stop.has(token)) || [];
  const linkedAtoms = (cfg.atoms || []).filter((atom) => (atom.objectiveIds || []).some((id) => objectiveIds.includes(String(id))));
  const targets = new Set([
    ...linkedObjectives.flatMap((objective) => tokens(objective.objective || objective.text)),
    ...linkedAtoms.flatMap((atom) => [...tokens(atom.term), ...tokens(atom.content)]),
  ]);
  if (!targets.size) return true;
  const itemText = [question.stem, ...Object.values(question.choices || {}), question.explanation].join(" ");
  // Do not let generic overlap establish a question's objective domain. Require
  // a distinctive objective/explicitly-linked-fact term when available.
  const overlap = tokens(itemText).filter((token) => targets.has(token));
  const distinctive = [...targets].filter((token) => token.length >= 6);
  return distinctive.length
    ? overlap.some((token) => token.length >= 6)
    : overlap.length >= 2;
}

/** Keep a generated batch from being dominated by one generic final ask.
 *
 * This used to enforce the family cap by dropping the excess questions. A
 * five-question generation batch could therefore be reduced to three, making
 * the default fifteen-question quiz stop at nine even when all five questions
 * passed structural and medical review. Preserve every valid item; the prompt
 * and independent reviewer still provide the diversity pressure, while order
 * puts capped families after the first pass through supported alternatives.
 */
export function diversifyQuestionEndings(questions = []) {
  if (questions.length < 4) return questions;
  const families = questions.map((question) => questionEndingTask(question?.stem));
  if (new Set(families).size < 2) return questions;
  const cap = Math.ceil(questions.length * 0.6);
  const counts = {};
  const selected = [];
  const deferred = [];
  for (let i = 0; i < questions.length; i += 1) {
    const family = families[i];
    if ((counts[family] || 0) >= cap) {
      deferred.push(questions[i]);
      continue;
    }
    counts[family] = (counts[family] || 0) + 1;
    selected.push(questions[i]);
  }
  return [...selected, ...deferred];
}

/**
 * A distinct model request reviews the completed batch. Missing, malformed, or uncertain reviews
 * fail closed: unapproved questions never reach the quiz or saved Firestore reserve.
 */
// A reviewer may fix prose only. The tested problem and key stay immutable.
export function explanationOnlyReplacement(question, review) {
  if (review?.approved !== false || !review.replacement || !review.issues?.length
    || review.issues.some(issue => issue !== "weak_explanation")) return null;
  const replacement = review.replacement;
  if (replacement.stem !== question.stem || replacement.correct !== question.correct
    || JSON.stringify(replacement.choices) !== JSON.stringify(question.choices)
    || JSON.stringify(replacement.objectiveIds) !== JSON.stringify(question.objectiveIds)) return null;
  if (!replacement.explanation || !replacement.whyWrong) return null;
  return { ...question, explanation: replacement.explanation, whyWrong: replacement.whyWrong };
}

export async function auditGeneratedQuestions(questions, cfg = {}, deps = {}) {
  if (!questions.length) return { questions: [] };
  if (deps.skipQuestionAudit === true) return { questions };
  const transport = withQuestionAIRouting(deps.reviewAIJSON || deps.callAIJSON);
  const reviewer = typeof transport === "function" ? async (...args) => resolveAuditEvidence(await transport(...args), args[1]) : transport;
  const locallyValid = diversifyQuestionEndings(locallyValidClinicalQuestions(questions))
    .filter((question) => questionMatchesObjectiveDomain(question, cfg) && locallyUsableQuestions([question]).length > 0);
  // An explicit independent approval is stronger than the conservative clinical-shape screen.
  // Keep the basic structural guard, but do not discard an approved question merely because it
  // is a shorter anatomy/mechanism item or uses a school-specific stem shape.
  const structurallyUsableSet = new Set(locallyUsableQuestions(questions));
  const locallyUsable = locallyUsableQuestions(questions).filter((question) => questionMatchesObjectiveDomain(question, cfg));
  const locallyUsableSet = new Set(locallyUsable);
  const keepLocallyValidated = (reason) => {
    const deferred = locallyValid.length ? [] : locallyUsableQuestions(questions).filter((question) => questionMatchesObjectiveDomain(question, cfg));
    const candidates = cfg.requireReasoningAudit ? [] : locallyValid.length ? locallyValid : deferred;
    return {
    questions: candidates.map((question) => ({
      ...question,
      qualityAudit: {
        version: 1,
        status: locallyValid.includes(question) ? "local-validated" : "review-deferred",
        checks: locallyValid.includes(question)
          ? ["clinical-structure", "valid-key", "distinct-choices", "no-answer-leak"]
          : ["basic-structure", "valid-key", "distinct-choices"],
      },
    })),
    warning: candidates.length
      ? (locallyValid.length
        ? `${candidates.length} question${candidates.length === 1 ? "" : "s"} passed structural checks; independent medical review was unavailable (${reason}).`
        : `${candidates.length} question${candidates.length === 1 ? "" : "s"} retained with basic structural checks while independent medical review was unavailable (${reason}).`)
      : null,
    error: candidates.length ? null : cfg.requireReasoningAudit
      ? `Reasoning verification failed (${reason}). No unverified items were counted as advanced practice.`
      : `Independent question review was unavailable (${reason}), and no generated questions passed structural checks.`,
  };
  };
  if (typeof reviewer !== "function") return keepLocallyValidated("reviewer not configured");
  try {
    let raw;
    const reviewBatchSize = Math.min(5, Math.max(1, Math.floor(Number(deps.reviewBatchSize) || 1)));
    if (cfg.promptProfile === "compact" && reviewBatchSize > 1 && questions.length > 1) {
      // Explicit capability opt-in. Local models retain item-by-item auditing;
      // capable reviewers amortize startup while still returning every verdict.
      const reviews = [];
      let reviewError = "";
      for (let offset = 0; offset < questions.length; offset += reviewBatchSize) {
        const group = questions.slice(offset, offset + reviewBatchSize);
        try {
          const result = await reviewer(AUDIT_SYSTEM, buildQuestionAuditPrompt(group, cfg), { reviews: [] }, (deps.auditMaxTokens || 1600) * group.length);
          for (let index = 0; index < group.length; index++) {
            const review = result?.reviews?.find(entry => Number(entry.index) === index);
            if (review) reviews.push({ ...review, index: offset + index });
            else reviewError = `Independent reviewer unavailable: no review returned for question ${offset + index + 1}.`;
          }
        } catch (error) { reviewError = error?.message || String(error); break; }
      }
      raw = { reviews, error: reviewError };
    } else if (cfg.promptProfile === "compact" && questions.length > 0) {
      // Small local models repeatedly reviewed only index zero of a batch,
      // then quoted generated explanations instead of the lecture. Give each
      // item an independent, source-focused review; merge indexes ourselves.
      const reviews = [];
      let reviewError = "";
      let unverifiableInARow = 0;
      for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];
        const focused = { ...cfg,
          objectives: (cfg.objectives || []).filter(o => (question.objectiveIds || []).includes(String(o.id || o.code))),
          comparisonStems: questions.filter((_, other) => other !== index).map(q => q.stem),
        };
        try {
          const prompt = buildQuestionAuditPrompt([question], focused);
          let result = await reviewer(AUDIT_SYSTEM, prompt, { reviews: [] }, deps.auditMaxTokens || 1600);
          let review = result?.reviews?.find(entry => Number(entry.index) === 0);
          const normalizeSource = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
          const factualSource = normalizeSource([cfg.lectureText || "", ...(cfg.atoms || []).map(a => `${a.term || ""} ${a.content || ""}`)].join(" "));
          const quoted = (review?.reasoning?.sourceQuotes || []).map(normalizeSource);
          const partialQuoteMatch = quoted.some(q => q.length >= 16 && factualSource.includes(q))
            && quoted.some(q => q.length < 16 || !factualSource.includes(q));
          if (cfg.requireReasoningAudit && review?.approved === true && partialQuoteMatch && !verifyReasoningReview(review, question, cfg)) {
            // One correction attempt, never fuzzy-match or silently approve an
            // unsupported quotation. The full question must still pass review.
            result = await reviewer(AUDIT_SYSTEM, `${prompt}\nPREVIOUS REVIEW FAILED DETERMINISTIC VERIFICATION:\n${JSON.stringify(review)}\nRe-audit this item. Copy only exact contiguous source text, including table separators; do not merge columns or paraphrase. Check every sourceQuote against the supplied source. If the source or required reasoning cannot be verified, reject the item. Return one corrected review.`, { reviews: [] }, deps.auditMaxTokens || 1600);
            review = result?.reviews?.find(entry => Number(entry.index) === 0);
          }
          if (review) {
            reviews.push({ ...review, index });
            unverifiableInARow = cfg.requireReasoningAudit && review.approved === true && !verifyReasoningReview(review, question, cfg)
              ? unverifiableInARow + 1 : 0;
            if (unverifiableInARow >= 2) {
              reviewError = "Independent reviewer unavailable: repeated claimed approvals could not be grounded in the lecture. A stronger reviewer is needed.";
              break;
            }
          }
          else reviewError = `Independent reviewer unavailable: no review returned for question ${index + 1}.`;
        } catch (error) {
          reviewError = error?.message || String(error);
          break;
        }
      }
      raw = { reviews, error: reviewError };
    } else {
      raw = await reviewer(AUDIT_SYSTEM, buildQuestionAuditPrompt(questions, cfg), { reviews: [] }, deps.auditMaxTokens || 4000);
    }
    const reviews = Array.isArray(raw?.reviews) ? raw.reviews : [];
    const byIndex = new Map(reviews.map((review) => [Number(review?.index), review]));
    const rejections = questions.flatMap((question, index) => {
      const review = byIndex.get(index);
      if (cfg.requireReasoningAudit && review?.approved === true && !verifyReasoningReview(review, question, cfg)) {
        return [{ objectiveIds: question.objectiveIds || [], issues: ["unverifiable_reasoning"], rationale: "The reviewer could not verify the source quotes or reasoning. Use exact contiguous lecture excerpts; do not paraphrase or join separated table columns. Construct a new source-supported causal task." }];
      }
      return review?.approved === false ? [{ objectiveIds: question.objectiveIds || [], issues: review.issues || [], rationale: String(review.rationale || "").slice(0, 600) }] : [];
    });
    if (!reviews.length) return keepLocallyValidated(raw.error || "malformed reviewer response");
    const nonBlockingReviewIssues = new Set(["repetitive_task_ending", "order_level_mismatch"]);
    const approved = questions.flatMap((question, index) => {
      const review = byIndex.get(index);
      if (!review) {
        if (cfg.requireReasoningAudit) return [];
        return locallyValid.includes(question) ? [{
          ...question,
          qualityAudit: { version: 1, status: "local-validated", checks: ["clinical-structure", "valid-key", "distinct-choices", "no-answer-leak"] },
        }] : [];
      }
      const issues = Array.isArray(review.issues) ? review.issues.map(String) : [];
      const blockingIssues = issues.filter((issue) => !nonBlockingReviewIssues.has(issue));
      // Batch-level variety and a mislabeled reasoning order are useful editor
      // notes, not evidence that the key or vignette is medically unsafe. The
      // old all-or-nothing rule discarded these sound questions, then paid for
      // another full generation/review round. Keep them when the deterministic
      // structural/domain screen passes; medical, ambiguity, grounding, answer-
      // leak, and explanation failures remain blocking.
      const acceptedWithNotes = review?.approved !== true && issues.length > 0 && blockingIssues.length === 0;
      const reasoningAudit = verifyReasoningReview(review, question, cfg);
      const target = (cfg.objectives || []).find(o => (question.objectiveIds || []).includes(String(o.id || o.code)))?._targetOrder;
      const orders = ["first-order", "second-order", "third-order"];
      if (cfg.requireReasoningAudit && target && reasoningAudit && orders.indexOf(reasoningAudit.orderLevel) < orders.indexOf(normalizeQuestionOrder(target))) return [];
      const semanticObjectiveAlignment = review.objectiveAligned === true && !!reasoningAudit
        && (question.objectiveIds || []).length === 1
        && (cfg.objectives || []).some(o => String(o.id || o.code) === question.objectiveIds[0]);
      if ((!acceptedWithNotes && review?.approved !== true) || blockingIssues.length
        || !structurallyUsableSet.has(question) || (!locallyUsableSet.has(question) && !semanticObjectiveAlignment)) return [];
      if (cfg.requireReasoningAudit && !reasoningAudit) return [];
      return [{
        ...question,
        ...(reasoningAudit ? { orderLevel: reasoningAudit.orderLevel, reasoningAudit } : {}),
        qualityAudit: {
          version: 1,
          status: acceptedWithNotes || issues.length ? "approved-with-notes" : "approved",
          ...(semanticObjectiveAlignment ? { semanticObjectiveAlignment: true, objectiveId: question.objectiveIds[0] } : {}),
          checks: ["medical-correctness", "single-best-answer", "objective-alignment", "explanation-quality"],
          ...(issues.length ? { notes: issues } : {}),
        },
      }];
    });
    // A partial rejection used to be thrown away outright; only an entirely
    // rejected batch entered the repair path. Let the independent reviewer
    // return an in-place correction, then apply the same deterministic
    // structure/domain screens before it can enter the quiz.
    const reviewerReplacements = cfg.requireReasoningAudit && deps.skipRepair ? [] : reviews.flatMap((review) => {
      if (review?.approved === true || !review?.replacement) return [];
      const normalized = stampQuestionOrders(
        ensureObjectiveAttribution(normalizeQuestions({ questions: [review.replacement] }), cfg.objectives || []),
        cfg.objectives || []
      ).map((question) => ({ ...question, generationVersion: "v2" }));
      return locallyValidClinicalQuestions(normalized)
        .filter((question) => locallyUsableQuestions([question]).length > 0 && questionMatchesObjectiveDomain(question, cfg))
        .map((question) => ({
          ...question,
          qualityAudit: {
            version: 1,
            status: "reviewer-repaired",
            checks: ["medical-review-repair", "clinical-structure", "valid-key", "objective-alignment"],
            notes: Array.isArray(review.issues) ? review.issues.map(String) : ["reviewer_rejected"],
          },
        }));
    });
    // Re-review narrow explanation corrections once, even in strict preparation.
    // Never accept a changed key, scenario, choice set or objective through this path.
    const proseRepairs = deps.skipExplanationRepair ? [] : reviews.flatMap(review => {
      const question = questions[Number(review.index)];
      const repaired = question && explanationOnlyReplacement(question, review);
      return repaired ? [repaired] : [];
    });
    const verifiedProseRepairs = proseRepairs.length
      ? (await auditGeneratedQuestions(proseRepairs, cfg, { ...deps, skipRepair: true, skipExplanationRepair: true })).questions || []
      : [];
    const verifiedReplacements = cfg.requireReasoningAudit && reviewerReplacements.length
      ? (await auditGeneratedQuestions(reviewerReplacements, cfg, { ...deps, skipRepair: true })).questions || []
      : reviewerReplacements;
    const distinctApproved = diversifyQuestionEndings(uniqueQuestions([...approved, ...verifiedReplacements, ...verifiedProseRepairs]));
    const unverifiableApprovals = cfg.requireReasoningAudit
      ? questions.filter((question, index) => byIndex.get(index)?.approved === true && !verifyReasoningReview(byIndex.get(index), question, cfg)).length
      : 0;
    if (!distinctApproved.length && unverifiableApprovals) {
      return { ...keepLocallyValidated(`Independent reviewer unavailable: ${unverifiableApprovals}/${questions.length} claimed approvals had unverifiable source quotes or reasoning. A stronger reviewer is needed; repeating repairs cannot validate these claims.`), rejections };
    }
    // A strict reviewer can reject every item when the local/cloud reviewer is
    // unavailable or over-sensitive. Do not strand the learner in an endless
    // replacement loop: retain questions that passed deterministic safety
    // checks and label them for later review instead of silently discarding the
    // whole batch.
    if (!distinctApproved.length && raw.error) return keepLocallyValidated(raw.error);
    if (!distinctApproved.length && deps.skipRepair !== true) {
      const repairer = withQuestionAIRouting(deps.repairAIJSON || deps.callAIJSON);
      if (typeof repairer === "function") {
        const rejectedItems = questions.map((question, index) => ({
          index,
          question: auditQuestionPayload(question),
          issues: byIndex.get(index)?.issues || ["reviewer_rejected"],
          reviewRationale: byIndex.get(index)?.rationale || "",
          requiredOrder: (cfg.objectives || []).find(o => (question.objectiveIds || []).includes(String(o.id || o.code)))?._targetOrder || "",
          reviewedOrder: byIndex.get(index)?.reasoning?.orderLevel || "",
        }));
        try {
          const repairedRaw = await repairer(REPAIR_SYSTEM, buildRepairPrompt(rejectedItems, cfg), { questions: [] }, deps.repairMaxTokens || 6000);
          const repaired = stampQuestionOrders(ensureObjectiveAttribution(normalizeQuestions(repairedRaw), cfg.objectives || []), cfg.objectives || []).map((question) => ({ ...question, generationVersion: "v2" }));
          if (repaired.length) {
            const repairedAudit = await auditGeneratedQuestions(repaired, cfg, { ...deps, skipRepair: true });
            if (repairedAudit.questions?.length) return repairedAudit;
          }
        } catch (repairError) {
          // Fall through to deterministic validation; a repair transport failure
          // must not erase otherwise structurally sound questions.
        }
      }
      return { ...keepLocallyValidated("reviewer rejected the batch after repair"), rejections };
    }
    return {
      questions: distinctApproved,
      rejections,
      rejectedCount: questions.length - distinctApproved.length,
      warning: raw.error || (distinctApproved.length < questions.length ? `${questions.length - distinctApproved.length} generated question${questions.length - distinctApproved.length === 1 ? "" : "s"} failed independent review or duplicated another item and were withheld.` : null),
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
  medium: "Standard SGU/ExamSoft application with STEP 1-style clinical framing — usually 3–5 sentences when the objective supports a vignette, with 1–3 reasoning steps and no decorative details.",
  hard: "Multi-step reasoning, integrated concepts, challenging plausible distractors.",
  expert: "Hardest transfer level — require 3+ reasoning steps, combine the tested fact with at least one other provided fact, conceal the diagnosis, use indirect clinical/lab clues, and make every distractor plausible. Never produce a direct-definition or simple recall question.",
};

/** Assemble the generation prompt. Exemplars + objectives + atoms + lecture drive style/scope. */
function compactSource(cfg, queries = cfg.atoms || [], evidenceBudget = null) {
  const atoms = (cfg.atoms || []).map(a => ({ term: a.term, content: a.content, objectiveIds: a.objectiveIds || [],
    ...(a.testableDetails?.length ? { testableDetails: a.testableDetails } : {}),
    ...(a.exceptions?.length ? { exceptions: a.exceptions } : {}),
    ...(a.quantitativeDetails?.length ? { quantitativeDetails: a.quantitativeDetails } : {}) }));
  return `KEY FACTS EXTRACTED FROM THE LECTURE (factual authority):\n${JSON.stringify(atoms)}\nLECTURE EXCERPTS (factual authority):\n${retrieveLectureEvidence(cfg.lectureText || "", cfg.objectives || [], queries, evidenceBudget || ((cfg.objectives || []).length <= 3 ? (atoms.length ? 2500 : 4500) : (atoms.length ? 4000 : 7000)))}`;
}

function compactObjectives(cfg) {
  return (cfg.objectives || []).map(o => ({ id: o.id || o.code, code: o.code, text: o.objective || o.text,
    targetCount: o._targetQuestionCount, targetOrder: o._targetOrder }));
}

function compactStyle(cfg) {
  const examples = selectStyleExemplars(cfg.examples || [], 2, cfg.difficulty, { objectives: cfg.objectives, atoms: cfg.atoms });
  const fingerprint = buildStyleFingerprint(selectStyleExemplars(cfg.examples || [], STYLE_FINGERPRINT_LIMIT, cfg.difficulty, { objectives: cfg.objectives, atoms: cfg.atoms }));
  const blueprint = buildQuestionSourceBlueprint(cfg.examples || [], cfg.objectives || [], cfg.count || 5);
  return `OFFICIAL SCHOOL STYLE (style only, never factual authority):\n${JSON.stringify(examples.map(q => ({ sourceKind: exemplarSourceTier(q), stem: q.stem, choices: q.choices })))}\nSOURCE TASK PATTERNS (homework/clickers are task evidence only):\n${JSON.stringify({ homework: blueprint.homeworkTypes, clickers: blueprint.clickerTypes })}\nSTYLE FINGERPRINT:\n${JSON.stringify(fingerprint)}`;
}

const QUESTION_PLAN_CONTRACT = `Before drafting EACH item, build its questionPlan from the supplied lecture evidence in the same response (no separate request). Identify: relationship (the taught causal rule), perturbation (what changes or is observed), inference (the required hidden intermediate and its downstream effect), endpoint (ONE thing the lead-in asks), nearestDistractor (a plausible competing explanation), discriminator (the observation that separates it from the key), and sourceQuotes (short exact contiguous lecture/fact excerpts supporting the relationships). First choose a causal prediction endpoint, then work backward to the hidden intermediate and discriminating observation. Only then write the stem and choices from that plan. Do not select a definition and decorate it with a patient or experiment.
For second-order, make the learner interpret an observation and apply a taught relationship to infer the requested endpoint. For third-order, require a second connected relationship to predict a further consequence. A normal application of a causal rule can be second-order even if the rule is familiar; a verbatim named-definition lookup is first-order. Do not count extra words or separately recalled labels as extra steps.
Perform a choice-blind solve, then a choice-visible shortcut check: would the key still require the inference? Choose distractors from entities/processes actually present in the supplied lecture; their whyWrong explanations must also be supported there. Do not import receptor names, drug mechanisms, or ion conductances from general medical knowledge to fill choices. If the source offers few named alternatives, use plausible different outcomes of the same supported process. Keep each plan concise (about 60 words excluding quotes). Include at least two alternatives that remain plausible from the main cue alone and require the discriminating observation to separate them. All alternatives should compete at the SAME endpoint; do not put one ion-channel answer among four G-protein answers when fast-versus-slow wording gives the key away. Add a meaningful competing alternative and its discriminating observation, not more filler. Do not state the hidden intermediate in the stem. If the supplied evidence cannot support the requested depth, do not invent a mechanism or relabel recall. CONSTRUCTION EXAMPLE (abstract logic only, not medical source): if the lecture teaches A activates B and B suppresses C, a second-order item can change A and ask what happens to B without naming B's activation in the stem; a third-order item changes A and asks the resulting direction of C. Alternatives should be competing outcomes, not unrelated labels. A vignette naming B and asking what B is remains recall. Transfer this construction only to actual relationships explicitly supported by this lecture. Never insert this abstract example into a medical question. The plan is untrusted drafting metadata, not evidence of correctness.`;
const QUESTION_PLAN_JSON = '"questionPlan":{"relationship":"lecture causal rule","perturbation":"change or observation","inference":"hidden intermediate to endpoint","endpoint":"one requested output","nearestDistractor":"plausible rival","discriminator":"decisive observation","sourceQuotes":["exact lecture excerpt"]}';

function buildCompactMcqPrompt(cfg) {
  const count = cfg.count || 5;
  const order = cfg.orderBlueprint || buildQuestionSourceBlueprint(cfg.examples || [], cfg.objectives || [], count).order;
  return `${CONNECTED_REASONING_CONTRACT}
${QUESTION_PLAN_CONTRACT}
Write exactly ${count} NEW ${cfg.difficulty || "medium"} SGU/ExamSoft-style Step 1 questions for ${cfg.subject || "this lecture"}.
OUTPUT ECONOMY: return compact JSON on one line, without indentation, markdown or introductory text. Keep each questionPlan field to one short clause (aim for 6-8 words), excluding sourceQuotes. Quote only the minimum contiguous source sentences that establish the required relationships; never repeat an entire slide. Keep reasoningSteps to short causal links. Explain the key in two concise sentences and each choice in one concise sentence (aim for 12-18 words) stating the discriminating reason. Preserve every required field, every choice rationale, necessary clinical clues, qualifiers and source-supported relationships; brevity must not change the question or replace the rationale with a label.

Objectives define the target; lecture facts/excerpts alone establish factual truth. Use one primary objective per item. Honor each targetCount and targetOrder. Do not copy source cases. Prioritize second/third-order application where the objective supports it, never invent extra causal steps to label recall advanced.
For second/third-order targets, a named agent/structure followed by its explicitly taught effect is a lookup shortcut, even inside a clinical vignette. If the lecture directly pairs N with effect B, do not ask "N causes which effect?". Instead describe a source-supported selective intervention or discriminating observation and ask a further supported prediction. Likewise, do not describe a defining morphology and simply ask its name. Keep the hidden intermediate absent from the stem and keep competing alternatives at the same requested endpoint. Do not use broad lead-ins such as "which event is impaired?" when several downstream events are impaired; ask a precise measurable endpoint. Any control or unchanged parameter must be supplied by the hypothetical experimental setup or supported by the source, not assumed from biology.
For application targets, prefer an intervention-and-prediction task over naming a synapse, receptor class or numbered life-cycle step. Describe what a selective intervention does using a relationship from the source, conceal the intermediate, then ask for the downstream change. Do not introduce toxin names, receptor subtypes, second messengers, ion species or timings unless the source explicitly supports their role. Use generic transmitter or experimental labels when specific names are unnecessary.
Use a focused clinical, experimental, imaging, anatomy or laboratory scenario. Include only discriminating clues. Hide diagnosis when it must be inferred. Ask one mechanism, structure, pathway or downstream prediction. Choices must be plausible near-neighbors of the same category; one unambiguous best answer. No decorative story, answer leak, equivalent choices, unsupported disease/drug/finding, or image reference without a supplied image. Preserve tables when appropriate using choiceLayout and choiceColumns; otherwise use five choices A-E. Explanation must connect clues to the mechanism. whyWrong must explain why each distractor was tempting and the decisive contradiction; include the correct option's rationale too.
When the lecture supports physiology but no named clinical condition, use a lecture-grounded experiment: a perturbation/blocker, its relevant recording or observation, then a predicted consequence. Do not invent a vague patient symptom to decorate a definition. Never turn "a researcher studies X" into "which is the first step/feature of X" and label it second-order. Conceal the process being inferred and make at least one supplied relationship necessary to select the key. For transmitter-release timing, trace the taught sequence precisely; events after a response cannot be its initiating cause.
For synthesis/transport interventions, distinguish newly synthesized or newly labeled products from pre-existing stored pools. Never infer that one transmitter pool is depleted while another is unchanged without lecture evidence for enzyme lifetime, storage and the stated time interval. If the source places both small-molecule enzymes and peptide precursors in the soma, a general protein-synthesis block is NOT a selective peptide intervention. Prefer tracing a newly labeled precursor through the taught compartments or an explicitly selective precursor/transport intervention, and ask a downstream transport, processing, accumulation or release prediction. Do not merely ask where a transmitter is synthesized: identifying its class and recalling its synthesis compartment alone is still first-order. Conceal the intermediate, use a selective interruption of a taught step, and require its consequence. State necessary experimental controls in the setup; do not invent biological selectivity.
Before returning, check the explanation and EACH whyWrong against your source excerpts. Explain a distractor using the same supported relationship and the conflicting clue, not additional textbook facts about that distractor. A correct key is insufficient if the explanation imports unsupported enzyme lifetimes, recycling rules, receptor kinetics or assumed unchanged functions.
Vary supported task families and objective facets; do not repeat one clue-to-answer route. An independent reviewer must verify the actual shortest reasoning route against exact source quotations.
OBJECTIVES:\n${JSON.stringify(compactObjectives(cfg))}
ORDER TARGETS:\n${JSON.stringify(order)}
${objectiveFacetCoveragePrompt(cfg.objectives || [], count)}
${objectiveModalitySection(cfg.objectives || [])}
${compactStyle(cfg)}
${styleProfilePrompt(cfg.styleProfile, count)}
${questionWritingBenchmarkPrompt(cfg)}
OPTIONAL CLINICAL PATTERNS (not factual authority; use only when the lecture supports them):\n${renderClinicalCorrelateLibrary((cfg.clinicalCorrelateLibrary || []).slice(0, 6))}
LEARNER EMPHASIS:\n${cfg.focusNotes || "none"}
PRIOR FEEDBACK:\n${JSON.stringify(cfg.feedback || {})}
AVOID REPEATING THESE PRIOR STEMS:\n${JSON.stringify((cfg.avoidStems || []).slice(-10).map(s => String(s).slice(0, 180)))}
${compactSource(cfg)}
Return ONLY JSON: {"questions":[{${QUESTION_PLAN_JSON},"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"B","explanation":"...",${WHY_WRONG_JSON},"objectiveIds":["exact id"],"objectiveFacet":"specific clause tested","topic":"specific concept","taskType":"recognition|mechanism|clinical-application|fresh-retest","reasoningDepth":"state-recognition|pathway-process|mechanism|enzyme-structure|regulation-cofactor|clinical-consequence","orderLevel":"first-order|second-order|third-order","reasoningSteps":["clue interpretation","required relationship","second relationship only if required"],"difficulty":"${cfg.difficulty || "medium"}"}]}`;
}

function buildCompactAuditPrompt(questions, cfg) {
  const queries = questions.map(q => ({ term: q.topic || "", content: `${q.stem} ${Object.values(q.choices || {}).join(" ")} ${q.explanation || ""}`, sourceQuotes: q.questionPlan?.sourceQuotes || [] }));
  return `Independently audit every generated question. If the ONLY defect is weak_explanation, return a complete replacement with the identical stem, choices, correct key and objectiveIds, changing only explanation and whyWrong. Other defects must remain rejected. Fail uncertain items; never infer approval from writing quality. Return compact JSON without indentation. Keep approved-item rationale to one concise sentence; rejected-item rationale must name the specific defect and repair needed. Use short causal clauses for reasoning steps, preserving every necessary relationship.
${CONNECTED_REASONING_CONTRACT}
A new hypothetical scenario is allowed: source-supported rules may be applied to a novel intervention or observation. Require evidence for the causal relationships, not a literal matching patient age, invented protocol label or logically derived observation. Do not reject a counterfactual wrong answer simply because that wrong outcome is absent from the lecture; verify the source-supported explanation for why it is wrong. Reject added medical mechanisms, diagnostic claims or quantitative thresholds not established by the source.
Check every item for a medically correct single best key, factual support for ALL relationships, meaningful primary-objective alignment and facet, plausible same-category distinct choices, sufficient discriminating clues, consistent scenario, no leaked answer, and a mechanistic explanation. Reject unsupported named diseases, drugs, findings or image dependencies. Compare items for duplicate clue-to-answer routes and repetitive asks. Match the supplied official school style; homework/clickers establish task patterns only. Objective verbs define scope but do not prohibit applying lecture-supported relationships.
Treat questionPlan as an untrusted hypothesis: verify its quoted relationships against the actual lecture source, and check that its hidden inference and discriminator are required in the FINAL stem and choices. Reject fabricated plans or plans that describe reasoning the question itself gives away. Do not reject causal application merely because one taught rule supplies the relationship: interpreting a novel perturbation then predicting its consequence can be second-order. Reject direct definition lookup or a keyed option identifiable solely by category mismatch. A shared word such as "calcium" is NOT by itself an answer leak: distinguish a valid clue-to-cause inference from a meaningless repeated label. To report answer_choice_shortcut, state which required causal inference can be skipped and show the specific stem/option cue that replaces it. If alternative mechanisms are plausible until the discriminating observations are interpreted, recognize the causal application as second-order. Do not demand two causal relationships for second-order or three for third-order; count interpreting the clue separately from applying the relationship(s). A correct prediction after an unfamiliar intervention is application, even when only one taught causal rule is needed.
Verify the ACTUAL shortest route to the answer with choices visible. First-order needs one fact; second-order needs clue interpretation plus one relationship; third-order needs clue interpretation plus TWO distinct connected relationships and a downstream prediction. Every step must be required, connected and have one endpoint; reject one-fact choice shortcuts. Cite supporting evidenceIds from the numbered source catalog. Never cite objective text as factual evidence. Third-order requires two distinct supporting excerpts. Do not retype or paraphrase source quotations. Unsupported/mislabeled depth must be rejected, not credited.
Reject an item below its objective's explicit targetOrder even when the recalled fact is correct. Do not certify a researcher/patient story as application if the final ask simply repeats a named fact.
Return exactly ${questions.length} reviews for indexes ${JSON.stringify(questions.map((_, index) => index))}. Give a concise rationale and issues for rejections. Do not generate replacements here: repair is a separate request followed by independent review. This review must never teach or rewrite the questions.
SUBJECT: ${cfg.subject || "this lecture"}
OBJECTIVES:\n${JSON.stringify(compactObjectives(cfg))}
${objectiveModalitySection(cfg.objectives || [])}
${compactStyle(cfg)}
${numberedAuditEvidence(cfg, retrieveLectureEvidence(cfg.lectureText || "", cfg.objectives || [], queries, 9000))}
QUESTIONS:\n${JSON.stringify(questions.map(auditQuestionPayload))}
OTHER BATCH STEMS (comparison only; never factual evidence):\n${JSON.stringify(cfg.comparisonStems || [])}
REQUIRED REVIEW COUNT: ${questions.length}; REQUIRED INDEXES: ${JSON.stringify(questions.map((_, index) => index))}. Review ALL items. evidenceIds must come ONLY from the SOURCE EVIDENCE CATALOG above, NEVER from QUESTIONS or generated plans. If no catalog excerpt supports a claim, reject it as unsupported_fact.
Return ONLY JSON: {"reviews":[{"index":0,"approved":true,"objectiveAligned":true,"objectiveFacet":"tested clause","issues":[],"rationale":"brief evidence-based judgment","reasoning":{"orderLevel":"second-order","steps":["interpret clue","apply required relationship"],"evidenceIds":["E1"],"allStepsRequired":true,"connectedChain":true,"singleEndpoint":true,"choiceShortcut":false}}]}
Issue codes: incorrect_key, ambiguous_key, unsupported_fact, objective_mismatch, duplicate_choices, duplicate_question, answer_leak, weak_explanation, inconsistent_vignette, non_discriminating_clues, multiple_true_choices, repetitive_task_ending, school_style_mismatch, disconnected_recall_tasks, answer_choice_shortcut, order_level_mismatch.`;
}

export function buildMcqPrompt(cfg = {}) {
  return cfg.promptProfile === "compact" ? buildCompactMcqPrompt(cfg) : buildFullMcqPrompt(cfg);
}

function buildFullMcqPrompt({ subject = "this lecture", lectureText = "", examples = [], styleProfile = null, objectives = [], atoms = [], difficulty = "medium", count = 10, studyMode = "balanced", generationVersion = "v2", feedback = null, clinicalCorrelateLibrary = [], orderBlueprint = null, focusNotes = "", reasoningDepthPlan = null, requireReasoningAudit = false } = {}) {
  const diff = String(difficulty).toLowerCase();

  const styleExamples = selectStyleExemplars(examples, STYLE_PROMPT_EXEMPLAR_LIMIT, diff, { objectives, atoms });
  const styleFingerprint = buildStyleFingerprint(selectStyleExemplars(examples, STYLE_FINGERPRINT_LIMIT, diff, { objectives, atoms }));
  const sourceBlueprint = buildQuestionSourceBlueprint(examples, objectives, count);
  const resolvedOrderBlueprint = orderBlueprint || sourceBlueprint.order;
  const depthPlan = Array.isArray(reasoningDepthPlan) && reasoningDepthPlan.length ? reasoningDepthPlan : buildReasoningDepthPlan(count);
  const depthSection = `\n\nREASONING-DEPTH TRAINING PLAN: ${JSON.stringify(depthPlan)}\nFor each question, return the matching reasoningDepth from state-recognition|pathway-process|mechanism|enzyme-structure|regulation-cofactor|clinical-consequence. Vary the requested layer across the batch. When multiple questions can validly target the same objective, build a shallow-to-deep progression or a same-patient mini-sequence (2-3 items maximum), then later transfer the mechanism to a different presentation. Sometimes state/process is obvious or explicitly supplied and the ask must go one level deeper. Distractors should encode plausible pathway, direction, level, or regulator errors, not random facts. Difficulty comes from supported causal depth, never vague wording.\n`;
  const examplesSection = styleExamples.length
    ? "\n\nEXAMPLE QUESTIONS FROM YOUR SCHOOL'S EXAM BANK:\n" +
      "(Use their structure and plausible distractors, not their exact cases. Keep factual scope within the supplied lecture/objectives and honor the requested difficulty. IMCQs are challenge references, not calibrated exam-difficulty benchmarks.)\n" +
      styleExamples.map((q, i) =>
        `EXAMPLE ${i + 1}${q.sourceKind === "imcq" ? " (IMCQ challenge reference)" : ""}:\nQ: ${q.stem}\n${renderChoices(q.choices)}\nCorrect: ${q.correct}\nExplanation: ${q.explanation || "N/A"}`
      ).join("\n\n")
    : "";

  const objectivesSection = objectives.length
    ? "\n\nLEARNING OBJECTIVES TO COVER (every question maps to one):\n" +
      objectives.map((o, i) => `${i + 1}. [${o.code || o.id || ""}] ${o.objective || o.text || ""}${o._targetQuestionCount ? ` [TARGET ${o._targetQuestionCount} ITEM${o._targetQuestionCount === 1 ? "" : "S"}]` : ""}`).join("\n")
    : "";
  const objectiveFacetsSection = objectiveFacetCoveragePrompt(objectives, count);
  const comparisonObjectives = objectives.filter((o) => /\b(compare|compar(?:e|ing|ison)|differentiat(?:e|ing)|distinguish|contrast|versus|\bvs\.?\b|different\s+(?:between|among))\b/i.test(String(o.objective || o.text || "")));
  const comparisonSection = comparisonObjectives.length
    ? "\n\nCOMPARISON OBJECTIVE REQUIREMENT:\n" + comparisonObjectives.map((o) => `[${o.id}] ${o.objective || o.text || ""}`).join("\n") +
      "\nFor these objectives, deliberately create paired or triplet contrast items. Put the competing diseases/processes in the same answer category, test the exact discriminating clinical feature, mechanism, lab, anatomy, or time course taught by the lecture, and explain why the nearest alternative is wrong. Do not ask a generic definition and do not introduce a disease or discriminator absent from the supplied lecture evidence. Across the batch, ensure each named comparison target is represented when the requested count permits.\n"
    : "";

  const atomsSection = atoms.length
    ? "\n\nKEY FACTS EXTRACTED FROM THE LECTURE (ground your questions in these specific concepts):\n" +
    atoms.slice(0, 50).map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}${a.clinicalCorrelate ? ` Clinical correlate: ${a.clinicalCorrelate}` : ""}${a.clinicalCues?.length ? ` Cues: ${a.clinicalCues.join(", ")}` : ""}${a.buzzwords?.length ? ` Buzzwords: ${a.buzzwords.join(", ")}` : ""}${a.testableDetails?.length ? ` Testable details: ${a.testableDetails.join("; ")}` : ""}${a.exceptions?.length ? ` Exceptions: ${a.exceptions.join("; ")}` : ""}${a.quantitativeDetails?.length ? ` Quantitative details: ${a.quantitativeDetails.join("; ")}` : ""}${a.inheritancePattern ? ` Inheritance: ${a.inheritancePattern}` : ""}`).join("\n")
    : "";

  const contentSection = lectureText
    ? "\n\nLECTURE CONTENT (retrieved across the lecture for these targets):\n" + retrieveLectureEvidence(lectureText, objectives, atoms)
    : "";
  const clinicalSection = clinicalCorrelateLibrary?.length
    ? `\n\nRECURRENT CLINICAL CORRELATES FROM THE LECTURE AND UPLOADED QUESTIONS:\n${renderClinicalCorrelateLibrary(clinicalCorrelateLibrary)}\nUse these as optional, curriculum-grounded clue patterns. Distribute them across the batch only when the supplied lecture facts support the relationship; never force one into an item, turn a cue into an unsupported diagnosis, or import outside facts. If a correlate conflicts with the lecture evidence, ignore it.\n`
    : "";
  const focusSection = String(focusNotes || "").trim()
    ? `\n\nINSTRUCTOR/LEARNER EMPHASIS (high-priority targeting guidance, not a substitute for lecture evidence):\n${String(focusNotes).trim()}\nDistribute questions across these requested topics when the supplied lecture facts/objectives support them. Give extra attention to stated blockers, rate-limiting steps, cofactors, enzyme reactions, and regulatory consequences. Do not invent unsupported facts.\n`
    : "";
  const feedbackSection = feedback?.sampleSize
    ? `\n\nLEARNED FEEDBACK FROM PRIOR QUESTIONS (${feedback.sampleSize} ratings): recurring issue codes ${JSON.stringify(feedback.issueCounts || {})}; fairness misses ${feedback.fairNo}; ExamSoft-style misses ${feedback.examStyleNo}. Correct these patterns in every new question.\n`
    : "";

  const v2Blueprint = generationVersion === "v2" ?
    `SGU/EXAMSOFT BLUEPRINT:\nObjectives define what may be tested. Lecture evidence determines factual content and the correct answer. Uploaded ExamSoft/IMCQ questions define structure, wording, clue density, and distractor style only. Preserve the supplied school structure while requiring connected STEP 1 foundational-science application. Follow objective-specific second/third-order targets; do not force a fixed recall quota or cap every item at two steps. Use same-category plausible distractors and distinct clue-to-answer routes.\n` +
    `SOURCE-GROUNDED WRITING RULES (learned from the supplied DM/ER ExamSoft, IMCQ, and Madcow examples): build the stem in three linked moves — (1) context and time course, (2) one or two discriminating examination, laboratory, imaging, histology, or procedural findings, then (3) a precise foundational-science ask. Every included detail must change the differential or support the mechanism; remove decorative comorbidities. Prefer one decisive discriminator over a long list of buzzwords.\n` +
    `Distractors must be near-neighbors in the same semantic category (for example, adjacent structures, enzymes in the same pathway, competing autonomic routes, or related lesions). Each wrong option must be tempting for a stated reason and contradicted by a specific clue; never use joke answers, category mismatches, or an answer that is merely less specific.\n` +
    `The school bank is single-best-answer but does not force one visual format: default to 5 options, while preserving verified 4–8-option patterns when the objective and reference style support them. Use a compact lab/data table, image or numbered-label interpretation, and histology only when the supplied lecture/objective contains that modality; do not invent image dependence. If you choose image dependence, an actual visual asset must be attached to the question. Never write "figure shown," "see the image," or similar when no image is supplied; convert the task into a fully self-contained text question instead. Tables must test pattern interpretation, not hide a sentence in cells.\n` +
    `Madcow items are useful for clinical-context and anatomy/physiology task patterns, but are not a license to copy their occasional recall items or questionable explanations. Keep the factual answer anchored to the lecture and objective.\n` +
    `STYLE FINGERPRINT: ${JSON.stringify(styleFingerprint)}\n\n` : "";
  const taskSection = taskVariationPrompt(styleFingerprint, diff, "question batch");
  const orderSection = `ORDER-OF-REASONING BLUEPRINT (separate from difficulty): ${JSON.stringify(resolvedOrderBlueprint.targets)}\n` +
    `${resolvedOrderBlueprint.rationale}\n` +
    `For each item set orderLevel to first-order, second-order, or third-order. First-order = ${questionOrderDescription("first-order")}; second-order = ${questionOrderDescription("second-order")}; third-order = ${questionOrderDescription("third-order")}. Objective targets: ${JSON.stringify(resolvedOrderBlueprint.objectiveTargets)}. Use each objective's allowed orders as its ceiling; never label a question third-order when its objective/facts cannot support integration. ${requireReasoningAudit ? "Return reasoningSteps for every item: the shortest necessary cue-to-relationship-to-answer chain. Follow objective nextOrder targets; second-order needs one relationship after interpreting clues, third-order needs two distinct lecture-supported relationships. Do not manufacture complexity through stem length." : ""}\n`;
  return (
    CONNECTED_REASONING_CONTRACT + questionWritingBenchmarkPrompt({ objectives, atoms, lectureText }) + objectiveFacetsSection + v2Blueprint + styleProfilePrompt(styleProfile, count) + orderSection + taskSection +
    `Generate exactly ${count} NEW SGU Basic Principles of Medicine questions on "${subject}".\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n` +
    `Each stem: an ExamSoft-structured, STEP 1-style clinical, anatomic, imaging, procedure, or laboratory scenario whose details do real reasoning work, ending in one precise foundational-science question. For clinical-application or third-order items, target 4–6 sentences: age/context, timeline, discriminating symptoms or examination, and only the relevant laboratory, imaging, or physiologic data before the final ask. For narrow recognition/mechanism items, 2–4 sentences is acceptable. Do not pad stems with irrelevant comorbidities or force a disease absent from the supplied evidence; match the reference bank's clue density while preserving a realistic board-style vignette. The final sentence should ask for the mechanism, downstream consequence, structure, pathway, or best comparison—not simply repeat the diagnosis already made obvious by the stem.\n` +
    `Match the option count and lettering of the exam-bank examples below, if given (real exams often run 4-6 options, A-F); otherwise exactly 5 options A-E, each a complete answer. When the references use laboratory/data tables, generate some items with a compact table-valued answer set: set choiceLayout to "table", set choiceColumns to ordered headers (for example ["Finding","Patient 1","Patient 2"]), and make each choice an object mapping every header to its row value. Preserve ↑/↓ (increased/decreased) arrows and units exactly; never flatten table rows into prose.\n` +
    WHY_WRONG_RULE +
    (studyMode === "repair" ? `\nFOCUSED REPAIR: prioritize the weakest objectives in their supplied order. Cycle item types: recognition, mechanism, clinical-application, fresh-retest, then repeat. Fresh-retest items must use a new clinical presentation and clue-to-answer route. Return taskType on every item.\n` : "") +
    examplesSection + homeworkEvidencePrompt(examples) + clickerEvidencePrompt(examples) +
    schoolEvidencePrompt(styleExamples, objectives, atoms) + objectivesSection + objectiveModalitySection(objectives) + comparisonSection + focusSection +
    atomsSection + clinicalSection + feedbackSection +
    contentSection +
    `\n\nDRAFT QUALITY CHECK: rewrite any item with a repeated sentence, repeated answer choice, answer wording revealed in the stem, ambiguous best answer, physiology that is only partly true, an unsupported named diagnosis/syndrome/finding, or an explanation that does not name the mechanism and connect it to the objective. Match the typical stem length and clue density of the school examples. A separate independent reviewer will decide whether each completed item may be used.\n` +
    `RULES: every question UNIQUE; vary format/demographics and final task family; base strictly on the lecture content; set objectiveIds to the exact ID/code of the ONE primary objective tested; distribute correct answers evenly across A/B/C/D/E — no single letter should be correct more than 30% of the time.\n` + depthSection + `\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"B","explanation":"...",${WHY_WRONG_JSON},"choiceLayout":null,"choiceColumns":null,"topic":"<3-6 word specific medical concept tested, e.g. zona glomerulosa aldosterone control>","objectiveIds":["exact objective id"],"objectiveFacet":"specific clause tested","taskType":"recognition|mechanism|clinical-application|fresh-retest","reasoningDepth":"state-recognition|pathway-process|mechanism|enzyme-structure|regulation-cofactor|clinical-consequence","orderLevel":"first-order|second-order|third-order","reasoningSteps":["interpret clue","apply supplied relationship","integrate a second relationship only when needed"],"difficulty":"${diff}"}]}`
  );
}
