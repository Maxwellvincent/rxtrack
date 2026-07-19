import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase.js";
import { getRecognitionItems } from "./supabase.js";

/**
 * Weak-area items first, then the rest; up to n. Pure + deterministic.
 * A "weak" item is one whose subject, weak_for tags, or vignette content
 * contains any of the weak terms (case-insensitive). Terms are weak-concept
 * names (e.g. "radial nerve innervation"), matched against item content.
 */
export function pickWeightedItems(items, weakTerms, n) {
  if (!items?.length) return [];
  const terms = (weakTerms || []).map((t) => String(t).toLowerCase()).filter(Boolean);
  const isWeak = (it) => {
    if (!terms.length) return false;
    const hay = (
      (it.subject || "") + " " +
      (Array.isArray(it.weak_for) ? it.weak_for.join(" ") : "") + " " +
      JSON.stringify(it.data || "")
    ).toLowerCase();
    return terms.some((t) => hay.includes(t));
  };
  const weakItems = items.filter(isWeak);
  const rest = items.filter((it) => !isWeak(it));
  return [...weakItems, ...rest].slice(0, n);
}

/** Fetch bank items for a block (optionally a subject). Read-only — recognitionItems
 *  is server-write-only, populated by the buildRecognitionBank Cloud Function (Task 7). */
export async function fetchRecognitionItems(userId, blockId, subject) {
  return getRecognitionItems(userId, blockId, subject);
}

/** One server-side generation batch for a block. Returns { generated, processed, remaining, provider, error }.
 *  Calls the buildRecognitionBank Cloud Function (Task 7 deploys it — this call errors until then). */
export async function triggerBankBuild(userId, blockId, { weakSubjects = [], perCard = 3, batch = 6 } = {}) {
  try {
    const call = httpsCallable(getFunctions(app), "buildRecognitionBank");
    const res = await call({ userId, blockId, perCard, batch, weakSubjects });
    return { ...res.data, error: null };
  } catch (e) {
    return { generated: 0, processed: 0, remaining: null, error: e };
  }
}

/**
 * Build a block's bank by looping small batches until the per-block `cap` of
 * generated items is reached, no cards remain, or a batch errors. Small batches
 * keep each Edge call well under the timeout. Calls onProgress({generated, remaining})
 * after each batch. Returns { generated, remaining, error }.
 */
export async function buildBlockBank(userId, blockId, { cap = 60, weakSubjects = [], batch = 6, onProgress } = {}) {
  if (!userId || !blockId) return { generated: 0, remaining: null, error: new Error("missing userId/blockId") };
  let generated = 0;
  let remaining = null;
  let guard = 0;
  while (generated < cap && guard < 50) {
    guard++;
    const r = await triggerBankBuild(userId, blockId, { weakSubjects, batch });
    if (r.error) return { generated, remaining, error: r.error };
    generated += r.generated || 0;
    remaining = r.remaining;
    if (onProgress) onProgress({ generated, remaining });
    if (!r.processed || remaining === 0) break; // nothing more to do
  }
  return { generated, remaining, error: null };
}
