// ── AnkiConnect client ──────────────────────────────────────────────────────
// Pulls deck content from the locally-running Anki desktop app via the
// AnkiConnect add-on (HTTP API on http://localhost:8765). The deck is the
// knowledge base: each card becomes an objective anchor that Patient
// Recognition (and future modes) build vignettes from.
//
// Requirements on the user's machine:
//   1. Anki desktop running.
//   2. AnkiConnect add-on installed (code 2055492159).
//   3. The page origin allowed in AnkiConnect config `webCorsOriginList`
//      (e.g. "http://localhost:5173", "http://localhost:5174"). See
//      ANKI_SETUP_NOTE below for the exact JSON.
//
// Local-only by design: a deployed https:// site cannot call http://localhost
// (mixed-content block), so this runs only in local dev / a local build.

import { cardToRow } from "./ankiCards.js";

export const ANKI_URL = "http://localhost:8765";
export const ANKICONNECT_ADDON_CODE = "2055492159";

export const ANKI_SETUP_NOTE =
  'In Anki: Tools → Add-ons → AnkiConnect → Config, set ' +
  '"webCorsOriginList" to include this app\'s origin, e.g. ' +
  '["http://localhost", "http://localhost:5173", "http://localhost:5174"]. ' +
  "Then restart Anki.";

/** One AnkiConnect RPC call. Throws on transport failure or API-level error. */
export async function invoke(action, params = {}, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal,
    });
  } catch (e) {
    // Most common: Anki not running, add-on missing, or CORS origin not allowed.
    throw new Error(
      "Cannot reach AnkiConnect. Is Anki open with the AnkiConnect add-on, " +
        "and is this origin in webCorsOriginList? " +
        ANKI_SETUP_NOTE
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`AnkiConnect: ${data.error}`);
  return data.result;
}

/** Confirm Anki + add-on reachable; returns the AnkiConnect version. */
export async function ping() {
  return invoke("version", {}, { timeoutMs: 4000 });
}

/** All deck names, sorted, top-level "Default" pushed to the end. */
export async function getDeckNames() {
  const names = await invoke("deckNames");
  return (names || [])
    .filter((n) => typeof n === "string")
    .sort((a, b) => (a === "Default" ? 1 : b === "Default" ? -1 : a.localeCompare(b)));
}

/** Note ids for a deck (includes subdecks via Anki's `deck:` semantics). */
export async function findNotesInDeck(deck) {
  // Quote the deck name so spaces/special chars are handled; `::*` matches subdecks.
  const query = `deck:"${deck.replace(/"/g, '\\"')}"`;
  return invoke("findNotes", { query });
}

/** Full note objects (fields, tags, modelName) for a batch of note ids. */
export async function notesInfo(noteIds) {
  if (!noteIds || noteIds.length === 0) return [];
  return invoke("notesInfo", { notes: noteIds });
}

const HTML_ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
};

/**
 * Strip Anki/HTML markup to plain text.
 * - Cloze deletions `{{c1::answer::hint}}` collapse to the answer ("answer"),
 *   so a card front reads as a complete factual statement.
 * - HTML tags, [sound:...] refs, <img>, and entities removed/decoded.
 */
export function stripAnki(html) {
  if (!html || typeof html !== "string") return "";
  let s = html;
  // AnKingOverhaul banners: the module title + divider are stamped on every
  // card in a deck — pure repeated noise. Drop the title; keep the subject
  // (it's the lecture topic, a useful anchor). Order before the generic strip.
  s = s.replace(/<div class="palmerton-title">.*?<\/div>/gis, " ");
  s = s.replace(/<hr class="palmerton-divider"\s*\/?>/gi, " ");
  // Cloze: keep the answer, drop the ::hint and the {{cN:: }} wrapper.
  s = s.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/gs, "$1");
  // Media/sound refs.
  s = s.replace(/\[sound:[^\]]*\]/g, "");
  s = s.replace(/<img[^>]*>/gi, "");
  // Block elements → spaces so words don't fuse.
  s = s.replace(/<\s*br\s*\/?>/gi, " ");
  s = s.replace(/<\/(div|p|li|tr|h[1-6])>/gi, " ");
  // Remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Entities.
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m] ?? " ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Map an AnkiConnect note → an objective anchor for the knowledge base, or
 * null when there's no usable text. Joins the front field with a short tail of
 * remaining non-empty fields so the AI has both the prompt and the answer.
 */
