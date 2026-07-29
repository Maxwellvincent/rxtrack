# Firestore-first read path

**Status:** proposed, not started
**Author:** drafted 2026-07-29
**Plan gate:** not yet cross-reviewed — Codex CLI is rate-limited until 2026-08-06. Run `/codex-review` on this document before Phase A starts.

## The question this answers

> Why isn't everything in Firestore, and grabbed asynchronously when needed?

It should be. It isn't for historical reasons, and the cost of that is now visible: a
~5MB localStorage budget that the lectures and objectives are outgrowing, plus a pile of
hand-written sync machinery that exists only because two copies of the truth have to be
reconciled.

## Where we actually are

Firestore is a **sync target**, not the read path. The app reads and writes localStorage
synchronously and pushes blobs up afterwards.

| | count |
|---|---|
| `localStorage` call sites in `App.jsx` | 170 reads, 59 writes |
| in `DeepLearn.jsx` | 11 reads, 6 writes |
| everywhere else combined | ~40 |
| store modules already funnelling shared keys (SP1 T0.3) | 16 |
| shell hooks over `useStoreResource` | 8 |

What that arrangement forces us to maintain:

- per-store merge functions (`mergeTerms`, `mergeCompletion`, `mergeKvValue`, …) to
  reconcile two full copies
- id tombstones, so a delete survives the next pull
- `overwriteObjectivesInCloud` — a special writer, because the normal push
  read-merge-writes and therefore can never shrink anything
- a 900KB per-document guard, because whole stores are written as single documents.
  `rxt-dl-sessions` silently exceeded it for months and never synced at all
- as of today, local caps and cloud-stub/hydrate paths for the MCQ bank, missed questions
  and DeepLearn sessions

Every one of those is a workaround for the mirror, not a feature.

**The thing that makes this worth doing now:** `firebase.js` already initialises Firestore
with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`. Firestore is
*already* keeping a full offline copy in IndexedDB — quota in the hundreds of MB, not 5MB —
and syncing it. The data is stored twice, and only the hand-rolled copy is starving.

## Target

Firestore is the source of truth. Its own IndexedDB cache is the offline story. localStorage
keeps only what is genuinely device-local.

```
                     ┌──────────────────────────────┐
  component ──uses──▶│ useLectures / useObjectives  │  (unchanged signatures)
                     └──────────────┬───────────────┘
                                    │  { data, loading, error, mutate }
                     ┌──────────────▼───────────────┐
                     │ useStoreResource             │  ← the single file that changes
                     └──────────────┬───────────────┘
                                    │ read / write / subscribe
                     ┌──────────────▼───────────────┐
                     │ store module (lectures.js…)  │  ← same interface, new backing
                     └──────────────┬───────────────┘
                                    │ onSnapshot / setDoc
                     ┌──────────────▼───────────────┐
                     │ Firestore + persistent cache │  ← offline, multi-tab, ~GB quota
                     └──────────────────────────────┘
```

**Why this is cheaper than it sounds:** `useStoreResource` already returns
`{ data, loading, error, mutate }` — `loading` is just hardcoded `false` today. Every shell
consumer already handles that shape. Swapping its internals from a synchronous
localStorage read to an `onSnapshot` subscription flips every shell surface at once
without touching the surfaces.

**Stays in localStorage** (device-local, small, no sync value): `rxt-shell-nav` (collapsed
terms), the shell flag `rxt-new-shell`, `rxt-panic-mode`, theme, and the upload cache hash.

## Phases

### Phase A — a Firestore-backed store, behind today's interface

1. `src/stores/cloudBase.js`: `read(userId)` from an in-memory cache hydrated by
   `onSnapshot`, `write(userId, value)` → `setDoc`, `subscribe(cb)` → snapshot listener.
   Same three-function shape `base.js` exposes now, so store modules keep their API.
2. `useStoreResource` gains real `loading` — `true` until the first snapshot lands.
   No consumer changes; they already destructure it.
3. Convert **one** store first: `examDates` (small, low blast radius, easy to eyeball).
   Ship it, use it for a day.

**Done when:** the shell reads exam dates with no localStorage involvement, works offline
(devtools offline mode), and survives a reload with no flash of empty state.

### Phase B — convert the rest of the shared stores

Order chosen by blast radius, smallest first:

`examDates` → `terms` → `assessments` → `calibration` → `performance` → `completion` →
`weakConcepts` → `lectures` → `blockObjectives`

`lectures` and `blockObjectives` last: they are the biggest, the most read, and the ones
whose sync bugs have bitten most.

Per store: convert, verify against live data, delete its merge function and any tombstone
handling it needed, then move on. One store per commit.

### Phase C — retire the mirror

1. Delete each converted key from `KV_KEYS` / the push loop.
2. Delete the local caps and stub/hydrate paths added on 2026-07-28 — `stores/capped.js`,
   `deepLearnSessions.js` — once their stores are cloud-backed and the reason for them is gone.
3. Delete `pushAllLocalDataToSupabase` / `pullAllDataFromSupabase` when the last caller goes.
4. Keep `overwriteObjectivesInCloud` only if something still needs an authoritative rewrite;
   with a single source of truth it should not.

### Phase D — App.jsx

Not a separate migration. App's surfaces are being deleted as T6.1 ports them to the shell,
and the shell surfaces are cloud-backed by Phase B. What remains in App (ingest queue,
Part A/B merge, collision resolver, objectives-PDF importer) either gets ported — inheriting
the new path — or keeps reading localStorage for keys nothing else uses, harmlessly.

**Explicitly not doing:** rewriting 229 synchronous call sites inside App.jsx in place. That
is the trap this plan exists to avoid.

## Risks

| risk | mitigation |
|---|---|
| A read that was synchronous now renders empty for a frame | `loading` is real; surfaces already handle it. Phase A on one small store proves the pattern before it spreads. |
| Offline behaviour regresses | Persistent cache is already enabled and serves reads offline. Verify explicitly with devtools offline on the Phase A store. |
| Read costs / quota | Snapshot listeners read once then serve from cache; a document changes rarely. Worth watching in the Firebase console after Phase B. |
| A conversion loses data | One store per commit, verified against the live account before the next. `firestore.rules` already scopes everything per uid. |
| Multi-tab divergence | `persistentMultipleTabManager` is already configured — this gets *better*, since two tabs stop holding independent localStorage copies. |

## Verification

Per store, before moving on:

1. Unit tests for the store module against the emulator (`firestoreAdapter.test.js` is the
   existing pattern).
2. Live check against the real account: counts before and after match.
3. Devtools offline: the surface still renders, a write queues, and it syncs on reconnect.
4. `localStorage` total drops by that store's size and does not come back after a reload.

## Rollback

Each store is one commit. `git revert` restores the localStorage path for that store, since
the store module's interface never changes. No data migration is destructive: Firestore
already holds a copy of everything before Phase A begins — with the single exception of
`rxt-dl-sessions`, which was only backed up on 2026-07-28 and is now per-document.

## Sequencing against everything else

Do this **after** the remaining three lecture folders are imported. The current setup has
~930KB of headroom; if an import runs out first, the cheap unblock is moving teaching maps
and `rxt-question-banks` out of localStorage (~850KB), which is a subset of Phase B and not
wasted work.
