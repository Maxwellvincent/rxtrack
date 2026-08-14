/**
 * Anki bank loader. Exposes the user's AnKing Proper + Proper+ deck content
 * (CPR-scoped) so the question generator can use it as the priority source per
 * the MEMORY_CONSOLIDATION_SPEC.
 *
 * The extraction lives in src/ankiBank.json — built one-time from a snapshot of
 * the live Anki collection (~/Library/Application Support/Anki2/.../collection.anki2).
 * 4309 notes across 69 CPR lectures, grouped by lecture path.
 *
 * Schema:
 *   { lectures: { "CPR Lecture N: Title": [ {source, block, week, prompt, answer, extra, images, tags}, ... ] } }
 *
 * Layer 2 (deferred): images. The notes carry image filename hints via [IMG: filename]
 * markers — once collection.media files are mirrored into public/anki-media/, those
 * markers can be rewritten to <img> tags for the UI.
 */
// Lazy-loaded bundled bank — fetched on first need so it doesn't bloat the
// main JS bundle. The JSON itself is ~3MB and Vite splits it into its own
// chunk via the dynamic import below.
let _bankData = null;
let _loadingPromise = null;
let BUNDLED_LECTURES = {};

/**
 * Kicks off (or returns) the dynamic import of ankiBank.json. Resolves once
 * BUNDLED_LECTURES is populated. Idempotent.
 */
export function ensureAnkiBankLoaded() {
  if (_bankData) return Promise.resolve(_bankData);
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = import("./ankiBank.json")
    .then((mod) => {
      _bankData = mod.default || mod;
      BUNDLED_LECTURES = (_bankData && _bankData.lectures) || {};
      LECTURE_KEYS_CACHE.map = null; // force key recompute
      return _bankData;
    })
    .catch((e) => {
      console.warn("ankiBank.json load failed:", e);
      _bankData = { lectures: {} };
      return _bankData;
    });
  return _loadingPromise;
}

/** True once ensureAnkiBankLoaded() has resolved. Sync-safe gate for callers. */
export function isAnkiBankLoaded() {
  return _bankData != null;
}

// Cloud-merged overrides — populated by hydrateAnkiBankFromCloud() once the
// user is authenticated. Cloud rows take precedence so the app reflects the
// most recent push from any device.
let CLOUD_LECTURES = {};

/** Merge of bundled + cloud, cloud wins. Recomputed on hydration. */
function mergedLectures() {
  return { ...BUNDLED_LECTURES, ...CLOUD_LECTURES };
}

const LECTURE_KEYS_CACHE = { keys: Object.keys(BUNDLED_LECTURES), map: BUNDLED_LECTURES };
function lectureKeys() {
  const map = mergedLectures();
  if (LECTURE_KEYS_CACHE.map !== map) {
    LECTURE_KEYS_CACHE.map = map;
    LECTURE_KEYS_CACHE.keys = Object.keys(map);
  }
  return LECTURE_KEYS_CACHE.keys;
}

/**
 * Replace the cloud overlay with a freshly pulled map from Supabase.
 * Call this after pullAnkiBankFromCloud() resolves on app boot.
 */
export function setCloudAnkiOverlay(cloudLecturesMap) {
  CLOUD_LECTURES = cloudLecturesMap && typeof cloudLecturesMap === "object" ? { ...cloudLecturesMap } : {};
  // Force recompute on next access
  LECTURE_KEYS_CACHE.map = null;
}

/** All lecture buckets (bundled + cloud) for browse-style UIs. */
export function listAllAnkiLectureKeys() {
  return lectureKeys().slice().sort();
}

/** Normalize a string for substring matching: lowercase, strip non-alphanum. */
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the Anki bucket(s) that match a given lecture. Tries exact-ish match
 * first, then loose substring match on the lecture title or "Lecture N" / "DLA N"
 * patterns.
 */
