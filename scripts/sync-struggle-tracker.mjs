// scripts/sync-struggle-tracker.mjs
//
// Reads the JSON the Struggle Tracker Anki addon exports to
//   ~/Documents/rxtrack-routine/struggle-tracker-export.json
// (Tools → Struggle Tracker → 📤 Export to RxTrack Now, or automatically
// once per Anki session on close) and upserts it into Firestore at
// users/{FB_UID}/struggleTasks/{cardId}, diffing against what's already
// there so unchanged cards don't cost a write. Cards no longer present in
// the export (fixed / remediation cleared in Anki) get deleted, unless
// they were marked doneLocally from RxTrack — those are left for a manual
// cleanup so a "done" checkbox doesn't quietly vanish before you saw it land.
//
// Env:
//   FB_UID                       Destination Firebase auth uid (required)
//   (optional) GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin creds
//   (optional) FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 — target the emulator
//   (optional) STRUGGLE_EXPORT_PATH — override the export file location
//
// Usage:
//   node scripts/sync-struggle-tracker.mjs            # one-shot sync
//   node scripts/sync-struggle-tracker.mjs --watch     # re-sync on file change (debounced)

import admin from "firebase-admin";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeDocId } from "../src/idCodec.js";

const args = process.argv.slice(2);
const WATCH = args.includes("--watch");
const DEBOUNCE_MS = 30_000; // export only changes once per Anki session (or on manual click) — no need to react instantly

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

const FB_UID = requireEnv("FB_UID");
const EXPORT_PATH =
  process.env.STRUGGLE_EXPORT_PATH ||
  path.join(os.homedir(), "Documents", "rxtrack-routine", "struggle-tracker-export.json");

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

function loadExport() {
  if (!fs.existsSync(EXPORT_PATH)) {
    console.error(`No export file at ${EXPORT_PATH}. In Anki: Tools → Struggle Tracker → Export to RxTrack Now.`);
    return null;
  }
  const raw = fs.readFileSync(EXPORT_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.tasks) ? parsed.tasks : [];
}

/** Fields that determine whether a task doc actually needs rewriting. */
function fingerprint(t) {
  return JSON.stringify([t.state, t.remediation, t.concept, t.subject, t.lecture, t.reason, t.front, t.buriedAt]);
}

async function sync() {
  const tasks = loadExport();
  if (tasks === null) return;

  const coll = db.collection("users").doc(FB_UID).collection("struggleTasks");
  const existingSnap = await coll.get();
  const existing = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

  const seenIds = new Set();
  let written = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchCount = 0;

  const flush = async () => {
    if (batchCount > 0) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  };

  for (const t of tasks) {
    const id = encodeDocId(t.cardId);
    seenIds.add(id);
    const prev = existing.get(id);
    if (prev && fingerprint(prev) === fingerprint(t)) {
      skipped++;
      continue;
    }
    batch.set(coll.doc(id), { ...t, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    batchCount++;
    written++;
    if (batchCount >= 400) await flush();
  }

  let deleted = 0;
  for (const [id, data] of existing.entries()) {
    if (seenIds.has(id)) continue;
    if (data.doneLocally) continue; // leave resolved-and-acknowledged docs for manual cleanup
    batch.delete(coll.doc(id));
    batchCount++;
    deleted++;
    if (batchCount >= 400) await flush();
  }
  await flush();

  console.log(
    `Struggle Tracker sync: ${tasks.length} exported, ${written} written, ${skipped} unchanged, ${deleted} removed.`
  );
}

if (WATCH) {
  console.log(`Watching ${EXPORT_PATH} (debounced ${DEBOUNCE_MS / 1000}s)…`);
  let timer = null;
  const dir = path.dirname(EXPORT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  sync();
  fs.watch(dir, (eventType, filename) => {
    if (filename !== path.basename(EXPORT_PATH)) return;
    clearTimeout(timer);
    timer = setTimeout(sync, DEBOUNCE_MS);
  });
} else {
  await sync();
}
