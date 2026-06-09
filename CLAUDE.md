# RXTrack

RXTrack is a custom-built clinical learning and exam preparation web app. Built by Louis to support medical school at SGU. It replaces generic flashcard tools with a system that understands curriculum structure — organized around terms, blocks, objectives, and lectures — with AI-powered drilling, spaced repetition, and mastery tracking.

**Live location:** `~/rxtrack/`
**Stack:** React 19 + Vite · Supabase (PostgreSQL + Auth + RLS) · Gemini 2.5 Flash (primary AI) / Claude Sonnet (fallback) · Mistral AI (OCR)
**Supabase project:** `ulnyobyupaizfthtvgkv` (rxtrack, us-east-1, ACTIVE_HEALTHY)
**Primary storage:** Supabase is source of truth — localStorage is fast read cache, synced on every change


## Claude's Role

You are the developer and architect of this app. You know the full codebase. When working on RXTrack:
- Reference actual file paths and component names, not generic advice
- `App.jsx` is the monolithic core (~35K lines) — always read the relevant section before editing, be surgical
- Supabase sync: 3s debounce on changes + 30s auto-sync + immediate push on sign-in
- `networkDown` flag in `supabase.js` aborts all remaining push calls after first "Failed to fetch"
- Never refactor without asking first. Surgical edits only.
- Test files exist (`.test.js`) — run with `npm run test` (Vitest)


## App Purpose

The app supports a full learning cycle:
1. **Upload** lecture PDFs/slides → OCR extracts objectives and content chunks
2. **Track** objectives per block (untested → inprogress → struggling → mastered)
3. **Drill** with AI-generated MCQs (clinical vignette, USMLE Step 1 style)
4. **Deep Learn** through structured phases: Brain Dump → SAQ → Structure → Cases
5. **Spaced repetition** via SRS scheduling on objectives (`srsNextReview` field)
6. **Histology** image drilling via HistoStudy


## Curriculum Structure

```
Term
 └── Block (e.g. CPR 1, FTM2, MSK)
      └── Lecture / DLA
           └── Objectives  (status, consecutiveCorrect, srsNextReview, starred)
           └── Content Chunks (OCR'd markdown text)
```


## Supabase Tables

| Table | Contents | Conflict key |
|-------|----------|-------------|
| `terms` | All terms/blocks/metadata | `user_id` |
| `lectures` | Lecture metadata + markdown chunks | `user_id, lecture_id` |
| `objectives` | Block objectives with status/mastery data | `user_id, block_id` |
| `performance` | Drill/quiz session results | `user_id` |
| `completion` | Objective mastery tracking + review dates | `user_id` |
| `weak_concepts` | Adaptive weak concept markers | `user_id` |
| `tracker` | Study tracker rows | `user_id` |
| `mcq_bank` | Persistent AI-generated MCQs | `user_id, objective_id, round` |
| `user_data` | Legacy key/value store | `user_id, key` |

All tables have RLS enabled — users can only read/write their own rows.
Auth: Google OAuth only.


## localStorage Keys (cache layer)

| Key | Contents |
|-----|----------|
| `rxt-terms` | Terms + blocks |
| `rxt-lec-meta` | Lecture metadata + OCR chunks |
| `rxt-block-objectives` | Objectives per block (can hit 3MB+ for large blocks — normal) |
| `rxt-performance` | Drill/quiz scores |
| `rxt-completion` | Session counts, mastery dates |
| `rxt-weak-concepts` | Struggling topics |
| `rxt-tracker-v2` | SRS logs and next review dates |
| `rxt-dl-sessions` | Deep Learn session state |
| `rxt-exam-results` | Parsed MCQ exam performance |
| `rxt-question-banks` | Uploaded block questions (Madcow etc.), keyed by filename |
| `rxt-mcq-bank` | AI-generated MCQ cache: `{ "objId_r0": {...} }` |
| `rxt-quick-notes` | Quick Capture panel notes |
| `rxt-missed-questions` | Wrong answer log |
| `rxt-panic-mode` | `"true"` when Exam/Panic Mode active |


## Objective Schema

```json
{
  "id": "unique-uuid",
  "objective": "Describe the mechanism of X...",
  "status": "untested | inprogress | struggling | mastered",
  "linkedLecId": "lecture-id",
  "sourceBlock": "block-id",
  "starred": true,
  "consecutiveCorrect": 0,
  "srsNextReview": "2026-04-20",
  "bloomsLevel": 2,
  "confidence": 0,
  "personalNotes": ""
}
```

- `starred` = professor-designated mastery requirement (from Module Objectives doc)
- `consecutiveCorrect >= 4` = mastered (`DRILL_MASTERY_CONSECUTIVE_THRESHOLD`)
- `srsNextReview` = ISO date string set after each answer


## Key Files

