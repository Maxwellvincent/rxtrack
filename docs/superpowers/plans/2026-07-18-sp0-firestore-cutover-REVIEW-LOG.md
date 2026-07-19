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

## Round 2 — Codex

VERDICT: REVISE. 15 findings (fine-grained, converging). Key: (1) rules snippet still broad; (2) `request.resource.size()` is NOT a byte check — map-key count; (3) Task 5/6 snippets still use raw ids/addDoc/writeBatch; (4) migration can't import encodeDocId from supabase.js (browser code); (5) migration writes raw block/lecture/kv ids; (6) image migration keeps Supabase path+uid, omits Firebase prefix; (7) removing @supabase breaks migration script; (8) `normalize()` Object.assign drops Firebase User getters; (9) persistentLocalCache no fallback; (10) aiComplete misses callAIWithImage/system-prompts/maxTokens/fallback/OCR; (11) AI callables require auth → pre-signin features fail; (12) any signed-in user can spend AI quota; (13) Vitest fetch-mock can't reach the emulator process; (14) empty indexes.json vs real query shapes; (15) mergeDoc doesn't return merged; (16) --resume can't match on regenerated updatedAt; (17) revert-branch rollback loses post-cutover writes.

### Claude's response
Accepted + fixed ALL 15: created pure `src/idCodec.js` (4,5); dropped the invalid rules size() and moved size-guard app-side + Firestore hard-limit surfacing (1,2); encodeDocId/commitInChunks in every Task 5/6 snippet (3); image migration path rewritten to `question-images/{FB_UID}/…` (6); @supabase → devDependencies, kept for migration (7); explicit plain-object `normalize()` with bound getIdToken (8); persistentLocalCache + persistentMultipleTabManager + memory fallback (9); aiComplete covers text/json/image/system/maxTokens/provider-fallback (10); auth + UID allowlist on callables (11,12); handlers unit-tested in-process with stubbed fetch (13); questionImages composite index + note (14); mergeDoc returns merged (15); --resume via srcHash not updatedAt (16); two-window rollback + reverse export-to-supabase script (17). No rejections this round — all material.

## Round 3 — Codex

VERDICT: REVISE. 12 findings — all snippet/constraint consistency (converging): (1) Task 5 still raw ids/writeBatch; (2) Task 8 imports encodeDocId from supabase.js not idCodec; (3) Task 8 raw objectives/lectures/kv ids; (4) srcHash not in the .set() calls; (5) Task 9 test still asserts rules byte-denial; (6) rules still broad for recognitionItems/ungeneratedCards; (7) buildRecognitionBank no userId-vs-uid check; (8) aiComplete allowlist via process.env not v2 param; (9) Task 7 Step 5 loses system/images/maxTokens mapping; (10) commit file list omits DeepLearn/examParser/HistoStudy/LearningModel; (11) export-firestore-to-supabase referenced but no task; (12) image path raw filename.

### Claude's response
Fixed all 12: Task 5 Step 3 rewritten to explicit mergeDoc + encodeDocId + commitInChunks (1); Task 8 imports idCodec, encodes objectives/lectures/kv/mcq ids, adds srcHash+srcUpdatedAt to every doc (2,3,4); Task 9 byte test = adapter guard not rules-denial (5); rules rewritten to ENUMERATED collections (Firestore ORs rules, so recursive {document=**} would re-enable bank writes) with recognitionItems read-only server-only, ungeneratedCards/ankiCards client-writable (6); buildRecognitionBank rejects userId!==uid + shared assertAllowed (7); aiComplete allowlist via defineString param + deploy/emulator setup (8); Task 7 Step 5 explicit callAI/callAIJSON/callAIWithImage mapping (9); commit list includes all 5 direct-Gemini callers + zero-hit grep gate (10); added Task 10 concrete reverse-migration script with decodeDocId (11); encoded image filename in path (12). Also self-corrected the rules ORing subtlety Codex's fix implied. No rejections.

## Round 4 — Codex

VERDICT: REVISE. 6 findings (consistency/completeness, converging 12→6): (1) Task 6 still adds client `saveRecognitionItems` vs read-only rule; (2) Task 10 leaves lectures/kv/mcq/images as `// ...`; (3) recognition loop missing srcUpdatedAt; (4) image filename vs encoded basename ambiguity; (5) global rule bullet still says broad allow read,write; (6) Task 5 byte-guard "split/shard" undefined.

### Claude's response
Fixed all 6: removed client `saveRecognitionItems`, recognition writes only via buildRecognitionBank/Admin, `getRecognitionItems` read-only (1); Task 10 expanded to full concrete reverse code for lectures/kv/mcq/recognition/question_images incl. Storage reverse-copy (2); srcUpdatedAt added to recognition + image docs (3); store both `filename` + `storageFilename` (4); global constraint rewritten to "per-collection enumerated, recognitionItems server-write-only" (5); byte-guard = log + skip, no silent shard in SP0 (6). No rejections.

## Round 5 — Codex

**VERDICT: APPROVED.** "No remaining material blockers. The plan is now implementable: the security model is internally consistent, the auth/client API breakage is accounted for, dynamic IDs are encoded across primary paths, AI keys move server-side with an allowlist, migration is idempotent, and rollback has a concrete reverse path."

4 residual nits (fixed during this pass, non-blocking): Task 9 byte-guard wording → "logs/skips"; Task 2 removed unused `getFirestore` import; Task 10 recognition reverse-upsert uses table-specific conflict keys (`anki_cards`/`ungenerated_cards` = `user_id,card_id`); Task 8 >700 KB state doc → STOP before live migration + Louis-gated sharding follow-up (no silent shard).

**Converged: 5 rounds, ~40 findings resolved. Human gate #2 next.**
