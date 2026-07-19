# RXTrack × Flow-Study Cycle — Design Spec

**Date:** 2026-07-18
**Status:** Approved (grilling complete) — pending implementation plans per sub-project
**Author context:** Louis Maxwell, MD candidate, entering Term 2 of Year 1.
**Purpose:** Turn RXTrack from a set of separate study tools into the engine that *runs* Louis's merged Flow-Study protocol as a guided, per-lecture cycle — optimizing toward a measurable **≥80% average** on every block/system test and the term cumulative.

This spec is the map. Each sub-project (SP0–SP3) gets its own implementation plan → build → verify cycle.

---

## 1. Source protocols (merged)

Three study frameworks, same philosophy (active recall + spaced retrieval + clinical reasoning), merged into one 8-phase cycle:

- **A — Flow Study Protocol** (`D:\Uchiha Clan\03 Projects\Medical Journey\05 System\Flow Study Protocol.md` and `C:\Users\Itachi91\Projects\med-teach\reference\flow-study-protocol.html`). Motivation/flow framing: *"one lecture → one debug loop."* 5 phases (P0–P4), difficulty knob, banned flow-killers, Claude as in-the-loop agent.
- **B — Learning System Master Template** (Justin Sung), from the `Maxwellvincent/Medical-Journey` Obsidian vault (`Templates/(C) Learning System - Master Template.md`). 6 phases: Intake → Dump → Encode (Feynman) → Link & Test → Clinical Application → Spaced Retrieval. Time budgets + spaced schedule.
- **C — Tisdall CPC method** (Dr. Philip Tisdall, `youtube.com/@DrPhilipTisdall`). Chief Complaint → Differential → Pathophysiology → clinical reasoning. "Think like a doctor," symptom-first. Adopted as the **case format**, not a separate silo.

---

## 2. Goal & success metric (north star)

- **Structure:** Term → **Block (= system, has a dated test)** → Lecture. Term ends with a **cumulative exam** across all blocks.
- **Metric:** **≥80% average** on each block/system test and the cumulative — this term and every subsequent term.
- **Implication:** 80 is the line the whole app optimizes toward. The orchestrator schedules **backward** from each block's test date + the cumulative and **forward** from spaced retrieval, and triggers the difficulty knob / extra reps whenever a block's *predicted* score dips below 80.

---

## 3. Core model

