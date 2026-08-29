export function cleanLectureTitle(value) {
  let title = String(value || "").trim();
  if (!title) return "";
  try { title = decodeURIComponent(title.replace(/\+/g, " ")); }
  catch { title = title.replace(/\+/g, " "); }
  return title
    .replace(/\.(?:pdf|md|markdown|txt)$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