export function noteToObjective(note, deck) {
  const fields = note?.fields || {};
  // Fields come keyed by name with an `order` index — sort by it.
  const ordered = Object.entries(fields)
    .map(([name, f]) => ({ name, order: f?.order ?? 99, text: stripAnki(f?.value) }))
    .filter((f) => f.text)
    .sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return null;

  const front = ordered[0].text;
  const tail = ordered
    .slice(1, 3)
    .map((f) => f.text)
    .filter(Boolean)
    .join(" — ");
  const text = tail ? `${front} — ${tail}` : front;
  if (text.length < 8) return null;

  return {
    id: `anki-${note.noteId}`,
    objective: text.slice(0, 600),
    block: deckToBlockId(deck),
    deck,
    source: "anki",
    tags: Array.isArray(note.tags) ? note.tags : [],
  };
}

/** Stable, filesystem-ish block id derived from a deck name. */
export function deckToBlockId(deck) {
  return (
    "anki-" +
    String(deck || "deck")
      .toLowerCase()
      .replace(/::/g, "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
  );
}

/** Full pull for one deck: ids → notesInfo → mapped objectives (deduped). */
export async function pullDeckObjectives(deck, { onProgress } = {}) {
  const ids = await findNotesInDeck(deck);
  if (!ids || ids.length === 0) return [];
  const out = [];
  const seen = new Set();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = await notesInfo(ids.slice(i, i + CHUNK));
    for (const note of batch) {
      const obj = noteToObjective(note, deck);
      if (obj && !seen.has(obj.id)) {
        seen.add(obj.id);
        out.push(obj);
      }
    }
    if (onProgress) onProgress(Math.min(i + CHUNK, ids.length), ids.length);
  }
  return out;
}

/**
 * Pull every note under AnKing::Proper Learning (text deck), mapped to
 * anki_cards rows. Skips Proper Learning+ (handled in a later phase).
 */
export async function pullProperLearningCards(appTerms, { onProgress } = {}) {
  const all = await getDeckNames();
  const decks = all.filter(
    (d) => d.includes("Proper Learning::") || d === "AnKing::Proper Learning"
  );
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < decks.length; i++) {
    const deck = decks[i];
    const ids = await findNotesInDeck(deck);
    if (ids?.length) {
      const CHUNK = 200;
      for (let j = 0; j < ids.length; j += CHUNK) {
        const batch = await notesInfo(ids.slice(j, j + CHUNK));
        for (const note of batch) {
          const row = cardToRow(note, deck, appTerms);
          if (row && !seen.has(row.card_id)) { seen.add(row.card_id); rows.push(row); }
        }
      }
    }
    if (onProgress) onProgress(i + 1, decks.length, deck);
  }
  return rows;
}

const OBJ_KEY = "rxt-block-objectives";

/**
 * Write objectives into the localStorage knowledge base under their deck's
 * block id, merging by id (re-sync overwrites, never duplicates). Mirrors the
 * store shape App.jsx uses so Patient Recognition's pool reader picks them up.
 * Returns { blocks, total } actually written.
 */
export function saveObjectivesToStore(objectives) {
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(OBJ_KEY) || "{}") || {};
  } catch {
    store = {};
  }
  const byBlock = new Map();
  for (const o of objectives) {
    if (!byBlock.has(o.block)) byBlock.set(o.block, []);
    byBlock.get(o.block).push(o);
  }
  let total = 0;
  for (const [block, incoming] of byBlock.entries()) {
    const existing = store[block];
    // Normalize existing entry to a flat array of objective objects.
    let prev = [];
    if (Array.isArray(existing)) prev = existing;
    else if (existing && typeof existing === "object")
      prev = [...(existing.imported || []), ...(existing.extracted || [])];
    const merged = new Map(prev.filter((o) => o && o.id).map((o) => [o.id, o]));
    for (const o of incoming) merged.set(o.id, o);
    store[block] = Array.from(merged.values());
    total += incoming.length;
  }
  localStorage.setItem(OBJ_KEY, JSON.stringify(store));
  try {
    window.dispatchEvent(new CustomEvent("rxt-objectives-updated"));
  } catch {}
  return { blocks: byBlock.size, total };
}
