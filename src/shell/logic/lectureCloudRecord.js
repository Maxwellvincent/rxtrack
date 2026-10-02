/** Atom/image writes can create a Firestore document before lecture metadata
 * exists. Such enrichment-only documents are not lecture-list entries. */
export function hasLectureMetadata(data) {
  const meta = data?.data;
  return Boolean(meta && typeof meta === "object" && [
    meta.lectureTitle, meta.title, meta.fileName, meta.filename,
  ].some((value) => String(value || "").trim()));
}
