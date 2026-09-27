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

export function formatLectureLabel(lecture = {}) {
  const rawTitle = cleanLectureTitle(lecture.lectureTitle || lecture.fileName || lecture.title || "");
  const prefix = rawTitle.match(/^(DLA|LEC|LECTURE|SG|TBL)\s*#?\s*(\d+)\s*(?:[-:–.]\s*)?(.*)$/i);
  const number = lecture.lectureNumber ?? (prefix ? Number(prefix[2]) : null);
  const type = lecture.lectureType || (prefix?.[1]?.toUpperCase() === "LECTURE" ? "Lecture" : prefix?.[1]?.toUpperCase());
  const title = prefix && number != null && Number(prefix[2]) === Number(number) ? prefix[3].trim() : rawTitle;
  if (number != null) return `${type || "Lecture"} ${number}${title ? ` · ${title}` : ""}`;
  return rawTitle || lecture.id || "Lecture";
}
