// scripts/export-firestore-to-supabase.mjs
//
// Reverse-migration escape hatch (SP0 Task 10) — the INVERSE of
// scripts/migrate-supabase-to-firestore.mjs (Task 8).
//
// Post-cutover rollback path: replays a Firebase user's data
// (users/{FB_UID}/**) back into Supabase tables for a given Supabase user.
// Uses the SAME decodeDocId (src/idCodec.js) that Task 8 used encodeDocId
// from, to recover the original Supabase source keys from Firestore doc ids.
//
// Env (never hardcode, never commit):
//   FB_UID           Source Firebase auth uid (data being exported FROM)
//   SB_UID           Destination Supabase auth user id (data being written TO)
//   SB_URL           Supabase project URL
//   SB_SERVICE_KEY   Supabase service-role key (write access to all tables)
//   (optional) GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin creds
//   (optional) FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 — read from the emulator
//              instead of live Firestore (dry-run)
//
// Flags:
//   --count    Print Firestore doc counts per collection for FB_UID. No writes.
//              Does not require Supabase creds (SB_URL/SB_SERVICE_KEY/SB_UID
//              are optional in this mode — Firestore is the only thing read).
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FB_UID=<uid> node scripts/export-firestore-to-supabase.mjs --count
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/export-firestore-to-supabase.mjs   (dry-run into a real/staging Supabase project)
//   node scripts/export-firestore-to-supabase.mjs   (live export)
//
// See task-10-report.md for the full ordered runbook.

import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";
import { decodeDocId } from "../src/idCodec.js"; // pure module — safe in node (same as Task 8's encodeDocId import)

const args = process.argv.slice(2);
const FLAG_COUNT = args.includes("--count");

const AUDIT_ONLY = FLAG_COUNT; // dry-run: Firestore reads only, no Supabase writes
const NEEDS_SUPABASE = !AUDIT_ONLY;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// Firestore is always the source in this script — Admin creds are needed
// even for --count.
const FB_UID = requireEnv("FB_UID");
const SB_UID = NEEDS_SUPABASE ? requireEnv("SB_UID") : process.env.SB_UID || "";
const SB_URL = NEEDS_SUPABASE ? requireEnv("SB_URL") : process.env.SB_URL || "";
const SB_SERVICE_KEY = NEEDS_SUPABASE ? requireEnv("SB_SERVICE_KEY") : process.env.SB_SERVICE_KEY || "";

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const fdb = admin.firestore();

let sb = null;
if (NEEDS_SUPABASE) {
  sb = createClient(SB_URL, SB_SERVICE_KEY);
}

const STATE = ["terms", "performance", "completion", "weak_concepts", "tracker"];
// [Firestore collection, Supabase table, Supabase onConflict key]
// Table-specific conflict keys (R5 nit from Task 8 brief): anki_cards/ungenerated_cards
// key on card_id, recognition_items keys on id.
const RECOGNITION_TABLES = [
  ["ankiCards", "anki_cards", "user_id,card_id"],
  ["recognitionItems", "recognition_items", "user_id,id"],
  ["ungeneratedCards", "ungenerated_cards", "user_id,card_id"],
];

// ---------------------------------------------------------------------------
// --count : Firestore doc counts per collection for FB_UID. No writes, no Supabase.
// ---------------------------------------------------------------------------
async function fsCollectionCount(path) {
  const snap = await fdb.collection(path).count().get();
  return snap.data().count;
}

