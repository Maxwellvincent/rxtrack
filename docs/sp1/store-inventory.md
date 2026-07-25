# SP1 · T0.1 — localStorage key inventory & store map

Audited 2026-07-25. Classifies every `rxt-*` key as **shared-data** (gets a
`src/stores/*` module, user-scoped, synced) or **local-preference** (plain
localStorage, per-device, not store-managed). The write/read site list is the
work order for **T0.3** (redirect every shared write through its store module).

## Shared-data keys WITH store modules (T0.2 — built)

| Key | Store module | Conflict policy |
|---|---|---|
| `rxt-terms` | `stores/terms.js` | union terms by id, union nested blocks by id, incoming scalars win |
| `rxt-lec-meta` | `stores/lectures.js` | cloud adds to local, local stubs preserved (active-term chunks only) |
| `rxt-block-objectives` | `stores/blockObjectives.js` | per-block merge of imported+extracted |
| `rxt-weak-concepts` | `stores/weakConcepts.js` | union by concept key |
| `rxt-performance` | `stores/performance.js` | merge sessions (dedup + score recompute) |
| `rxt-completion` | `stores/completion.js` | merge KV |
| `rxt-exam-dates` | `stores/examDates.js` | KV overwrite |
| `rxt-calibration-log` | `stores/calibration.js` | append log |

## Shared-data keys WITHOUT modules yet (add in T0.3 / as needed)

`rxt-tracker-v2`, `rxt-question-banks`, `rxt-mcq-bank`, `rxt-quick-notes`,
`rxt-weak-areas`, `rxt-dl-sessions`, `rxt-sessions`, `rxt-analyses`,
`rxt-reviewed-lecs`, `rxt-supplemental-resources`, `rxt-style-prefs`,
`rxt-question-notes`, `rxt-histo-bookmarks`, `rxt-histo-conf`, `rxt-histo-manual`.

## Local-preference keys (NOT store-managed)

`rxt-new-shell` (→ replaced by the T5.1 resolver), `rxt-shell-theme`,
`rxt-tracker-tab`, `rxt-click-hint-seen`.

## Write / delete sites → T0.3 redirect targets

Non-exhaustive grep of `setItem`/`removeItem`/`sSet`/`safeSetItem` on `rxt-*`
(App.jsx uses `safeSetItem`/`sSet` widely — **T0.3 must re-audit App.jsx
directly**; this list covers the clearer call sites):

- `src/supabase.js`: 364/460/480/491/498/505/512/519/571/597 — the pull/push
  hydration writes (terms, lec-meta, block-objectives, performance, completion,
  weak-concepts, tracker-v2, mcq-bank). **Highest priority** — these run every
  sync and must route through the store modules (already namespace-aware).
- `src/Tracker.jsx`: 4010/4340/4390/4480 (`sSet` completion/tracker-v2),
  4530/9291 (weak-areas), 8930 (quick-notes), 5505 (tracker-v2), 3937/3974
  (local prefs — leave).
- `src/weakConcepts.js`: 94/331 (weak-concepts).
- `src/shell/ScheduleImportModal.jsx`: 58/59/60 (terms/exam-dates/lec-meta) —
  **shell code, redirect first**.
- `src/shell/McqGenModal.jsx`: 20 (question-banks).
- `src/LearningModel.jsx`: 892/950 (question-banks).
- `src/DeepLearn.jsx`: 7713 (dl-sessions).
- `src/QuickCapturePanel.jsx`: 50 (quick-notes).
- `src/HistoStudy.jsx`: 1298–1399 (histo-* — treat as shared-data if histology
  ports; local for now).

## Reads to migrate (T0.5 audit)

Shared-key `localStorage.getItem`/`JSON.parse(localStorage...)` outside
`src/stores/*` must move to `read()`/hooks during each feature's port. `data.js`
readers and the many `App.jsx` inline parses are the bulk — audited per-port.
