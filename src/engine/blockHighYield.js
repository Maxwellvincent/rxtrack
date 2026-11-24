// What a block's school assessments emphasize, measured from the learner's
// own uploaded questions (only exact codes and stored links count), combined
// with score-report weaknesses and unfinished objectives. It describes the
// evidence available; with few linked questions it is a weak signal.

const WEIGHTS = { esoft: 3, imcq: 2, homework: 1 };
const CODE_RE = /SOM\.[A-Z]{2}\.[IVX]+\.[A-Z0-9]+\.\d\.NB\.\d\.[A-Z]+\.\d{4}|SOM\.[A-Z0-9.]+\.\d{4}/g;

function bankTier(filename = "", meta = {}) {
  const label = `${filename} ${meta.sourceKind || ""}`.toLowerCase();
  if (/clicker|in[- ]?class/.test(label)) return "clicker";
  if (/esoft|examsoft/.test(label)) return "esoft";
  if (/imcq/.test(label)) return "imcq";
  return "homework";
}

const TASK_PATTERNS = [
  ["diagnostic criteria", /diagnostic criteria|diagnos(e|is|tic)/i],
  ["differentiate", /differentiat|distinguish|contrast|compare/i],
  ["management & drugs", /management|treatment|mechanisms? of action|side effects|pharmac/i],
  ["lesion → deficit", /lesion|damage|dysfunction|deficit|localiz/i],
  ["mechanism / pathway", /mechanism|pathway|circuit|neural|physiolog/i],
];
export function objectiveTaskKind(text = "") {
  return TASK_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || "describe / recall";
}

export function blockHighYield({ blockId, lectures = [], objectives = [], banks = {}, bankMeta = {}, weakConcepts = {} } = {}) {
  const blockLectures = lectures.filter(lecture => lecture.blockId === blockId && !lecture.mergedInto);
  const lectureIds = new Set(blockLectures.map(lecture => lecture.id));
  const blockObjectives = objectives.filter(objective => lectureIds.has(objective.linkedLecId));
  const byId = new Map(blockObjectives.map(objective => [String(objective.id), objective]));
  const byCode = new Map(blockObjectives.filter(objective => objective.code).map(objective => [objective.code, objective]));
  const metaByFile = new Map(Object.values(bankMeta || {}).filter(meta => meta?.filename).map(meta => [meta.filename, meta]));
  const counts = new Map(), lectureQuestions = new Map();
  const coverage = { schoolQuestions: 0, linkedToObjective: 0, linkedToLecture: 0, unlinked: 0 };

  for (const [filename, questions] of Object.entries(banks || {})) {
    const meta = metaByFile.get(filename) || {};
    if (meta.blockId !== blockId || !Array.isArray(questions)) continue;
    const tier = bankTier(filename, meta);
    if (tier === "clicker") continue;
    for (const question of questions) {
      if (!question?.stem || !question.correct) continue;
      coverage.schoolQuestions += 1;
      const ids = new Set((question.objectiveIds || []).map(String).filter(id => byId.has(id)));
      const codes = [question.schoolObjectiveCode, ...(question.schoolObjectiveCodes || [])].join(" ").match(CODE_RE) || [];
      for (const code of codes) if (byCode.has(code)) ids.add(String(byCode.get(code).id));
      for (const id of ids) {
        const row = counts.get(id) || {};
        row[tier] = (row[tier] || 0) + 1;
        counts.set(id, row);
      }
      const lectureId = lectureIds.has(question.lectureId) ? question.lectureId : ids.size ? byId.get([...ids][0]).linkedLecId : null;
      if (lectureId) lectureQuestions.set(lectureId, (lectureQuestions.get(lectureId) || 0) + 1);
      if (ids.size) coverage.linkedToObjective += 1;
      else if (lectureId) coverage.linkedToLecture += 1;
      else coverage.unlinked += 1;
    }
  }

  const score = row => Object.entries(row || {}).reduce((sum, [tier, n]) => sum + (WEIGHTS[tier] || 0) * n, 0);
  const objectiveRows = blockObjectives.map(objective => ({
    id: String(objective.id), code: objective.code || null, lectureId: objective.linkedLecId,
    text: objective.objective || objective.text || "", status: String(objective.status || "untested").toLowerCase(),
    kind: objectiveTaskKind(objective.objective || objective.text), counts: counts.get(String(objective.id)) || {},
    schoolScore: score(counts.get(String(objective.id))),
  })).sort((a, b) => b.schoolScore - a.schoolScore || a.text.localeCompare(b.text));

  const reports = (weakConcepts?.[blockId] || []).filter(entry => entry?.tags?.includes("exam-report"));
  const lectureRows = blockLectures.map(lecture => {
    const own = objectiveRows.filter(row => row.lectureId === lecture.id);
    const weakReports = reports.filter(entry => (entry.linkedLecIds || []).includes(lecture.id));
    const struggling = own.filter(row => ["struggling", "needs_repair"].includes(row.status)).length;
    const untested = own.filter(row => row.status === "untested" || !row.status).length;
    const schoolScore = own.reduce((sum, row) => sum + row.schoolScore, 0);
    const questionCount = lectureQuestions.get(lecture.id) || 0;
    const reasons = [];
    if (questionCount) reasons.push(`${questionCount} school question${questionCount === 1 ? "" : "s"}`);
    if (weakReports.length) reasons.push(`weak on score report (${weakReports.map(entry => entry.concept).join(", ")})`);
    if (struggling) reasons.push(`${struggling} objective${struggling === 1 ? "" : "s"} struggling`);
    if (untested) reasons.push(`${untested}/${own.length} objectives untested`);
    const priority = schoolScore * 2 + questionCount + weakReports.length * 6 + struggling * 3 + (own.length ? untested / own.length * 2 : 0);
    return { lectureId: lecture.id, title: lecture.lectureTitle || lecture.fileName || lecture.id, number: lecture.lectureNumber ?? null,
      questionCount, schoolScore, reportWeak: weakReports.length > 0, struggling, untested, objectiveCount: own.length, priority, reasons,
      topObjectives: own.filter(row => row.schoolScore > 0).slice(0, 3) };
  }).sort((a, b) => b.priority - a.priority || String(a.title).localeCompare(String(b.title)));

  const kinds = new Map();
  for (const row of objectiveRows) {
    const entry = kinds.get(row.kind) || { kind: row.kind, objectives: 0, schoolScore: 0 };
    entry.objectives += 1; entry.schoolScore += row.schoolScore;
    kinds.set(row.kind, entry);
  }
  const taskKinds = [...kinds.values()].sort((a, b) => b.schoolScore - a.schoolScore || b.objectives - a.objectives);
  return { lectures: lectureRows.filter(row => row.priority > 0), objectives: objectiveRows, taskKinds, coverage };
}
