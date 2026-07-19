// Unified AI client — Task 7b: every browser AI call proxies through the
// `aiComplete` Cloud Function (Task 7a). No API keys live in the client
// anymore; provider selection/fallback happens server-side.

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase.js";

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
 * JSON completion — never throws, returns `fallback` on any failure (parse
 * errors are handled server-side; transport/provider errors are caught here).
 * 5th arg: explicit provider, or omit for DEFAULT_PROVIDER.
 */
export async function callAIJSON(
  systemPrompt,
  userPrompt,
  fallback = {},
  maxTokens = 1000,
  explicitProvider,
  temperature
) {
  const safeFallback = fallback !== undefined && fallback !== null ? fallback : {};
  const provider =
    explicitProvider !== undefined && explicitProvider !== null ? explicitProvider : DEFAULT_PROVIDER;
  const model = providerToModel(provider);

  try {
    const res = await withRetry(() =>
      aiCompleteCall({ system: systemPrompt, prompt: userPrompt, json: true, maxTokens, model, temperature })
    );
    markProviderHealthy(provider);
    return res.data.data;
  } catch (err) {
    const { is403, is429, msg } = classifyProviderFailure(err);
    if (is403 || is429) markProviderError(provider, is403 ? 403 : 429);
    console.error("callAIJSON failed:", msg);
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
