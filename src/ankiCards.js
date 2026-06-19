import { stripAnki } from "./ankiConnect.js";
import { parseProperLearningPath, resolveBlock } from "./ankiPaths.js";
import { supabase } from "./supabase.js";

/** Map an AnkiConnect note + its deck path → an anki_cards row, or null. */
export function cardToRow(note, deckPath, appTerms) {
  const parsed = parseProperLearningPath(deckPath);
  if (!parsed) return null;
  const fields = note?.fields || {};
  const ordered = Object.entries(fields)
    .map(([name, f]) => ({ name, order: f?.order ?? 99, raw: f?.value || "", text: stripAnki(f?.value) }))
    .sort((a, b) => a.order - b.order);
  const front = ordered[0]?.text || "";
  const tail = ordered.slice(1, 3).map((f) => f.text).filter(Boolean).join(" — ");
  const text = (tail ? `${front} — ${tail}` : front).trim().slice(0, 1200);
  if (text.length < 8) return null;
  const { blockId, termId } = resolveBlock(parsed.block, appTerms);
  const has_media = ordered.some((f) => /<img|\[sound:/i.test(f.raw));
  const pathTags = [parsed.subject, parsed.lecture, parsed.author].filter(Boolean);
  const tags = Array.from(new Set([...(Array.isArray(note.tags) ? note.tags : []), ...pathTags]));
  return {
    card_id: String(note.noteId),
    block_id: blockId,
    term_id: termId,
    subject: parsed.subject || parsed.lecture || parsed.block,
    text,
    tags,
    has_media,
    source_deck: deckPath,
  };
}

/** Upsert rows into anki_cards in chunks; conflict on (user_id, card_id). */
export async function upsertAnkiCards(userId, rows) {
  if (!userId || !rows?.length) return { count: 0, error: null };
  const now = new Date().toISOString();
  let count = 0;
  let lastError = null;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => ({ ...r, user_id: userId, updated_at: now }));
    const { error } = await supabase.from("anki_cards").upsert(batch, { onConflict: "user_id,card_id" });
    if (error) { lastError = error; break; }
    count += batch.length;
  }
  return { count, error: lastError };
}
