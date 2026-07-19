// functions/index.js — Task 7: all browser AI calls moved behind Cloud Functions v2.
//
// Two callables:
//   buildRecognitionBank({ userId, blockId, perCard, batch, weakSubjects })
//     -> { generated, processed, remaining, provider }
//   aiComplete({ system, prompt, images, json, maxTokens, model })
//     -> { text } | { data }
//
// Both are gated by assertAllowed(req): must be signed in, and (if ALLOWED_UIDS
// is non-empty) the caller's uid must be in the allowlist.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Test-only injection seam: vi.mock("firebase-admin") does not reliably
// intercept require() calls made from inside this CJS module when it's
// loaded via ESM import (confirmed — the mock factory never runs), so
// handlers.test.js swaps the Firestore instance directly instead. No-op in
// production; onCall wiring below always goes through db().
let firestoreOverride = null;
function db() {
  if (firestoreOverride) return firestoreOverride;
  return admin.firestore();
}
function __setFirestoreForTests(instance) {
  firestoreOverride = instance;
}

const GEMINI = defineSecret("GEMINI_API_KEY");
const ANTHROPIC = defineSecret("ANTHROPIC_API_KEY");
const ALLOWED_UIDS = defineString("ALLOWED_UIDS", { default: "" });

const GEMINI_MODEL = "gemini-2.5-flash";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

// ── Auth guard (shared) ─────────────────────────────────────────────────────
function assertAllowed(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "sign in required");
  const list = (ALLOWED_UIDS.value() || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length && !list.includes(req.auth.uid)) {
    throw new HttpsError("permission-denied", "not allowlisted");
  }
}

// ── JSON extraction helpers (ported from supabase/functions/generate-recognition-items) ──
function stripFence(text) {
  let s = (text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  return s;
}

function sliceToJson(s) {
  const braceStart = s.indexOf("{");
  const bracketStart = s.indexOf("[");
  const start = Math.min(
    braceStart === -1 ? Infinity : braceStart,
    bracketStart === -1 ? Infinity : bracketStart
  );
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start === Infinity || end === -1) return s;
  return s.slice(start, end + 1);
}

/** Defensive JSON parse — tolerate code fences / stray prose (ported from the Deno edge fn). */
function parseVignettes(txt) {
  const s = sliceToJson(stripFence(txt));
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed.vignettes) ? parsed.vignettes : [];
  } catch {
    return [];
  }
}

// ── Provider callers ────────────────────────────────────────────────────────
async function callGeminiRaw({ system, prompt, images = [], apiKey, maxTokens = 2048, json = false }) {
  if (!apiKey) throw new Error("No Gemini API key configured");
  const parts = [];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType || "image/png", data: img.data } });
  }
  const fullText = [system, prompt].filter(Boolean).join("\n\n");
  parts.push({ text: fullText });

  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: json ? 0.1 : 0.7,
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (json) generationConfig.responseMimeType = "application/json";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callClaudeRaw({ system, prompt, images = [], apiKey, maxTokens = 2048 }) {
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const content = [];
  for (const img of images) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType || "image/png", data: img.data },
    });
  }
  content.push({ type: "text", text: prompt || "" });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data?.content || []).map((c) => c.text || "").join("");
}

// ── buildRecognitionBank ─────────────────────────────────────────────────────
const RECOGNITION_SYSTEM = `You are a USMLE Step 1 item writer. Given a fact from a medical
flashcard, produce diverse patient-recognition items. Return STRICT JSON:
{"vignettes":[{"vignette":"...","leadIn":"What is the most likely diagnosis?",
"correctDiagnosis":"...","mechanism":"...","keyDifferentiator":"...",
"options":[{"letter":"A","text":"...","isCorrect":true,"whyWrong":""},
{"letter":"B","text":"...","isCorrect":false,"whyWrong":"..."}]}]}.
Produce {{N}} distinct vignettes varying age/sex/presentation. Mechanism-first
teaching. No markdown, JSON only.`;

/** Deterministic id for a generated vignette so re-runs don't duplicate rows. */
function vignetteDocId(cardId, index) {
  return `${cardId}-v${index}`;
}

