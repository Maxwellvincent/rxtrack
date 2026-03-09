// Unified AI client — supports Anthropic and Google Gemini

const GEMINI_KEY =
  import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";
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
async function callGeminiOnce(systemPrompt, userPrompt, maxTokens = 1000) {
  if (!GEMINI_KEY) throw new Error("No Gemini API key set (VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY)");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

  const fullPrompt = [systemPrompt, userPrompt].filter(Boolean).join("\n\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
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

async function callGemini(systemPrompt, userPrompt, maxTokens = 1000) {
  return withRetry(() => callGeminiOnce(systemPrompt, userPrompt, maxTokens));
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
    text = await callAI(systemPrompt, userPrompt, maxTokens, provider);
  } catch (err) {
    console.warn("callAIJSON parse error:", err?.message || err);
    return fallback !== undefined && fallback !== null ? fallback : {};
  }
  const clean = (text || "").replace(/```json\n?|```/g, "").trim();
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

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last > first) {
    parsed = tryParse(clean.slice(first, last + 1));
    if (parsed != null) return parsed;
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

  console.warn("callAIJSON: could not parse response, using fallback");
  return safeFallback;
}
