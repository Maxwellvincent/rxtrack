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

/** Same seam for Storage, so the Datalab proxy is testable without a bucket. */
let storageOverride = null;
function bucket() {
  if (storageOverride) return storageOverride;
  return admin.storage().bucket();
}
function __setStorageForTests(instance) {
  storageOverride = instance;
}

const GEMINI = defineSecret("GEMINI_API_KEY");
const ANTHROPIC = defineSecret("ANTHROPIC_API_KEY");
const ALLOWED_UIDS = defineString("ALLOWED_UIDS", { default: "" });

// Model ids are env-overridable (set GEMINI_MODEL / ANTHROPIC_MODEL in functions/.env
// to change without a code edit). Defaults use current, new-key-available ids:
//  - gemini-flash-latest: rolling alias (bare gemini-2.5-flash is closed to NEW API keys)
//  - claude-sonnet-5: current Sonnet (claude-sonnet-4-20250514 is retired)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

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
async function callGeminiRaw({ system, prompt, images = [], apiKey, maxTokens = 2048, json = false, temperature }) {
  if (!apiKey) throw new Error("No Gemini API key configured");
  const parts = [];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType || "image/png", data: img.data } });
  }
  const fullText = [system, prompt].filter(Boolean).join("\n\n");
  parts.push({ text: fullText });

  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: temperature !== undefined && temperature !== null ? temperature : (json ? 0.1 : 0.7),
  };
  // thinkingConfig is only valid on gemini-2.5 thinking models; sending it to a
  // model that lacks thinking support returns 400 INVALID_ARGUMENT. Only include
  // it when the model id clearly targets 2.5 (rolling aliases may not).
  if (/2\.5/.test(GEMINI_MODEL)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
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

async function callClaudeRaw({ system, prompt, images = [], apiKey, maxTokens = 2048, json = false, temperature }) {
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
      temperature: temperature !== undefined && temperature !== null ? temperature : (json ? 0.1 : 0.7),
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

/**
 * One vignette batch, Gemini then Claude.
 *
 * Throws only when both refuse, so a spent key on one provider degrades to a
 * slower build rather than an empty bank.
 */
async function callWithFallback({ system, prompt, geminiKey, anthropicKey }) {
  try {
    if (!geminiKey) throw new Error("GEMINI_API_KEY not set");
    return await callGeminiRaw({ system, prompt, apiKey: geminiKey, maxTokens: 2048, json: true });
  } catch (geminiErr) {
    if (!anthropicKey) throw geminiErr;
    logger.warn(`buildRecognitionBank: gemini failed (${geminiErr.message}) — trying anthropic`);
    return callClaudeRaw({ system, prompt, apiKey: anthropicKey, maxTokens: 2048, json: true });
  }
}

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
  const anthropicKey = ANTHROPIC.value();
  if (!geminiKey && !anthropicKey) {
    throw new HttpsError("failed-precondition", "no provider key set (GEMINI_API_KEY / ANTHROPIC_API_KEY)");
  }

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
      // Gemini first, Claude if it refuses — the same fallback aiComplete has
      // had all along. Without it, a spent Gemini key made this the one dead
      // generator in the app: every fact 429'd with "prepayment credits are
      // depleted", the bank stayed empty, and both engine sessions reported
      // "nothing to study" on blocks full of material.
      const raw = await callWithFallback({ system, prompt, geminiKey, anthropicKey });
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
  const { system, prompt, images = [], json = false, maxTokens = 2048, model = "gemini", temperature } = req.data || {};

  const geminiKey = GEMINI.value();
  const anthropicKey = ANTHROPIC.value();

  const primary = model === "claude" || model === "anthropic" ? "anthropic" : "gemini";
  const fallback = primary === "gemini" ? "anthropic" : "gemini";

  async function runProvider(p) {
    if (p === "gemini") {
      return callGeminiRaw({ system, prompt, images, apiKey: geminiKey, maxTokens, json, temperature });
    }
    return callClaudeRaw({ system, prompt, images, apiKey: anthropicKey, maxTokens, json, temperature });
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

// ── Datalab marker OCR (server-side proxy) ──────────────────────────────────
// The browser cannot call Datalab directly: the API sends no CORS headers, so
// every client attempt died as "TypeError: Failed to fetch" and the app silently
// fell back to pdf.js text extraction. Proxying also keeps the key server-side.
//
// The PDF arrives via Storage rather than in the call payload — callable
// requests cap out around 10MB and a slide deck is routinely 30MB+.
const DATALAB = defineSecret("DATALAB_API_KEY");
const DATALAB_URL = process.env.DATALAB_URL || "https://www.datalab.to/api/v1/convert";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the check URL until the conversion finishes, fails, or we run out of budget. */
async function pollDatalab(checkUrl, apiKey, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let delay = 2000;
  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.5, 10000);
    const res = await fetch(checkUrl, { headers: { "X-API-Key": apiKey } });
    if (!res.ok) continue; // a transient 5xx during a long job is not fatal
    const body = await res.json();
    if (body.status === "complete") return body;
    if (body.status === "failed") {
      throw new HttpsError("internal", `Datalab failed: ${body.error || "no reason given"}`);
    }
  }
  throw new HttpsError("deadline-exceeded", "Datalab did not finish in time");
}

async function datalabConvertHandler(req) {
  assertAllowed(req);
  const { storagePath, forceOcr = true, useLlm = false, keepFile = false } = req.data || {};
  if (!storagePath) throw new HttpsError("invalid-argument", "storagePath required");

  // A caller may only convert files under its own prefix.
  const prefix = `users/${req.auth.uid}/`;
  if (!storagePath.startsWith(prefix)) {
    throw new HttpsError("permission-denied", "storagePath outside your own folder");
  }

  const apiKey = DATALAB.value();
  if (!apiKey) throw new HttpsError("failed-precondition", "DATALAB_API_KEY not configured");

  const file = bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", `no such file: ${storagePath}`);
  const [buffer] = await file.download();

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/pdf" }), storagePath.split("/").pop());
  form.append("output_format", "markdown");
  form.append("paginate", "true"); // {N}----- page markers, so the client can split pages
  form.append("force_ocr", String(forceOcr));
  form.append("use_llm", String(useLlm));

  const submit = await fetch(DATALAB_URL, { method: "POST", headers: { "X-API-Key": apiKey }, body: form });
  if (!submit.ok) {
    throw new HttpsError("internal", `Datalab submit failed: ${submit.status} ${await submit.text()}`);
  }
  const job = await submit.json();
  if (!job.success || !job.request_check_url) {
    throw new HttpsError("internal", `Datalab rejected the job: ${job.error || "no request_check_url"}`);
  }

  const result = await pollDatalab(job.request_check_url, apiKey, 7 * 60 * 1000);

  // The upload was a transport detail; don't leave 30MB of it behind per lecture.
  if (!keepFile) {
    try {
      await file.delete();
    } catch (e) {
      logger.warn("datalabConvert: could not delete temp upload", { storagePath, err: e?.message });
    }
  }

  return {
    markdown: result.markdown || "",
    images: result.images || {},
    pageCount: result.page_count ?? null,
    method: "marker-datalab",
  };
}

// ── Exports ──────────────────────────────────────────────────────────────
// Raw handlers exported for in-process unit testing (Task 7, Step 4) — call
// directly with a fake { auth: { uid }, data } request, no emulator needed.
exports.buildRecognitionBankHandler = buildRecognitionBankHandler;
exports.aiCompleteHandler = aiCompleteHandler;
exports.datalabConvertHandler = datalabConvertHandler;
exports.assertAllowed = assertAllowed;
exports.parseVignettes = parseVignettes;
exports.__setFirestoreForTests = __setFirestoreForTests;
exports.__setStorageForTests = __setStorageForTests;

// minInstances:1 keeps one instance warm so callers don't hit Cloud Run
// cold-start "no available instance" aborts (seen after re-enabling billing).
// memory 512MiB + 120s timeout give the AI provider calls headroom.
exports.buildRecognitionBank = onCall(
  { secrets: [GEMINI, ANTHROPIC], memory: "512MiB", timeoutSeconds: 120 },
  buildRecognitionBankHandler
);
exports.aiComplete = onCall(
  { secrets: [GEMINI, ANTHROPIC], memory: "512MiB", timeoutSeconds: 120 },
  aiCompleteHandler
);
// Marker OCR is minutes, not seconds, and holds a 30MB buffer while it runs:
// 9 minutes and 1GiB, against the 7-minute polling budget inside the handler.
exports.datalabConvert = onCall(
  { secrets: [DATALAB], memory: "1GiB", timeoutSeconds: 540 },
  datalabConvertHandler
);
