// scripts/migrate-supabase-to-firestore.mjs
//
// One-time Supabase → Firestore data migration (SP0 Task 8).
//
// Env (never hardcode, never commit):
//   SB_URL           Supabase project URL
//   SB_SERVICE_KEY   Supabase service-role key (read access to all tables)
//   SB_UID           Source Supabase auth user id
//   FB_UID           Destination Firebase auth uid
//   (optional) GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin creds
//   (optional) FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 — target the emulator instead of live
//   FB_STORAGE_BUCKET  Firebase Storage bucket name (e.g. rxtrack-med.firebasestorage.app).
//                       REQUIRED for the question_images step — Louis must set this, or
//                       admin.storage().bucket() has no default bucket to resolve and throws.
//
// Flags:
//   --count    Print Supabase row counts per table for SB_UID. No writes. No Firestore needed.
//   --sizes    Print byte size of each state-doc JSON (terms/performance/completion/
//              weak_concepts/tracker) for SB_UID. Flags any doc >700KB. No writes. No Firestore needed.
//   --verify   Post-migration: compare Firestore doc counts to Supabase row counts. Reads only.
//   --resume   During migration, skip writing a doc when its stored srcHash already matches
//              the freshly computed hash of the source row (idempotent re-run / resume after
//              a partial failure). Ignored in --count/--sizes/--verify modes.
//
// Usage (see task-8-report.md for the full ordered runbook):
//   node scripts/migrate-supabase-to-firestore.mjs --count --sizes
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-supabase-to-firestore.mjs
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-supabase-to-firestore.mjs --verify
//   node scripts/migrate-supabase-to-firestore.mjs --resume
//   node scripts/migrate-supabase-to-firestore.mjs --verify

import { createClient } from "@supabase/supabase-js";
import admin from "firebase-admin";
import crypto from "node:crypto";
import { encodeDocId } from "../src/idCodec.js"; // pure module — safe in node (R3-finding 2)

const args = process.argv.slice(2);
const FLAG_COUNT = args.includes("--count");
const FLAG_SIZES = args.includes("--sizes");
const FLAG_VERIFY = args.includes("--verify");
const FLAG_RESUME = args.includes("--resume");

const AUDIT_ONLY = FLAG_COUNT || FLAG_SIZES; // dry-run: no writes, Supabase-only
const NEEDS_FIRESTORE = !AUDIT_ONLY; // migration or --verify both touch Firestore

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const SB_URL = requireEnv("SB_URL");
const SB_SERVICE_KEY = requireEnv("SB_SERVICE_KEY");
const SB_UID = requireEnv("SB_UID");
const FB_UID = AUDIT_ONLY ? process.env.FB_UID || "" : requireEnv("FB_UID");

const sb = createClient(SB_URL, SB_SERVICE_KEY);

let db = null;
if (NEEDS_FIRESTORE) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FB_STORAGE_BUCKET,
  });
  db = admin.firestore();
}

const srcHash = (row) => crypto.createHash("sha1").update(JSON.stringify(row)).digest("hex"); // R3-finding 4

const STATE = ["terms", "performance", "completion", "weak_concepts", "tracker"];
const RECOGNITION_TABLES = [
  ["anki_cards", "ankiCards"],
  ["recognition_items", "recognitionItems"],
  // NOTE: ungenerated_cards is NOT a Supabase table (it's derived) — buildRecognitionBank
  // recomputes the ungenerated set from ankiCards at run time, so nothing to migrate.
];

// ---------------------------------------------------------------------------
// --count : Supabase row counts per table for SB_UID. No writes, no Firestore.
// ---------------------------------------------------------------------------
async function runCount() {
  console.log(`\n=== --count : Supabase row counts for user ${SB_UID} ===`);
  for (const name of STATE) {
    const { data } = await sb.from(name).select("data").eq("user_id", SB_UID).maybeSingle();
    console.log(`  state/${name}: ${data ? 1 : 0}`);
  }
  const tables = ["objectives", "lectures", "user_kv", "mcq_bank", "question_images", ...RECOGNITION_TABLES.map(([t]) => t)];
  for (const table of tables) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true }).eq("user_id", SB_UID);
    if (error) {
      console.log(`  ${table}: ERROR ${error.message}`);
    } else {
      console.log(`  ${table}: ${count ?? 0}`);
    }
  }
}

