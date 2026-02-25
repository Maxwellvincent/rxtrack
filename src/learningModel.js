const STORAGE_KEY = "rxt-learning-profile";

export const DEFAULT_PROFILE = {
  totalSessions: 0,
  questionTypeWeights: {
    clinicalVignette: 0.7,
    mechanismBased: 0.15,
    pharmacology: 0.1,
    laboratory: 0.05,
  },
  weakTopics: {},
  strongTopics: {},
  sessionHistory: [],
  uploadedExamPatterns: [],
};

function safeParseProfile(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Very light shape check; fall back if obviously wrong.
    if (!parsed.questionTypeWeights || typeof parsed.questionTypeWeights !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function loadProfile() {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_PROFILE };
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_PROFILE };
  const parsed = safeParseProfile(raw);
  if (!parsed) return { ...DEFAULT_PROFILE };
  // Ensure any missing keys from the default shape are filled in.
  return {
    ...DEFAULT_PROFILE,
    ...parsed,
    questionTypeWeights: {
      ...DEFAULT_PROFILE.questionTypeWeights,
      ...(parsed.questionTypeWeights || {}),
    },
    weakTopics: parsed.weakTopics || {},
    strongTopics: parsed.strongTopics || {},
    sessionHistory: Array.isArray(parsed.sessionHistory) ? parsed.sessionHistory : [],
    uploadedExamPatterns: Array.isArray(parsed.uploadedExamPatterns)
      ? parsed.uploadedExamPatterns
      : [],
  };
}

export function saveProfile(profile) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore quota / serialization errors
  }
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile || DEFAULT_PROFILE));
}

function normalizeWeights(weights) {
  const out = { ...weights };
  let total = 0;
  for (const k of Object.keys(out)) {
    const v = Number(out[k]);
    if (!Number.isFinite(v) || v < 0) continue;
    out[k] = v;
    total += v;
  }
  if (!total) return { ...DEFAULT_PROFILE.questionTypeWeights };
  for (const k of Object.keys(out)) {
    out[k] = out[k] / total;
  }
  return out;
}

export function recordAnswer(profile, topic, subtopic, wasCorrect, questionType) {
  const next = cloneProfile(profile);

  // --- Session history -------------------------------------------------
  const entry = {
    at: new Date().toISOString(),
    topic: topic || null,
    subtopic: subtopic || null,
    wasCorrect: !!wasCorrect,
    questionType: questionType || null,
  };
  next.sessionHistory = Array.isArray(next.sessionHistory) ? [...next.sessionHistory, entry] : [entry];
  // Keep history bounded so it doesn't grow unbounded.
  if (next.sessionHistory.length > 500) {
    next.sessionHistory = next.sessionHistory.slice(next.sessionHistory.length - 500);
  }

  // --- Question type weights -------------------------------------------
  if (questionType && next.questionTypeWeights && next.questionTypeWeights[questionType] != null) {
    const current = next.questionTypeWeights;
    const updated = { ...current };
    const delta = wasCorrect ? -0.03 : 0.05; // small learning rate

    updated[questionType] = Math.max(0.01, (updated[questionType] || 0) + delta);
    next.questionTypeWeights = normalizeWeights(updated);
  }

  // --- Weak / strong topics --------------------------------------------
  if (topic || subtopic) {
    const key = [topic, subtopic].filter(Boolean).join(" — ");
    if (!next.weakTopics) next.weakTopics = {};
    if (!next.strongTopics) next.strongTopics = {};

    if (wasCorrect) {
      // Reduce weakness score; promote to strong over time.
      const prevWeak = Number(next.weakTopics[key] || 0);
      const newWeak = Math.max(0, prevWeak - 1);
      if (newWeak <= 0) {
        delete next.weakTopics[key];
      } else {
        next.weakTopics[key] = newWeak;
      }

      const prevStrong = Number(next.strongTopics[key] || 0);
      next.strongTopics[key] = prevStrong + 1;
    } else {
      // Increase weakness score; demote from strong if necessary.
      const prevWeak = Number(next.weakTopics[key] || 0);
      next.weakTopics[key] = prevWeak + 1;
      if (next.strongTopics && next.strongTopics[key] != null) {
        next.strongTopics[key] = Math.max(0, Number(next.strongTopics[key]) - 1);
        if (next.strongTopics[key] <= 0) delete next.strongTopics[key];
      }
    }
  }

  return next;
}

export function buildSystemPrompt(profile, subject, subtopic, mode) {
  const p = profile || DEFAULT_PROFILE;
  const weights = p.questionTypeWeights || DEFAULT_PROFILE.questionTypeWeights;

  const weakKeys = p.weakTopics ? Object.keys(p.weakTopics) : [];
  const strongKeys = p.strongTopics ? Object.keys(p.strongTopics) : [];

  const contextBits = [];
  if (subject) contextBits.push(`Subject: ${subject}`);
  if (subtopic) contextBits.push(`Subtopic: ${subtopic}`);
  if (mode) contextBits.push(`Mode: ${mode}`);

  const typePrefs = Object.entries(weights)
    .map(([k, v]) => `${k} ~ ${Math.round(v * 100)}%`)
    .join(", ");

  const weakLine =
    weakKeys.length > 0
      ? `Student weak areas (weight questions toward these, and use them for harder distractors): ${weakKeys.join(
          "; "
        )}.`
      : "Student has no recorded weak areas yet; use a balanced mix of topics.";

  const strongLine =
    strongKeys.length > 0
      ? `Student relative strengths (can be used as subtle contrasts or simpler distractors): ${strongKeys.join(
          "; "
        )}.`
      : "No strong-topic bias recorded yet.";

  const baseInstructions = [
    "You are a USMLE Step 1 question writer and medical educator.",
    contextBits.length ? `Current session context: ${contextBits.join(" | ")}.` : "",
    `Question style distribution preference: ${typePrefs}.`,
    weakLine,
    strongLine,
    "",
    "Write high-yield clinical vignette questions for an M1/M2 student preparing for Step 1.",
    "",
    "Each question must:",
    "- Describe a realistic patient with **age, sex, chief complaint, relevant history**, and **presenting symptoms**.",
    "- Include **vital signs, focused physical exam findings, and key lab values** when relevant.",
    "- Use a stem of about **3–5 sentences**, concise but information-dense.",
    "- Provide exactly **4 answer choices labeled A–D**, with **one clearly correct answer** and **three plausible distractors**.",
    "",
    "Explanations must:",
    "- Clearly state **why the correct answer is right**, including the underlying **pathophysiology/mechanism**.",
    "- Briefly explain **why each wrong answer is wrong**, tying back to specific details in the vignette.",
    "- Include a short **First Aid reference** (section or page-level descriptor) when appropriate.",
    "",
    "If the student has weak topics recorded, weight question selection toward those areas,",
    "and make distractors particularly challenging around those weak mechanisms or diagnoses.",
  ]
    .filter(Boolean)
    .join("\n");

  return baseInstructions;
}

