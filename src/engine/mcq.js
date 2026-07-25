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
  if (text.trim().length < 150) return { error: "Not enough lecture text — convert/upload the lecture first.", questions: [] };
  try {
    const prompt = buildMcqPrompt(cfg);
    const result = await callAIJSON(MCQ_SYSTEM, prompt, { questions: [] }, maxTokens);
    return { questions: normalizeQuestions(result) };
  } catch (e) {
    return { error: e?.message || String(e), questions: [] };
  }
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
    out.push({
      stem,
      choices: Object.fromEntries(keys.map((l) => [l, String(choices[l]).trim()])),
      correct,
      explanation: String(q.explanation || "").trim(),
      topic: q.topic ? String(q.topic).trim() : null,
      difficulty: q.difficulty ? String(q.difficulty).trim() : null,
    });
    if (out.length >= 50) break;
  }
  return out;
}

// ── Exemplar parsing ─────────────────────────────────────────────────────
// Extract MCQs verbatim from an uploaded exam-bank .md so they can seed style.
export function buildExemplarParsePrompt(md) {
  return (
    `Extract EVERY multiple-choice question from the text below, verbatim.\n` +
    `For each: the full stem, options A-D, the correct answer letter, and any explanation given.\n` +
    `Do not invent questions or answers; if the answer key is absent, infer the best-supported letter.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"..."}]}\n\n` +
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

export function buildAtomQuestionsPrompt({ atoms = [], difficulty = "medium", examples = [], subject = "this lecture" } = {}) {
  const diff = String(difficulty).toLowerCase();
  const factList = atoms
    .slice(0, ATOM_QUIZ_CAP)
    .map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}`)
    .join("\n");

  const examplesSection = examples.length
    ? "\n\nMATCH THE STYLE of these real school exam questions:\n" +
      examples.slice(0, 5).map((q, i) =>
        `EXAMPLE ${i + 1}:\nQ: ${q.stem}\nA: ${q.choices?.A}  B: ${q.choices?.B}  C: ${q.choices?.C}  D: ${q.choices?.D}\nCorrect: ${q.correct}`
      ).join("\n\n")
    : "";

  return (
    `Write ONE USMLE Step 1 clinical-vignette question that tests EACH numbered fact below, in order — one question per fact.\n` +
    `Each question must test that specific fact (not adjacent trivia). Stem = a short patient scenario ending in a question mark; 4 options A-D; explanation states the tested fact.\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n\n` +
    `FACTS TO TEST (from "${subject}"):\n${factList}` +
    examplesSection +
    `\n\nReturn ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"...","topic":"the fact's term","difficulty":"${diff}"}]}`
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

const DIFF_LINE = {
  easy: "Straightforward single-concept questions, direct recall.",
  medium: "USMLE Step 1 standard — 2-step clinical reasoning.",
  hard: "Multi-step reasoning, integrated concepts, challenging plausible distractors.",
  expert: "Hardest USMLE level — synthesis across topics, all distractors plausible.",
};

/** Assemble the generation prompt. Exemplars + objectives + lecture drive style/scope. */
export function buildMcqPrompt({ subject = "this lecture", lectureText = "", examples = [], objectives = [], difficulty = "medium", count = 10 } = {}) {
  const diff = String(difficulty).toLowerCase();

  const examplesSection = examples.length
    ? "\n\nEXAMPLE QUESTIONS FROM YOUR SCHOOL'S EXAM BANK:\n" +
      "(Model your questions after this exact style, format, length, and clinical depth.)\n" +
      examples.slice(0, 5).map((q, i) =>
        `EXAMPLE ${i + 1}:\nQ: ${q.stem}\nA: ${q.choices?.A}  B: ${q.choices?.B}  C: ${q.choices?.C}  D: ${q.choices?.D}\nCorrect: ${q.correct}\nExplanation: ${q.explanation || "N/A"}`
      ).join("\n\n")
    : "";

  const objectivesSection = objectives.length
    ? "\n\nLEARNING OBJECTIVES TO COVER (every question maps to one):\n" +
      objectives.map((o, i) => `${i + 1}. [${o.code || o.id || ""}] ${o.objective || o.text || ""}`).join("\n")
    : "";

  const contentSection = lectureText
    ? "\n\nLECTURE CONTENT TO BASE QUESTIONS ON (markdown; **bold** = high-yield):\n" + String(lectureText).slice(0, 6000)
    : "";

  return (
    `Generate exactly ${count} USMLE Step 1 clinical-vignette questions on "${subject}".\n\n` +
    `DIFFICULTY: ${diff.toUpperCase()}\n${DIFF_LINE[diff] || DIFF_LINE.medium}\n` +
    `Each stem: a 3-5 sentence patient scenario (age, sex, complaint, relevant history, vitals/labs/exam) ENDING in a question mark.\n` +
    `Exactly 4 options A-D, each a complete answer. Explanation covers why right + why each wrong.` +
    examplesSection +
    objectivesSection +
    contentSection +
    `\n\nRULES: every question UNIQUE; vary format/demographics; base strictly on the lecture content; don't repeat the same correct letter >3× in a row.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","topic":"${String(subject).replace(/"/g, "'")}","difficulty":"${diff}"}]}`
  );
}
