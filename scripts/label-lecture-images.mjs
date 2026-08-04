/**
 * Bulk pre-labelling of lecture figures, for doing a whole subject in one unattended run.
 *
 * The normal path is in the app: Study → "+ add this lecture's figures" picks the folder,
 * labels it, and shows the cards for review, all without a terminal. This exists only for the
 * overnight case — `--all` across a subject — and writes `images.json` next to each lecture,
 * which the app reads instead of relabelling. The prompt and reply parsing are imported from
 * `src/lectureFigures.js` so the two paths cannot drift apart.
 *
 * Marker already wrote every figure next to the lecture's .md and left an inline
 * `![](_page_5_Figure_1.jpeg)` where it sat on the slide, so WHERE an image belongs is already
 * known. What is not known is WHAT it is — a deck is mostly logos, headshots and slide
 * furniture. This asks a vision model once, offline, and writes the answers to `images.json`
 * next to the lecture. Nothing here touches Firebase: the app uploads and stores the results
 * while signed in as you.
 *
 * It runs against llm-bridge, so labelling is free but slow (~40s per call). Two things keep it
 * finite: a size floor that drops icons before they cost anything, and batching several images
 * into one call. Re-running is cheap — anything already in `images.json` is skipped, so it is
 * safe to stop it with Ctrl-C and pick it up later.
 *
 *   node scripts/label-lecture-images.mjs "C:/Users/.../Endocrine Lectures"
 *   node scripts/label-lecture-images.mjs "<dir>" --only "Lecture 01" --batch 6
 *   node scripts/label-lecture-images.mjs "<dir>" --dry     # report only, no model calls
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseImageRefs, IMAGE_KINDS } from "../src/lectureImages.js";
import { buildLabelPrompt, parseLabelReply, LABEL_SYSTEM } from "../src/lectureFigures.js";

const BRIDGE = process.env.RXT_BRIDGE_URL || "http://127.0.0.1:4319";

/** Below this, a JPEG is a bullet icon or a university crest, never a photomicrograph. */
const MIN_BYTES = 20_000;

/** Images per vision call. Higher is faster but the model starts losing track of the order. */
const BATCH = 6;

/** Kept in step with IMAGE_KINDS in src/lectureImages.js, plus the reject bucket. */
const KINDS = [...IMAGE_KINDS, "decorative"];

function parseArgs(argv) {
  const args = { dir: "", only: "", batch: BATCH, minBytes: MIN_BYTES, dry: false, all: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") args.dry = true;
    else if (a === "--only") args.only = argv[++i] || "";
    else if (a === "--all") args.all = true;
    else if (a === "--batch") args.batch = Math.max(1, parseInt(argv[++i], 10) || BATCH);
    else if (a === "--min-bytes") args.minBytes = parseInt(argv[++i], 10) || MIN_BYTES;
    else rest.push(a);
  }
  args.dir = rest[0] || "";
  return args;
}

/** Every lecture is its own folder holding the .md and the figures it references. */
function lectureFolders(root, only) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !only || n.toLowerCase().includes(only.toLowerCase()))
    .sort();
}

function findMarkdown(dir) {
  const md = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(".md"));
  return md ? path.join(dir, md) : null;
}

/**
 * The figures worth paying a model to look at: referenced by the markdown, present on disk,
 * big enough to be content, and not a repeat of one already in this lecture (a crest on every
 * slide is one image, forty times).
 */
function candidates(dir, refs, minBytes) {
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const file = path.join(dir, ref.file);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.size < minBytes) continue;
    const hash = crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ file: ref.file, context: ref.context, bytes: stat.size, path: file });
  }
  return out;
}

function readManifest(dir) {
  const p = path.join(dir, "images.json");
  try {
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeManifest(dir, list) {
  fs.writeFileSync(path.join(dir, "images.json"), JSON.stringify(list, null, 2), "utf8");
}

function mimeOf(file) {
  return /\.png$/i.test(file) ? "image/png" : "image/jpeg";
}

async function labelBatch(batch) {
  const res = await fetch(`${BRIDGE}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system: LABEL_SYSTEM,
      prompt: buildLabelPrompt(batch.length),
      images: batch.map((c) => ({
        mimeType: mimeOf(c.file),
        data: fs.readFileSync(c.path).toString("base64"),
      })),
      json: true,
    }),
  });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
  const { text } = await res.json();
  return parseLabelReply(text, batch.length);
}

async function labelLecture(dir, name, args) {
  const mdPath = findMarkdown(dir);
  if (!mdPath) return console.log(`  ${name}: no .md, skipped`);

  const refs = parseImageRefs(fs.readFileSync(mdPath, "utf8"));
  const todo = candidates(dir, refs, args.minBytes);
  const manifest = readManifest(dir);
  const done = new Set(manifest.map((m) => m.file));
  const pending = todo.filter((c) => !done.has(c.file));

  console.log(
    `  ${name}: ${refs.length} refs → ${todo.length} worth labelling` +
      `, ${manifest.length} done, ${pending.length} to do`
  );
  if (args.dry || !pending.length) return;

  for (let i = 0; i < pending.length; i += args.batch) {
    const batch = pending.slice(i, i + args.batch);
    const started = Date.now();
    let labels;
    try {
      labels = await labelBatch(batch);
    } catch (e) {
      // One bad batch must not cost the whole lecture — the manifest already holds the rest.
      console.log(`    batch ${i / args.batch + 1} failed (${e.message}), continuing`);
      continue;
    }
    batch.forEach((c, j) => {
      const l = labels[j] || {};
      manifest.push({
        file: c.file,
        kind: KINDS.includes(l.kind) ? l.kind : "decorative",
        shows: String(l.shows || "").trim(),
        context: c.context,
        bytes: c.bytes,
      });
    });
    // Written every batch, not at the end, so Ctrl-C never loses an hour of labelling.
    writeManifest(dir, manifest);
    const kept = manifest.filter((m) => m.kind !== "decorative").length;
    console.log(
      `    +${batch.length} in ${Math.round((Date.now() - started) / 1000)}s` +
        ` (${manifest.length}/${todo.length}, ${kept} usable)`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !fs.existsSync(args.dir)) {
    console.error('Usage: node scripts/label-lecture-images.mjs "<lectures dir>" [--only NAME] [--batch N] [--dry]');
    process.exit(1);
  }
  // Label the lecture you are about to study, not the whole subject. A term's figures are only
  // useful while you are on that term, and the deck you are not studying costs an hour to label.
  if (!args.only && !args.all && !args.dry) {
    console.error('Pick a lecture: --only "Lecture 01"   (or --all to do the whole folder, or --dry to look)');
    process.exit(1);
  }
  const folders = lectureFolders(args.dir, args.only);
  console.log(`${folders.length} lecture folder(s) in ${args.dir}${args.dry ? " (dry run)" : ""}`);
  for (const name of folders) {
    await labelLecture(path.join(args.dir, name), name, args);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
