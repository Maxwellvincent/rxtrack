import { extractCodeDelimited } from "../ingest/objectives.js";
const codeOf = row => String(row?.code || row?.objectiveCode || "").replace(/\s/g, "").toUpperCase();

/** Conservative screen for reused codes describing unrelated curriculum tasks. */
export function sourceObjectiveTextConflict(a, b) {
 const words = row => new Set(String(row?.objective || row?.text || "").toLowerCase().match(/[a-z]{4,}/g)?.filter(word => !["describe", "identify", "explain", "briefly", "different", "following", "formation", "process", "location", "their", "with", "that", "this", "from", "into", "each", "list"].includes(word)) || []);
 const left = words(a), right = words(b);
 if (left.size < 3 || right.size < 3) return false;
 const overlap = [...left].filter(word => right.has(word)).length;
 return overlap / Math.min(left.size, right.size) < .25;
}

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
 const sourceByCode = new Map(sourceObjectives.map(row => [codeOf(row), row]));
 let changed = false;
 const next = objectives.map(row => {
  if (row.manuallyAligned) return row;
  if (supported.has(codeOf(row))) {
   const source = sourceByCode.get(codeOf(row));
   if (sourceObjectiveTextConflict(row, source)) {
    // Keep the old identity/evidence intact and recover a distinct source identity.
    if (!row.linkedLecId && row.lectureLinkRepair?.reason === "source-code-wording-conflict") return row;
    changed = true;
    return { ...row, linkedLecId: null, sourceFile: null, lectureLinkRepair: { previousLectureId: row.linkedLecId, reason: "source-code-wording-conflict", sourceObjective: source.objective } };
   }
   if (row.linkedLecId === lecture.id) return row;
   changed = true;
   return { ...row, linkedLecId: lecture.id, sourceFile: lecture.id };
  }
  if (row.linkedLecId !== lecture.id) return row;
  changed = true;
  return { ...row, linkedLecId: null, sourceFile: null, lectureLinkRepair: { previousLectureId: lecture.id, reason: "explicit-source-objective-mismatch" } };
 });
 const existingCodes = new Set(next.filter(row => !sourceObjectiveTextConflict(row, sourceByCode.get(codeOf(row)))).map(codeOf));
 for (const row of sourceObjectives) if (!existingCodes.has(codeOf(row))) { next.push(row); changed = true; }
 return changed ? next : objectives;
}
