/**
 * Build a contact sheet for one lecture's labelled figures, so the pruning decision is made by
 * looking at them rather than by trusting the labeller.
 *
 * The model's classification is a first pass, not a verdict — it reads a clinical photograph of
 * exophthalmos as "histology", and it cannot know that a pathway diagram you already understand
 * is worthless as a question stimulus. That judgement is the student's, and it takes about a
 * minute per lecture once the images are on one page.
 *
 * Writes `review.html` next to `images.json`. Open it, untick what you do not want, save the
 * pruned manifest back over `images.json`, then import in the app. Nothing has been uploaded at
 * this point, so anything dropped here never leaves the machine.
 *
 *   node scripts/review-lecture-images.mjs "<lectures dir>" --only "Lecture 07"
 */
import fs from "node:fs";
import path from "node:path";

const KINDS = ["histology", "clinical", "diagram", "decorative"];

function parseArgs(argv) {
  const args = { dir: "", only: "" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") args.only = argv[++i] || "";
    else rest.push(argv[i]);
  }
  args.dir = rest[0] || "";
  return args;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function page(name, manifest) {
  const cards = manifest
    .map((m, i) => {
      const keep = m.kind !== "decorative";
      return `<label class="card${keep ? "" : " out"}" data-i="${i}">
  <input type="checkbox" ${keep ? "checked" : ""}>
  <img src="${esc(m.file)}" loading="lazy" alt="">
  <div class="meta">
    <select class="kind">${KINDS.map(
      (k) => `<option ${k === m.kind ? "selected" : ""}>${k}</option>`
    ).join("")}</select>
    <div class="shows">${esc(m.shows) || "<em>no label</em>"}</div>
    <div class="file">${esc(m.file)}</div>
  </div>
</label>`;
    })
    .join("\n");

  return `<!doctype html><meta charset="utf-8"><title>${esc(name)} — figures</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0e0f12; color:#e6e7ea;
         font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
  h1 { font-size:16px; margin:0 0 4px; }
  .sub { color:#8b8f98; font-size:12px; margin-bottom:16px; }
  .bar { position:sticky; top:0; z-index:2; display:flex; gap:12px; align-items:center;
         padding:12px 0; margin-bottom:12px; background:#0e0f12; border-bottom:1px solid #24262c; }
  button { font:inherit; padding:6px 12px; border-radius:8px; border:1px solid #34373f;
           background:#1a1c21; color:#e6e7ea; cursor:pointer; }
  button.primary { border-color:#4c7dff; }
  .count { color:#8b8f98; font-size:12px; }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); }
  .card { display:block; position:relative; border:1px solid #24262c; border-radius:10px;
          overflow:hidden; background:#15171b; cursor:pointer; }
  .card.out { opacity:.35; }
  .card input { position:absolute; top:10px; left:10px; z-index:1; width:18px; height:18px; }
  .card img { display:block; width:100%; height:190px; object-fit:contain; background:#0a0b0d; }
  .meta { padding:9px 11px 11px; }
  .shows { font-size:12px; margin:6px 0 3px; }
  .file { font:11px ui-monospace,monospace; color:#70747c; }
  select { font:inherit; font-size:11px; background:#1a1c21; color:#e6e7ea;
           border:1px solid #34373f; border-radius:6px; padding:2px 5px; }
</style>
<h1>${esc(name)}</h1>
<div class="sub">Untick anything that would not make a good question. Fix a wrong kind with the dropdown. Then save the pruned manifest over <code>images.json</code>.</div>
<div class="bar">
  <button id="all">Keep all</button>
  <button id="none">Keep none</button>
  <button id="save" class="primary">Save images.json</button>
  <span class="count" id="count"></span>
</div>
<div class="grid">${cards}</div>
<script>
const DATA = ${JSON.stringify(manifest)};
const cards = [...document.querySelectorAll('.card')];
const count = document.getElementById('count');
const kept = () => cards.filter(c => c.querySelector('input').checked);
function sync() {
  cards.forEach(c => c.classList.toggle('out', !c.querySelector('input').checked));
  count.textContent = kept().length + ' of ' + cards.length + ' kept';
}
cards.forEach(c => {
  c.querySelector('input').addEventListener('change', sync);
  // The dropdown lives inside the label, so a click on it would otherwise toggle the checkbox.
  c.querySelector('select').addEventListener('click', e => e.preventDefault());
});
document.getElementById('all').onclick = () => { cards.forEach(c => c.querySelector('input').checked = true); sync(); };
document.getElementById('none').onclick = () => { cards.forEach(c => c.querySelector('input').checked = false); sync(); };
document.getElementById('save').onclick = () => {
  const out = kept().map(c => ({ ...DATA[+c.dataset.i], kind: c.querySelector('select').value }))
                    .filter(m => m.kind !== 'decorative');
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'images.json'; a.click();
  URL.revokeObjectURL(url);
};
sync();
</script>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !fs.existsSync(args.dir)) {
    console.error('Usage: node scripts/review-lecture-images.mjs "<lectures dir>" --only "Lecture 07"');
    process.exit(1);
  }
  const folders = fs
    .readdirSync(args.dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !args.only || n.toLowerCase().includes(args.only.toLowerCase()));

  if (!folders.length) return console.error(`No lecture folder matches "${args.only}"`);

  for (const name of folders) {
    const dir = path.join(args.dir, name);
    const manifestPath = path.join(dir, "images.json");
    if (!fs.existsSync(manifestPath)) {
      console.log(`  ${name}: no images.json — run label-lecture-images.mjs first`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const out = path.join(dir, "review.html");
    fs.writeFileSync(out, page(name, manifest), "utf8");
    const usable = manifest.filter((m) => m.kind !== "decorative").length;
    console.log(`  ${name}: ${manifest.length} figures (${usable} kept by default)\n    ${out}`);
  }
}

main();
