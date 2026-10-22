import { extractCodeDelimited, OBJECTIVE_START_RE } from "../ingest/objectives.js";
const codeOf = row => String(row?.code || row?.objectiveCode || "").replace(/\s/g, "").toUpperCase();

/** Conservative screen for reused codes describing unrelated curriculum tasks. */
export function sourceObjectiveTextConflict(a, b) {
 const words = row => new Set(String(row?.objective || row?.text || "").toLowerCase().match(/[a-z]{4,}/g)?.filter(word => !["describe", "identify", "explain", "briefly", "different", "following", "formation", "process", "location", "their", "with", "that", "this", "from", "into", "each", "list"].includes(word)) || []);
 const left = words(a), right = words(b);
 if (left.size < 3 || right.size < 3) return false;
 const overlap = [...left].filter(word => right.has(word)).length;
 return overlap / Math.min(left.size, right.size) < .25;
}

const codeWithoutBloom=row=>codeOf(row).replace(/^SOM\.MK(?:\.[IVX]+|[IVX]+)\./,"SOM.MK.");
const normalizedText=row=>String(row.objective || row.text || "").toLowerCase().replace(/\s+/g," ").replace(/[. -]+$/g,"").trim();
export function sourceObjectiveMatch(row,source){
 return codeOf(row)===codeOf(source)?!sourceObjectiveTextConflict(row,source):codeWithoutBloom(row)===codeWithoutBloom(source) && normalizedText(row)===normalizedText(source);
}

/** Only an explicit objective page/table can replace links; slide keywords are not authority. */
export function lectureSourceObjectives(text, lecture, blockId) {
 const source = String(text || "").replace(/\f/g, "\n\f\n");
 const headings=[...source.matchAll(/^[ \t#*]*(?:(?:learning|lecture|DLA)\s+)?objectives[ \t:*#]*$/gim)];
 const found=new Map();
 for(const [index,heading] of headings.entries()){
  const start=heading.index+heading[0].length;
  const tail=source.slice(start,headings[index+1]?.index ?? source.length);
  const end=tail.search(/\f|\n[ \t]*#{1,6}[ \t]+/);
  const table=end<0?tail.slice(0,6000):tail.slice(0,end);
  // Rejoin split two-column codes and normalize whitespace within full codes.
  const aligned=table.replace(/\bBPM\s+(\d)/g,"BPM$1")
   .replace(/SOM\s*\.\s*[A-Za-z0-9]+(?:\s*\.\s*[A-Za-z0-9]+)+\s*\.\s*\d{4}/gi,code=>code.replace(/\s/g,""))
   .replace(/(SOM(?:\.[A-Za-z0-9]+)+\.?)[ \t]*([^\n]*)\n[ \t]*([A-Za-z]+\.\d{4})[ \t]*([^\n]*)/g,
    (_match,prefix,first,suffix,last)=>`${prefix}${suffix}  ${[first,last].filter(Boolean).join(" ")}`);
  const rows=extractCodeDelimited(aligned,lecture,blockId).filter(row=>codeOf(row) && OBJECTIVE_START_RE.test(String(row.objective || row.text || "").slice(0,40)));
  for(const row of rows)if(!found.has(codeOf(row)))found.set(codeOf(row),{...row,id:`source:${lecture.id}:${codeOf(row)}`});
 }
 return [...found.values()];
}

/** Preserve all records and evidence; detach unsupported links without guessing a destination. */
export function repairSourceObjectiveLinks(objectives, lecture, sourceObjectives) {
 if (!lecture?.id || !sourceObjectives.length) return objectives;
 const supported = new Set(sourceObjectives.map(codeOf));
 const sourceByCode = new Map(sourceObjectives.map(row => [codeOf(row), row]));
 // School exports sometimes differ only in the Bloom-level segment of a
 // code. Preserve the practiced identity when the exact objective wording,
 // remaining curriculum code, and prior lecture assignment all agree.
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
   if (row.linkedLecId === lecture.id && (lecture.lectureNumber == null || Number(row.lectureNumber) === Number(lecture.lectureNumber))) return row;
   changed = true;
   return { ...row, linkedLecId: lecture.id, sourceFile: lecture.id, ...(lecture.lectureNumber != null ? {lectureNumber:lecture.lectureNumber} : {}) };
  }
  if (row.linkedLecId !== lecture.id) return row;
  changed = true;
  return { ...row, linkedLecId: null, sourceFile: null, lectureLinkRepair: { previousLectureId: lecture.id, reason: "explicit-source-objective-mismatch" } };
 });
 const existingCodes = new Set(next.filter(row => !sourceObjectiveTextConflict(row, sourceByCode.get(codeOf(row)))).flatMap(row=>[codeOf(row),...(sourceByCode.has(codeOf(row))?[codeOf(sourceByCode.get(codeOf(row)))]:[])]));
 for (const row of sourceObjectives) if (!existingCodes.has(codeOf(row))) { next.push(row); changed = true; }
 return changed ? next : objectives;
}
