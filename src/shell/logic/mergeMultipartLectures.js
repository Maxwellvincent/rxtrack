import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase.js";
import { encodeDocId } from "../../idCodec.js";
import * as lecturesStore from "../../stores/lectures.js";
import { stripLectureBodyForLocalCache } from "./lectureMetaCache.js";
import { multipartGroups, multipartIdentity, relinkMultipartObjectives } from "./multipartLectures.js";

/** Atomic, recoverable merge: original documents, IDs and historical records remain intact. */
export async function mergeMultipartLectures(userId, candidates) {
  if (!userId || !multipartGroups(candidates).length) return null;
  const ordered = multipartGroups(candidates)[0];
  const targetId = ordered[0].id;
  const merged = await runTransaction(db, async transaction => {
    const refs = ordered.map(row => doc(db, "users", userId, "lectures", encodeDocId(row.id)));
    const objectiveRef = doc(db, "users", userId, "objectives", encodeDocId(ordered[0].blockId));
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    const objectives = await transaction.get(objectiveRef);
    if (snapshots.some(snap => !snap.exists())) throw new Error("A lecture part is still syncing. Retry after sync finishes.");
    const records = snapshots.map((snap, index) => ({ ...snap.data(), data: { ...snap.data().data, id: ordered[index].id } }));
    if (records[0].data.combinedParts > 1) return records[0].data;
    if (records.some(row => row.data.mergedInto)) throw new Error("These parts have already been combined. Refresh the lecture list.");
    if (!multipartGroups(records.map(row => row.data)).length) throw new Error("The source files no longer identify matching lecture parts.");
    if (records.some(row => !row.chunks?.length && !row.data.fullText)) throw new Error("Waiting for both lecture parts to finish uploading.");
    const sourceFiles = records.flatMap((row, index) => (row.data.sourceFiles?.length ? row.data.sourceFiles : [{ filename: row.data.filename || row.data.fileName, ...(row.data.sourceStoragePath ? { storagePath: row.data.sourceStoragePath } : {}) }]).map(file => ({ ...file, part: index + 1, originalLectureId: row.data.id })));
    const chunks = records.flatMap((row, index) => [
      { markdown: `## Part ${index + 1} · ${sourceFiles.find(file => file.part === index + 1)?.filename || "Lecture"}`, sourcePart: index + 1 },
      ...(row.chunks?.length ? row.chunks : [{ markdown: row.data.fullText }]).map(chunk => typeof chunk === "string" ? { markdown: chunk, sourcePart: index + 1 } : { ...chunk, sourcePart: index + 1 }),
    ]);
    const metadata = { ...records[0].data, lectureTitle: multipartIdentity(records[0].data).title, sourceFiles, combinedParts: records.length,
      mergedFrom: records.map(row => ({ id: row.data.id, lectureTitle: row.data.lectureTitle })), filename: sourceFiles.map(file => file.filename).join(" + ") };
    delete metadata.fullText;
    delete metadata.chunks;
    const payload = { data: metadata, chunks, atoms: records.flatMap(row => row.atoms || []), images: records.flatMap(row => row.images || []), updatedAt: serverTimestamp() };
    if (JSON.stringify(payload).length > 900000) throw new Error("These parts exceed the combined lecture size limit. Both originals have been kept.");
    transaction.set(refs[0], payload, { merge: true });
    refs.slice(1).forEach(ref => transaction.set(ref, { data: { mergedInto: targetId }, updatedAt: serverTimestamp() }, { merge: true }));
    if (objectives.exists()) transaction.set(objectiveRef, { data: relinkMultipartObjectives(objectives.data().data, ordered.map(row => row.id), targetId), updatedAt: serverTimestamp() }, { merge: true });
    return metadata;
  });
  // Keep archived metadata too, so a stale sync cannot resurrect the second row.
  const sourceIds = new Set(ordered.slice(1).map(row => row.id));
  const current = lecturesStore.read(userId) || [];
  lecturesStore.writeCloudSaved(userId, current.map(row => row.id === targetId ? stripLectureBodyForLocalCache(merged) : sourceIds.has(row.id) ? { ...row, mergedInto: targetId } : row));
  return merged;
}
