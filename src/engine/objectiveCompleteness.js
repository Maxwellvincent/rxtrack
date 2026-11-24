import { lectureSourceObjectives } from "./sourceObjectiveScope.js";

/**
 * Compare the objective codes printed on a lecture's objective slides with the
 * objectives RxTrack has stored for that lecture. OCR can miss a slide, so a
 * lecture with no detected objective slide is reported as such, never as
 * complete.
 */
export function objectiveCompleteness(lectureText = "", lecture = {}, storedObjectives = [], blockId = null) {
  const stored = new Set((storedObjectives || []).map(o => String(o.code || "").trim()).filter(Boolean));
  const storedCount = (storedObjectives || []).length;
  if (!String(lectureText || "").trim()) return { status: "unknown", slideCount: 0, storedCount, missing: [] };
  const slide = lectureSourceObjectives(lectureText, lecture, blockId).filter(o => o.code);
  if (!slide.length) return { status: "no-slide-objectives", slideCount: 0, storedCount, missing: [] };
  const missing = slide.filter(o => !stored.has(String(o.code).trim())).map(o => ({ code: o.code, text: o.objective || o.text || "" }));
  return { status: missing.length ? "missing" : "complete", slideCount: slide.length, storedCount, missing };
}
