/** Schedule hints narrow attribution; they never establish objective coverage. */
export function curriculumSourceContext(question = {}) {
 const labels=[question.sourceSectionTitle,question.sourceSection,question.sourceTitle,question.sourceFilename,question.filename,question.bankName].filter(Boolean).join(' ');
 const weeks=[...labels.matchAll(/\bweek\s*0*(\d+)\b/gi)].map(m=>Number(m[1]));
 if(question.weekNumber!=null)weeks.push(Number(question.weekNumber));
 const unique=[...new Set(weeks.filter(Number.isFinite))];
 const date=String(question.sourceLectureDate || question.lectureDate || '').slice(0,10);
 return {weekNumber:unique.length===1?unique[0]:null,lectureDate:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:null,conflictingWeeks:unique.length>1};
}
export function scheduleLectureCandidates(question,lectures=[]) {
 const context=curriculumSourceContext(question);
 if(context.conflictingWeeks)return [];
 if(context.lectureDate)return lectures.filter(l=>String(l.lectureDate || '').slice(0,10)===context.lectureDate);
 if(context.weekNumber!=null)return lectures.filter(l=>l.weekNumber!=null && Number(l.weekNumber)===context.weekNumber);
 return [];
}
/** Hierarchy is provenance, never permission to copy credit across blocks. */
export function curriculumMappingProvenance(question,lecture,blockId,basis) {
 return {version:1,blockId,lectureId:lecture.id,...(lecture.termId?{termId:lecture.termId}:{}),scope:'block',basis,sourceContext:curriculumSourceContext(question),crossBlockCredit:false};
}
