// Unified AI client — Task 7b: every browser AI call proxies through the
// `aiComplete` Cloud Function (Task 7a). No API keys live in the client
// anymore; provider selection/fallback happens server-side.
//
// User-provided keys (Gemini / OpenAI) stored in localStorage are tried
// before the Cloud Function so power users can use their own quota.

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase.js";
import { bridgeComplete, parseBridgeJSON } from "./llmBridge.js";
import { withDeadline } from "./asyncDeadline.js";

// ── User-provided key helpers ─────────────────────────────────────────────────

function readUserApiKey() {
  try { return JSON.parse(localStorage.getItem("rxt-user-api-key") || "null"); }
  catch { return null; }
}

function localOnlyRouting() {
  try { return localStorage.getItem("rxt-ai-routing") === "local-only"; }
  catch { return false; }
}

/**
 * Direct Gemini REST call from the browser (supports CORS).
 * Returns parsed JSON content string, or throws on failure.
 */
async function callGeminiDirect(systemPrompt, userPrompt, json = false, maxTokens = 8000, signal) {
  const { key } = readUserApiKey() || {};
  if (!key) throw new Error("no-key");
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini ${res.status}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Direct OpenAI REST call from the browser (supports CORS).
 */
async function callOpenAIDirect(systemPrompt, userPrompt, json = false, maxTokens = 8000, signal) {
  const { key } = readUserApiKey() || {};
  if (!key) throw new Error("no-key");
  const body = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI ${res.status}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * Direct Anthropic REST call.
 * NOTE: Anthropic blocks browser-origin CORS requests — this will throw in a
 * browser but works fine when called from the local bridge or a server context.
 * We attempt it anyway; CORS failure falls through to the Cloud Function.
 */
async function callAnthropicDirect(systemPrompt, userPrompt, maxTokens = 8000, signal) {
  const { key } = readUserApiKey() || {};
  if (!key) throw new Error("no-key");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic ${res.status}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

/**
 * Kimi (Moonshot AI) — OpenAI-compatible endpoint.
 */
async function callKimiDirect(systemPrompt, userPrompt, json = false, maxTokens = 8000, signal) {
  const { key } = readUserApiKey() || {};
  if (!key) throw new Error("no-key");
  const body = {
    model: "moonshot-v1-32k",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Kimi ${res.status}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function callUserKeyDirect(systemPrompt, userPrompt, json = false, maxTokens = 8000, signal) {
  const creds = readUserApiKey();
  if (!creds?.key) return null;
  if (creds.provider === "openai") return callOpenAIDirect(systemPrompt, userPrompt, json, maxTokens, signal);
  if (creds.provider === "anthropic") return callAnthropicDirect(systemPrompt, userPrompt, maxTokens, signal);
  if (creds.provider === "kimi") return callKimiDirect(systemPrompt, userPrompt, json, maxTokens, signal);
  return callGeminiDirect(systemPrompt, userPrompt, json, maxTokens, signal);
}

export const AI_PROVIDERS = {
  GEMINI: "gemini",
  ANTHROPIC: "anthropic",
};

// ── Provider health (UI status only — the server does its own provider
// fallback on every call, this just drives the nav "AI: Gemini/Claude" badge) ──
const providerStatus = {
  gemini: "unknown",
  anthropic: "unknown",
};

function providerStatusKey(provider) {
  return provider === AI_PROVIDERS.ANTHROPIC ? "anthropic" : "gemini";
}

// Global default — navbar + explicit-provider callers when no override is passed.
export let DEFAULT_PROVIDER = AI_PROVIDERS.GEMINI;

function emitProviderChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("rxt-provider-changed", {
        detail: {
          active: DEFAULT_PROVIDER,
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
  return DEFAULT_PROVIDER;
}

// Keys are server-side now (defineSecret), so the client can't know which
// providers are actually configured. Report both available; the callable
// itself throws (surfaced to markProviderError) if a provider has no key.
export function getAvailableProviders() {
  return {
    gemini: true,
    anthropic: true,
  };
}

function classifyProviderFailure(err) {
  const msg = String(err?.message || "");
  const is403 = /\b403\b/.test(msg) || msg.includes("403");
  const is429 = /\b429\b/.test(msg) || /quota/i.test(msg);
  return { is403, is429, msg };
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

// Single callable — all three shapes below proxy to it (Step 5 of task-7-brief.md).
const aiCompleteCall = httpsCallable(getFunctions(app), "aiComplete");

function providerToModel(provider) {
  return provider === AI_PROVIDERS.ANTHROPIC ? "claude" : "gemini";
}

/**
 * Plain text completion. 4th arg: explicit provider (gemini | anthropic),
 * or omit / null / undefined to use DEFAULT_PROVIDER.
 */
export async function callAI(systemPrompt, userPrompt, maxTokens = 1000, explicitProvider, temperature) {
  const provider =
    explicitProvider !== undefined && explicitProvider !== null ? explicitProvider : DEFAULT_PROVIDER;
  const model = providerToModel(provider);

  // Free path first: the local bridge runs on your own subscriptions.
  const bridged = await bridgeComplete({ system: systemPrompt, prompt: userPrompt });
  if (bridged !== null) return bridged;
  if (localOnlyRouting()) throw new Error("Local LLM bridge is unavailable. Cloud fallback is disabled in AI settings.");

  // User-provided key: direct REST call, bypasses shared Cloud Function quota.
  try {
    const userResult = await callUserKeyDirect(systemPrompt, userPrompt, false, maxTokens);
    if (userResult !== null) return userResult;
  } catch (e) {
    if (e.message !== "no-key") console.warn("user key call failed, using cloud:", e.message);
  }

  try {
    const res = await withRetry(() =>
      aiCompleteCall({ system: systemPrompt, prompt: userPrompt, maxTokens, model, temperature })
    );
    markProviderHealthy(provider);
    return res.data.text;
  } catch (err) {
    const { is403, is429, msg } = classifyProviderFailure(err);
    if (is403 || is429) markProviderError(provider, is403 ? 403 : 429);
    throw new Error(msg || String(err));
  }
}

/**
 * JSON completion — defaults to `fallback` on failure; extraction can opt into
 * throwing with the seventh argument { throwOnError: true }. (Parse
 * errors are handled server-side; transport/provider errors are caught here).
 * 5th arg: explicit provider, or omit for DEFAULT_PROVIDER.
 */
export async function callAIJSON(
  systemPrompt,
  userPrompt,
  fallback = {},
  maxTokens = 1000,
  explicitProvider,
  temperature,
  options = {}
) {
  if (options.timeoutMs) {
    return withDeadline(signal => callAIJSON(systemPrompt, userPrompt, fallback, maxTokens, explicitProvider, temperature,
      { ...options, timeoutMs: null, signal }), options.timeoutMs, options.signal);
  }
  options.signal?.throwIfAborted();
  const safeFallback = fallback !== undefined && fallback !== null ? fallback : {};
  const provider =
    explicitProvider !== undefined && explicitProvider !== null ? explicitProvider : DEFAULT_PROVIDER;
  const model = providerToModel(provider);

  // Free path first. A bridge reply that will not parse falls through to next tier.
  try {
    const bridged = await bridgeComplete({
      system: systemPrompt,
      prompt: userPrompt,
      json: true,
      signal: options.signal,
      timeoutMs: options.bridgeTimeoutMs,
    });
    if (bridged !== null) return parseBridgeJSON(bridged);
  } catch (err) {
    options.signal?.throwIfAborted();
    console.warn("bridge JSON parse failed, using cloud:", err.message);
  }
  if (localOnlyRouting()) {
    if (options.throwOnError) throw new Error("Local LLM bridge is unavailable or returned invalid JSON. Cloud fallback is disabled in AI settings.");
    return safeFallback;
  }

  // User-provided key: direct REST call before Cloud Function.
  options.signal?.throwIfAborted();
  try {
    const userResult = await callUserKeyDirect(systemPrompt, userPrompt, true, maxTokens, options.signal);
    if (userResult !== null) {
      try { return JSON.parse(userResult); }
      catch { console.warn("User key returned invalid JSON; trying cloud."); }
    }
  } catch (e) {
    if (e.message !== "no-key") console.warn("user key JSON call failed, using cloud:", e.message);
  }

  try {
    const res = await withRetry(() =>
      { options.signal?.throwIfAborted(); return aiCompleteCall({ system: systemPrompt, prompt: userPrompt, json: true, maxTokens, model, temperature }); }
    );
    markProviderHealthy(provider);
    if (res.data?.data == null) throw new Error("AI returned an empty or invalid JSON response. Please retry.");
    return res.data.data;
  } catch (err) {
    const { is403, is429, msg } = classifyProviderFailure(err);
    if (is403 || is429) markProviderError(provider, is403 ? 403 : 429);
    console.error("callAIJSON failed:", msg);
    if (options.throwOnError) throw new Error(msg || "AI service unavailable. Check the local bridge or cloud AI connection and retry.");
    return safeFallback;
  }
}

/**
 * Vision with multiple images in one call (e.g. exam question slide + answer
 * slide). `images` = [{ base64, mimeType }], base64 raw (no data: URL prefix).
 * Extension beyond the brief's three shapes — examParser.js's grid-slide
 * parser needs 2 images per call, which callAIWithImage's single-image
 * positional signature can't express; this reuses the same `aiComplete`
 * callable (which already accepts an `images[]` array) via a second thin
 * wrapper instead of dropping the multi-image capability.
 */
export async function callAIWithImages(systemPrompt, userPrompt, images, maxTokens = 2000, temperature) {
  const bridged = await bridgeComplete({
    system: systemPrompt,
    prompt: userPrompt,
    images: (images || []).map((img) => ({ mimeType: img.mimeType || "image/png", data: img.base64 })),
  });
  if (bridged !== null) {
    return bridged.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  if (localOnlyRouting()) throw new Error("Local LLM bridge cannot process this image request. Cloud fallback is disabled in AI settings.");

  const res = await withRetry(() =>
    aiCompleteCall({
      system: systemPrompt,
      prompt: userPrompt,
      images: (images || []).map((img) => ({
        mimeType: img.mimeType || "image/png",
        data: img.base64,
      })),
      maxTokens,
      temperature,
    })
  );
  markProviderHealthy(DEFAULT_PROVIDER);
  const raw = res.data.text || "";
  return raw.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/**
 * Vision / OCR. `base64` must be raw base64 (no data: URL prefix).
 */
export async function callAIWithImage(
  systemPrompt,
  userPrompt,
  base64,
  mimeType = "image/png",
  maxTokens = 2000,
  temperature
) {
  const bridged = await bridgeComplete({
    system: systemPrompt,
    prompt: userPrompt,
    images: [{ mimeType, data: base64 }],
  });
  if (bridged !== null) {
    return bridged.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  if (localOnlyRouting()) throw new Error("Local LLM bridge cannot process this image request. Cloud fallback is disabled in AI settings.");

  const res = await withRetry(() =>
    aiCompleteCall({
      system: systemPrompt,
      prompt: userPrompt,
      images: [{ mimeType, data: base64 }],
      maxTokens,
      temperature,
    })
  );
  markProviderHealthy(DEFAULT_PROVIDER);
  const raw = res.data.text || "";
  return raw.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}
