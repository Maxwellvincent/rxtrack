/** Keep Cloud-backed slide bodies out of the local lecture-list cache. */
export function stripLectureBodyForLocalCache(lecture = {}) {
  const metadata = { ...lecture };
  for (const field of ["chunks", "fullText", "extractedText", "content"]) delete metadata[field];
  return metadata;
}
