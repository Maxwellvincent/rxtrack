// Unified AI client — supports Anthropic and Google Gemini

const GEMINI_KEY =
  import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.5-flash";
/** Same model as GEMINI_MODEL; JSON path uses thinkingBudget: 0 so reasoning does not consume output tokens. */
const GEMINI_JSON_MODEL = "gemini-2.5-flash";
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

export const AI_PROVIDERS = {
  GEMINI: "gemini",
  ANTHROPIC: "anthropic",
};

// ── Provider health (automatic fallback) ───────────────────────────────────
const providerStatus = {
  gemini: "unknown",
  anthropic: "unknown",
};

function providerStatusKey(provider) {
  return provider === AI_PROVIDERS.ANTHROPIC ? "anthropic" : "gemini";
}

// Global default — navbar + getBestProvider when both backends are OK
export let DEFAULT_PROVIDER = GEMINI_KEY ? AI_PROVIDERS.GEMINI : AI_PROVIDERS.ANTHROPIC;

function getBestProvider() {
  const hasGemini = !!GEMINI_KEY;
  const hasAnthropic = !!ANTHROPIC_KEY;

  const geminiBad = providerStatus.gemini === "quota" || providerStatus.gemini === "error";
  const anthropicBad = providerStatus.anthropic === "quota" || providerStatus.anthropic === "error";

  if (geminiBad && hasAnthropic) {
    console.log("Gemini unavailable — using Anthropic");
    return AI_PROVIDERS.ANTHROPIC;
  }
  if (anthropicBad && hasGemini) {
    console.log("Anthropic unavailable — using Gemini");
    return AI_PROVIDERS.GEMINI;
  }
  if (geminiBad && anthropicBad) {
    if (hasAnthropic) return AI_PROVIDERS.ANTHROPIC;
    if (hasGemini) return AI_PROVIDERS.GEMINI;
    throw new Error("No AI provider configured");
  }

  if (DEFAULT_PROVIDER === AI_PROVIDERS.GEMINI && hasGemini && !geminiBad) {
    return AI_PROVIDERS.GEMINI;
  }
  if (DEFAULT_PROVIDER === AI_PROVIDERS.ANTHROPIC && hasAnthropic && !anthropicBad) {
    return AI_PROVIDERS.ANTHROPIC;
  }
  if (hasGemini && !geminiBad) return AI_PROVIDERS.GEMINI;
  if (hasAnthropic && !anthropicBad) return AI_PROVIDERS.ANTHROPIC;
  if (hasGemini) return AI_PROVIDERS.GEMINI;
  if (hasAnthropic) return AI_PROVIDERS.ANTHROPIC;
  throw new Error("No AI provider configured");
}

function emitProviderChanged() {
  if (typeof window === "undefined") return;
  try {
    let active;
    try {
      active = getBestProvider();
    } catch {
      active = DEFAULT_PROVIDER;
    }
    window.dispatchEvent(
      new CustomEvent("rxt-provider-changed", {
        detail: {
          active,
          status: { ...providerStatus },
        },
      })
    );
  } catch {
    /* ignore */
  }
}

function markProviderError(provider, errorCode) {
  const key = providerStatusKey(provider);
  if (errorCode === 403 || errorCode === 429) {
    providerStatus[key] = "quota";
    console.warn(`${key} marked as quota/blocked`);
  } else {
    providerStatus[key] = "error";
  }
  emitProviderChanged();
}

function markProviderHealthy(provider) {
  providerStatus[providerStatusKey(provider)] = "healthy";
  emitProviderChanged();
}

export function setDefaultProvider(provider) {
  DEFAULT_PROVIDER = provider;
  emitProviderChanged();
}

export function getProviderStatus() {
  return { ...providerStatus };
}

export function getActiveProvider() {
  return getBestProvider();
}

