# RXTrack

> **Living document.** This file describes what IS built. Any change to the
> stack, data model, Cloud Functions, screens, env vars, or roadmap status
> updates this file in the same commit as the code. If it disagrees with the
> tree, this file is the bug.
>
> Last verified against the tree: 2026-11-26

RXTrack is a personal medical-school study app: lectures and their learning
objectives go in, and the app drives the study loop around them — pre-reads,
lecture study rounds, objective-linked question practice, timed exams,
miss tracking, calibration, and readiness reporting against school exams.

Deployed on Vercel (project `rxtrack`). Single user/owner; Google sign-in.

## Stack

| Layer | What |
|-------|------|
| UI | React 19, Vite 7, Tailwind 4, lucide-react |
| Backend | Firebase — Auth (Google), Firestore, Storage, Cloud Functions (Node 22) |
| AI — question prep | llm-bridge on `127.0.0.1:4319`: Ollama Cloud **DeepSeek** first → Codex fallback (never for exam launches) → local Ollama last. Never falls through to paid APIs. See [Question generation](#question-generation). |
| AI — other calls | llm-bridge first, then the `aiComplete` Cloud Function (Anthropic / Gemini, keys server-side) |
| OCR | local Marker server → Datalab (via `datalabConvert` function) → Mistral OCR |
| Tests | Vitest + jsdom; `@firebase/rules-unit-testing` for rules |

Supabase is **retired**; its migrations, edge function, migration scripts and client package
were removed, and the Firebase data layer formerly named `src/supabase.js` is now
`src/firebaseData.js` with `…Cloud` function names (2026-11-24).

## Architecture

The original monolith (`App.jsx`, `Tracker.jsx`, and later `DeepLearn.jsx`) has been fully
removed. Everything boots through one shell:

```
src/main.jsx            → lazy-loads src/shell/Shell.jsx (only entry point)
src/shell/              app chrome: Shell, Header, Sidebar, TabBar, admin screens, background jobs
src/shell/features/*    feature surfaces (may not import legacy top-level components — enforced by ESLint)
src/shell/hooks/        store-backed React hooks
src/shell/logic/        pure UI logic
src/engine/             pure study/question engine (mastery, calibration, question contracts,
                        objective mapping, school alignment, readiness, …) — unit-tested
src/stores/             one typed module per shared key: read() / write() / subscribe(),
                        local cache + Firestore sync (base.js, cloudBase.js)
functions/index.js      Cloud Functions
```

### Screens

Top tabs (`src/shell/TabBar.jsx`):

| Tab | Feature dir | What |
|-----|-------------|------|
| Today | `features/today` | one header line (date · exam countdown · day type), the planned week calendar (see Review spacing), then one card with tabs Today's plan (`TodayPlan.jsx`: today's calendar column as one queue with Start/Continue, reviews launched as 10-question quizzes on the lecture's weakest objectives, Skim for first passes that cannot fit; work ahead; day schedule) · Exam sprint (mixed timed exam link, school review, top-two sprint) · Progress (projected score `ProjectedScoreCard.jsx` / `projectedScore.js`: school-emphasis-weighted smoothed objective accuracy vs 80% with the five biggest gains; daily score, block practice, readiness) |
| Lectures | `features/tracker` + `features/lectures` | list view: one stats line + search, tabs Focus (urgency-ranked released lectures) · Library (status/type/week/sort dropdowns, week groups, bulk select); compact rows with progress, accuracy, weak/ready counts, question reviews ("2/4 reviews": days with ≥5 independent answers on the lecture, or one per objective for smaller lectures; target 4 spaced reviews, `lectureReviewDays.js`, also shown under the lecture title) and next review, Study/Quiz and a ⋯ menu (log study, date & details, rename, delete). Lecture workspace: pre-read, study flow; Practice tab is one card with a mastery-ladder status line and modes Quiz · Weak spots · Missed · Checkpoint (`PracticeModeTabs.jsx`), full ladder on the Progress tab; Learn tab is one card with modes Connections · Repairs (the Guide tab, guided tutor, mental-model, study-guide and lecture-facts views were removed, and lecture import no longer generates study guides or mental models; atoms are still extracted because quizzes use them); objective coverage/connections (incl. ✓/⚠ check that every slide objective code is uploaded, `objectiveCompleteness.js`), figures, question bank upload; a **School questions** line under the title ("N homework · N IMCQ · N ESoft" linked to this lecture from every bank in any block, `lectureSchoolQuestions.js`) with **Practice these N**, which starts an untimed practice set and opens it in the Exam tab; list rows show the same summary (✎) |
| Objectives | `features/objectives` | objective tracker per block: one stats line and one tab bar with counts (By lecture · Needs repair · No answer evidence · Developing · Mastered · Coverage · Reference sources); By lecture is a single searchable list sorted by priority (or next review, lecture order, objective count) with each lecture's exam-aware next review date and a Due-for-review filter; PDF objective import, re-extract all and the answer-history audit live under ⋯ Tools; quiz launch |
| Exam | `features/exam` | one stats line + a **+ New practice set** button + tabs Start (resume, **Start a practice set** card with Homework / IMCQ / ESoft / Full NB exam buttons that open the launch modal preset to that format, Mixed timed exam — `mixedExam.js`, keyed school questions from every lecture in the block, round-robin by lecture, shuffled, 20–80 at 72 s; Practice a topic, prepared sets, optional subject weighting) · High yield · Weak concepts · Missed questions · Results (80% goal validation, dashboards, school-style alignment) · Question banks (bank uploads + score-report upload); timed/tutor exam sessions, **Practice a topic** (`TopicPractice.jsx` / `topicFocus.js`: type e.g. "PICA vs AICA, medial medulla"; matches objectives, key facts and on-demand lecture text in the block, case-sensitive abbreviations, then launches a focused repair set that follows the mastery ladder), prepared question sets, results (high-yield ranking `HighYieldPanel` / `blockHighYield.js`, score-report upload, school alignment panel, dashboards, weak areas, calibration, blueprint coverage) |
| More | `Shell.jsx` `MoreTab` | one card with tabs Anki struggles (Struggle Tracker) · Admin (question diagnostics, allow-listed users only). Weak concepts live on the Exam tab and per lecture; the adaptive session, the calibration session and BlockHome were removed (saved calibration history is still read by readiness views) |

IMCQ / school key decks (question slide followed by the same slide with the answer marked): `examParser.groupPairedKeySlides` pairs them by number, by repeated slide text (unnumbered D&M decks) or behind a running header (MSK), strips objective text from choices, and numbers unnumbered items by position. The marked answer is read by the AI image reader (one retry); if any answer cannot be read, `assertPairedKeysRead` stops the import and names the questions instead of saving them unkeyed.

IMCQ deck + answer-explanation handout: uploading `NB+IMCQ+KEY_0N` (or `NB IMCQ N Practice Questions`) together with `NB IMCQ N Answer Explanations` makes one bank (`pairImcqExplanationFiles`, `mergeImcqKeyWithExplanations`): the deck keeps its original vignette, figures and choices; the handout supplies the written key (no AI image read for those items) and per-choice ✓/✗ notes as `whyWrong`; a deck slide the parser misses is filled from the handout; mismatched choice sets stop the import. Figure credits and scattered figure labels are stripped from choices.

Importing: the ⋯ menu's **Add lectures** (`BulkImportModal.jsx`) takes files or a folder, one lecture per file, filling scheduled rows; its "Combine them" link opens `AddLectureModal.jsx` for several files that make one lecture (also used by re-extract). **Question banks** (`QuestionBankModal.jsx`) is one type picker (ExamSoft/exam · IMCQ · Homework · Clickers), one files/folder chooser (image-only selections import as clickers; stray images in document folders are skipped), Options (wrong-only, AI cleanup, hold out for testing) and the uploaded-bank list with confirm-before-delete.

Missed questions can be marked learned (`MissedQuestions.jsx` → `rxt-dismissed-misses-v1`, `stores/dismissedMisses.js`): they leave the redo queue, accuracy history is unchanged, and a newer miss brings the question back.

CBSE question banks: the ⋯ menu's Question banks item and the CBSE Prep page's "Upload CBSE question banks" link open the bank uploader filed under the `cbse-prep` block, defaulting to the supplemental source kind. `buildCbsePool` pools them with every block's school banks, while high-yield school emphasis ignores them. The CBSE page opens with **Today's set** (40 questions across all terms, weak areas and missed questions first, timed). After a block's exam day passes, the shell no longer restores that block on load and opens the next upcoming exam (NB 3 → CBSE Prep); a block picked during the session stays. CBSE practice filters by source (`cbseSourceGroup`: All banks, ESoft + IMCQ, ESoft quizzes, IMCQs, Weekly practice / homework, NBME / USMLE samples — ESoft is recognized by filename even when filed as "school") and by term, with per-option counts.

**Score reports:** ExamSoft "Strengths and Improvement Opportunities" PDFs (ESoft quiz
or NB main exam) are uploaded from CBSE Prep or Exam → Results (`ScoreReportUpload.jsx`,
`scoreReportImport.js`). The overall score goes to `rxt-school-results`; categories
below the class average — or, for NB reports that have no average, below the 80%
goal on ≥3 questions — become exam-report weak concepts that weight exam allocation
and CBSE "weak" practice.

Other feature dir: `features/cbse` (CBSE prep dashboard). Deep Learn and Patient Recognition
were removed on 2026-11-24 (unused since July; their Firestore data was left in place). Admin screens (`QuestionDiagnosticsAdmin`, `SourceUseAdmin`,
`SourceRelationshipsAdmin`, `ObjectiveIntegrityAdmin`) are gated by
`VITE_RXTRACK_ADMIN_UIDS`.

### Data model (Firestore)

Per user, under `users/{uid}/`:

- `state/{terms,completion,performance}` — core study state documents
- `kv/{key}` — one doc per synced store key (see `src/stores/index.js`)
- `objectives/{blockId}` — block objectives
- exam sessions, generated questions, learner evidence, MCQ bank, images —
  sharded docs owned by their `src/stores/*` module

`rxt-lec-meta` (lecture metadata cache) still lives in localStorage. Rules:
`firestore.rules`, `storage.rules`; indexes: `firestore.indexes.json`. Storage
bucket CORS: `storage.cors.json`.

### Cloud Functions (`functions/index.js`)

| Function | Purpose |
|----------|---------|
| `aiComplete` | server-side AI gateway (Anthropic / Gemini), uid allow-list |
| `buildRecognitionBank` | builds recognition items from Anki cards (used by Anki sync) |
| `datalabConvert` | Datalab OCR proxy (deployed only when `DEPLOY_DATALAB` is set) |
| `bridgeStruggleTaskToFocusHud` | pushes struggle tasks to the focus-hud project |

Secrets (`firebase functions:secrets:set`): `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `DATALAB_API_KEY`. Optional env: `ALLOWED_UIDS`,
`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `GEMINI_MODEL`, `DATALAB_URL`.

## Question generation

Objective ownership: on strict reviews the reviewer names the source objective a draft actually tests. If that is another objective in the same quiz, the draft is re-filed there (`refileToReviewedObjective`, `refiledFromObjectiveId`) instead of being rejected; only an owner outside the quiz is still `objective_mismatch`.

Answer reveal (lecture quizzes, practice and exam review): each choice's reasoning shows directly under that choice (`choiceNotes` / `ChoiceNote` in `ui/QuestionExplanation.jsx`) — "✓ Why this is right", "✕ Why your answer is wrong", or "Why not" — and the block below the choices keeps only the general explanation. Distractors named in a source rationale get that sentence; an "Explain the other choices" button (`ui/ExplainOtherChoices.jsx`) asks the AI for one-line "why not" notes for the rest, labelled (AI) and cached per question on the device. Lecture quizzes show "Seen before: N× ✓ ✕ …" from the evidence journal; original school questions are keyed by their stem (`engine/questionHistory.js`), and the quiz fill-in skips school questions already answered.

Answer-choice terminology (`QUESTION_CHOICE_CONTRACT` in `engine/questionContract.js`): the keyed answer and its comparable distractors use the term the lecture uses most often for a concept, not a once-mentioned synonym, so difficulty comes from reasoning rather than unfamiliar wording.

Core: `src/engine/mcq.js` (prompt assembly, review, repair). Routing:
`src/questionPreparation.js`. Exam sets: `src/shell/features/exam/generation.js`
+ `launchExam.js`. Lecture quizzes: `src/shell/features/objectives/quizLaunch.js`.

**Inputs, in priority order**

1. **Objectives** set scope; **lecture excerpts** establish factual truth.
2. **School questions** (uploaded banks, classified by `exemplarSourceTier`:
   `examsoft`, `imcq`, `homework`, `clicker`, `school`) set wording and
   difficulty. Keyed, trusted ones are also factual evidence. Reserved banks
   (`sourceUse`) are kept out of generation for honest timed assessments.
3. **Step 1 editorial standard** (`step1WritingStandard.js`) improves clarity
   and distractors but never overrides school difficulty.

**How school style is applied**

- `buildSchoolTemplatePlan` assigns each objective its best concept-matching
  school question as a template (rank: ExamSoft → school → homework → IMCQ →
  clicker) plus up to one supporting example per other source kind. The writer
  must record `templateId`, `retainedPattern` and `changedRelationship`.
- `styleProfilePrompt` adds aggregate stem length, sentence count, option-count
  distribution and lead-in/task-ending mix from the persisted style profile
  (`rxt-question-style-profile-v1`). ExamSoft, IMCQ and unlabelled school items
  are pooled into one `officialStyle`; homework and clicker are profiled
  separately.
- Which school examples a prompt shows (`selectStyleExemplars`, `mcq.js`):
  objective-linked items first (school code 100, stored link 50, word overlap ≤ 20),
  then items linked to the lecture being written for (+15; target lectures come
  from `targets.lectureIds` or the objectives' `linkedLecId`), then the rest of the
  block's bank for variety. Block scoping (`selectClinicalExamplesForBlock`) keeps
  items filed in the block plus items whose bank linking found it was taught there
  (`linkedBlockId` from `mappingProgress.scope.homeBlockId`), so CBSE-filed IMCQs
  that taught NB 3 are NB 3 examples.
- `SCHOOL_DIFFICULTY_CONTRACT` (default policy `school`) matches the inferential
  burden of relevant school examples; IMCQs are a task pattern, not a difficulty
  floor. Excess inference is rejected as `school_style_mismatch`. The
  `challenge` policy or an assigned `targetOrder` can require more depth.
- `withSchoolEmphasis` (`schoolEmphasis.js`) counts uploaded school questions tied
  to each objective by exact school code or stored link. Within the same learner
  status, more-tested objectives get questions first (lecture quizzes and exam
  practice). Word overlap never counts as emphasis.
- `QUESTION_CHOICE_CONTRACT` (every generation path) follows the template's option
  count (A–H and beyond) and writes full laterality/modality/region grids when the
  matching school item uses one; the five-letter JSON examples are shape only.
- `schoolStyleSimilarity` scores each saved exam question's format fit
  (length, sentences, options, clinical/data, ending). It is displayed only; it
  does not gate acceptance.

**Lecture evidence:** the writer, the independent reviewer and the key-blind solve receive the
whole lecture (slide pages separated by `\f`, objective-inventory slides dropped) up to
`COMPLETE_LECTURE_BUDGET` = 60,000 characters (`schoolAlignment.js`); above that they fall back
to per-objective retrieval (~2,800 characters per objective). Lecture quizzes and exam practice
both load page-delimited text, and exam practice fetches the lecture text even when
extracted facts already exist.

**Mastery ladder** (`masteryLadder.js`): each objective climbs Recall → Application (2 in a
row) → Discrimination (2 look-alike items, one confident) → Integration (two-step or cross-lecture)
→ Mastered (a correct retest on a later day: 1 day apart within a week of the exam, else 2).
Only independent answers with verified reasoning depth count; a miss drops one rung and the next
item is a repair variant; a correct answer with confidence < 3 counts half. `withLadderTargets`
points lecture quizzes and exam practice at each objective's next step (raising, never lowering,
other depth targets) and `ladderStepPrompt` tells the writer how to build that step. Shown per
objective in the lecture workspace (`MasteryLadderPanel`) and as school-weighted readiness on the
Exam high-yield panel.

**Objective parts** (`objectiveParts.js`, store `rxt-objective-parts-v1:{lectureId}`): an
objective such as "Clinically differentiate the psychotic disorders" covers several lecture
elements that its wording does not name. Before a lecture quiz, `ensureObjectiveParts`
(`objectivePartsLoader.js`) asks the question route once per lecture to split each objective into
up to 8 parts, each kept only when its quote is supported by the lecture text (`quoteSupported`
tolerates interleaved slide columns), and maps already-answered questions to parts so past
practice keeps its credit. Quizzes steer the writer to untested parts first (`objectivePartsPrompt`)
and tag each accepted question with `objectivePartId`; answer events carry it. An objective is not
Mastered on the ladder, nor `ready` in the practice plan, until every part has one independent
correct answer. The lecture's ladder panel lists the parts with ✓ tested / ○ untested. The
inventory is rebuilt when the lecture text changes; parts stay stable while it does not (the source
version hashes the lecture's words, so chunk pages and joined exam text agree). The exam page
(`ExamContainer` via `useObjectivesWithParts`), the CBSE dashboard (`useLecturePartsInventory`), Today
(`buildScheduleContext` gets `parts` from `useToday`, so the plan, week calendar and lecture rows
see them) and the block readiness dashboard attach the stored parts to every block objective, so their readiness, high-yield ladder and the
objective chart ("Parts x/y") apply the same rule; exam generation (`generation.js`) builds a
lecture's inventory when it is missing, steers each lecture batch to untested parts and tags
accepted questions.

**Duplicate guard:** `toEntry` drops any objective an upload, import or re-extract is adding when
it repeats one the block already has (`isDuplicateObjective`: same wording allowing typos,
punctuation or truncation; same lecture or unlinked; never across distinct school codes or two
different lectures). Bulk and single lecture upload mark a lecture whose title already exists in
another block and skip it unless the learner explicitly includes it. The legacy merge-sync
(`pushAllLocalDataToCloud` / `pullAllDataFromCloud`) no longer union-merges terms, objectives or
lectures from the local shadow copy; the cloud is authoritative for them, which is what let deleted
blocks and objectives come back.

**Delete a block** (sidebar → "✕ Delete this block…", `DeleteBlockDialog.jsx` +
`shell/logic/deleteBlock.js`): shows how many lectures and objectives go (and how many objectives
have practice on record), downloads a JSON backup (lectures with their text, facts and images, plus
the objectives), and deletes only after the block name is typed. Lectures and objectives
(`blockObjectives.removeBlock`, base doc and shards) are removed first and the term entry last, so a
failure leaves the block in place to retry. Exam sessions and answer evidence are kept. Deleted lectures are tombstoned (`rxt-id-tombstones`;
`readLectureTombstoneIds` reads both the legacy `{ oldId }` records and the plain ids written now).

**Reasoning depth and connections**

- First/second/third order are internal labels. An independent review checks
  the shortest choice-visible route, a unique key and the closest alternative
  (`questionDiscrimination.js`); a separate key-blind solve is required for
  objective quizzes.
- Third-order items are built from two source-quoted rules joined through one
  hidden intermediate (`thirdOrderConstruction.js`), anchored on reviewed
  objective connections (`objectiveConnections.js`, `sourceRelationships.js`).
- **Cross-lecture items.** A share of a set is written with two lectures' text
  and an integration contract (rule 1 from the primary lecture, rule 2 from the
  partner, joined through a hidden intermediate). An item counts only if its
  reviewed quotes (reasoning audit / key-blind solve) include text unique to each
  lecture; otherwise the slot refills normally (`crossLecture.js`).
  - **Exam practice** picks a school format in the launch modal
    (`assessmentFormats.js`): *Homework* = one lecture, no cross items; *IMCQ* =
    one week, ~40% cross items, partner from the same week; *ESoft* = a 2–3 week
    span (`week-range:A:B` scope), ~50% cross items, partner from anywhere in the
    span; *Custom* = any scope, 25%.
  - **Launch modal** (`ExamLaunchModal.jsx`, "New practice set") is three steps:
    1 Practice like (Homework · IMCQ · ESoft · Full NB exam), 2 one picker for
    that format (lecture, newest first · week, current week first · from/through
    week · blueprint test; `schoolWeeks` uses stored week numbers, else groups
    lectures into Monday–Friday weeks by date and scopes them as `date-range`), 3 question count (10/20/40 chips or typed) and Practice vs
    Timed exam (untimed by default; Full NB exam defaults to timed, 72 s each). A
    summary line gives lectures, objectives and the cross-lecture share. Focus,
    difficulty, concept drill, include-answered, name and any other scope sit
    under **More options**, opened automatically when the modal is launched for a
    repair target. Start, Prepare for later and Start-with-saved share one payload.
  - **Lecture quizzes** add ~20% cross items once every objective of the lecture
    has had a first pass, pairing it with an earlier lecture of the same block
    (`lectureQuizPartner.js`). Targeted retests stay single-lecture.
  - **Partner choice** ranks candidates by school questions already linked to
    both lectures, then shared key terms (`atomTermIndex`, terms in more than six
    lectures ignored), then the partner's weak or untested objectives.
  - **Credit:** the writer names the partner objective its second rule comes from
    (`questionPlan.partnerObjectiveId`); if that id is one of the partner's real
    objectives the answer also counts for it and for the partner lecture, without
    touching the partner objective's parts. Ownership (allocation, parts, the
    key-blind solve) stays with the primary objective.

**Write my reasoning first** (`activeRecall.js`, `CoverOptions.jsx`): opt-in, off by
default. The **✎ Write my reasoning first: On/Off** switch sits above every question in
lecture quizzes, exam practice and timed exams (remembered per browser; *Turn off
reasoning first* under the box also turns it off). When on, the stem shows first and
the choices stay hidden until you type your answer and the linking reason in one
line, or press *Skip this time*. In practice, after the reveal your line sits beside
the question's own reasoning (plan link, deciding clue, partner lecture; school items
fall back to the explanation's first sentence) and you mark ✓ matched or ✕ missed.
In timed exams the timer keeps running while you write; your line shows under the
stem and again beside the question in the submitted review.
Nothing is graded by a model. Self-checks go to `selfCheckJournal` in learner
evidence and project per objective (`projectSelfChecks`).

**Linking uploaded school questions** (`semanticObjectiveMapping.js`, run from the
question-bank screen): two agreeing AI reviews on Ollama Cloud (DeepSeek first)
must cite an exact excerpt from the lecture and an objective linked to it. An
integrated IMCQ/ESoft item may link one objective in each of two lectures
(`secondaryLectureIds`, `curriculumMapping.crossLecture`), each quote from its
own lecture. Progress stores a fingerprint of the block's lectures and objectives;
if it changes, earlier unresolved questions are evaluated again on Resume.
You can also assign questions yourself (Exam → Banks → "Assign questions to
lectures", `QuestionBankManualLinks.jsx`): lecture plus up to two objectives is a
`user-confirmed` link; lecture only is `user-lecture-only` and automatic mapping may
then add objectives only inside that pinned lecture.
**Learning from your links** (`learnedLinks.js`): a homework section heading you have
consistently assigned to one lecture is learned for the block; unlinked questions under
that heading are pinned to it (`lectureLinkBasis: "learned-heading"`, no objective credit)
when you save a link and at the start of each mapping run. Automatic linking also sends
the reviewer up to 3 of your most similar objective-confirmed questions as
`learnerPrecedents` (hints only; the lecture quote is still required).
**Where a bank is linked** (`bankMappingScope.js`): each question's top lexical lecture
matches are soft votes (a verified or confirmed link counts double). The votes pick the
bank's home block: the filed block, unless another block in the same term clearly taught
it (≥ 3 votes, ≥ 25% of voters, ≥ 2× the filed block); banks filed under CBSE Prep link
to the block that taught them. They also pick focus weeks by format (`bankFormat`):
homework and IMCQ one school week (≥ 40% of votes), ESoft a 3-week window (≥ 55%).
School week = the lecture's week number, else its Monday–Friday week. Focus-week
lectures are offered to the reviewer first (`focusLectureIds`); every objective link
still needs the quoted two-pass review. After the AI pass, **week rescue**
(`weekRescueMatch`) links still-unlinked questions to a focus-week lecture when one
lecture's distinctive content clearly wins (score ≥ 60, ≥ 20 ahead and ≥ 1.6× the
runner-up): lecture only, `content-matched`, `lectureLinkBasis: "bank-week-content"`,
no objective credit. Exam → Question banks → **Re-link all banks**
(`RelinkQuestionBanks.jsx` / `relinkQuestionBanks.js`) runs this for every keyed bank one
at a time (a failure pauses that bank and moves on); each bank's status shows its home
block, focus weeks and week-rescued count, and its Resume/Recheck button uses the same path.

Pipeline details and live-run notes: [docs/question-preparation-pipeline.md](docs/question-preparation-pipeline.md),
[docs/question-writing-standard.md](docs/question-writing-standard.md),
[docs/quality/](docs/quality/).

## Review spacing

Lecture reviews are exam-aware (`src/engine/examSpacing.js`). With an exam date
set, the longest gap between reviews is about a third of the days left (7 days
out → every 1–2 days; 30 days out → up to 10), and the last review lands on the
day before the exam. This applies to activity logs (`completionLog.computeReviewDates`),
slides-and-notes model reviews (`modelRetrieval.gradeModel` / `selectDailyModels`,
which also pull older stored dates forward), and the lecture dashboard's
"next review" (`lectureReviewTiming`). Without an exam date the old fixed
1/3/7/14/30-day spacing still applies.

The Today tab opens with a Monday-first week calendar (`features/today/WeekCalendar.jsx`,
logic in `weekCalendar.js`). Past days list the lectures given that day with
first-pass status (✓ done · ◐ in progress · ○ not started). From today to the
day before the exam, `planStudyLoad` plans each day under a daily limit
(default 6 lectures, 4–8 selectable and stored per block as
`rxt-daily-limit:{blockId}`): first passes first, oldest first, at most half
the limit a day; then reviews (↻) ordered by need from `lectureReviewNeed`
(lower accuracy, struggling objectives and thin evidence rank higher).
Lectures with first pass done, ≥80% independent accuracy over enough answers
and nothing struggling get no reviews. Reviews may move two days earlier or one
later; one whose window passes with no room is dropped, lowest need first.
First passes that cannot fit are listed for skimming. Rows are one line (code,
short title, accuracy, origin day); ‹ › pages between weeks; Start opens the
day's first item.

## Environment variables (client)

Copy `.env.example` → `.env.local`.

| Var | Required | Use |
|-----|----------|-----|
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID` | yes | Firebase app config |
| `VITE_RXTRACK_ADMIN_UIDS` | no | comma-separated uids allowed into admin/diagnostics screens |
| `VITE_MISTRAL_API_KEY` | no | Mistral OCR fallback |
| `VITE_MARKER_LOCAL_URL` | no | local Marker OCR server |
| `VITE_DATALAB_URL`, `VITE_DATALAB_API_KEY` | no | direct Datalab OCR (dev) |
| `VITE_FOCUSHUD_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | no | focus-hud activity signals (separate Firebase project) |
| `VITE_FIREBASE_EMULATORS` | dev | `1` routes Auth/Firestore/Storage to local emulators |
| `VITE_DEV_USER_ID` | dev | skips sign-in in dev builds (no auth token — reads fail rules; prefer emulators) |

## Commands

```sh
npm run dev          # Vite dev server
npm test             # Vitest (all suites)
npm run lint
npm run build
npm run bridge:check # is llm-bridge reachable?
cd functions && npm test
```

Other scripts: `style:dataset`, `sync:struggle[:watch]`
(Anki Struggle Tracker sync), plus audits/benchmarks in `scripts/`.

## Driving the app against the emulators

`VITE_DEV_USER_ID` skips Google OAuth but has no auth token, so every Firestore
read is rejected by the rules and the app boots empty — useless for verifying UI
in a browser. Run against the local emulator suite instead:

```sh
firebase emulators:start --only auth,firestore
VITE_FIREBASE_EMULATORS=1 npm run dev
```

`VITE_FIREBASE_EMULATORS=1` routes Auth, Firestore and Storage to
127.0.0.1 (`src/firebase.js`), so a session never reads or writes the live
account. Seed fixtures straight into the emulator's REST API at the paths in
[Data model](#data-model-firestore).

## Roadmap status

Current direction: the [Learning Hub plan](docs/plans/2026-09-21-learning-hub-architecture.md)
(lecture → objective → mechanism → patient reasoning → retrieval → transfer →
spaced repair), driven in practice by exam readiness: NB Exam 2 toward an
80% per-test goal. The original SP0–SP3 roadmap
([med-teach-cycle design](docs/superpowers/specs/2026-07-18-med-teach-cycle-design.md))
is superseded.

| Area | Status |
|------|--------|
| Firebase backend (was SP0) | **Done** |
| Modular shell, monolith removed (was SP1, [PLAN.md](PLAN.md), historical) | **Done** (last legacy component, `DeepLearn.jsx`, removed 2026-11-24) |
| Source-grounded question prep: review, blind solve, discrimination, repair | **Done**, under continuous tuning (`docs/quality/question-baseline.md`) |
| School-style calibration (templates, style profile, difficulty contract) | **Done**; ExamSoft and IMCQ pooled into one style profile |
| Integrated exam tab: prepared sets, reserve refill, timed 72 s/question, tutor mode, persisted choice elimination | **Done** |
| Weak-concept repair loop, focused drills, delayed retests | **Done** |
| Objective connection maps + third-order construction (within a lecture) | **Done** (2026-11-23) |
| Objective parts: objectives that span several lecture elements are split into source-quoted parts; quizzes target untested parts and Mastered requires every part | **Done** (2026-11-26; lecture flow, exam page and CBSE dashboard) |
| Duplicate prevention: objective writes drop new copies, uploads flag lectures already in another block, legacy sync no longer resurrects deletions | **Done** (2026-11-26) |
| Delete a block from the sidebar, with a backup download and typed-name confirmation | **Done** (2026-11-26) |
| Requested quiz length is filled: objectives whose lecture cannot support a verified third-order or connection item fall back to reviewed second-order items after 2 depth rejections; refill continues while rounds still yield questions (bounded by the time budget and 3 empty rounds) | **Done** (2026-11-25) |
| Lecture checkpoints, school alignment on exam results | **Done** (2026-11-23/24) |
| Learned question links (headings + precedents), manual linking, score-report upload, high-yield panel | **Done** (2026-11-24) |
| Mastery ladder (per-objective rungs, discrimination step, delayed retest, readiness) | **Done** (2026-11-24); live behaviour still to be observed |
| NB Exam 2 scope + subject weighting, pre-test 80% validation | **Done**; live accuracy still being measured |
| Cross-lecture integration questions: exam practice by school format (Homework 0% / IMCQ 40% / ESoft 50% / Custom 25%), lecture quizzes 20% after the first pass, ranked partners, partner-objective credit | **Done** (2026-11-24, formats and lecture quizzes 2026-11-26); live yield not yet measured |
| Write my reasoning first (opt-in switch in quizzes and exams): commit an answer and reason before the choices show, then self-check ✓/✕ against the question's reasoning | **Done** (2026-11-26); self-checks recorded, not yet shown on dashboards |
| Capacity-planned Today (daily limit, need-ranked reviews, Today's plan queue, projected score, mixed timed exam, CBSE daily set) | **Done** (2026-11-25) |
| Shared access for another user | **Not started** (needs a rules/auth design) |

## Other docs

- [`docs/`](docs/) — question pool, question-writing standard, preparation
  pipeline, mental-model retrieval, struggle-task bridge, focus-hud signal
- [`docs/study-protocol/`](docs/study-protocol/) — the flow-state study protocol the app implements
- [`docs/plans/`](docs/plans/) — dated design plans (historical once shipped)
- [`src/shell/features/README.md`](src/shell/features/README.md) — feature-dir import rules