| File | Role |
|------|------|
| `src/App.jsx` | Monolithic core — all views, drill engine, MCQ gen, state (~35K lines) |
| `src/supabase.js` | Cloud sync, auth, push/pull, mcq_bank sync |
| `src/aiClient.js` | `callAI()`, `callAIJSON()` — Gemini/Claude API |
| `src/difficultyEngine.js` | Score-gated tier advancement |
| `src/examParser.js` | PDF format detection, text extraction |
| `src/mistralOCR.js` | Mistral OCR wrapper for PDF processing |
| `src/aiPromptSnippets.js` | System prompt constants |
| `src/DeepLearn.jsx` | Deep Learn session phases |
| `src/QuickCapturePanel.jsx` | Quick Capture floating panel |
| `src/Tracker.jsx` | Study tracker + SRS coach |
| `src/LearningModel.jsx` | Learn tab |
| `src/HistoStudy.jsx` | Histology image drilling |
| `src/bloomsTaxonomy.js` | Bloom's levels, colors |
| `src/deepLearnPhaseUtils.js` | Phase management utilities |
| `supabase/migrations/` | RLS policy SQL |


## Drill Engine

### Queue Construction
- `buildDrillQueue(blockId, filter, lecFilter)` builds ordered objective list
- Filters: `struggling` / `weak_untested` / `untested` / `srs_due` / `all`
- `all`: not-mastered objectives first, mastered hard-partitioned to back
- Selecting "struggling" or "untested" filter → auto-selects matching lectures in setup UI

