# Struggle Tracker ↔ focus-hud bridge

> **Living document.** Cross-project Cloud Functions setup for mirroring
> `users/{uid}/struggleTasks` between rxtrack-med and focus-hud-lvm.
> Last verified against the tree: 2026-08-22

## Why two functions, not one

rxtrack-med and focus-hud-lvm are separate Firebase projects (separate
billing, separate uid spaces, separate everything). A Firestore-triggered
Cloud Function only fires for writes in its own project — there is no
built-in cross-project trigger. So each side gets its own function:

- `rxtrack/functions/struggleTaskBridge.js` (deployed to **rxtrack-med**) —
  mirrors task **content** (concept/subject/lecture/reason/state/etc, never
  `doneLocally`/`doneAt`) into focus-hud-lvm.
- `focus-hud/functions/index.js` (deployed to **focus-hud-lvm**) — mirrors
  **only** `doneLocally`/`doneAt` back into rxtrack-med.

Content and completion never touch the same fields in either direction, so
there's no last-writer-wins race, and each function guards against writing
when the destination already matches (comparing the relevant field subset
before every write) — that guard is what stops the two functions triggering
each other in an infinite loop.

## One-time setup

Each function needs its *own* runtime service account with Firestore access
on the *other* project — not the project's default compute SA, so a scope
change here can't silently affect anything else running in either project.

```bash
# 1. Create the two service accounts (one per project)
gcloud iam service-accounts create struggle-bridge \
  --project=rxtrack-med --display-name="Struggle Tracker bridge (writes to focus-hud-lvm)"

gcloud iam service-accounts create struggle-bridge \
  --project=focus-hud-lvm --display-name="Struggle Tracker bridge (writes to rxtrack-med)"

# 2. Cross-grant Firestore access — each SA gets datastore.user on the OTHER project only
gcloud projects add-iam-policy-binding focus-hud-lvm \
  --member="serviceAccount:struggle-bridge@rxtrack-med.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding rxtrack-med \
  --member="serviceAccount:struggle-bridge@focus-hud-lvm.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# 3. Deploy each function with its dedicated service account (already wired
#    into the `serviceAccount` option in both functions' onDocumentWritten config)
cd ~/projects/rxtrack && firebase deploy --only functions:bridgeStruggleTaskToFocusHud --project rxtrack-med
cd ~/projects/focus-hud && firebase deploy --only functions:bridgeStruggleTaskDoneToRxtrack --project focus-hud-lvm
```

Both projects also need `firestore.googleapis.com` and
`cloudfunctions.googleapis.com`/`run.googleapis.com` enabled — `firebase
deploy` prompts to enable anything missing on first deploy.

## Data flow, end to end

```
Anki (Struggle Tracker addon)
  → JSON export on disk
  → scripts/sync-struggle-tracker.mjs (rxtrack-med, admin SDK)
  → users/{uid}/struggleTasks/{cardId}                [rxtrack-med]
      ├─ RxTrack "Struggle Tracker" panel reads this directly
      └─ bridgeStruggleTaskToFocusHud (content only)
           → users/{uid}/struggleTasks/{cardId}        [focus-hud-lvm]
               ├─ focus-hud dashboard card reads this directly
               └─ bridgeStruggleTaskDoneToRxtrack (doneLocally/doneAt only)
                    → back to users/{uid}/struggleTasks/{cardId} [rxtrack-med]
```

Marking a task done in *either* app's UI ends up reflected in both, without
either app needing to be open at the time — the functions run server-side.

Clearing/fixing the underlying card only ever happens in Anki. Doing so drops
it from the next export, which deletes it from rxtrack-med, which the bridge
mirrors as a delete in focus-hud-lvm too.

## uid alignment

Both bridge functions assume the SAME uid path works in both projects for a
given person. That's true because `focusHudLink.js` in RxTrack already
establishes this: signing into a Firebase project with the same Google
account always yields the same uid for that project, project-instance, no
matter which app's code performed the sign-in. RxTrack's own uid in
rxtrack-med and its linked uid in focus-hud-lvm just happen to differ from
each other (two different projects) — but they're each stable and shared
between whichever app talks to that project.
