# Plan Review Log: SP0 Firestore Cutover

Started session 2026-07-18. MAX_ROUNDS=5. Codex CLI 0.142.5, CLI-default model, forced read-only.

## Round 1 — Codex

VERDICT: REVISE. Findings (full):

1. `supabase` client is exported and call-sites use `supabase.auth.getUser/getSession/onAuthStateChange`, `.from()`, `.functions.invoke()` directly — plan's "every signature preserved" is false without a facade or full call-site migration.
2. App is wired around `user.id`; Firebase uses `user.uid` — must normalize at adapter boundary.
3. `signInWithPopup` breaks mobile/popup-blockers; boot expects post-redirect `getSession()` — use redirect + `getRedirectResult` or both.
4. Boot/subscription still uses Supabase `{data:{subscription}}` shape — rewrite to `onAuthStateChanged` unsubscribe semantics; test initial/sign-in/reload/sign-out.
5. Client-side `VITE_GEMINI_API_KEY` unaddressed (App.jsx, aiClient.js, DeepLearn.jsx, examParser.js, HistoStudy.jsx, LearningModel.jsx) — move all AI behind auth'd functions or document the risk.
6. Firestore rules too broad (any shape/size under own tree) — add path/type/size validation; restrict server-generated collections to Admin.
7. Storage rules allow any type/size — enforce size + `image/*` contentType.
8. Offline-persistence claim not backed by code (`getFirestore()` only) — use `initializeFirestore({localCache: persistentLocalCache})` or drop claim.
9. Doc IDs unsafe (`/`, spaces, `__r`, long strings in block/lecture/objective/mcq/image) — need reversible `encodeDocId/decodeDocId`.
10. 1 MiB doc-limit risk for single-JSON stores (terms/performance/completion/tracker/lec-meta) — measure sizes; shard if needed.
11. Read-merge-write without transactions loses concurrent multi-device updates — use `runTransaction` or append-only per-record docs for sessions/completion/mcq/tracker.
12. `pullAll…` skips everything when `terms` absent — check each collection independently.
13. `pushMcqBankToSupabase` fire-and-forget undermines verify — await + surface errors.
14. Batch 500-limit / partial-failure not centralized — `commitInChunks(writes, 400)` + retries.
15. Migration not idempotent (`questionImages/{autoId}` duplicates on rerun) — deterministic ids + `--dry-run/--resume/--verify`.
16. Migration omits `anki_cards`, `recognition_items`, `ungenerated_cards`, RPCs, and Storage file copy — enumerate every table/RPC/bucket.
17. Cloud Function contract mismatch: `triggerBankBuild()` sends `{userId,blockId,perCard,batch,weakSubjects}` expects `{generated,processed,remaining,provider}` — preserve it, port server-side card selection, not `{cards}→{items}`.
18. Functions v2 config stale — use `defineSecret("GEMINI_API_KEY")` + `onCall({secrets:[...]})`, not `functions:config:set`; mock AI in tests.
19. Emulator tests too shallow — add `@firebase/rules-unit-testing` (cross-user denial), doc-id encoding, ~1 MiB payloads, batch chunking, popup/redirect boot, migration idempotency.
20. Simpler alternative: staged rollout (Firebase Auth first, dual-read/write persistence window, rollback criteria) vs one-shot.

### Claude's response
Accepting (material, acting): 1,2,3,4,5,8,9,12,13,14,15,16,17,18,19. These are correctness/contract/security gaps — revising the plan to fix each.
- 5 aligns with Louis's chosen Option A (all AI behind Cloud Functions) — expanding Task 7 from "port 1 fn" to "route all AI server-side + `defineSecret`".
- 17 is a real contract error I introduced — restoring the `triggerBankBuild` callable contract + server-side card selection via Admin SDK.
- 16 — adding anki_cards/recognition_items/ungenerated_cards + RPC equivalents + Storage copy to the migration, all with deterministic ids (15).

Accepting partially (scoping for a single-user desktop-first app, logged):
- 6 — adding Storage size/type (7) + immutable-owner + size caps on writes, but NOT exhaustive per-field schema validation in rules (over-engineering for one user).
- 10 — adding a pre-migration size-audit step + sharding ONLY the unbounded-growth stores (performance/completion activityLog) if they exceed ~700 KB; the rest stay single-doc.
- 11 — wrapping the state-doc merges in `runTransaction`; keeping append-only for sessions is noted as a follow-on, not SP0.
- 3 — popup PRIMARY (desktop-first personal app) with `signInWithRedirect`/`getRedirectResult` fallback + normalized boot.

Rejecting (with reason):
- 20 (dual-backend staged rollout) — explicitly rejected in the spec (Global Constraints: no dual-backend; single source of truth; Louis runs parallel agents). Mitigation kept: Supabase data left INTACT until live-verify passes = the rollback path (revert the branch, data still in Postgres). Adding explicit rollback criteria to Task 9.
