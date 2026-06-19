# Anki → DB → Recognition Bank — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Branch:** `main` (RXTrack-app worktree)

## Goal

Turn the user's Anki "Proper Learning" deck into the knowledge base that powers
disease-recognition learning. Cards are grabbed once into the database, then an
AI batch molds each card/subject into a stored bank of patient vignettes, MCQs,
and mechanism explanations. Study modes (Patient Recognition first) serve from
this bank by block/subject, weighting weak areas. Excels school exams + USMLE
Step 1.

This is "Track B" pedagogy work, building on the existing Supabase backend and
the already-shipped `PatientRecognition.jsx` mode.

## Decisions (from brainstorming)

- **Sources:** `AnKing::Proper Learning` (text, phase 1) and
  `AnKing::Proper Learning+` (X-ray/anatomy images, deferred to phase 4).
- **Generation model:** pre-generate and store ("mold" cards), **not** live per
  session. 2–5 distinct vignettes per card/subject minimum. AI generates *extra*
  items for weak subjects to hone in.
- **Serve:** by subject + block; weak areas weighted higher. Instant, no live AI
  call for normal serving. "Teach me deeper" stays live on demand.
- **Generation runs in a Supabase Edge Function** (server-side; API key off the
  browser; handles long batches). **Ingest stays client-side/local** because
  AnkiConnect is only reachable from the user's machine.
- **Restore** the paused `rxtrack` Supabase project (`ulnyobyupaizfthtvgkv`);
  configure local `.env`. Also un-breaks the live site's cloud sync.

## Source structure & mapping

Deck path (text source):

```
AnKing :: Proper Learning :: Term 1 :: CPR 1 :: Week 10 :: <lecture> :: <author>
            (anchor)          term       block    week       lecture     source
```

- **Anchor** on the `Proper Learning` segment. The next segment is the **term**,
  the one after is the **block** (CPR 1, CPR 2, FTM 1, FTM 2, MSK — these match
  the app's existing blocks under `rxt-terms`).
- Remaining segments (week, lecture, author) are retained as `subject`/`lecture`
  + tags for sub-grouping and the weak-area system.
- Block id resolution: map parsed block name → existing app block id (e.g.
  `FTM 1` → the block whose name matches, case/space-insensitive). Unmatched
  blocks are created/flagged, never silently dropped.

Proper Learning+ (phase 4) parses by subject (`Anatomy-Radiology`, `MSK`) and is
image-centric; out of scope for phases 1–3 except recording `has_media`.

## Data model (new Supabase tables)

### `anki_cards` — raw ingest (one-time grab)
| column | type | notes |
|---|---|---|
| user_id | uuid | owner |
| card_id | text | Anki note id (stable) |
| block_id | text | resolved app block id |
| term_id | text | resolved app term id |
| subject | text | lecture/week grouping |
| text | text | stripped front+tail (cloze revealed, HTML removed) |
| tags | text[] | Anki tags + parsed path segments |
| has_media | bool | true if card referenced images (for phase 4) |
| source_deck | text | full deck path |
| updated_at | timestamptz | |

PK: `(user_id, card_id)`.

### `recognition_items` — the molded bank
| column | type | notes |
|---|---|---|
| id | uuid | pk |
| user_id | uuid | owner |
| block_id | text | serve key |
| subject | text | serve key |
| source_card_id | text | provenance → `anki_cards.card_id` |
| kind | text | `vignette` \| `mcq` \| `mechanism` |
| data | jsonb | the item (vignette text, options, correct dx, mechanism, distractor rationales) |
| difficulty | int | 1–3, for sequencing |
| weak_for | text[] | subject/concept tags this item targets (adaptive) |
| generated_at | timestamptz | |

Indexes: `(user_id, block_id, subject)`, `(user_id, weak_for)`.

Existing `mcq_bank`, `question_images`, `objectives` tables are reused where they
fit; `recognition_items` is the new serve surface for Patient Recognition.

## Pipeline

### 1. Ingest (client-side, local app, one-time per refresh)
- New "Anki Sync" path (replaces the localStorage write in the current
  `ankiConnect.js`/`AnkiSyncModal.jsx`): pull Proper Learning subdecks via
  AnkiConnect → map paths → upsert `anki_cards` in Supabase.
- Idempotent: re-running updates cards by `card_id`, no duplicates.
- Requires the user signed in (rows are per `user_id`) and Anki open with the
  AnkiConnect add-on + origin allowed (existing setup checklist in the modal).

### 2. Generate (Supabase Edge Function, server-side, batched)
- Function reads ungenerated `anki_cards` (optionally filtered to block/subject),
  calls the LLM (key in Edge Function secrets, not the browser) to mold each
  card/subject into 2–5 vignettes + MCQ + mechanism, upserts `recognition_items`.
- Idempotent + resumable: skips cards already covered (by `source_card_id` +
  target count); safe to re-invoke. Batches to stay within time/payload limits.
- Triggered on demand from the app ("Build bank" button) and re-runnable per
  block. Adaptive mode: given a set of weak subjects, generate *additional*
  items tagged `weak_for`.

### 3. Serve (client-side, Patient Recognition)
- `PatientRecognition.jsx` reads `recognition_items` for the active block/subject
  instead of generating live. Falls back to its current live-generate path only
  when the bank is empty for that selection.
- Weak-area weighting: pull weak subjects from existing `weak_concepts` /
  `performance`; oversample items whose `weak_for` matches.
- "Teach me deeper" remains a live AI call.

## Prerequisites & phasing

- **P0 — setup:** restore `rxtrack` Supabase project; write `VITE_SUPABASE_URL`
  + anon key to local `.env`; confirm app boots signed-in against cloud.
  (Crash-safe stub already added so an empty `.env` no longer blanks the app.)
- **P1 — ingest:** `anki_cards` table + migration; rework ingest to write
  Supabase; verify a small block (e.g. FTM 1) lands correctly.
- **P2 — generate:** `recognition_items` table; Edge Function for batch
  generation; "Build bank" trigger + progress.
- **P3 — serve:** wire Patient Recognition to the bank + weak-area weighting.
- **P4 — later:** Proper Learning+ images (download → Supabase storage),
  image→dx items, and drag-and-drop image attach onto existing items
  (user wants manual customization control).

## Error handling

- Ingest: AnkiConnect unreachable / CORS → existing setup checklist; partial
  pulls resume by `card_id`.
- Generate: per-card LLM failures logged, skipped, retried on next run; never
  blocks the whole batch. Malformed LLM JSON rejected, card left ungenerated.
- Serve: empty bank → fall back to live generation; never a blank screen.
- All cloud writes go through the existing additive merge discipline; nothing
  silently overwritten.

## Out of scope (this spec)

- Proper Learning+ image pipeline (phase 4).
- Drag-and-drop image attach UI (phase 4).
- Non-recognition study modes reading the bank (future).
