# Anki → DB → Recognition Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grab the Anki "Proper Learning" deck once into Supabase, mold each card into a stored bank of patient vignettes/MCQs/mechanisms via an Edge Function, and serve them in Patient Recognition by block/subject with weak-area weighting.

**Architecture:** Ingest runs client-side (AnkiConnect is local-only) and upserts raw cards into `anki_cards`. A Supabase Edge Function reads ungenerated cards, calls the LLM server-side, and writes `recognition_items`. Patient Recognition reads `recognition_items` for the active block/subject, falling back to live generation when the bank is empty.

**Tech Stack:** React 19 + Vite 7 (SPA), Supabase (Postgres + Edge Functions/Deno), vitest 3 for unit tests, Gemini/Anthropic via existing `aiClient` (browser) and a server-side LLM call (Edge Function).

## Global Constraints

- Source decks: `AnKing::Proper Learning` (text, this plan) and `AnKing::Proper Learning+` (images, OUT OF SCOPE — phase 4).
- Mapping anchor: the `Proper Learning` path segment. Next segment = term, segment after = block (`CPR 1`, `CPR 2`, `FTM 1`, `FTM 2`, `MSK`). Remaining segments = subject/lecture/author kept as tags.
- Minimum 2–5 distinct vignettes per source card/subject.
- All new tables are per-`user_id` with RLS enabled; users see only their own rows; the Edge Function writes with the service-role key.
- Cloze deletions reveal the answer; HTML/media stripped (reuse existing `stripAnki` in `src/ankiConnect.js`).
- Supabase project: `ulnyobyupaizfthtvgkv` (rxtrack), URL `https://ulnyobyupaizfthtvgkv.supabase.co`. Local `.env` already holds `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- Idempotency: ingest upserts by `card_id`; generation skips cards already at target item count.
- Never blank the app: serving falls back to live generation when the bank is empty.

---

## File Structure

- `src/ankiPaths.js` — **new**, pure: parse a Proper Learning deck path → `{term, block, subject, lecture, author}`; resolve a parsed block name → app block id/term id against `rxt-terms`.
- `src/ankiConnect.js` — **modify**: add `pullProperLearningCards()` returning `anki_cards` rows; keep `stripAnki`/`invoke`/`pullDeckObjectives` (latter now unused by the modal but harmless). Drop `saveObjectivesToStore` from the ingest path.
- `src/ankiCards.js` — **new**: `cardToRow(note, deckPath, appTerms)` → an `anki_cards` row; `upsertAnkiCards(userId, rows)` → Supabase upsert.
- `src/recognitionBank.js` — **new**: `fetchRecognitionItems(userId, blockId, subject?)`, `pickWeightedItems(items, weakSubjects, n)` (pure), and `triggerBankBuild(userId, blockId)` (invokes the Edge Function).
- `src/AnkiSyncModal.jsx` — **modify**: pull Proper Learning → `upsertAnkiCards` → show counts; add a "Build bank" button per block that calls `triggerBankBuild`.
- `src/PatientRecognition.jsx` — **modify**: read from `recognitionBank` for the active block/subject with weak-area weighting; fall back to existing live generation when empty.
- `supabase/migrations/0001_anki_cards.sql` — **new**: `anki_cards` table + RLS.
- `supabase/migrations/0002_recognition_items.sql` — **new**: `recognition_items` table + RLS.
- `supabase/functions/generate-recognition-items/index.ts` — **new**: Edge Function (Deno) batch generator.
- Tests: `src/ankiPaths.test.js`, `src/ankiCards.test.js`, `src/recognitionBank.test.js`.

---

## Task 0: Verify P0 setup (cloud reachable, app boots)

**Files:** none (verification only).

- [ ] **Step 1: Confirm env present**

Run: `npm run build`
Expected: `✓ built` with no error.

- [ ] **Step 2: Start dev server, open app**

Run: `npm run dev`, open the printed localhost URL.
Expected: UI renders (no blank screen, no `supabaseUrl is required` in console). Sign-in via Google should now be available (real Supabase creds in `.env`).

- [ ] **Step 3: Confirm signed-in user id**

In the browser console: `(await window.supabase?.auth?.getUser?.())` is not required; instead sign in through the UI and confirm the menu shows a logged-in state. Note the user id from the console log `Pulling data for user: <id>` or Supabase dashboard → Authentication.
Expected: a real `user_id` exists (needed for per-user rows).

---

## Task 1: Deck-path parser + block resolver (pure, TDD)

**Files:**
- Create: `src/ankiPaths.js`
- Test: `src/ankiPaths.test.js`

**Interfaces:**
- Produces:
  - `parseProperLearningPath(deckPath: string): { term: string, block: string, subject: string|null, lecture: string|null, author: string|null } | null` — returns `null` if the path is not under `Proper Learning`.
  - `resolveBlock(blockName: string, appTerms: Array<{id,name,blocks:Array<{id,name}>}>): { blockId: string, termId: string|null }` — normalized name match against app terms/blocks; falls back to a slug (`blockName` lowercased, non-alnum→`-`) and `termId: null` when no match.

- [ ] **Step 1: Write the failing tests**

```javascript
// src/ankiPaths.test.js
import { describe, it, expect } from "vitest";
import { parseProperLearningPath, resolveBlock } from "./ankiPaths.js";

