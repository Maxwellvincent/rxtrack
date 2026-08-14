#!/usr/bin/env node
/**
 * One-time uploader: copies every image referenced by src/ankiBank.json from
 * the user's local Anki collection.media folder up to a Supabase Storage
 * bucket called "anki-media". Public URLs follow the pattern
 *   {SUPABASE_URL}/storage/v1/object/public/anki-media/{filename}
 * which the app's loader (resolveAnkiImageURL) constructs on demand — no JSON
 * rewrite needed.
 *
 * Idempotent: skips files already present in the bucket. Re-run safe.
 *
 * Run:
 *   node tools/upload-anki-media.mjs
 *
 * Requires .env at repo root with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 * The anon key must have INSERT permission on the anki-media bucket; if the
 * bucket doesn't exist yet, create it manually in the Supabase dashboard
 * and mark it Public.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const BANK_PATH = path.join(REPO_ROOT, "src/ankiBank.json");
const MEDIA_DIR = path.join(homedir(), "Library/Application Support/Anki2/Madballer9898/collection.media");
const BUCKET = "anki-media";
const CONCURRENCY = 8;

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return out;
}

function contentTypeFor(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
    }[ext] || "application/octet-stream"
  );
}

async function main() {
  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error(".env missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  const supabase = createClient(url, key);

  if (!existsSync(MEDIA_DIR)) {
    throw new Error(`media folder not found: ${MEDIA_DIR}`);
  }
  const bank = JSON.parse(await readFile(BANK_PATH, "utf8"));

  // Collect every referenced image filename.
  const referenced = new Set();
  const imgRe = /\[IMG:\s+([^\]]+?)\s*\]/g;
  for (const notes of Object.values(bank.lectures || {})) {
    for (const n of notes) {
      for (const img of n.images || []) referenced.add(String(img).trim());
      for (const field of ["prompt", "answer", "extra"]) {
        const t = n[field] || "";
        let m;
        while ((m = imgRe.exec(t))) referenced.add(m[1].trim());
        imgRe.lastIndex = 0;
      }
    }
  }
  console.log(`referenced images: ${referenced.size}`);

  // Filter to those that actually exist on disk.
  const tasks = [];
  for (const fname of referenced) {
    const p = path.join(MEDIA_DIR, fname);
    if (existsSync(p)) tasks.push({ fname, path: p, size: statSync(p).size });
  }
  console.log(`present in media folder: ${tasks.length}`);
  const totalBytes = tasks.reduce((a, t) => a + t.size, 0);
  console.log(`total size: ${(totalBytes / 1e6).toFixed(1)} MB`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let i = 0;

  async function worker(workerId) {
    while (i < tasks.length) {
      const my = i++;
      const { fname, path: filePath } = tasks[my];
      try {
        const buf = await readFile(filePath);
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(fname, buf, {
            contentType: contentTypeFor(fname),
            upsert: false,
          });
        if (error) {
          if (error.message?.includes("already exists") || error.statusCode === "409") {
            skipped++;
          } else {
            failed++;
            if (failed < 10) console.warn(`  fail ${fname}: ${error.message}`);
          }
        } else {
          uploaded++;
        }
        if ((uploaded + skipped + failed) % 100 === 0) {
          console.log(`  progress: ${uploaded + skipped + failed}/${tasks.length} (uploaded=${uploaded}, skipped=${skipped}, failed=${failed})`);
        }
      } catch (e) {
        failed++;
        if (failed < 10) console.warn(`  exception ${fname}: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => worker(n)));
  console.log(`done. uploaded=${uploaded}, skipped=${skipped}, failed=${failed}, total=${tasks.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
