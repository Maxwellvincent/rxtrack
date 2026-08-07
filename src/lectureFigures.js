/**
 * Turning a lecture folder into reviewable figures, in the browser.
 *
 * This used to be two command-line scripts, for one bad reason: uploading needs your signed-in
 * session and labelling needs llm-bridge, and it looked like those could not meet in one place.
 * They can — the page reaches 127.0.0.1 fine — so the whole pipeline belongs where the lecture
 * already is. Pick the folder, watch the cards fill in, tick the ones worth answering.
 *
 * Nothing here uploads. Labelling is a suggestion and the review grid is the decision, so a
 * figure you reject never leaves the machine.
 */
import { parseImageRefs, IMAGE_KINDS } from "./lectureImages.js";

/** Below this a JPEG is a bullet icon or a university crest, never a figure. */
export const MIN_FIGURE_BYTES = 20_000;

/** Images per vision call. More is faster; too many and the model loses the ordering. */
export const LABEL_BATCH = 5;

const KNOWN_KINDS = [...IMAGE_KINDS, "decorative"];

export const LABEL_SYSTEM = "You label figures extracted from medical lecture slides. Return ONLY valid JSON.";

export function buildLabelPrompt(n) {
  return (
    `You are shown ${n} image(s) extracted from a medical school lecture slide deck, in order.\n` +
    `Classify EACH one:\n` +
    `- "histology"  — a micrograph: stained tissue or cells under a microscope, or a gross\n` +
    `                 pathology specimen.\n` +
    `- "clinical"   — a real patient or an image taken from one: physical findings, a rash, a\n` +
    `                 goitre, exophthalmos, a radiograph, CT, MRI, ultrasound, ECG.\n` +
    `- "diagram"    — a drawn teaching figure: pathway, chart, anatomical illustration, graph.\n` +
    `- "decorative" — anything not testable: logos, crests, headshots of the lecturer, stock\n` +
    `                 photos, slide furniture, screenshots of text, decorative borders.\n\n` +
    `"histology" means TISSUE SEEN THROUGH A MICROSCOPE — stain colours, cells, nuclei. Nothing\n` +
    `else qualifies, however medical it looks:\n` +
    `- A CT, MRI or ultrasound is a cross-section of a LIVING patient, not a slide. It is\n` +
    `  "clinical", even though it shows internal anatomy in greyscale.\n` +
    `- A radiograph or ECG is "clinical".\n` +
    `- A photograph of a patient, or of a gross organ on a bench, is "clinical".\n` +
    `If you cannot see individual cells, it is not "histology".\n\n` +
    `For "shows", name what is depicted in under 12 words, using the anatomical, histologic or\n` +
    `clinical terms a physician would use. For "decorative", leave "shows" as "".\n\n` +
    `Return ONLY a JSON array of exactly ${n} objects, in the same order as the images:\n` +
    `[{"kind":"histology","shows":"thyroid follicles lined by cuboidal epithelium with colloid"}]`
  );
}

/** A thumbnail source for the review grid. Not having one must never abort the harvest. */
function previewUrl(file) {
  try {
    return URL.createObjectURL(file);
  } catch {
    return "";
  }
}

async function sha(buffer) {
  // Cheap identity for "same picture twice". Crypto strength is irrelevant here.
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * The figures worth showing you: referenced by the lecture's markdown, present in the folder,
 * big enough to be content, and not a repeat of one already picked.
 *
 * Order follows the markdown, not the file listing, because that is the order you read the
 * lecture in and the order the surrounding context makes sense in.
 */
export async function selectCandidates({ files = [], markdown = "", minBytes = MIN_FIGURE_BYTES } = {}) {
  const refs = parseImageRefs(markdown);
  if (!refs.length) return [];
  const byName = new Map((files || []).map((f) => [f.name, f]));

  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const file = byName.get(ref.file);
    if (!file || file.size < minBytes) continue;
    const buffer = await file.arrayBuffer();
    const hash = await sha(buffer);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({
      name: ref.file,
      context: ref.context,
      bytes: file.size,
      mimeType: file.type || "image/jpeg",
      file,
      data: toBase64(buffer),
      url: previewUrl(file),
    });
  }
  return out;
}

export function batchesOf(list, size = LABEL_BATCH) {
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < (list || []).length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Bridge backends emit bare JSON but CLIs still like to wrap it in chatter. */
export function parseLabelReply(text, expected) {
  const cleaned = String(text || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) throw new Error("reply was not JSON");
    parsed = JSON.parse(m[0]);
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.images || [];
  // A short reply means the model lost the mapping, which would caption the wrong slide.
  if (list.length !== expected) throw new Error(`got ${list.length} labels for ${expected} images`);
  return list;
}

/**
 * Labels from a folder already processed by `scripts/label-lecture-images.mjs`, or null.
 *
 * Reusing them is what makes the bulk script worth running: an overnight pass over a subject
 * turns every later folder-pick into an instant review instead of a two-minute wait.
 */
export async function readStoredLabels(files) {
  const manifest = (files || []).find((f) => f.name === "images.json");
  if (!manifest) return null;
  try {
    const parsed = JSON.parse(await manifest.text());
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Match stored labels to candidates by filename, not position — the manifest is written in
 * label order and may be missing anything a previous run failed on.
 */
export function applyStoredLabels(candidates, stored) {
  const byFile = new Map((stored || []).map((m) => [m.file, m]));
  return (candidates || []).map((c) => {
    const m = byFile.get(c.name);
    if (!m) return { ...c, kind: "unlabelled", shows: "", keep: true };
    const kind = KNOWN_KINDS.includes(m.kind) ? m.kind : "decorative";
    return { ...c, kind, shows: String(m.shows || "").trim(), keep: kind !== "decorative" };
  });
}

/** Attach one batch of labels to the candidates they describe, by position. */
export function mergeLabels(candidates, labels) {
  return (candidates || []).map((c, i) => {
    const raw = labels?.[i] || {};
    const kind = KNOWN_KINDS.includes(raw.kind) ? raw.kind : "decorative";
    return { ...c, kind, shows: String(raw.shows || "").trim(), keep: kind !== "decorative" };
  });
}

/**
 * Label every candidate, batch by batch.
 *
 * A failed batch — or no model at all — leaves those figures `unlabelled` and still selectable.
 * The grid is the decision either way, and seeing twenty pictures beats seeing an error.
 */
export async function labelCandidates(candidates, { complete, batchSize = LABEL_BATCH, onProgress } = {}) {
  const list = candidates || [];
  const out = [];
  for (const batch of batchesOf(list, batchSize)) {
    let labels = null;
    try {
      const text = await complete({
        system: LABEL_SYSTEM,
        prompt: buildLabelPrompt(batch.length),
        images: batch.map((c) => ({ mimeType: c.mimeType, data: c.data })),
        json: true,
      });
      if (text) labels = parseLabelReply(text, batch.length);
    } catch {
      labels = null;
    }
    out.push(
      ...(labels
        ? mergeLabels(batch, labels)
        : batch.map((c) => ({ ...c, kind: "unlabelled", shows: "", keep: true })))
    );
    onProgress?.(out.length, list.length);
  }
  return out;
}