async function runCount() {
  console.log(`\n=== --count : Firestore doc counts for uid ${FB_UID} ===`);
  for (const name of STATE) {
    const snap = await fdb.doc(`users/${FB_UID}/state/${name}`).get();
    console.log(`  state/${name}: ${snap.exists ? 1 : 0}`);
  }
  const collections = [
    ["objectives", `users/${FB_UID}/objectives`],
    ["lectures", `users/${FB_UID}/lectures`],
    ["user_kv", `users/${FB_UID}/kv`],
    ["mcq_bank", `users/${FB_UID}/mcq`],
    ["question_images", `users/${FB_UID}/questionImages`],
    ...RECOGNITION_TABLES.map(([coll, table]) => [table, `users/${FB_UID}/${coll}`]),
  ];
  for (const [label, path] of collections) {
    const count = await fsCollectionCount(path);
    console.log(`  ${label}: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// Export — reads Firestore users/{FB_UID}/** and upserts back into Supabase
// for SB_UID, decoding doc ids back to their original source keys and
// stripping migration-only fields (srcHash, srcUpdatedAt, updatedAt).
// ---------------------------------------------------------------------------
let writeCount = 0;

async function runExport() {
  console.log(`\n=== Exporting Firestore uid ${FB_UID} -> Supabase user ${SB_UID} ===`);

  // state -> single-row tables (onConflict: user_id)
  for (const name of STATE) {
    const snap = await fdb.doc(`users/${FB_UID}/state/${name}`).get();
    if (!snap.exists) continue;
    const v = snap.data();
    const { error } = await sb
      .from(name)
      .upsert({ user_id: SB_UID, data: v.data, updated_at: new Date() }, { onConflict: "user_id" });
    if (error) console.error(`  state/${name}: ERROR ${error.message}`);
    else writeCount++;
  }

  // objectives — decode doc id -> block_id (onConflict: user_id,block_id)
  for (const d of (await fdb.collection(`users/${FB_UID}/objectives`).get()).docs) {
    const v = d.data();
    const blockId = decodeDocId(d.id);
    const { error } = await sb
      .from("objectives")
      .upsert({ user_id: SB_UID, block_id: blockId, data: v.data, updated_at: new Date() }, { onConflict: "user_id,block_id" });
    if (error) console.error(`  objectives/${d.id}: ERROR ${error.message}`);
    else writeCount++;
  }

  // lectures — decode doc id -> lecture_id (onConflict: user_id,lecture_id)
  for (const d of (await fdb.collection(`users/${FB_UID}/lectures`).get()).docs) {
    const v = d.data();
    const lectureId = decodeDocId(d.id);
    const { error } = await sb.from("lectures").upsert(
      {
        user_id: SB_UID,
        lecture_id: lectureId,
        block_id: v.blockId,
        term_id: v.termId,
        data: v.data,
        chunks: v.chunks || [],
        updated_at: new Date(),
      },
      { onConflict: "user_id,lecture_id" }
    );
    if (error) console.error(`  lectures/${d.id}: ERROR ${error.message}`);
    else writeCount++;
  }

  // user_kv — decode doc id -> key (onConflict: user_id,key)
  for (const d of (await fdb.collection(`users/${FB_UID}/kv`).get()).docs) {
    const v = d.data();
    const key = decodeDocId(d.id);
    const { error } = await sb
      .from("user_kv")
      .upsert({ user_id: SB_UID, key, data: v.data, updated_at: new Date() }, { onConflict: "user_id,key" });
    if (error) console.error(`  kv/${d.id}: ERROR ${error.message}`);
    else writeCount++;
  }

  // mcq_bank — doc id = `${encodeDocId(objectiveId)}__r${round}`, split on the
  // LAST "__r" (encoded objective ids can't reintroduce "__r" after encodeURIComponent
  // since "_" is never percent-encoded, but splitting on the last occurrence is the
  // safe direction regardless) then decode the objective-id half.
  // (onConflict: user_id,objective_id,round)
  for (const d of (await fdb.collection(`users/${FB_UID}/mcq`).get()).docs) {
    const v = d.data();
    const idx = d.id.lastIndexOf("__r");
    const objectiveId = idx >= 0 ? decodeDocId(d.id.slice(0, idx)) : v.objectiveId;
    const round = idx >= 0 ? parseInt(d.id.slice(idx + 3), 10) || 0 : v.round ?? 0;
    const { error } = await sb.from("mcq_bank").upsert(
      { user_id: SB_UID, objective_id: objectiveId, round, data: v.data, updated_at: new Date() },
      { onConflict: "user_id,objective_id,round" }
    );
    if (error) console.error(`  mcq/${d.id}: ERROR ${error.message}`);
    else writeCount++;
  }

  // recognition tables — anki_cards/recognition_items/ungenerated_cards, each
  // with a table-specific onConflict key. Row data already carries the
  // original PK fields (id/card_id) from the Task 8 spread-write, but we
  // also decode the doc id as a fallback/cross-check for whichever PK field
  // that table uses, in case it's missing from the row payload.
  for (const [coll, table, conflict] of RECOGNITION_TABLES) {
    const pkField = conflict.endsWith(",id") ? "id" : "card_id";
    for (const d of (await fdb.collection(`users/${FB_UID}/${coll}`).get()).docs) {
      // eslint-disable-next-line no-unused-vars
      const { srcHash, srcUpdatedAt, updatedAt, ...row } = d.data();
      if (row[pkField] == null) row[pkField] = decodeDocId(d.id);
      const { error } = await sb.from(table).upsert({ ...row, user_id: SB_UID }, { onConflict: conflict });
      if (error) console.error(`  ${table}/${d.id}: ERROR ${error.message}`);
      else writeCount++;
    }
  }

  // question_images — reverse-copy the Storage object back to the Supabase
  // bucket, then upsert the meta row (onConflict: user_id,storage_path).
  for (const d of (await fdb.collection(`users/${FB_UID}/questionImages`).get()).docs) {
    const v = d.data();
    const [file] = await admin
      .storage()
      .bucket()
      .file(v.storagePath)
      .download()
      .catch(() => [null]);
    const sbPath = `${SB_UID}/${encodeURIComponent(v.objectiveId)}_r${v.round ?? 0}/${v.filename}`;
    if (file) {
      const { error: uploadError } = await sb.storage
        .from("question-images")
        .upload(sbPath, file, { contentType: v.mimeType || "image/jpeg", upsert: true });
      if (uploadError) console.error(`  questionImages/${d.id} (storage): ERROR ${uploadError.message}`);
    } else {
      console.error(`  questionImages/${d.id}: source Storage object missing at ${v.storagePath}, meta will still be written`);
    }
    const { error } = await sb.from("question_images").upsert(
      {
        user_id: SB_UID,
        objective_id: v.objectiveId,
        round: v.round ?? 0,
        storage_path: sbPath,
        filename: v.filename,
        mime_type: v.mimeType,
      },
      { onConflict: "user_id,storage_path" }
    );
    if (error) console.error(`  question_images/${d.id}: ERROR ${error.message}`);
    else writeCount++;
  }

  console.log(`reverse export complete (${writeCount} rows written)`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  if (FLAG_COUNT) {
    await runCount();
    return;
  }
  await runExport();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
