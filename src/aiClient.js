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

// Global default — change this one line to switch all calls
export let DEFAULT_PROVIDER = GEMINI_KEY
  ? AI_PROVIDERS.GEMINI
  : AI_PROVIDERS.ANTHROPIC;

export function setDefaultProvider(provider) {
  DEFAULT_PROVIDER = provider;
}

export function getAvailableProviders() {
  return {
    gemini: !!GEMINI_KEY,
    anthropic: !!ANTHROPIC_KEY,
  };
}

// Retry transient failures (rate limit, timeout, 5xx). Do not retry 4xx auth/bad request.
const MAX_AI_RETRIES = 3;
const RETRY_DELAY_MS = 1200;

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 500 || status === 408;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      const statusMatch = msg.match(/(?:Gemini|Anthropic)\s+(\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : null;
      const isRetryable =
        status != null ? isRetryableStatus(status) : /network|timeout|failed to fetch/i.test(msg);
      if (attempt === MAX_AI_RETRIES || !isRetryable) throw err;
      const delay = RETRY_DELAY_MS * Math.pow(1.5, attempt - 1);
      await sleep(delay);
    }
  }
  throw lastErr;
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

async function callGemini(systemPrompt, userPrompt, maxTokens = 1000, geminiOpts = {}) {
  return withRetry(() => callGeminiOnce(systemPrompt, userPrompt, maxTokens, geminiOpts));
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
    raw = await withRetry(() => callGeminiVisionOnce(systemPrompt, userPrompt, base64, mimeType, maxTokens));
  } else if (ANTHROPIC_KEY) {
    raw = await withRetry(() => callAnthropicVisionOnce(systemPrompt, userPrompt, base64, mimeType, maxTokens));
  } else {
    throw new Error(
      "No vision-capable API key (set VITE_GOOGLE_API_KEY / VITE_GEMINI_API_KEY or VITE_ANTHROPIC_API_KEY)"
    );
  }
  return raw.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// --- Main export ---
// provider: "gemini" | "anthropic" | undefined (uses DEFAULT_PROVIDER)
export async function callAI(
  systemPrompt,
  userPrompt,
  maxTokens = 1000,
  provider = DEFAULT_PROVIDER
) {
  const raw =
    provider === AI_PROVIDERS.ANTHROPIC
      ? await callAnthropic(systemPrompt, userPrompt, maxTokens)
      : await callGemini(systemPrompt, userPrompt, maxTokens);

  // Strip markdown fences — both providers sometimes wrap JSON in ```
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// Lenient JSON parse: strip trailing commas before ] or } (model output often has these)
function parseJSONLenient(str) {
  const fixed = str.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(fixed);
}

// Convenience: parse JSON response safely — never throws, returns fallback on any failure
export async function callAIJSON(
  systemPrompt,
  userPrompt,
  fallback = {},
  maxTokens = 1000,
  provider = DEFAULT_PROVIDER
) {
  let text = "";
  try {
    const raw =
      provider === AI_PROVIDERS.ANTHROPIC
        ? await callAnthropic(systemPrompt, userPrompt, maxTokens)
        : await callGemini(systemPrompt, userPrompt, maxTokens, { jsonMode: true });
    text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  } catch (err) {
    console.warn("callAIJSON parse error:", err?.message || err);
    return fallback !== undefined && fallback !== null ? fallback : {};
  }
  const rawText = text || "";
  console.log("callAIJSON raw response:", rawText.slice(0, 500));
  const clean = rawText.replace(/```json\n?|```/g, "").trim();
  const safeFallback = fallback !== undefined && fallback !== null ? fallback : {};

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
  const tryBracketFirst =
    idxBracket !== -1 && (idxBrace === -1 || idxBracket < idxBrace);
  const tryBraceFirst =
    idxBrace !== -1 && (idxBracket === -1 || idxBrace < idxBracket);

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