export function findAnkiBucketsForLecture({ lectureTitle, lectureNumber, isDLA } = {}) {
  const KEYS = lectureKeys();
  if (!KEYS.length) return [];
  const titleN = norm(lectureTitle);
  const numStr = lectureNumber != null ? String(lectureNumber) : "";
  const matches = [];
  for (const key of KEYS) {
    const keyN = norm(key);
    // Match "CPR Lecture 5" or "CPR DLA 5" by number
    if (numStr) {
      const numRegex = isDLA
        ? new RegExp(`\\bdla\\s*${numStr}\\b`, "i")
        : new RegExp(`\\blecture\\s*${numStr}\\b`, "i");
      if (numRegex.test(keyN)) {
        matches.push(key);
        continue;
      }
    }
    // Match by title fragment (15+ chars overlap)
    if (titleN && titleN.length >= 8) {
      if (keyN.includes(titleN.slice(0, Math.min(titleN.length, 22)))) {
        matches.push(key);
        continue;
      }
      if (titleN.includes(keyN.slice(0, Math.min(keyN.length, 18)))) {
        matches.push(key);
        continue;
      }
    }
  }
  return matches;
}

/**
 * Returns flattened Anki notes for the lecture, capped at maxNotes. Prefers
 * Proper deck notes first (priority source per the spec), then Proper+.
 */
export function getAnkiNotesForLecture(lectureMeta, maxNotes = 25) {
  const buckets = findAnkiBucketsForLecture(lectureMeta);
  if (!buckets.length) return [];
  const lectures = mergedLectures();
  const notes = [];
  for (const key of buckets) {
    notes.push(...(lectures[key] || []));
  }
  // Sort: Proper before Proper+, then shorter (more atomic) first
  notes.sort((a, b) => {
    if (a.source !== b.source) return a.source === "Proper" ? -1 : 1;
    const aLen = (a.answer || "").length;
    const bLen = (b.answer || "").length;
    return aLen - bLen;
  });
  return notes.slice(0, maxNotes);
}

/**
 * Format notes as a compact text block for injection into a generator prompt.
 * Returns "" if nothing matched, so callers can do simple string concat.
 */
export function buildAnkiContextBlock(lectureMeta, maxNotes = 20) {
  const notes = getAnkiNotesForLecture(lectureMeta, maxNotes);
  if (!notes.length) return "";
  const lines = notes.map((n, i) => {
    const src = n.source === "Proper+" ? "Proper+" : "Proper";
    const ans = (n.answer || "").slice(0, 240);
    const extra = n.extra ? ` · ${n.extra.slice(0, 120)}` : "";
    return `${i + 1}. [${src}] ${ans}${extra}`;
  });
  return (
    "PRIORITY SOURCE — student's AnKing Proper / Proper+ deck content for this lecture " +
    "(treat this as the main tested curriculum; preserve school framing and recurring concepts):\n" +
    lines.join("\n")
  );
}

/** True if the bank has any notes for the given lecture. */
export function hasAnkiNotesForLecture(lectureMeta) {
  return findAnkiBucketsForLecture(lectureMeta).length > 0;
}

/** Total note count across all lectures, for diagnostics / sidebar badges. */
export function getAnkiTotalNotes() {
  return Object.values(mergedLectures()).reduce(
    (a, arr) => a + (Array.isArray(arr) ? arr.length : 0),
    0
  );
}

/** Notes for a specific bucket key (used by browse-by-bucket UI). */
export function getNotesForBucketKey(key) {
  return mergedLectures()[key] || [];
}

/**
 * Build the public Supabase Storage URL for an Anki media filename. Returns
 * null if VITE_SUPABASE_URL isn't set (e.g. local dev without env). The actual
 * upload is done one-time via tools/upload-anki-media.mjs — this function just
 * computes where the image lives.
 */
export function resolveAnkiImageURL(filename) {
  const base = import.meta.env?.VITE_SUPABASE_URL;
  if (!base || !filename) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/anki-media/${encodeURIComponent(filename)}`;
}

/**
 * Replace [IMG: filename] markers in note text with <img src="..."> tags.
 * Returns an HTML string. Use in UI surfaces where you trust the upstream
 * content (Anki notes are user-owned, so XSS surface is the user themselves).
 */
export function renderNoteWithImages(text) {
  if (!text) return "";
  return String(text).replace(/\[IMG:\s+([^\]]+?)\s*\]/g, (_, fname) => {
    const url = resolveAnkiImageURL(fname.trim());
    if (!url) return ""; // no env, drop marker
    return `<img src="${url}" alt="${fname.trim()}" loading="lazy" style="max-width:100%;border-radius:6px;margin:6px 0" />`;
  });
}

/**
 * Raw bundled bank data (used by the cloud push helper). Awaits the dynamic
 * import so the caller always gets populated lectures.
 */
export async function getBundledAnkiBank() {
  await ensureAnkiBankLoaded();
  return _bankData || { lectures: {} };
}