// ---------------------------------------------------------------------------
// --sizes : byte size of each state-doc JSON. Flags anything >700KB.
// ---------------------------------------------------------------------------
const SIZE_WARN_BYTES = 700 * 1024;

async function runSizes() {
  console.log(`\n=== --sizes : state-doc JSON byte sizes for user ${SB_UID} ===`);
  let anyOver = false;
  for (const name of STATE) {
    const { data } = await sb.from(name).select("data,updated_at").eq("user_id", SB_UID).maybeSingle();
    if (!data?.data) {
      console.log(`  state/${name}: (no row)`);
      continue;
    }
    const bytes = Buffer.byteLength(JSON.stringify(data.data), "utf8");
    const flag = bytes > SIZE_WARN_BYTES ? "  <-- OVER 700KB (approaching 1MiB Firestore doc limit)" : "";
    if (flag) anyOver = true;
    console.log(`  state/${name}: ${bytes} bytes${flag}`);
  }
  if (anyOver) {
    console.log("\n  STOP: at least one state doc is over 700KB. Do NOT run the live migration.");
    console.log("  Get Louis's go on a sharding follow-up (performance/completion by block) first — SP0 does no silent sharding.");
  }
  return anyOver;
}

// ---------------------------------------------------------------------------
// Migration write helper — deterministic id, srcHash-based --resume skip.
// ---------------------------------------------------------------------------
let writeCount = 0;
let skipCount = 0;

async function setDoc(ref, payload, hash) {
  if (FLAG_RESUME) {
    const existing = await ref.get();
    if (existing.exists && existing.data()?.srcHash === hash) {
      skipCount++;
      return;
    }
  }
  await ref.set(payload);
  writeCount++;
}