async function buildRecognitionBankHandler(req) {
  assertAllowed(req);
  const uid = req.auth.uid;
  const { userId, blockId = null, perCard = 2, batch = 20, weakSubjects = [] } = req.data || {};
  if (userId && userId !== uid) throw new HttpsError("permission-denied", "userId mismatch");

  const geminiKey = GEMINI.value();
  if (!geminiKey) throw new HttpsError("failed-precondition", "GEMINI_API_KEY not set");

  const firestore = db();
  const ungeneratedRef = firestore.collection("users").doc(uid).collection("ungeneratedCards");

  let query = ungeneratedRef;
  if (blockId) query = query.where("block_id", "==", blockId);

  const snap = await query.get();
  const cards = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));

  // Weak-area subjects first (mirrors the edge fn's ORDER BY weak-flag).
  const weak = new Set(weakSubjects || []);
  const ordered = cards
    .slice()
    .sort((a, b) => (weak.has(b.subject) ? 1 : 0) - (weak.has(a.subject) ? 1 : 0));

  const limit = Math.min(batch, 12);
  const toProcess = ordered.slice(0, limit);

  let generated = 0;
  let processed = 0;
  const system = RECOGNITION_SYSTEM.replace("{{N}}", String(perCard));

  for (const card of toProcess) {
    const cardId = card.card_id ?? card._id;
    const prompt = `FACT (block ${card.block_id}, subject ${card.subject || "—"}):\n${card.text}`;
    let vignettes = [];
    try {
      const raw = await callGeminiRaw({ system, prompt, apiKey: geminiKey, maxTokens: 2048, json: true });
      vignettes = parseVignettes(raw);
    } catch (e) {
      logger.error("buildRecognitionBank: generation failed", cardId, String(e));
      continue;
    }
    processed++;

    const rows = vignettes.map((v, i) => ({
      id: vignetteDocId(cardId, i),
      block_id: card.block_id,
      subject: card.subject,
      lecture: card.lecture ?? null,
      source_card_id: cardId,
      kind: "vignette",
      data: v,
      weak_for: weak.has(card.subject) ? [card.subject] : [],
    }));

    if (rows.length) {
      const writeBatch = firestore.batch();
      const recognitionItemsRef = firestore.collection("users").doc(uid).collection("recognitionItems");
      for (const row of rows) {
        const { id, ...fields } = row;
        writeBatch.set(recognitionItemsRef.doc(id), { ...fields, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
      // Mark this card generated — remove it from the ungeneratedCards pool so the
      // next call advances (mirrors the edge fn's anti-join advancing every call).
      writeBatch.delete(ungeneratedRef.doc(card._id));
      await writeBatch.commit();
      generated += rows.length;
    }
  }

  let remaining = null;
  try {
    let remainingQuery = ungeneratedRef;
    if (blockId) remainingQuery = remainingQuery.where("block_id", "==", blockId);
    if (typeof remainingQuery.count === "function") {
      const countSnap = await remainingQuery.count().get();
      remaining = countSnap.data().count;
    } else {
      const remainingSnap = await remainingQuery.get();
      remaining = remainingSnap.size;
    }
  } catch (e) {
    logger.warn("buildRecognitionBank: remaining-count failed", String(e));
  }

  return { generated, processed, remaining, provider: "gemini" };
}

// ── aiComplete ────────────────────────────────────────────────────────────
async function aiCompleteHandler(req) {
  assertAllowed(req);
  const { system, prompt, images = [], json = false, maxTokens = 2048, model = "gemini" } = req.data || {};

  const geminiKey = GEMINI.value();
  const anthropicKey = ANTHROPIC.value();

  const primary = model === "claude" || model === "anthropic" ? "anthropic" : "gemini";
  const fallback = primary === "gemini" ? "anthropic" : "gemini";

  async function runProvider(p) {
    if (p === "gemini") {
      return callGeminiRaw({ system, prompt, images, apiKey: geminiKey, maxTokens, json });
    }
    return callClaudeRaw({ system, prompt, images, apiKey: anthropicKey, maxTokens });
  }

  let raw;
  try {
    raw = await runProvider(primary);
  } catch (err) {
    logger.warn(`${primary} failed (${err.message}) — trying ${fallback}`);
    try {
      raw = await runProvider(fallback);
    } catch (fallbackErr) {
      throw new HttpsError(
        "internal",
        `Both providers failed. Primary: ${err.message}. Fallback: ${fallbackErr.message}`
      );
    }
  }

  const text = (raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!json) return { text };

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let data = tryParse(text);
  if (data === undefined) data = tryParse(sliceToJson(text));
  if (data === undefined) {
    throw new HttpsError("internal", "Failed to parse JSON response from provider");
  }
  return { data };
}

// ── Exports ──────────────────────────────────────────────────────────────
// Raw handlers exported for in-process unit testing (Task 7, Step 4) — call
// directly with a fake { auth: { uid }, data } request, no emulator needed.
exports.buildRecognitionBankHandler = buildRecognitionBankHandler;
exports.aiCompleteHandler = aiCompleteHandler;
exports.assertAllowed = assertAllowed;
exports.parseVignettes = parseVignettes;
exports.__setFirestoreForTests = __setFirestoreForTests;

exports.buildRecognitionBank = onCall({ secrets: [GEMINI] }, buildRecognitionBankHandler);
exports.aiComplete = onCall({ secrets: [GEMINI, ANTHROPIC] }, aiCompleteHandler);
