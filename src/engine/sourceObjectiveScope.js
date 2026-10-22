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
 // PDF columns can interleave the objective sentence between a SOM prefix
 // and its subject/number on the next line. Rejoin the code before parsing.
 const aligned = table.replace(/(SOM(?:\.[A-Za-z0-9]+)+\.?)[ \t]*([^\n]*)\n[ \t]*([A-Za-z]+\.\d{4})[ \t]*([^\n]*)/g,
  (_match,prefix,first,suffix,last)=>`${prefix}${suffix}  ${[first,last].filter(Boolean).join(" ")}`);
 const rows = extractCodeDelimited(aligned, lecture, blockId).filter(row => codeOf(row) && /^(?:describe|explain|list|identify|compare|contrast|outline|discuss|define|understand|recognize|distinguish|summarize|trace|relate|state|name|differentiate|predict|interpret|analy[sz]e)\b/i.test(row.objective || row.text || ""));
 return rows.map(row => ({ ...row, id: `source:${lecture.id}:${codeOf(row)}` }));
}

/** Preserve all records and evidence; detach unsupported links without guessing a destination. */
export function repairSourceObjectiveLinks(objectives, lecture, sourceObjectives) {
 if (!lecture?.id || !sourceObjectives.length) return objectives;
 const supported = new Set(sourceObjectives.map(codeOf));
 const sourceByCode = new Map(sourceObjectives.map(row => [codeOf(row), row]));
 // School exports sometimes differ only in the Bloom-level segment of a
 // code. Preserve the practiced identity when the exact objective wording,
 // remaining curriculum code, and prior lecture assignment all agree.
 const codeWithoutBloom=row=>codeOf(row).replace(/^SOM\.MK(?:\.[IVX]+|[IVX]+)\./,"SOM.MK.");
 const normalizedText=row=>String(row.objective || row.text || "").toLowerCase().replace(/\s+/g," ").replace(/[. -]+$/g,"").trim();
 for(const row of objectives){
  if(supported.has(codeOf(row)) || !(row.linkedLecId===lecture.id || row.lectureLinkRepair?.previousLectureId===lecture.id))continue;
  const matches=sourceObjectives.filter(source=>normalizedText(source)===normalizedText(row) && codeWithoutBloom(source)===codeWithoutBloom(row));
  if(matches.length===1){supported.add(codeOf(row));sourceByCode.set(codeOf(row),matches[0]);}
 }
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
 const existingCodes = new Set(next.filter(row => !sourceObjectiveTextConflict(row, sourceByCode.get(codeOf(row)))).flatMap(row=>[codeOf(row),...(sourceByCode.has(codeOf(row))?[codeOf(sourceByCode.get(codeOf(row)))]:[])]));
 for (const row of sourceObjectives) if (!existingCodes.has(codeOf(row))) { next.push(row); changed = true; }
 return changed ? next : objectives;
}
