// Keep short Roman numerals: they distinguish otherwise identical lecture titles.
export function cranialNerveScope(text = '') {
  const value = String(text).toLowerCase();
  const names = [[5, /\btrigeminal\b/], [7, /\bfacial nerve\b/], [9, /\bglossopharyngeal\b/], [10, /\bvagus\b/]];
  const found = names.filter(([, pattern]) => pattern.test(value)).map(([number]) => number);
  const heading = value.match(/\b(?:cranial\s+nerves?|cn)\s+((?:viii|xii|iii|vii|xi|iv|vi|ix|ii|v|x|i)(?:\s*(?:,|&|and|\/)\s*(?:viii|xii|iii|vii|xi|iv|vi|ix|ii|v|x|i))*)\b/i)?.[1];
  const roman = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10, xi:11, xii:12 };
  return [...new Set([...found, ...(heading?.match(/[ivx]+/g) || []).map(token => roman[token]).filter(Boolean)])].sort((a,b)=>a-b);
}

export function repairCranialLectureLinks(objectives, lecture, sourceObjectives, lectures = []) {
  const scope = cranialNerveScope(lecture?.lectureTitle || lecture?.title);
  const code = o => String(o?.code || o?.objectiveCode || '').trim().toUpperCase();
  const supported = new Map(sourceObjectives.filter(o => code(o)).map(o => [code(o), o]));
  if (!scope.length || supported.size < 3) return objectives;
  let changed = false;
  const result = objectives.map(objective => {
    if (objective.manuallyAligned) return objective;
    if (supported.has(code(objective))) {
      if (objective.linkedLecId === lecture.id && objective.sourceFile === lecture.id) return objective;
      changed = true;
      return { ...objective, linkedLecId: lecture.id, sourceFile: lecture.id };
    }
    if (objective.linkedLecId !== lecture.id) return objective;
    const target = cranialNerveScope(objective.objective || objective.text);
    if (!target.length || target.some(number => scope.includes(number))) return objective;
    const matches = lectures.filter(other => other.id !== lecture.id && other.blockId === lecture.blockId && target.every(number => cranialNerveScope(other.lectureTitle || other.title).includes(number)));
    const nextId = matches.length === 1 ? matches[0].id : null;
    changed = true;
    return { ...objective, linkedLecId: nextId, sourceFile: nextId,
      lectureLinkRepair: { previousLectureId: lecture.id, reason: 'cranial-nerve-source-mismatch' } };
  });
  const existingCodes = new Set(result.map(code));
  for (const [key, objective] of supported) {
    if (!existingCodes.has(key)) { result.push(objective); changed = true; }
  }
  return changed ? result : objectives;
}