- **Unit of one protocol run = one lecture.** Launched from the lecture node (RXTrack's spine is term→block→lecture; matches "one lecture → one debug loop"). Not per-block (too coarse for flow) or per-objective (too granular).
- At ~2 lectures/day, ~10/week, phases **interleave** — a fresh lecture is at phase 1-2 while older ones are due for phases 6-8. The daily orchestrator resolves *"what do I do right now?"*.

---

## 4. The 8-phase cycle

| # | Phase | Drives on | Status | Source |
|---|---|---|---|---|
| 1 | **Ingest** — OCR lecture, sync its Anki subdeck | completion | ✅ built (OCR chain, recognition bank) | A-P0 / B-Intake |
| 2 | **Encode / schema** — DeepLearn, Feynman | completion | ✅ built (DeepLearn) | B-Encode |
| 3 | **Objectives → binary tickets** — each objective a closeable question | completion | ✅ built; add lecture↔objective auto-tag | A-P1 |
| 4 | **Feedback engine** — recognition/cloze items | completion | ✅ built (recognition bank, edge fn) | A-P2 / B |
| 5 | **Debug/test loop** — adaptive engine, answer-before-reveal | completion | ✅ built (`src/engine/`, Teach/Recognize/Test) | A-P3 / B-Link&Test |
| 6 | **CPC cases** — chief-complaint → differential → pathophys | time | 🔨 **build** — new "Reason" engine mode | C / A-P3 / B-Clinical |
| 7 | **Teach-back** — explain from memory to AI-as-student | time | 🔨 **build** — gaps → SRS + Learner Model | A-P4 / B-Feynman |
| 8 | **Spaced retrieval** — SRS `[1,1,3,7,14,30]` | time | ✅ built (existing SRS engine) | A-P4 / B-Spaced |

- **Phases 1–5 are completion-gated** (linear encode sprint; can't advance until the phase's binary goal is met).
- **Phases 6–8 are time-driven** (retention track; resurfaced by the spaced clock + test proximity). Finishing phase 5 enrolls the lecture into the spaced queue.

**Difficulty knob** (from protocol A) is a first-class control: bored → integrate/harder/time-pressure; overwhelmed → shrink to one pathway, drop timer, more scaffold; numb → force blank-page recall. Auto-suggested from Learner Model signals, manually overridable.

---

## 5. Concepts & pool (resolves `newPool` stub)

- A lecture's **learnable concepts = its tagged objectives (+ matched Anki cards)** — **not** AI concept-extraction. Louis already curates objectives + decks; AI *generates practice*, never *defines what to learn*.
- This fixes the deferred `newPool=[]` stub: the engine's `newPool` = the current lecture's **unmastered** objective-concepts.

---

## 6. Practice-question sources (calibration)

Item sources for phase 5/6, ranked by trust:

1. **School practice questions** (imported) — highest trust; closest to the real test. Source of truth for the **80-line prediction**, real error patterns, and CPC-case seeds. Collection `practice_questions`, `source: school`, tagged to block/objective. Import via the existing OCR pipeline.
2. **AI recognition/CPC items** — generated, weak-area-weighted; fill coverage where school Qs are sparse.

Predicted block score is calibrated against school-Q performance first, AI-item performance second.

---

## 7. Learner Model (Tier 1)

First-class, **inspectable** Firestore document that grows over time (no black box for the MVP):

- **What lands:** framings/mnemonics kept vs rewritten, focus flags, confidence ratings.
- **Error patterns:** recurring miss types, from `performance` / `weak_concepts` / teach-back gaps.
- **Depth/pace prefs:** where the difficulty knob is hit, typical block length.

Every AI action reads it (card edits match voice, cases target error patterns, difficulty knob auto-tunes, phase 8 resurfaces weak chains). Misses + teach-back gaps write to it. **Tier 2** (AI-written natural-language learner summary injected into prompts) is a deferred follow-on once real signal accumulates.

---

## 8. Card personalization

- **AI-assisted, human-approved.** AI proposes rephrases, annotations, "why this matters to you" notes; Louis approves/tweaks.
- **Approved card-text edits push back to Anki** via AnkiConnect (explicit approve + diff preview; Anki-open is fine → one writer at a time, no conflict). Never silent.
- RXTrack keeps its own **understanding layer** (`card_annotations`) so the cycle works with Anki closed. One-way re-pull from Anki picks up edits made in Anki itself.

---

## 9. Teach-back (AI-as-student)

- Louis **types** an explanation of the objective/lecture from memory (no notes). Text for MVP; voice deferred.
- AI (existing `aiClient` → Gemini/Claude) plays a **confused student**: compares against the lecture's objectives + notes, asks 1–2 targeted follow-ups where thin, flags gaps/errors.
- Gaps **auto-enqueue as spaced-review items** (SRS) and **write to the Learner Model** (error patterns). Closes the loop: teach-back → tomorrow's cards → weak-area targeting.

---

## 10. Orchestrator (Tracker = "Today" queue)

- Extends the existing Tracker (schedule/coach/weak-areas) into the daily orchestrator.
- Interleaves phases across **all in-flight lectures** by: lecture age, spaced clock, and **test-date proximity** for each block.
- Surfaces a ranked "do this now" list and each block's **predicted score vs the 80 line**; below 80 → schedules extra reps / bumps difficulty knob.
- Needs real inputs: Term 2 schedule (block/system list + test dates + cumulative date), objectives + lectures per block.

---

## 11. Architecture & sequencing

### SP0 — Firestore full cutover (FIRST; gates everything)
- Supabase → **Firebase Auth + Firestore**. Full cutover, **not** dual-backend (monolith straddling two DBs = maintenance trap; Louis runs parallel agents → one source of truth).
- Rewrite `src/supabase.js` → **Firestore adapter keeping the same function signatures** (the ~13 external call-sites barely change; `supabase.js` has 21 internal sites, the choke-point).
- Port 15 auth call-sites to Firebase Auth (Google).
- Port the 1 edge function `generate-recognition-items` → **Cloud Function for Firebase**.
- **One-time data migration** of real Term 1 data (Postgres export → transform to Firestore docs → import).
- Firestore offline persistence **replaces** the hand-rolled `localStorage + 3s-debounce + networkDown` sync — simplification, not just a swap.
- **Verify live end-to-end** in the browser — closes the standing "never run in browser, only build-checked" gap.
- Tooling: Firebase MCP plugin + firebase skill available in this environment.

### SP1 — New modular shell → default
- Promote `src/shell/` (144-line `Shell.jsx`, split Header/Sidebar/BlockHome/data/fuzzy/status/useTheme, unit-tested) from behind `?shell=new` to **default**; drop the flag after live-verify.
- Port existing engines (Tracker, adaptive engine, recognition) into the new shell. **Strangle** `App.jsx` incrementally as the cycle grows.

### SP2 — Guided cycle + orchestrator + Learner Model
- Per-lecture guided flow over the (mostly built) phases 1-5 + phase 8; Today orchestrator; Learner Model Tier 1; school-question import.

### SP3 — Fill the gaps
- CPC cases ("Reason" mode) + AI teach-back.

**Term 2 line = through SP3 (full 8-phase cycle).**

---

## 12. New Firestore data (collections)

| Collection | Content |
|---|---|
| `learner_model` | Tier-1 inspectable fields (weak concepts, error patterns, focus flags, confidence, prefs) |
| `lesson_runs` | Per-lecture phase state: encode-phase 1-5 progress, retention schedule (next due dates) |
| `card_annotations` | Understanding layer over Anki cards (rephrase, why-this-matters, relevance/focus, confidence) |
| `case_items` | CPC cases (chief complaint → differential → pathophys → reasoning) |
| `practice_questions` | Imported school questions (`source: school`) + AI items, tagged block/objective |
| `learning_records` | Phase-4/7 outcomes (what stuck / what broke) — feeds spaced review |
| `block_tests` | Per-block test date + predicted/actual score (the 80-line tracking) |

(Existing data — terms, lectures, objectives, performance, completion, weak_concepts, tracker, mcq_bank, anki_cards, recognition_items — migrates from Supabase in SP0.)

---

## 13. Open inputs (from Louis, to make the orchestrator real)

- Term 2 **schedule**: block/system list, each block's test date, the cumulative exam date.
- **Objectives + lectures per block** — location / how they're delivered.
- **School practice questions** — format (PDF?) and location, for OCR import.
- Anki desktop open when a fresh deck pull is wanted (AnkiConnect on `localhost:8765`).

---

## 14. Explicitly deferred (not in Term 2 MVP)

- Learner Model **Tier 2** (AI-written NL summary) and **Tier 3** (self-rewriting).
- **Voice** teach-back.
- Image-card ingest (Proper Learning+).
- Weak-area **additive** generation (base weighting ships in the recognition bank).