// ---------------------------------------------------------------------------
// Migration — writes Supabase rows for SB_UID into Firestore under FB_UID.
// ---------------------------------------------------------------------------
async function runMigration() {
  console.log(`\n=== Migrating Supabase user ${SB_UID} -> Firestore uid ${FB_UID}${FLAG_RESUME ? " (--resume)" : ""} ===`);

  // state (terms/performance/completion/weak_concepts/tracker)
  for (const name of STATE) {
    const { data, error } = await sb.from(name).select("data,updated_at").eq("user_id", SB_UID).maybeSingle();
    if (error) {
      console.error(`  state/${name}: READ ERROR ${error.message}`);
      throw error;
    }
    if (data?.data) {
      const hash = srcHash(data);
      await setDoc(
        db.doc(`users/${FB_UID}/state/${name}`),
        { data: data.data, srcHash: hash, srcUpdatedAt: data.updated_at ?? null, updatedAt: new Date() },
        hash
      );
    }
  }

  // objectives (per block) — encoded id + srcHash (R3-findings 3,4)
  const { data: objs, error: objsError } = await sb.from("objectives").select("block_id,data,updated_at").eq("user_id", SB_UID);
  if (objsError) {
    console.error(`  objectives: READ ERROR ${objsError.message}`);
    throw objsError;
  }
  for (const o of objs || []) {
    const hash = srcHash(o);
    await setDoc(
      db.doc(`users/${FB_UID}/objectives/${encodeDocId(o.block_id)}`),
      { data: o.data, srcHash: hash, srcUpdatedAt: o.updated_at ?? null, updatedAt: new Date() },
      hash
    );
  }

  // lectures — encoded id + srcHash
  const { data: lecs, error: lecsError } = await sb
    .from("lectures")
    .select("lecture_id,block_id,term_id,data,chunks,updated_at")
    .eq("user_id", SB_UID);
  if (lecsError) {
    console.error(`  lectures: READ ERROR ${lecsError.message}`);
    throw lecsError;
  }
  for (const l of lecs || []) {
    const hash = srcHash(l);
    await setDoc(
      db.doc(`users/${FB_UID}/lectures/${encodeDocId(l.lecture_id)}`),
      {
        data: l.data,
        chunks: l.chunks || [],
        blockId: l.block_id,
        termId: l.term_id,
        srcHash: hash,
        srcUpdatedAt: l.updated_at ?? null,
        updatedAt: new Date(),
      },
      hash
    );
  }

  // user_kv — encoded key + srcHash
  const { data: kv, error: kvError } = await sb.from("user_kv").select("key,data,updated_at").eq("user_id", SB_UID);
  if (kvError) {
    console.error(`  user_kv: READ ERROR ${kvError.message}`);
    throw kvError;
  }
  for (const r of kv || []) {
    const hash = srcHash(r);
    await setDoc(
      db.doc(`users/${FB_UID}/kv/${encodeDocId(r.key)}`),
      { data: r.data, srcHash: hash, srcUpdatedAt: r.updated_at ?? null, updatedAt: new Date() },
      hash
    );
  }

  // mcq_bank (deterministic id = idempotent on rerun) — encodeDocId imported at top from idCodec
  const { data: mcq, error: mcqError } = await sb
    .from("mcq_bank")
    .select("objective_id,round,data,updated_at")
    .eq("user_id", SB_UID);
  if (mcqError) {
    console.error(`  mcq_bank: READ ERROR ${mcqError.message}`);
    throw mcqError;
  }
  for (const m of mcq || []) {
    const hash = srcHash(m);
    await setDoc(
      db.doc(`users/${FB_UID}/mcq/${encodeDocId(m.objective_id)}__r${m.round ?? 0}`),
      {
        objectiveId: m.objective_id,
        round: m.round ?? 0,
        data: m.data,
        srcHash: hash,
        srcUpdatedAt: m.updated_at ?? null,
        updatedAt: new Date(),
      },
      hash
    );
  }

  // recognition tables (finding 16) — anki_cards, recognition_items, ungenerated_cards
  for (const [table, coll] of RECOGNITION_TABLES) {
    const { data: rows, error: rowsError } = await sb.from(table).select("*").eq("user_id", SB_UID);
    if (rowsError) {
      console.error(`  ${table}: READ ERROR ${rowsError.message}`);
      throw rowsError;
    }
    for (const r of rows || []) {
      const id = encodeDocId(r.id ?? r.card_id ?? `${r.deck || ""}_${r.note_id || ""}`); // deterministic from source PK
      const hash = srcHash(r);
      await setDoc(
        db.doc(`users/${FB_UID}/${coll}/${id}`),
        { ...r, srcHash: hash, srcUpdatedAt: r.updated_at ?? r.created_at ?? null, updatedAt: new Date() },
        hash
      );
    }
  }

  // question_images (finding 15/16) — copy Storage file + meta, deterministic id from storage_path.
  // Destination basename MUST come from the Supabase storage_path (already globally unique,
  // client-randomized), NOT the display filename — two images can share the same original
  // filename on the same objective+round, which would collide and silently overwrite.
  const { data: imgs, error: imgsError } = await sb.from("question_images").select("*").eq("user_id", SB_UID);
  if (imgsError) {
    console.error(`  question_images: READ ERROR ${imgsError.message}`);
    throw imgsError;
  }
  for (const im of imgs || []) {
    const srcBase = im.storage_path.split("/").pop();
    const dest = `question-images/${FB_UID}/${encodeDocId(im.objective_id)}_r${im.round ?? 0}/${encodeDocId(srcBase)}`;
    const id = encodeDocId(dest); // deterministic from NEW (unique) path → idempotent
    const hash = srcHash(im);

    if (FLAG_RESUME) {
      const existing = await db.doc(`users/${FB_UID}/questionImages/${id}`).get();
      if (existing.exists && existing.data()?.srcHash === hash) {
        skipCount++;
        continue;
      }
    }

    const { data: file, error: downloadError } = await sb.storage.from("question-images").download(im.storage_path);
    if (!file) {
      console.warn(
        `  question_images: SKIPPING metadata doc for missing Storage object at ${im.storage_path}` +
          (downloadError ? ` (${downloadError.message})` : "")
      );
      continue; // do not write a ghost metadata doc with no backing Storage object
    }
    const buf = Buffer.from(await file.arrayBuffer());
    await admin.storage().bucket().file(dest).save(buf, { contentType: im.mime_type || "image/jpeg" });
    // Store BOTH the original filename and the encoded unique storage basename (R4-finding 4) so
    // reverse-export knows what to restore vs how to locate the object.
    await db.doc(`users/${FB_UID}/questionImages/${id}`).set({
      objectiveId: im.objective_id,
      round: im.round ?? 0,
      storagePath: dest,
      filename: im.filename,
      storageFilename: encodeDocId(srcBase),
      mimeType: im.mime_type,
      srcHash: hash,
      srcUpdatedAt: im.added_at ?? null,
      addedAt: im.added_at || new Date(),
    });
    writeCount++;
  }

  console.log(`migration complete (${writeCount} written, ${skipCount} skipped${FLAG_RESUME ? " via --resume" : ""})`);
}