export function getAvailableProviders() {
  return {
    gemini: !!GEMINI_KEY,
    anthropic: !!ANTHROPIC_KEY,
  };
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes("429");

      if (is429 && i < retries - 1) {
        const delay = Math.pow(2, i + 1) * 1000;
        console.log(`Rate limited — waiting ${delay / 1000}s before retry`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// --- Gemini ---
/** `geminiOpts.jsonMode` — JSON MIME type + low temperature (used by callAIJSON only; callAI omits this). */
async function callGeminiOnce(systemPrompt, userPrompt, maxTokens = 1000, geminiOpts = {}) {
  if (!GEMINI_KEY) throw new Error("No Gemini API key set (VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY)");

  const jsonMode = !!geminiOpts.jsonMode;
  const modelForRequest = jsonMode ? GEMINI_JSON_MODEL : GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelForRequest}:generateContent?key=${GEMINI_KEY}`;

  const fullPrompt = [systemPrompt, userPrompt].filter(Boolean).join("\n\n");

  const generationConfig = jsonMode
    ? {
        maxOutputTokens: Math.max(maxTokens, 3000),
        temperature: 0.1,
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingBudget: 0,
        },
      }
    : {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
      };

  console.log(
    "Gemini request config:",
    JSON.stringify({
      maxOutputTokens: generationConfig.maxOutputTokens,
      model: modelForRequest,
    })
  );

  const requestBody = {
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig,
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

let geminiCallQueue = Promise.resolve();

async function callGeminiQueued(systemPrompt, userPrompt, maxTokens = 1000, geminiOpts = {}) {
  return new Promise((resolve, reject) => {
    geminiCallQueue = geminiCallQueue
      .then(() => callGeminiOnce(systemPrompt, userPrompt, maxTokens, geminiOpts))
      .then(resolve)
      .catch(reject);
  });
}

async function callGemini(systemPrompt, userPrompt, maxTokens = 1000, geminiOpts = {}) {
  return withRetry(() => callGeminiQueued(systemPrompt, userPrompt, maxTokens, geminiOpts));
}

// --- Anthropic ---
async function callAnthropicOnce(systemPrompt, userPrompt, maxTokens = 1000) {
  if (!ANTHROPIC_KEY) throw new Error("No Anthropic API key set (VITE_ANTHROPIC_API_KEY)");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-calls": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: systemPrompt || undefined,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.map((c) => c.text || "").join("") || "";
}

async function callAnthropic(systemPrompt, userPrompt, maxTokens = 1000) {
  return withRetry(() => callAnthropicOnce(systemPrompt, userPrompt, maxTokens));
}

async function callGeminiVisionOnce(systemPrompt, userPrompt, base64, mimeType, maxTokens = 2000) {
  if (!GEMINI_KEY) throw new Error("No Gemini API key set (VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const fullText = [systemPrompt, userPrompt].filter(Boolean).join("\n\n");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: fullText },
            { inline_data: { mime_type: mimeType || "image/png", data: base64 } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.4,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiVisionQueued(systemPrompt, userPrompt, base64, mimeType, maxTokens = 2000) {
  return new Promise((resolve, reject) => {
    geminiCallQueue = geminiCallQueue
      .then(() => callGeminiVisionOnce(systemPrompt, userPrompt, base64, mimeType, maxTokens))
      .then(resolve)
      .catch(reject);
  });
}

async function callAnthropicVisionOnce(systemPrompt, userPrompt, base64, mimeType, maxTokens = 2000) {
  if (!ANTHROPIC_KEY) throw new Error("No Anthropic API key set (VITE_ANTHROPIC_API_KEY)");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-calls": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: systemPrompt || undefined,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType || "image/png",
                data: base64,
              },
            },
            { type: "text", text: userPrompt || "Describe this image." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.map((c) => c.text || "").join("") || "";
}

/**
 * Vision: prefers Gemini when configured, otherwise Anthropic.
 * `base64` must be raw base64 (no data: URL prefix).
 */
export async function callAIWithImage(
  systemPrompt,
  userPrompt,
  base64,
  mimeType = "image/png",
  maxTokens = 2000
) {
  let raw;
  if (GEMINI_KEY) {
    raw = await withRetry(() => callGeminiVisionQueued(systemPrompt, userPrompt, base64, mimeType, maxTokens));
  } else if (ANTHROPIC_KEY) {
    raw = await withRetry(() => callAnthropicVisionOnce(systemPrompt, userPrompt, base64, mimeType, maxTokens));
  } else {
    throw new Error(
      "No vision-capable API key (set VITE_GOOGLE_API_KEY / VITE_GEMINI_API_KEY or VITE_ANTHROPIC_API_KEY)"
    );
  }
  return raw.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/** Route to Gemini or Anthropic (internal). */
async function callProvider(provider, systemPrompt, userPrompt, maxTokens) {
  if (provider === AI_PROVIDERS.GEMINI) {
    return callGemini(systemPrompt, userPrompt, maxTokens);
  }
  if (provider === AI_PROVIDERS.ANTHROPIC) {
    return callAnthropic(systemPrompt, userPrompt, maxTokens);
  }
  throw new Error(`Unknown provider: ${provider}`);
}

async function callProviderJSON(provider, systemPrompt, userPrompt, maxTokens) {
  const raw =
    provider === AI_PROVIDERS.ANTHROPIC
      ? await callAnthropic(systemPrompt, userPrompt, maxTokens)
      : await callGemini(systemPrompt, userPrompt, maxTokens, { jsonMode: true });
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function classifyProviderFailure(err) {
  const msg = String(err?.message || "");
  const is403 = /\b403\b/.test(msg) || msg.includes("403");
  const is429 = /\b429\b/.test(msg) || /quota/i.test(msg);
  return { is403, is429, msg };
}

// --- Main export ---
// 4th arg: explicit provider (gemini | anthropic), or omit / null / undefined for getBestProvider()
export async function callAI(systemPrompt, userPrompt, maxTokens = 1000, explicitProvider) {
  const primaryProvider =
    explicitProvider !== undefined && explicitProvider !== null ? explicitProvider : getBestProvider();
  const fallbackProvider =
    primaryProvider === AI_PROVIDERS.GEMINI ? AI_PROVIDERS.ANTHROPIC : AI_PROVIDERS.GEMINI;

  const normalize = (raw) => raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const raw = await callProvider(primaryProvider, systemPrompt, userPrompt, maxTokens);
    markProviderHealthy(primaryProvider);
    return normalize(raw);
  } catch (err) {
    const { is403, is429, msg } = classifyProviderFailure(err);
    if (is403 || is429) {
      markProviderError(primaryProvider, is403 ? 403 : 429);
    }
    console.warn(
      `${primaryProvider} failed (${msg.slice(0, 50)}) — trying ${fallbackProvider}`
    );

    try {
      const raw = await callProvider(fallbackProvider, systemPrompt, userPrompt, maxTokens);
      markProviderHealthy(fallbackProvider);
      return normalize(raw);
    } catch (fallbackErr) {
      const fm = String(fallbackErr?.message || "");
      markProviderError(fallbackProvider, fm.includes("403") ? 403 : 500);
      throw new Error(`Both providers failed. Primary: ${msg}. Fallback: ${fm}`);
    }
  }
}

// Lenient JSON parse: strip trailing commas before ] or } (model output often has these)
function parseJSONLenient(str) {
  const fixed = str.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(fixed);
}

// Convenience: parse JSON response safely — never throws, returns fallback on any failure
// 5th arg: explicit provider, or omit for getBestProvider()
export async function callAIJSON(
  systemPrompt,
  userPrompt,
  fallback = {},
  maxTokens = 1000,
  explicitProvider
) {
  const safeFallback = fallback !== undefined && fallback !== null ? fallback : {};

  const primaryProvider =
    explicitProvider !== undefined && explicitProvider !== null ? explicitProvider : getBestProvider();
  const fallbackProvider =
    primaryProvider === AI_PROVIDERS.GEMINI ? AI_PROVIDERS.ANTHROPIC : AI_PROVIDERS.GEMINI;

  let text = "";
  try {
    text = await callProviderJSON(primaryProvider, systemPrompt, userPrompt, maxTokens);
    markProviderHealthy(primaryProvider);
  } catch (err) {
    const { is403, is429, msg } = classifyProviderFailure(err);
    if (is403 || is429) {
      markProviderError(primaryProvider, is403 ? 403 : 429);
    }
    console.warn(
      `${primaryProvider} failed (${msg.slice(0, 50)}) — trying ${fallbackProvider}`
    );
    try {
      text = await callProviderJSON(fallbackProvider, systemPrompt, userPrompt, maxTokens);
      markProviderHealthy(fallbackProvider);
    } catch (fallbackErr) {
      const fm = String(fallbackErr?.message || "");
      markProviderError(fallbackProvider, fm.includes("403") ? 403 : 500);
      console.error("callAIJSON both providers failed:", fm);
      return safeFallback;
    }
  }

  const rawText = text || "";
  console.log("callAIJSON raw response:", rawText.slice(0, 500));
  const clean = rawText.replace(/```json\n?|```/g, "").trim();

  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      try {
        return parseJSONLenient(str);
      } catch {
        return null;
      }
    }
  };

  let parsed = tryParse(clean);
  if (parsed != null) return parsed;

  const idxBrace = clean.indexOf("{");
  const idxBracket = clean.indexOf("[");
  const tryBracketFirst = idxBracket !== -1 && (idxBrace === -1 || idxBracket < idxBrace);
  const tryBraceFirst = idxBrace !== -1 && (idxBracket === -1 || idxBrace < idxBracket);

  if (tryBracketFirst) {
    const lastBracket = clean.lastIndexOf("]");
    if (lastBracket > idxBracket) {
      parsed = tryParse(clean.slice(idxBracket, lastBracket + 1));
      if (parsed != null) return parsed;
    }
  }
  if (tryBraceFirst) {
    const last = clean.lastIndexOf("}");
    if (last > idxBrace) {
      parsed = tryParse(clean.slice(idxBrace, last + 1));
      if (parsed != null) return parsed;
    }
  }
  if (!tryBracketFirst && idxBracket !== -1) {
    const lastBracket = clean.lastIndexOf("]");
    if (lastBracket > idxBracket) {
      parsed = tryParse(clean.slice(idxBracket, lastBracket + 1));
      if (parsed != null) return parsed;
    }
  }
  if (!tryBraceFirst && idxBrace !== -1) {
    const last = clean.lastIndexOf("}");
    if (last > idxBrace) {
      parsed = tryParse(clean.slice(idxBrace, last + 1));
      if (parsed != null) return parsed;
    }
  }

  // Salvage teaching-map-style response (analyzeLecture) — try before score/q salvage
  if (/"sections"\s*:\s*\[/.test(text) || /"summary"|"clinicalHook"|"bigPicture"/.test(text)) {
    try {
      const extracted = clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);
      parsed = tryParse(extracted);
      if (parsed && (Array.isArray(parsed.sections) || typeof parsed.summary === "string")) {
        return {
          summary: parsed.summary ?? safeFallback.summary ?? "",
          clinicalHook: parsed.clinicalHook ?? safeFallback.clinicalHook ?? "",
          sections: Array.isArray(parsed.sections) ? parsed.sections : [],
          bigPicture: parsed.bigPicture ?? safeFallback.bigPicture ?? "",
        };
      }
    } catch (_) {}
  }

  // Attempt to salvage truncated JSON (e.g. response cut off mid-feedback)
  const scoreMatch = text.match(/"score"\s*:\s*(\d+)/);
  const feedbackMatch = text.match(/"feedback"\s*:\s*"([^"]{0,200})/);
  if (scoreMatch) {
    return {
      score: parseInt(scoreMatch[1], 10),
      feedback: feedbackMatch ? feedbackMatch[1] + "…" : "See score above.",
    };
  }
  const arrayMatch = text.match(/"q"\s*:\s*\[([^\]]{0,500})/);
  if (arrayMatch) {
    const items = arrayMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/^"|"$/g, "").replace(/\\"/g, '"')) || [];
    if (items.length > 0) return { q: items };
  }

  let cleaned = rawText.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    cleaned = cleaned.slice(arrStart, arrEnd + 1);
  }
  try {
    const salvaged = JSON.parse(cleaned);
    if (Array.isArray(salvaged)) {
      console.log("callAIJSON: salvaged array of", salvaged.length, "items");
      return salvaged;
    }
  } catch (e) {
    console.log("callAIJSON: salvage failed:", e.message);
  }

  console.warn("callAIJSON: could not parse response, using fallback");
  return safeFallback;
}