describe("parseProperLearningPath", () => {
  it("parses term/block/lecture/author from a full path", () => {
    const p = parseProperLearningPath(
      "AnKing::Proper Learning::Term 1::CPR 1::Week 10::CPR Lecture 1: Histology::Mikey"
    );
    expect(p).toEqual({
      term: "Term 1",
      block: "CPR 1",
      subject: "Week 10",
      lecture: "CPR Lecture 1: Histology",
      author: "Mikey",
    });
  });

  it("parses when only term+block present", () => {
    const p = parseProperLearningPath("AnKing::Proper Learning::Term 1::MSK");
    expect(p).toEqual({ term: "Term 1", block: "MSK", subject: null, lecture: null, author: null });
  });

  it("returns null for non-Proper-Learning decks", () => {
    expect(parseProperLearningPath("AnKing::Proper Learning+::Anatomy- Radiology::Abdomen")).toBeNull();
    expect(parseProperLearningPath("AnKing::Dr. Pickle's Anki::Term 1")).toBeNull();
  });
});

describe("resolveBlock", () => {
  const terms = [{ id: "term1", name: "Term 1", blocks: [{ id: "ftm1", name: "FTM 1" }, { id: "msk", name: "MSK" }] }];
  it("matches an existing block by normalized name", () => {
    expect(resolveBlock("FTM 1", terms)).toEqual({ blockId: "ftm1", termId: "term1" });
    expect(resolveBlock("msk", terms)).toEqual({ blockId: "msk", termId: "term1" });
  });
  it("falls back to a slug when no match", () => {
    expect(resolveBlock("CPR 2", terms)).toEqual({ blockId: "cpr-2", termId: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/ankiPaths.test.js`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement `src/ankiPaths.js`**

```javascript
// Parse + map Proper Learning deck paths to the app's term/block model.

const ANCHOR = "Proper Learning";

/** Normalize a name for matching: lowercase, collapse non-alphanumerics. */
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Slugify a name for a fallback block id. */
function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse a deck path anchored on the exact `Proper Learning` segment.
 * Returns null for `Proper Learning+` or any path without that anchor.
 */
export function parseProperLearningPath(deckPath) {
  if (!deckPath || typeof deckPath !== "string") return null;
  const parts = deckPath.split("::").map((s) => s.trim());
  const anchorIdx = parts.findIndex((p) => p === ANCHOR);
  if (anchorIdx === -1) return null;
  const rest = parts.slice(anchorIdx + 1);
  if (rest.length < 2) return null; // need at least term + block
  return {
    term: rest[0],
    block: rest[1],
    subject: rest[2] ?? null,
    lecture: rest[3] ?? null,
    author: rest[4] ?? null,
  };
}

/** Resolve a parsed block name to an app block id + term id, else a slug fallback. */
export function resolveBlock(blockName, appTerms) {
  const target = norm(blockName);
  for (const t of appTerms || []) {
    for (const b of t.blocks || []) {
      if (norm(b.name) === target || norm(b.id) === target) {
        return { blockId: b.id, termId: t.id };
      }
    }
  }
  return { blockId: slug(blockName), termId: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ankiPaths.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ankiPaths.js src/ankiPaths.test.js
git commit -m "feat: Proper Learning deck-path parser + block resolver"
```

---

## Task 2: Card → anki_cards row mapper (pure, TDD)

**Files:**
- Create: `src/ankiCards.js`
- Test: `src/ankiCards.test.js`

**Interfaces:**
- Consumes: `stripAnki` from `./ankiConnect.js`; `parseProperLearningPath`, `resolveBlock` from `./ankiPaths.js`.
- Produces:
  - `cardToRow(note: AnkiNote, deckPath: string, appTerms): Row | null` where `Row = { card_id, block_id, term_id, subject, text, tags, has_media, source_deck }`. Returns `null` when text < 8 chars or path not under Proper Learning. `AnkiNote` has `{ noteId, fields: {name:{value,order}}, tags: string[] }`.
  - `upsertAnkiCards(userId: string, rows: Row[]): Promise<{ count: number, error: any }>` — chunked upsert into `anki_cards` on conflict `(user_id, card_id)`.

- [ ] **Step 1: Write the failing test (pure mapper only)**

```javascript
// src/ankiCards.test.js
import { describe, it, expect } from "vitest";
import { cardToRow } from "./ankiCards.js";

const terms = [{ id: "ftm1id", name: "FTM 1", blocks: [{ id: "ftm1", name: "FTM 1" }] }];
const path = "AnKing::Proper Learning::Term 1::FTM 1::Week 1::Apoptosis::Pickle";

describe("cardToRow", () => {
  it("maps a note to an anki_cards row with revealed cloze and resolved block", () => {
    const note = {
      noteId: 123,
      tags: ["DrPickle"],
      fields: {
        Text: { value: 'The two types of cell death are {{c1::necrosis}} and {{c1::apoptosis}}', order: 0 },
        Extra: { value: "", order: 1 },
      },
    };
    const row = cardToRow(note, path, terms);
    expect(row.card_id).toBe("123");
    expect(row.block_id).toBe("ftm1");
    expect(row.term_id).toBe("ftm1id");
    expect(row.subject).toBe("Week 1");
    expect(row.text).toContain("necrosis and apoptosis");
    expect(row.has_media).toBe(false);
    expect(row.tags).toEqual(expect.arrayContaining(["DrPickle", "Apoptosis"]));
    expect(row.source_deck).toBe(path);
  });

  it("flags media and returns null for empty/short text", () => {
    const media = { noteId: 9, tags: [], fields: { Text: { value: '<img src="x.jpg"> {{c1::lung}}', order: 0 } } };
    expect(cardToRow(media, path, terms).has_media).toBe(true);
    const empty = { noteId: 10, tags: [], fields: { Text: { value: "", order: 0 } } };
    expect(cardToRow(empty, path, terms)).toBeNull();
    expect(cardToRow({ noteId: 1, fields: {} }, "AnKing::Other::x", terms)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ankiCards.test.js`
Expected: FAIL — `cardToRow` undefined.

- [ ] **Step 3: Implement `src/ankiCards.js`**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ankiCards.test.js`
Expected: PASS (2 tests). (`upsertAnkiCards` is exercised in Task 4's integration step, not unit-tested here.)

- [ ] **Step 5: Commit**

```bash
git add src/ankiCards.js src/ankiCards.test.js
git commit -m "feat: Anki note → anki_cards row mapper"
```

---

## Task 3: `anki_cards` table + RLS migration

**Files:**
- Create: `supabase/migrations/0001_anki_cards.sql`

**Interfaces:**
- Produces: table `public.anki_cards` consumed by `upsertAnkiCards` (Task 2) and the Edge Function (Task 5).

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/0001_anki_cards.sql
create table if not exists public.anki_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  block_id text not null,
  term_id text,
  subject text,
  text text not null,
  tags text[] default '{}',
  has_media boolean default false,
  source_deck text,
  updated_at timestamptz default now(),
  primary key (user_id, card_id)
);

create index if not exists anki_cards_block_idx on public.anki_cards (user_id, block_id, subject);

alter table public.anki_cards enable row level security;

create policy "anki_cards owner read" on public.anki_cards
  for select using (auth.uid() = user_id);
create policy "anki_cards owner write" on public.anki_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (project `ulnyobyupaizfthtvgkv`, name `anki_cards`, the SQL above).
Expected: success, no error.

- [ ] **Step 3: Verify the table exists**

Use the Supabase MCP `list_tables` (schema `public`).
Expected: `public.anki_cards` present with `rls_enabled: true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_anki_cards.sql
git commit -m "feat: anki_cards table + RLS"
```

---

## Task 4: Ingest — pull Proper Learning → upsert anki_cards

**Files:**
- Modify: `src/ankiConnect.js` (add `pullProperLearningCards`)
- Modify: `src/AnkiSyncModal.jsx` (write to Supabase instead of localStorage)

**Interfaces:**
- Consumes: `getDeckNames`, `findNotesInDeck`, `notesInfo` from `./ankiConnect.js`; `cardToRow`, `upsertAnkiCards` from `./ankiCards.js`; app terms from `localStorage["rxt-terms"]`; current user from `supabase.auth.getUser()`.
- Produces: `pullProperLearningCards(appTerms, { onProgress }): Promise<Row[]>` on `ankiConnect.js`.

- [ ] **Step 1: Add `pullProperLearningCards` to `src/ankiConnect.js`**

```javascript
import { cardToRow } from "./ankiCards.js"; // add to existing imports at top

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
```

- [ ] **Step 2: Rewrite the sync action in `src/AnkiSyncModal.jsx`**

Replace the `sync` callback body (the deck-picker pull + `saveObjectivesToStore`) with a one-shot Proper Learning pull → Supabase upsert. Replace the imports `pullDeckObjectives, saveObjectivesToStore` with `pullProperLearningCards` and add `upsertAnkiCards` + `supabase`:

```javascript
import { ping, pullProperLearningCards, ANKI_SETUP_NOTE, ANKICONNECT_ADDON_CODE } from "./ankiConnect";
import { upsertAnkiCards } from "./ankiCards";
import { supabase } from "./supabase";

// inside the component, replace sync():
const sync = useCallback(async () => {
  setStatus("syncing");
  setError("");
  setResult(null);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in first — cards are saved to your account.");
    const appTerms = JSON.parse(localStorage.getItem("rxt-terms") || "[]");
    setProgress({ deck: "Proper Learning", done: 0, total: 0 });
    const rows = await pullProperLearningCards(appTerms, {
      onProgress: (done, total, deck) => setProgress({ deck, done, total }),
    });
    const { count, error } = await upsertAnkiCards(user.id, rows);
    if (error) throw new Error(error.message || "Upload failed");
    setResult({ blocks: new Set(rows.map((r) => r.block_id)).size, total: count });
    setStatus("done");
  } catch (e) {
    setError(e?.message || String(e));
    setStatus("error");
  } finally {
    setProgress(null);
  }
}, []);
```

Remove the deck-picker UI (the `decks`/`selected`/`toggle` block) and replace the `ready` state body with a single "Pull Proper Learning → my account" button that calls `sync`. Keep the connecting/error/done states. (The deck list and `getDeckNames` connect check stay for the ping in `connect()`.)

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: `✓ built`, no error.

- [ ] **Step 4: Integration verify against live Anki + Supabase**

With Anki open + signed in to the app: open 🃏 Anki Sync → Pull. Watch progress over Proper Learning subdecks.
Then verify rows landed — Supabase MCP `execute_sql` on project `ulnyobyupaizfthtvgkv`:
`select block_id, count(*) from anki_cards group by block_id order by 1;`
Expected: counts for `cpr1/cpr2/ftm1/ftm2/msk` (or slug fallbacks), nonzero, matching the deck sizes roughly.

- [ ] **Step 5: Commit**

```bash
git add src/ankiConnect.js src/AnkiSyncModal.jsx
git commit -m "feat: ingest Proper Learning cards into anki_cards"
```

---

## Task 5: `recognition_items` table + RLS migration

**Files:**
- Create: `supabase/migrations/0002_recognition_items.sql`

**Interfaces:**
- Produces: table `public.recognition_items` consumed by the Edge Function (Task 6) and the serve layer (Task 8).

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/0002_recognition_items.sql
create table if not exists public.recognition_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  block_id text not null,
  subject text,
  source_card_id text not null,
  kind text not null check (kind in ('vignette','mcq','mechanism')),
  data jsonb not null,
  difficulty int default 2,
  weak_for text[] default '{}',
  generated_at timestamptz default now()
);

create index if not exists recog_serve_idx on public.recognition_items (user_id, block_id, subject);
create index if not exists recog_card_idx on public.recognition_items (user_id, source_card_id);
create index if not exists recog_weak_idx on public.recognition_items using gin (weak_for);

alter table public.recognition_items enable row level security;

create policy "recog owner read" on public.recognition_items
  for select using (auth.uid() = user_id);
create policy "recog owner write" on public.recognition_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (project `ulnyobyupaizfthtvgkv`, name `recognition_items`, SQL above).
Expected: success.

- [ ] **Step 3: Verify**

Supabase MCP `list_tables` → `public.recognition_items` present, `rls_enabled: true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_recognition_items.sql
git commit -m "feat: recognition_items table + RLS"
```

---

## Task 6: Edge Function — generate-recognition-items

**Files:**
- Create: `supabase/functions/generate-recognition-items/index.ts`

**Interfaces:**
- Consumes: `anki_cards` rows; secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`.
- Produces: an HTTP endpoint accepting `{ userId: string, blockId?: string, perCard?: number, weakSubjects?: string[] }`, writing `recognition_items`, returning `{ generated: number, cards: number }`.

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/generate-recognition-items/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";

const SYSTEM = `You are a USMLE Step 1 item writer. Given a fact from a medical
flashcard, produce diverse patient-recognition items. Return STRICT JSON:
{"vignettes":[{"vignette":"...","leadIn":"What is the most likely diagnosis?",
"correctDiagnosis":"...","mechanism":"...","keyDifferentiator":"...",
"options":[{"letter":"A","text":"...","isCorrect":true,"whyWrong":""},
{"letter":"B","text":"...","isCorrect":false,"whyWrong":"..."}]}]}.
Produce {{N}} distinct vignettes varying age/sex/presentation. Mechanism-first
teaching. No markdown, JSON only.`;

async function genForCard(card: any, perCard: number, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const prompt = `${SYSTEM.replace("{{N}}", String(perCard))}\n\nFACT (block ${card.block_id}, subject ${card.subject || "—"}):\n${card.text}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(txt);
  return Array.isArray(parsed.vignettes) ? parsed.vignettes : [];
}

Deno.serve(async (req) => {
  try {
    const { userId, blockId, perCard = 3, weakSubjects = [] } = await req.json();
    if (!userId) return new Response(JSON.stringify({ error: "userId required" }), { status: 400 });
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Cards for this user/block that have no items yet (idempotent).
    let q = supabase.from("anki_cards").select("card_id, block_id, subject, text").eq("user_id", userId);
    if (blockId) q = q.eq("block_id", blockId);
    const { data: cards, error: cardsErr } = await q.limit(50);
    if (cardsErr) throw cardsErr;

    const { data: existing } = await supabase
      .from("recognition_items").select("source_card_id").eq("user_id", userId);
    const done = new Set((existing || []).map((r) => r.source_card_id));
    const todo = (cards || []).filter((c) => !done.has(c.card_id));

    let generated = 0;
    for (const card of todo) {
      let vignettes: any[] = [];
      try { vignettes = await genForCard(card, perCard, apiKey!); }
      catch (e) { console.error("gen failed", card.card_id, String(e)); continue; }
      const rows = vignettes.map((v) => ({
        user_id: userId, block_id: card.block_id, subject: card.subject,
        source_card_id: card.card_id, kind: "vignette", data: v,
        weak_for: weakSubjects.includes(card.subject) ? [card.subject] : [],
      }));
      if (rows.length) {
        const { error } = await supabase.from("recognition_items").insert(rows);
        if (!error) generated += rows.length;
      }
    }
    return new Response(JSON.stringify({ generated, cards: todo.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
```

- [ ] **Step 2: Deploy the function + set the secret**

Deploy via Supabase MCP `deploy_edge_function` (project `ulnyobyupaizfthtvgkv`, name `generate-recognition-items`, the file above). Set the `GEMINI_API_KEY` secret in the Supabase dashboard → Edge Functions → Secrets (the user supplies a real Gemini key). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
Expected: deploy success.

- [ ] **Step 3: Smoke-test the function**

After Task 4 has loaded cards, invoke the function (curl or the app in Task 7) with `{ "userId": "<your id>", "blockId": "ftm1", "perCard": 2 }`.
Then check: Supabase MCP `execute_sql` → `select kind, count(*) from recognition_items group by 1;`
Expected: `vignette` rows present (≥ 2 × generated cards).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-recognition-items/index.ts
git commit -m "feat: Edge Function to generate recognition items from anki_cards"
```

---

## Task 7: recognitionBank module + "Build bank" trigger (TDD for the pure part)

**Files:**
- Create: `src/recognitionBank.js`
- Test: `src/recognitionBank.test.js`
- Modify: `src/AnkiSyncModal.jsx` (add per-block "Build bank" button)

**Interfaces:**
- Produces:
  - `pickWeightedItems(items: Item[], weakSubjects: string[], n: number): Item[]` (pure) — oversamples items whose `subject` or `weak_for` intersects `weakSubjects`, returns up to `n`, deterministic given a shuffled input is not required (stable selection: weak first, then the rest).
  - `fetchRecognitionItems(userId, blockId, subject?): Promise<Item[]>` — select from `recognition_items`.
  - `triggerBankBuild(userId, blockId, weakSubjects?): Promise<{generated,cards,error}>` — calls `supabase.functions.invoke('generate-recognition-items', ...)`.

- [ ] **Step 1: Write the failing test for `pickWeightedItems`**

```javascript
// src/recognitionBank.test.js
import { describe, it, expect } from "vitest";
import { pickWeightedItems } from "./recognitionBank.js";

const items = [
  { id: "1", subject: "Heart failure", weak_for: [] },
  { id: "2", subject: "Glomerular", weak_for: ["Glomerular"] },
  { id: "3", subject: "Random", weak_for: [] },
];

describe("pickWeightedItems", () => {
  it("puts weak-area items first", () => {
    const out = pickWeightedItems(items, ["Glomerular"], 3);
    expect(out[0].id).toBe("2");
    expect(out).toHaveLength(3);
  });
  it("returns n items when no weak subjects", () => {
    expect(pickWeightedItems(items, [], 2)).toHaveLength(2);
  });
  it("handles empty input", () => {
    expect(pickWeightedItems([], ["x"], 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/recognitionBank.test.js`
Expected: FAIL — `pickWeightedItems` undefined.

- [ ] **Step 3: Implement `src/recognitionBank.js`**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/recognitionBank.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add a "Build bank" button to `src/AnkiSyncModal.jsx` done state**

In the `done` state (after a successful pull), add a button per synced block that calls `triggerBankBuild(user.id, blockId)`. Minimal version — one button that builds all synced blocks sequentially, showing a generated count:

```javascript
import { triggerBankBuild } from "./recognitionBank";

// add state: const [building, setBuilding] = useState(false); const [built, setBuilt] = useState(null);
// in the done block, render under the counts:
<button
  type="button"
  disabled={building}
  onClick={async () => {
    setBuilding(true);
    const { data: { user } } = await supabase.auth.getUser();
    let total = 0;
    for (const blockId of result.blockIds || []) {
      const r = await triggerBankBuild(user.id, blockId);
      total += r.generated || 0;
    }
    setBuilt(total);
    setBuilding(false);
  }}
  style={primaryBtn}
>
  {building ? "Building bank…" : "Build recognition bank"}
</button>
{built != null && (
  <div style={{ fontSize: 12.5, color: T.text3, marginTop: 8 }}>{built} items generated</div>
)}
```

Update `sync()` to also set `result.blockIds = Array.from(new Set(rows.map((r) => r.block_id)))`.

- [ ] **Step 6: Build to verify it compiles**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add src/recognitionBank.js src/recognitionBank.test.js src/AnkiSyncModal.jsx
git commit -m "feat: recognition bank fetch/weighting + Build bank trigger"
```

---

## Task 8: Serve — Patient Recognition reads the bank

**Files:**
- Modify: `src/PatientRecognition.jsx`

**Interfaces:**
- Consumes: `fetchRecognitionItems`, `pickWeightedItems` from `./recognitionBank.js`; current user from `supabase.auth.getUser()`; weak subjects from `localStorage["rxt-weak-concepts"]`; active block from `localStorage` (existing block-selection key) or all blocks if none.

- [ ] **Step 1: Add a bank-backed question source**

At the top of `PatientRecognition.jsx`, import the bank and add a loader that, on mount, tries the bank before the live path:

```javascript
import { fetchRecognitionItems, pickWeightedItems } from "./recognitionBank";
import { supabase } from "./supabase";

// helper near readObjectivePool:
function readWeakSubjects() {
  try {
    const w = JSON.parse(localStorage.getItem("rxt-weak-concepts") || "{}");
    return Object.values(w).flat().map((c) => c?.subject).filter(Boolean);
  } catch { return []; }
}
```

- [ ] **Step 2: Modify `generate()` to prefer the bank**

In the `generate` callback, before the existing live-AI generation, attempt the bank:

```javascript
// inside generate(), first:
try {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const activeBlock = localStorage.getItem("rxt-active-block") || null;
    const blocks = activeBlock ? [activeBlock] : Array.from(new Set(pool.map((p) => p.block)));
    let items = [];
    for (const b of blocks) {
      items = items.concat(await fetchRecognitionItems(user.id, b));
    }
    if (items.length > 0) {
      const [pickItem] = pickWeightedItems(items, readWeakSubjects(), 1);
      if (pickItem?.data) {
        setQ(pickItem.data);          // data already matches the vignette shape
        setLoading(false);
        setAnswered(false); setPicked(null); setDeep("");
        return;                        // served from bank — no live AI call
      }
    }
  }
} catch (e) { /* fall through to live generation */ }
// ... existing live-AI generation remains below as fallback
```

(Confirm `rxt-active-block` is the key the app uses for the selected block; if different, use the actual key found in `App.jsx`. If none exists, the `blocks` fallback from the pool is correct.)

- [ ] **Step 3: Build + manual verify**

Run: `npm run build` → `✓ built`.
Then in the app (after Tasks 4–7 populated a bank): open 🩺 Patient Recognition. A vignette should appear **instantly** (no "Building a clinical case…" spinner delay) when the bank has items for the block; the reveal (mechanism, distractor rationales) renders from the stored item.

- [ ] **Step 4: Verify fallback still works**

Pick a block with no bank items (or sign out). Patient Recognition should fall back to live generation (the existing spinner + AI path) without error.

- [ ] **Step 5: Commit**

```bash
git add src/PatientRecognition.jsx
git commit -m "feat: Patient Recognition serves from the recognition bank with weak-area weighting"
```

---

## Task 9: End-to-end verification + docs

**Files:**
- Modify: `.env.example` (document the new server-side secret expectation)

- [ ] **Step 1: Document the Edge Function secret**

Add to `.env.example` a comment noting that `GEMINI_API_KEY` must be set as a Supabase Edge Function secret (not a Vite var) for generation.

```bash
# Server-side (Supabase Edge Function secret, NOT a Vite var):
#   GEMINI_API_KEY — used by generate-recognition-items to mold cards into vignettes
```

- [ ] **Step 2: Full flow on one block (FTM 1)**

1. Sign in. 2. 🃏 Anki Sync → Pull (Anki open). 3. Build recognition bank. 4. 🩺 Patient Recognition → confirm instant bank-served vignettes for FTM 1.
Verify counts: `select block_id, count(*) from recognition_items group by 1;` via Supabase MCP `execute_sql`.
Expected: ≥ 2 items per ingested FTM 1 card.

- [ ] **Step 3: Run the full unit suite**

Run: `npm test`
Expected: all tests pass (ankiPaths, ankiCards, recognitionBank).

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: note GEMINI_API_KEY Edge Function secret for bank generation"
```

---

## Self-Review Notes

- **Spec coverage:** sources/mapping (Task 1), raw grab → `anki_cards` (Tasks 2–4), pre-generated bank 2–5/card via Edge Function (Tasks 5–6), serve by block/subject + weak-area weighting (Tasks 7–8), idempotency (Task 4 upsert, Task 6 skip-done), RLS (Tasks 3, 5), fallback-never-blank (Task 8). Images/drag-drop explicitly deferred (P4) — not in this plan, matching the spec's out-of-scope.
- **Adaptive "more for weak areas":** Task 6 accepts `weakSubjects` and tags `weak_for`; Task 7/8 weight by it. Generating *additional* items for weak areas = re-invoking the function with `weakSubjects` after the skip-done set is cleared for those subjects (follow-on; base weighting shipped).
- **Type consistency:** `Row` fields (`card_id/block_id/term_id/subject/text/tags/has_media/source_deck`) consistent across Tasks 2–4; `recognition_items` columns consistent Tasks 5–8; `data` jsonb matches the vignette shape PatientRecognition already renders (`vignette/leadIn/correctDiagnosis/mechanism/keyDifferentiator/options[]`).