### Adaptive Difficulty (`difficultyEngine.js`)
```
Score < 60%  → foundational
Score 60–74% → developing  
Score 75–87% → advanced
Score ≥ 88%  → exam-ready
```
Capped by session count (can't jump more than 1 tier per session). Panic Mode forces exam tier.

### Session Mechanics
- **Wrong-answer re-queue:** incorrect objectives inserted ~6 positions ahead, once per session (`sessionReQueuedRef`)
- **Locked counter:** `drillOriginalQueueSizeRef` set at session start — denominator never grows. Re-queues show as `+N retry` badge
- **SRS intervals:** [1,1,3,7,14,30] days by `consecutiveCorrect` count
- **Valid stem check:** `hasValidStem()` — rejects fragments < 20 chars or missing question word/`?`
- **`advanceDrillRef`** — ref pattern used to break temporal dead zone in early callbacks

### Drill Modes
| Mode | Description |
|------|-------------|
| Flashcard | Self-assess, flip card |
| MCQ | AI generates 1 question per objective |
| Exam Block | Timed, silent, full review at end |
| Panic Mode | Starred objectives only, forced exam tier |


## MCQ Generation Pipeline

### Flow
1. Session start → `scheduleMcqPrefetchForQueue()` prefetches queue[1] and queue[2]
2. `prefetchMCQ(obj)` → checks `rxt-mcq-bank` localStorage → if found: instant load, no AI call → else: calls AI, saves result
3. `generateDrillMCQ(obj)` → checks in-session prefetch cache → checks `rxt-mcq-bank` → else: calls AI live
4. After any successful generation → `saveMcqBankEntry(userId, objId, round, data)` → writes localStorage + Supabase `mcq_bank`

### Prompt Construction (`buildMCQPrompts` in App.jsx)
- Lecture markdown (up to 5000 chars)
- All lecture objectives with IDs
- Bloom level (L1/L2/L3) + question round angle (round 1=recall, 2=application, 3+=clinical)
- Difficulty tier instruction
- Starred objective flag (⭐ exam-critical — write high-yield, teach with distractors)
- **Style injection:** 2 uploaded block questions matching current lecture topic → pushes style toward USMLE Step 1 clinical vignette format (Madcow questions = benchmark)
- Panic Mode → forces exam tier

### AI Response Fields (JSON)
```json
{
  "stem": "...",
  "style": "vignette",
  "objectiveIndices": [3],
  "options": [{"letter":"A","text":"...","isCorrect":false,"whyWrong":"..."}],
  "explanation": "...",
  "teachingPoint": "...",
  "imagePrompt": "left ventricular pressure-volume loop",
  "visualSearchQuery": "left ventricular pressure volume loop diagram labeled",
  "imagePage": null,
  "objectiveId": "..."
}
```
**Important:** `normalizeDrillMcqFromParsed()` must explicitly extract `visualSearchQuery` — it does NOT auto-forward unknown fields.

### Image Pipeline
- `WikimediaImagePanel` fetches Wikimedia Commons API using `visualSearchQuery`
- Images shown **blurred** during question → **auto-reveal** on answer
- Manual "🔍 Reveal to assist" button available before answering
- Lecture slide images (uploaded PDFs) take priority over Wikimedia

### Persistent MCQ Bank (`mcq_bank`)
- localStorage: `rxt-mcq-bank` → `{ "objId_r0": {...questionData} }`
- Supabase: `mcq_bank` table (RLS enforced, batched push in groups of 100)
- Pull on sign-in: `pullMcqBankFromSupabase()` → populates localStorage
- Individual write: `saveMcqBankEntry()` fires immediately after each generation
- Grows permanently — every drill session makes future sessions faster


## Views & Navigation

| View | Description |
|------|-------------|
| `block` | Main block dashboard — lecture cards, tabs, drill setup |
| `overview` | All terms/blocks grid |
| `learn` | LearningModel component |
| `deeplearn` | Deep Learn session |
| `tracker` | Study tracker |
| `analytics` | Analytics |
| `config` | Settings |

### Block View Tabs
- **Lectures** — Cards grouped by week. **Search bar** filters cards + NEEDS ATTENTION in real time by lecture title or objective text
- **Heatmap** — Visual performance heatmap
- **AI Analysis** — Block-level AI insights
- **Objectives** — Full objective list with status
- **Weak Spots** — Weakness heatmap with **topic search** → surfaces matching lectures + objectives → **Drill →** per objective or "Drill all matching →"
- **Exams** — Exam results log


## Quick Capture Panel (`QuickCapturePanel.jsx`)

- Floating ✏️ button → captures notes tagged: lookup / confused / important / connection
- Stored fields: `text, tag, lectureName, lectureId, blockId, resolved, resolvedLines[]`
- **Multi-line notes:** per-line checkboxes — check off individual items, auto-resolves when all done
- **Single-line notes:** circular ✓ button marks whole note done
- **Lecture link:** clicking lecture name navigates to that lecture's Deep Learn view (`onGoToLecture` prop)
- Persists to `rxt-quick-notes` in localStorage


## Uploaded Block Questions (`rxt-question-banks`)

```json
{ "filename.pdf": [{ "stem": "...", "choices": {"A":"...","B":"...","C":"...","D":"..."}, "correct": "B", "explanation": "...", "type": "...", "difficulty": "..." }] }
```
- Madcow questions = the USMLE-style benchmark for style injection
- These are fed as 2-question examples into MCQ prompt when they match current lecture topic


## Known Gotchas

- **`filteredBlockLecs` scoping** — defined inside one IIFE, cannot be referenced from a sibling IIFE. Define search filter before `buildWeekGroups` call, use separate `filteredLecs` variable in other IIFEs.
- **`normalizeDrillMcqFromParsed`** must explicitly extract every field — does not forward unknown JSON keys.
- **`advanceDrill` TDZ** — early callbacks must use `advanceDrillRef.current?.()` not `advanceDrill()` directly.
- **Large writes** — `rxt-block-objectives` logs "Large write: 3.27MB" for CPR 1 — this is normal.
- **AI is stateless** — the AI doesn't learn from answers. Adaptation is simulated via weak concept tracking + style injection.


## Current Status

> **Last updated:** 2026-04-14
> **Status:** Active development — CPR 1 exam in 1 day.

### What's live
- Full adaptive drill engine with SRS, wrong-answer re-queue, locked queue counter
- Score-gated difficulty tiers (foundational → exam-ready)
- Persistent MCQ question bank (Supabase `mcq_bank` + localStorage cache)
- USMLE-style question generation with Madcow style injection
- Wikimedia image auto-fetch with occlusion/reveal
- Weak spot search (Weak Spots tab + Lectures tab search bar + drill setup filter)
- Quick Capture with per-line checkboxes and lecture navigation
- Full Supabase sync (all 8 tables, networkDown protection)

### Changelog (recent)

| Date | Change |
|------|--------|
| 2026-04-14 | Fixed `filteredBlockLecs` scoping — ReferenceError on Lectures tab |
| 2026-04-14 | Fixed `visualSearchQuery` not extracted in `normalizeDrillMcqFromParsed` — images now load |
| 2026-04-14 | Search bar on Lectures tab — filters cards + NEEDS ATTENTION in real time |
| 2026-04-14 | `mcq_bank` Supabase table created + wired into push/pull cycle |
| 2026-04-14 | Style injection — Madcow questions fed as examples into MCQ prompt |
| 2026-04-14 | Weak Spots tab topic search with per-objective Drill → buttons |
| 2026-04-14 | Quick Capture: per-line checkboxes + clickable lecture link |
| 2026-04-13 | Wrong-answer re-queue, SRS scheduling, Panic Mode, Exam Block Mode |
| 2026-04-13 | Locked queue counter (`drillOriginalQueueSizeRef`) + +N retry badge |
| 2026-04-13 | `hasValidStem` validator — rejects fragment questions |
| 2026-04-13 | `WikimediaImagePanel` — occluded images with auto-reveal |
| 2026-04-13 | Supabase `networkDown` flag — aborts push after first failed fetch |
| 2026-04-13 | Score-gated difficulty tiers in `difficultyEngine.js` |
| 2026-04-13 | `advanceDrillRef` pattern — fixes TDZ error in early callbacks |
| 2026-04-13 | Drill summary score fix (was showing 0% — now uses totalCorrect/totalAnswered) |
