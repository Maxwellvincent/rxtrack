# Recognition Generation Strategy — Design

**Date:** 2026-06-19
**Status:** Approved (delegated) — fixing the half-built bank
**Branch:** `app-rework` (generation is backend-only; independent of the shell)

## Problem

The `generate-recognition-items` Edge Function (sub-project from the recognition
bank) is unreliable at the user's real scale (10,812 ingested cards across 5
blocks):
- **Timeouts:** one call tries 50 serial AI calls → exceeds the Edge Function
  wall-clock limit → dies mid-loop, returns uneven partials (cpr1=11, msk=5,
  ftm2=1, others 0).
- **Stuck-at-N:** the `.limit(50)` fetches the same first 50 cards every call and
  filters out already-done ones client-side → after the first batch, repeat calls
  return 0; the bank can't grow past ~50 cards/block.
- **Cost risk:** per-card generation over all 10.8k cards = ~32k AI calls — wrong.
- Currently Gemini-only; tutoring quality should be Claude.

## Decisions

- **Lazy / on-demand, capped:** generate for the block the user is studying, in
  small batches, up to a per-block cap — NOT blanket over every card.
- **Small server batches:** each Edge call generates a small number of cards
  (default 6) so it stays well under the timeout; the client loops calls until
  the cap or no cards remain.
- **Server-side paging of un-generated cards:** the function selects cards that
  do NOT already have items via a SQL anti-join (RPC), ordered stably — each call
  advances. Fixes stuck-at-N.
- **Provider:** prefer **Claude** (Anthropic) when `ANTHROPIC_API_KEY` secret is
  set; otherwise **Gemini** (already configured + working). Same JSON contract.
- **Weak-area first:** when the caller passes `weakSubjects`, those cards are
  prioritized and tagged `weak_for`.
- **2–3 vignettes per card** (default 3).

## Architecture

- **DB:** add an RPC `ungenerated_cards(p_user uuid, p_block text, p_limit int)`
  returning cards in `anki_cards` with no row in `recognition_items` for that
  user — a `not exists` anti-join, ordered by `card_id`. This replaces the
  client-side filtering and the stuck `.limit(50)`.
- **Edge Function `generate-recognition-items` (v-next):**
  - Body: `{ userId, blockId, perCard=3, batch=6, weakSubjects=[] }`.
  - Calls the RPC for `batch` ungenerated cards (optionally weak-first).
  - Generates via Claude-or-Gemini; inserts items.
  - Returns `{ generated, processed, remaining }` (`remaining` = count still
    ungenerated for the block) so the client knows whether to loop.
  - CORS + `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` guards retained.
- **Client (`recognitionBank.js` / Build button):** `buildBlockBank(userId,
  blockId, { cap=60, weakSubjects })` loops `triggerBankBuild` in batches until
  `remaining === 0` or the per-block `cap` of generated items is reached, with
  progress. Replaces the single fire-and-forget call.

## Out of scope
- The adaptive engine (#2) — separate.
- Shell integration of the trigger — the existing Anki Sync "Build bank" button
  is updated; surfacing in the new shell comes with #2.
- Image (Proper Learning+) generation.

## Risks
- Edge Function wall-clock: batch of 6 × ~2s/card ≈ 12s — safe. Keep `batch`
  small; never raise it near the limit.
- RPC must be `security definer` or RLS-aware so it sees the user's rows; it is
  called by the service-role client inside the function, so it runs with full
  access — filter by `p_user` explicitly.
- Anthropic JSON adherence: request `response_format`-style strict JSON in the
  prompt; tolerate/parse fenced JSON defensively.
