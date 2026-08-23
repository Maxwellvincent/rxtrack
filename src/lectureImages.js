/**
 * Histology and diagram images from a lecture, and how they find their way onto a question.
 *
 * Marker already pulls every figure out of the PDF during ingest and leaves an inline
 * `![](_page_5_Figure_1.jpeg)` where it sat on the slide, so the markdown itself records which
 * text an image belongs to — no vision call is needed to place one. Vision is used once, at
 * ingest, only to say WHAT each image is (`kind` + `shows`), because a slide deck is mostly
 * logos, headshots and slide furniture and none of that belongs on an exam question.
 *
 * Atoms lose their source offsets during extraction, so matching here is by name: the atom's
 * term against the image's label first, then against the markdown that surrounded it.
 */

/** How much markdown either side of an image ref counts as "about" that image. */
export const CONTEXT_WINDOW = 400;

/** Words too common to prove an image is about an atom. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "to", "for", "with", "by", "is", "are",
  "cell", "cells", "system", "type", "level", "levels",
]);

const MARKER_FILE = /^_page_\d+_(?:Figure|Picture|Table)_\d+\.(?:jpe?g|png)$/i;

/**
 * Marker's extracted figures, in the order they appear, each with the surrounding text.
 *
 * Only marker's own output files count — a remote badge or logo linked in the markdown is not
 * something we have a file for and is never lecture content.
 */
export function parseImageRefs(markdown) {
  const md = String(markdown || "");
  if (!md) return [];
  const out = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    const file = m[1].split("/").pop();
    if (!MARKER_FILE.test(file)) continue;
    const start = Math.max(0, m.index - CONTEXT_WINDOW);
    const end = Math.min(md.length, m.index + m[0].length + CONTEXT_WINDOW);
    const context = (md.slice(start, m.index) + " " + md.slice(m.index + m[0].length, end))
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ file, at: m.index, context });
  }
  return out;
}

/**
 * What a figure can be. Order is preference: given two images that match an atom equally well,
 * the tissue beats the patient photo beats the redrawn diagram, because that is the order in
 * which a Step 1 item is likely to show them.
 */
export const IMAGE_KINDS = ["histology", "clinical", "diagram"];

/** An image is worth showing only if it was labelled as content and we can render it. */
export function isUsableImage(img) {
  if (!img || !img.url) return false;
  return IMAGE_KINDS.includes(img.kind);
}

function terms(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * The best image for a chunk of text (an atom's term, a question stem, anything), or null.
 *
 * A wrong picture is worse than no picture — it reads as a clue and teaches the wrong pairing —
 * so anything without a real term overlap returns null.
 */
export function imageForText(text, images) {
  const list = (Array.isArray(images) ? images : []).filter(isUsableImage);
  if (!list.length) return null;
  const want = terms(text);
  if (!want.length) return null;

  let best = null;
  let bestScore = 0;
  for (const img of list) {
    const inLabel = terms(img.shows);
    const inContext = terms(img.context);
    let score = 0;
    for (const w of want) {
      if (inLabel.includes(w)) score += 3;
      else if (inContext.includes(w)) score += 1;
    }
    if (!score) continue;
    // Break ties by kind — a real specimen is a better stimulus than a drawing of one.
    score += (IMAGE_KINDS.length - IMAGE_KINDS.indexOf(img.kind)) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = img;
    }
  }
  return best;
}

/** The best image for this atom, or null. See `imageForText` for the matching rule. */
export function imageForAtom(atom, images) {
  return imageForText(atom?.term, images);
}

/**
 * Hang each question's image off the question object.
 *
 * The model is asked to echo the atom's term as `topic`, but it does not always comply, so
 * position is the fallback — questions come back one per atom, in order.
 *
 * The image's label never touches the stem. The whole point of putting a photomicrograph in
 * front of the question is that reading the tissue is the work; captioning it is the answer.
 */
export function attachImagesToQuestions(questions, atoms, images) {
  const qs = Array.isArray(questions) ? questions : [];
  const list = (Array.isArray(images) ? images : []).filter(isUsableImage);
  if (!qs.length || !list.length) return qs;
  const source = Array.isArray(atoms) ? atoms : [];

  return qs.map((q, i) => {
    const byTopic = q?.topic
      ? source.find((a) => String(a?.term || "").toLowerCase() === String(q.topic).toLowerCase())
      : null;
    const atom = byTopic || source[i];
    const image = imageForAtom(atom, list);
    return image ? { ...q, image } : q;
  });
}
