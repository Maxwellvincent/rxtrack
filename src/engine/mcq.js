// mcq.js — pure MCQ generation helpers (port of the monolith's
// genTopicVignettesWithContext prompt + validation into the shell/engine).
// The exam-bank questions the student uploaded become few-shot STYLE exemplars
// so the model asks questions in their school's exact style.

const LETTERS = ["A", "B", "C", "D", "E"];

const MCQ_SYSTEM = "You are a USMLE Step 1 question writer. Return ONLY valid JSON — no markdown, no prose.";

/** Generate MCQs via an injected callAIJSON (testable without a live model). */
export async function generateMcqs(cfg = {}, deps = {}) {
  const { callAIJSON, maxTokens = 8000 } = deps;
  const text = String(cfg.lectureText || "");
  const atoms = Array.isArray(cfg.atoms) ? cfg.atoms : [];
  if (text.trim().length < 150 && !atoms.length) return { error: "Not enough lecture text — convert/upload the lecture first.", questions: [] };
  try {
    const prompt = buildMcqPrompt(cfg);
    const result = await callAIJSON(MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    return { questions: normalizeQuestions(result) };
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

/** Validate + normalize model output into a clean MCQ list. */
export function normalizeQuestions(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : [];
  const out = [];
  for (const q of list) {
    if (!q || typeof q !== "object") continue;
    const stem = String(q.stem || "").trim();
    const choices = q.choices && typeof q.choices === "object" ? q.choices : null;
    if (!stem || !choices) continue;
    const keys = LETTERS.filter((l) => String(choices[l] || "").trim());
    if (keys.length < 2) continue;
    const correct = String(q.correct || "").trim().toUpperCase();
    if (!keys.includes(correct)) continue;
    const validated = {
      stem,
      choices: Object.fromEntries(keys.map((l) => [l, String(choices[l]).trim()])),
      correct,
      explanation: String(q.explanation || "").trim(),
      whyWrong: normalizeWhyWrong(q.whyWrong, keys),
      topic: q.topic ? String(q.topic).trim() : null,
      difficulty: q.difficulty ? String(q.difficulty).trim() : null,
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
function renderChoices(choices) {
  return LETTERS.filter((l) => choices?.[l]).map((l) => `${l}: ${choices[l]}`).join("  ");
}

export function buildAtomQuestionsPrompt({ atoms = [], difficulty = "medium", examples = [], subject = "this lecture" } = {}) {
  const diff = String(difficulty).toLowerCase();
  // A fact with `hasImage` gets a photomicrograph rendered above its question. The model is
  // told an image is coming so the stem can point at it, but never told what it shows —
  // naming the tissue in the stem is the answer.
  const factList = atoms
    .slice(0, ATOM_QUIZ_CAP)
    .map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}${a.hasImage ? IMAGE_NOTE : ""}`)
    .join("\n");

  const examplesSection = examples.length
    ? "\n\nMATCH THE STYLE of these real school exam questions:\n" +
      examples.slice(0, 5).map((q, i) =>
        `EXAMPLE ${i + 1}:\nQ: ${q.stem}\n${renderChoices(q.choices)}\nCorrect: ${q.correct}`
      ).join("\n\n")
    : "";

  return (
    `Write ONE USMLE Step 1 clinical-vignette question that tests EACH numbered fact below, in order — one question per fact.\n` +
    `Each question must test that specific fact (not adjacent trivia). Stem = a short patient scenario ending in a question mark; exactly 5 options A-E.\n\n` +
    WHY_WRONG_RULE + `\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n\n` +
    `FACTS TO TEST (from "${subject}"):\n${factList}` +
    examplesSection +
    `\n\nReturn ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"A","explanation":"...",${WHY_WRONG_JSON},"topic":"the fact's term","difficulty":"${diff}"}]}`
  );
}

export async function generateFromAtoms(cfg = {}, deps = {}) {
  const { callAIJSON, maxTokens = 8000 } = deps;
  const atoms = Array.isArray(cfg.atoms) ? cfg.atoms : [];
  if (!atoms.length) return { error: "No atoms to quiz — extract a lecture first.", questions: [] };
  try {
    const prompt = buildAtomQuestionsPrompt(cfg);
    const result = await callAIJSON(MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    return { questions: normalizeQuestions(result) };
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
  expert: "Hardest USMLE level — synthesis across topics, all distractors plausible.",
};

/** Assemble the generation prompt. Exemplars + objectives + atoms + lecture drive style/scope. */
export function buildMcqPrompt({ subject = "this lecture", lectureText = "", examples = [], objectives = [], atoms = [], difficulty = "medium", count = 10 } = {}) {
  const diff = String(difficulty).toLowerCase();

  const examplesSection = examples.length
    ? "\n\nEXAMPLE QUESTIONS FROM YOUR SCHOOL'S EXAM BANK:\n" +
      "(Model your questions after this exact style, format, length, and clinical depth.)\n" +
      examples.slice(0, 5).map((q, i) =>
        `EXAMPLE ${i + 1}:\nQ: ${q.stem}\n${renderChoices(q.choices)}\nCorrect: ${q.correct}\nExplanation: ${q.explanation || "N/A"}`
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
    ? "\n\nLECTURE CONTENT (markdown; **bold** = high-yield):\n" + String(lectureText).slice(0, 4000)
    : "";

  return (
    `Generate exactly ${count} USMLE Step 1 clinical-vignette questions on "${subject}".\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n` +
    `Each stem: a 3-5 sentence patient scenario (age, sex, complaint, relevant history, vitals/labs/exam) ENDING in a question mark.\n` +
    `Exactly 5 options A-E, each a complete answer.\n` +
    WHY_WRONG_RULE +
    examplesSection +
    objectivesSection +
    atomsSection +
    contentSection +
    `\n\nRULES: every question UNIQUE; vary format/demographics; base strictly on the lecture content; distribute correct answers evenly across A/B/C/D/E — no single letter should be correct more than 30% of the time.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"correct":"B","explanation":"...",${WHY_WRONG_JSON},"topic":"<3-6 word specific medical concept tested, e.g. zona glomerulosa aldosterone control>","difficulty":"${diff}"}]}`
  );
}
