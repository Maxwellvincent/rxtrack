import { supabase } from "./supabase.js";

/** Weak-area items first, then the rest; up to n. Pure + deterministic. */
export function pickWeightedItems(items, weakSubjects, n) {
  if (!items?.length) return [];
  const weak = new Set(weakSubjects || []);
  const isWeak = (it) =>
    weak.has(it.subject) || (it.weak_for || []).some((w) => weak.has(w));
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
