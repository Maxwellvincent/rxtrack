# RXTrack

> **Living document.** This file describes what IS built. Any change to the
> stack, data model, Cloud Functions, screens, env vars, or roadmap status
> updates this file in the same commit as the code. If it disagrees with the
> tree, this file is the bug.
>
> Last verified against the tree: 2026-11-24

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
| AI | llm-bridge on `127.0.0.1:4319` first, then the `aiComplete` Cloud Function (Anthropic / Gemini, keys server-side) |
| OCR | local Marker server → Datalab (via `datalabConvert` function) → Mistral OCR |
| Tests | Vitest + jsdom; `@firebase/rules-unit-testing` for rules |

Supabase is **retired**. `src/supabase.js` keeps its old filename but is the
Firebase data layer (auth, push/pull, kv, exam sessions, storage). The
`supabase/` directory and `scripts/*supabase*` migration scripts are historical.

## Architecture

The original monolith (`App.jsx`, `Tracker.jsx`) has been fully removed by the
SP1 strangler work. Everything boots through one shell:

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
src/DeepLearn.jsx       remaining legacy component (~9.2k lines), mounted from More → Deep Learn
functions/index.js      Cloud Functions
```

### Screens

Top tabs (`src/shell/TabBar.jsx`):

| Tab | Feature dir | What |
|-----|-------------|------|
| Today | `features/today` | daily plan, block practice card, school alignment, exam sprint, readiness, model retrieval |
| Lectures | `features/lectures` | lecture workspace: pre-read, study flow, checkpoints, objective coverage/connections, figures, question bank upload |
| Objectives | `features/objectives` | objective tracker per block, PDF objective import, answer-history audit, quiz launch |
| Exam | `features/exam` | timed/tutor exam sessions, prepared question sets, results (school alignment panel, dashboards, weak areas, calibration, blueprint coverage) |
| Guide | `features/guide` | master study guide |
| More | `Shell.jsx` `MoreTab` | Deep Learn, calibration, weak concepts, struggle tasks (`features/tracker`), diagnostics/admin |

Other feature dirs: `features/cbse` (CBSE prep dashboard), `features/recognition`
(patient-recognition vignettes), `features/deeplearn` (container around
`DeepLearn.jsx`). Admin screens (`QuestionDiagnosticsAdmin`, `SourceUseAdmin`,
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
| `buildRecognitionBank` | builds patient-recognition vignettes |
| `datalabConvert` | Datalab OCR proxy (deployed only when `DEPLOY_DATALAB` is set) |
| `bridgeStruggleTaskToFocusHud` | pushes struggle tasks to the focus-hud project |

Secrets (`firebase functions:secrets:set`): `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `DATALAB_API_KEY`. Optional env: `ALLOWED_UIDS`,
`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `GEMINI_MODEL`, `DATALAB_URL`.

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

Other scripts: `benchmark:tutor`, `style:dataset`, `sync:struggle[:watch]`
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

| Item | Status |
|------|--------|
| SP1 — strangle monolith into shell ([PLAN.md](PLAN.md)) | **Done** for `App.jsx` / `Tracker.jsx` (deleted). `DeepLearn.jsx` still legacy. PLAN.md is historical reference. |
| Supabase → Firebase migration | **Done** |
| School alignment on exam results | **Done** (2026-11-24) |

## Other docs

- [`docs/`](docs/) — question pool, question-writing standard, preparation
  pipeline, mental-model retrieval, struggle-task bridge, focus-hud signal
- [`docs/study-protocol/`](docs/study-protocol/) — the flow-state study protocol the app implements
- [`docs/plans/`](docs/plans/) — dated design plans (historical once shipped)
- [`src/shell/features/README.md`](src/shell/features/README.md) — feature-dir import rules
