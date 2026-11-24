import { getLecText } from "../../../lectureText.js";
import { lectureTextFrom } from "../lectures/lectureStudy.js";

// Page-delimited text (\f between slides) lets the writer and reviewer receive
// the whole lecture instead of keyword snippets; fall back to the flat text.
const evidenceText = lecture => lectureTextFrom(lecture) || getLecText(lecture);

/** Resolve a lightweight library record without writing large text to localStorage. */
export async function loadExamLectureEvidence(lecture, atoms = [], { userId, fetchContent } = {}) {
  let resolved = lecture || {};
  let lectureText = evidenceText(resolved);
  let facts = atoms.length ? atoms : (Array.isArray(resolved.atoms) ? resolved.atoms : []);
  // Extracted facts are not a substitute for the lecture itself: fetch the text
  // whenever it is missing locally, even if facts are already available.
  if (lectureText.trim().length < 150 && fetchContent && userId && resolved.id) {
    let remote;
    try { remote = await fetchContent(userId, resolved.id); }
    catch (error) {
      throw new Error(`Could not load saved lecture content: ${error?.message || String(error)}. Retry when the connection is available; re-uploading is not required for a connection error.`);
    }
    if (remote) {
      resolved = { ...resolved, ...(remote.meta || {}), ...remote, id: lecture.id, blockId: lecture.blockId };
      lectureText = evidenceText(resolved);
      if (!facts.length) facts = Array.isArray(remote.atoms) ? remote.atoms : [];
    }
  }
  if (lectureText.trim().length < 150 && !facts.length) {
    throw new Error("No usable lecture text or extracted facts were found in the saved content. Open this lecture to check its extraction before retrying.");
  }
  return { lecture: resolved, lectureText, atoms: facts };
}