// ---------------------------------------------------------------------------
// --verify : compare Firestore doc counts to Supabase row counts.
// ---------------------------------------------------------------------------
async function fsCollectionCount(path) {
  const snap = await db.collection(path).count().get();
  return snap.data().count;
}

async function sbTableCount(table) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true }).eq("user_id", SB_UID);
  if (error) throw error;
  return count ?? 0;
}

async function runVerify() {
  console.log(`\n=== --verify : Firestore vs Supabase doc counts (SB_UID=${SB_UID}, FB_UID=${FB_UID}) ===`);
  let mismatches = 0;

  const checkExpectStateCount = async () => {
    let sbCount = 0;
    for (const name of STATE) {
      const { data } = await sb.from(name).select("data").eq("user_id", SB_UID).maybeSingle();
      if (data?.data) sbCount++;
    }
    const fsCount = await fsCollectionCount(`users/${FB_UID}/state`);
    const ok = fsCount === sbCount;
    if (!ok) mismatches++;
    console.log(`  state: supabase=${sbCount} firestore=${fsCount} ${ok ? "OK" : "MISMATCH"}`);
  };
  await checkExpectStateCount();

  const pairs = [
    ["objectives", `users/${FB_UID}/objectives`],
    ["lectures", `users/${FB_UID}/lectures`],
    ["user_kv", `users/${FB_UID}/kv`],
    ["mcq_bank", `users/${FB_UID}/mcq`],
    ["question_images", `users/${FB_UID}/questionImages`],
    ["anki_cards", `users/${FB_UID}/ankiCards`],
    ["recognition_items", `users/${FB_UID}/recognitionItems`],
  ];
  for (const [table, path] of pairs) {
    const sbCount = await sbTableCount(table);
    const fsCount = await fsCollectionCount(path);
    const ok = sbCount === fsCount;
    if (!ok) mismatches++;
    console.log(`  ${table} -> ${path}: supabase=${sbCount} firestore=${fsCount} ${ok ? "OK" : "MISMATCH"}`);
  }

  console.log(mismatches === 0 ? "\n  verify OK — all counts match" : `\n  verify FAILED — ${mismatches} mismatch(es)`);
  return mismatches === 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  if (FLAG_COUNT) await runCount();
  if (FLAG_SIZES) {
    const anyOver = await runSizes();
    if (FLAG_COUNT === false && anyOver) process.exitCode = 1;
  }
  if (AUDIT_ONLY) return; // --count/--sizes never write or touch Firestore

  if (FLAG_VERIFY) {
    const ok = await runVerify();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  await runMigration();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
