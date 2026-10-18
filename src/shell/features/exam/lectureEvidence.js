import { getLecText } from "../../../lectureText.js";

/** Resolve a lightweight library record without writing large text to localStorage. */
export async function loadExamLectureEvidence(lecture, atoms = [], { userId, fetchContent } = {}) {
  let resolved = lecture || {};
  let lectureText = getLecText(resolved);
  let facts = atoms.length ? atoms : (Array.isArray(resolved.atoms) ? resolved.atoms : []);
  if (lectureText.trim().length < 150 && !facts.length && fetchContent && userId && resolved.id) {
    let remote;
    try { remote = await fetchContent(userId, resolved.id); }
    catch (error) {
      throw new Error(`Could not load saved lecture content: ${error?.message || String(error)}. Retry when the connection is available; re-uploading is not required for a connection error.`);
    }
    if (remote) {
      resolved = { ...resolved, ...(remote.meta || {}), ...remote, id: lecture.id, blockId: lecture.blockId };
      lectureText = getLecText(resolved);
      facts = Array.isArray(remote.atoms) ? remote.atoms : [];
    }
  }
  if (lectureText.trim().length < 150 && !facts.length) {
    throw new Error("No usable lecture text or extracted facts were found in the saved content. Open this lecture to check its extraction before retrying.");
  }
  return { lecture: resolved, lectureText, atoms: facts };
}
