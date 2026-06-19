import { supabase } from "./supabase.js";

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

/** Fetch bank items for a block (optionally a subject). */
export async function fetchRecognitionItems(userId, blockId, subject) {
  if (!userId || !blockId) return [];
  let q = supabase
    .from("recognition_items")
    .select("id, block_id, subject, source_card_id, kind, data, difficulty, weak_for")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .eq("kind", "vignette");
  if (subject) q = q.eq("subject", subject);
  const { data, error } = await q.limit(200);
  if (error) return [];
  return data || [];
}

/** Trigger server-side generation for a block. */
export async function triggerBankBuild(userId, blockId, weakSubjects = []) {
  try {
    const { data, error } = await supabase.functions.invoke("generate-recognition-items", {
      body: { userId, blockId, perCard: 3, weakSubjects },
    });
    if (error) return { generated: 0, cards: 0, error };
    return { ...data, error: null };
  } catch (e) {
    return { generated: 0, cards: 0, error: e };
  }
}
