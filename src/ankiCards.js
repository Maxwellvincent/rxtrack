import { stripAnki } from "./ankiConnect.js";
import { parseProperLearningPath, resolveBlock } from "./ankiPaths.js";
import { saveAnkiCards } from "./supabase.js";

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
  // Lecture = the deepest segment under the block that isn't a "Week N" grouping
  // or a known author leaf. Null when cards sit directly under the block.
  const AUTHOR = /^(pickle|quizlet|mikey|anki|faranki|far|tan|lolnotacop|dr\.?\s|mr\.?\s)/i;
  const WEEK = /^week\s*\d+/i;
  const lecture =
    [parsed.subject, parsed.lecture, parsed.author]
      .filter(Boolean)
      .filter((s) => !WEEK.test(s) && !AUTHOR.test(s))
      .pop() || null;
  return {
    card_id: String(note.noteId),
    block_id: blockId,
    term_id: termId,
    subject: parsed.subject || parsed.lecture || parsed.block,
    lecture,
    text,
    tags,
    has_media,
    source_deck: deckPath,
  };
}

/** Upsert rows into users/{uid}/ankiCards, keyed by card_id (via saveAnkiCards). */
export async function upsertAnkiCards(userId, rows) {
  if (!userId || !rows?.length) return { count: 0, error: null };
  return saveAnkiCards(userId, rows);
}
