import { extractCodeDelimited } from "../ingest/objectives.js";
const codeOf = row => String(row?.code || row?.objectiveCode || "").replace(/\s/g, "").toUpperCase();

/** Only an explicit objective page/table can replace links; slide keywords are not authority. */
export function lectureSourceObjectives(text, lecture, blockId) {
 const source = String(text || "").replace(/\f/g, "\n\f\n");
 const heading = /^[ \t#*]*(?:(?:learning|lecture|DLA)\s+)?objectives[ \t:*#]*$/im.exec(source);
 if (!heading) return [];
 const start = heading.index + heading[0].length;
 const tail = source.slice(start);
 const end = tail.search(/\f|\n[ \t]*#{1,6}[ \t]+/);
 const table = end < 0 ? tail.slice(0, 6000) : tail.slice(0, end);
 const rows = extractCodeDelimited(table, lecture, blockId).filter(row => codeOf(row) && /^(?:describe|explain|list|identify|compare|outline|discuss|define|understand|recognize|distinguish|summarize|trace|relate|state|name|differentiate|predict|interpret|analy[sz]e)\b/i.test(row.objective || row.text || ""));
 return rows.map(row => ({ ...row, id: `source:${lecture.id}:${codeOf(row)}` }));
}

/** Preserve all records and evidence; detach unsupported links without guessing a destination. */
export function repairSourceObjectiveLinks(objectives, lecture, sourceObjectives) {
 if (!lecture?.id || !sourceObjectives.length) return objectives;
 const supported = new Set(sourceObjectives.map(codeOf));
 let changed = false;
 const next = objectives.map(row => {
  if (row.manuallyAligned) return row;
  if (supported.has(codeOf(row))) {
   if (row.linkedLecId === lecture.id) return row;
   changed = true;
   return { ...row, linkedLecId: lecture.id, sourceFile: lecture.id };
  }
  if (row.linkedLecId !== lecture.id) return row;
  changed = true;
  return { ...row, linkedLecId: null, sourceFile: null, lectureLinkRepair: { previousLectureId: lecture.id, reason: "explicit-source-objective-mismatch" } };
 });
 const existingCodes = new Set(next.map(codeOf));
 for (const row of sourceObjectives) if (!existingCodes.has(codeOf(row))) { next.push(row); changed = true; }
 return changed ? next : objectives;
}
