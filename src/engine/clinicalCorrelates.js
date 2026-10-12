import NB1_CLINICAL_CORRELATES from "../data/nb1ClinicalCorrelates.json";

/**
 * Shared clinical-signal extraction for lecture and uploaded-question generation.
 *
 * This module deliberately keeps the signals close to the supplied curriculum. It does not
 * try to infer a disease association from general medical knowledge; it only carries forward
 * explicit atom metadata, analyzed question-bank metadata, and conservative stem cues.
 */

const CUE_RULES = [
  ["clinical presentation", /\b(?:year-old|month-old|patient|presents|chief complaint|history of|symptoms?)\b/i],
  ["family / inheritance clue", /family history|parent|sibling|offspring|pedigree|consanguin/i],
  ["laboratory clue", /serum|plasma|urine|blood gas|laboratory|concentration|level|value/i],
  ["anatomic or image clue", /figure|image|micrograph|histolog|biopsy|cross-section|lesion/i],
  ["mechanism lead-in", /mechanism|how does|why does|which process|regulate|transport/i],
  ["decision lead-in", /most likely|best explains|would be expected|which finding|next step/i],
];

const SOURCE_LABELS = {
  lecture: "lecture",
  homework: "homework",
  school: "uploaded school question",
  curated: "NB1 lecture inventory",
};

const asList = (value) => Array.isArray(value) ? value : value ? [value] : [];

export function normalizeClinicalPhrase(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—:•\s]+|[-–—:•\s]+$/g, "")
    .trim();
}

function phraseKey(value) {
  return normalizeClinicalPhrase(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchable(value) {
  return normalizeClinicalPhrase(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lectureSearchText(lecture = {}, lectureTitle = "") {
  return searchable([
    lectureTitle,
    lecture?.lectureTitle,
    lecture?.title,
    lecture?.name,
    lecture?.fileName,
    lecture?.filename,
  ].filter(Boolean).join(" "));
}

function matchesCuratedLecture(entry, haystack) {
  if (!haystack) return false;
  const title = searchable(entry.lectureTitle);
  if (title && haystack.includes(title)) return true;
  if (entry.lectureKey === "dla") return /\b(?:dla|practical clinical neuroimaging)\b/.test(haystack);
  const number = Number(entry.lectureKey);
  if (!Number.isFinite(number)) return false;
  return new RegExp(`\\b(?:lecture|lec|l)\\s*0?${number}\\b`).test(haystack);
}

/** Lecture-explicit NB1 correlates, scoped to the matching lecture only. */
export function curatedClinicalCorrelatesForLecture({ lecture = null, lectureTitle = "", max = 40 } = {}) {
  const haystack = lectureSearchText(lecture || {}, lectureTitle);
  return NB1_CLINICAL_CORRELATES
    .filter((entry) => matchesCuratedLecture(entry, haystack))
    .sort((a, b) => "ABC".indexOf(a.priority) - "ABC".indexOf(b.priority) || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, max))
    .map((entry) => ({ ...entry, curated: true }));
}

function addSignal(signals, value, source, evidence = "") {
  const label = normalizeClinicalPhrase(value);
  const key = phraseKey(label);
  if (!key || key.length < 3 || key.length > 240) return;
  const existing = signals.get(key) || {
    label,
    frequency: 0,
    sourceKinds: new Set(),
    evidence: [],
  };
  existing.frequency += 1;
  existing.sourceKinds.add(source);
  if (evidence && existing.evidence.length < 4 && !existing.evidence.includes(evidence)) {
    existing.evidence.push(evidence);
  }
  signals.set(key, existing);
}

function questionSource(question) {
  return question?.sourceKind === "homework" || question?.sourceKind === "supplemental"
    ? "homework"
    : "school";
}

export function clinicalSignalsFromQuestion(question = {}) {
  const item = question || {};
  const text = `${item.topic || ""} ${item.stem || ""} ${item.explanation || ""}`;
  return {
    cues: CUE_RULES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label),
    explicit: [item.clinicalCorrelate, ...asList(item.clinicalCorrelates), ...asList(item.clinicalCues), ...asList(item.buzzwords), item.inheritancePattern]
      .map(normalizeClinicalPhrase)
      .filter(Boolean),
  };
}

function addAtomSignals(signals, atoms = []) {
  for (const atom of Array.isArray(atoms) ? atoms : []) {
    const evidence = atom?.term ? String(atom.term) : "lecture atom";
    for (const value of [atom?.clinicalCorrelate, ...asList(atom?.clinicalCues), ...asList(atom?.buzzwords), atom?.inheritancePattern]) {
      addSignal(signals, value, "lecture", evidence);
    }
  }
}

function addQuestionSignals(signals, questions = []) {
  for (const question of Array.isArray(questions) ? questions : []) {
    const source = questionSource(question);
    const evidence = question?.id || question?.num ? `question ${question.id || question.num}` : "uploaded question";
    const detected = clinicalSignalsFromQuestion(question);
    for (const value of [...detected.explicit, ...detected.cues]) addSignal(signals, value, source, evidence);
  }
}

function addAnalysisSignals(signals, analyses = []) {
  for (const analysis of Array.isArray(analyses) ? analyses : []) {
    const source = analysis?.sourceKind === "homework" || analysis?.sourceKind === "supplemental" ? "homework" : "school";
    for (const item of Array.isArray(analysis?.items) ? analysis.items : []) {
      const evidence = item?.id ? `analyzed question ${item.id}` : "analyzed uploaded question";
      for (const value of [...asList(item?.clinicalCorrelates), ...asList(item?.clinicalCues), ...asList(item?.buzzwords)]) {
        addSignal(signals, value, source, evidence);
      }
    }
  }
}

/**
 * Return recurring signals that are supported by the lecture and/or uploaded questions.
 * `frequency >= 2` captures recurrence within one source; cross-source support captures a
 * signal mentioned once in lecture and once in homework. The result is plain JSON so it can be
 * passed through generation configs and logged with question provenance.
 */
export function buildClinicalCorrelateLibrary({ atoms = [], examples = [], analyses = [], lecture = null, lectureTitle = "", max = 24 } = {}) {
  const signals = new Map();
  addAtomSignals(signals, atoms);
  addQuestionSignals(signals, examples);
  addAnalysisSignals(signals, analyses);

  for (const curated of curatedClinicalCorrelatesForLecture({ lecture, lectureTitle, max })) {
    const key = phraseKey(curated.label);
    const existing = signals.get(key);
    signals.set(key, {
      ...(existing || { label: curated.label, frequency: 0, sourceKinds: new Set(), evidence: [] }),
      label: curated.label,
      frequency: Math.max(1, existing?.frequency || 0),
      sourceKinds: new Set([...(existing?.sourceKinds || []), "curated"]),
      evidence: [...new Set([...(existing?.evidence || []), curated.sourcePage])].slice(0, 4),
      curated: true,
      id: curated.id,
      priority: curated.priority,
      recognitionCue: curated.recognitionCue,
      structureMechanism: curated.structureMechanism,
      discriminator: curated.discriminator,
      visualSuggestion: curated.visualSuggestion,
      lectureKey: curated.lectureKey,
      lectureTitle: curated.lectureTitle,
      sourcePage: curated.sourcePage,
    });
  }

  return [...signals.values()]
    .filter((entry) => entry.curated || entry.frequency >= 2 || (entry.sourceKinds.has("lecture") && (entry.sourceKinds.has("homework") || entry.sourceKinds.has("school"))))
    .sort((a, b) => {
      if (!!a.curated !== !!b.curated) return a.curated ? -1 : 1;
      const priority = (entry) => "ABC".indexOf(entry.priority || "C");
      if (a.curated && b.curated && priority(a) !== priority(b)) return priority(a) - priority(b);
      const aCrossSource = a.sourceKinds.size > 1 ? 1 : 0;
      const bCrossSource = b.sourceKinds.size > 1 ? 1 : 0;
      return bCrossSource - aCrossSource || b.frequency - a.frequency || a.label.localeCompare(b.label);
    })
    .slice(0, Math.max(0, max))
    .map((entry) => ({
      label: entry.label,
      frequency: entry.frequency,
      sourceKinds: [...entry.sourceKinds].map((source) => SOURCE_LABELS[source] || source),
      evidence: entry.evidence,
      ...(entry.curated ? {
        id: entry.id,
        curated: true,
        priority: entry.priority,
        recognitionCue: entry.recognitionCue,
        structureMechanism: entry.structureMechanism,
        discriminator: entry.discriminator,
        visualSuggestion: entry.visualSuggestion,
        lectureKey: entry.lectureKey,
        lectureTitle: entry.lectureTitle,
        sourcePage: entry.sourcePage,
      } : {}),
    }));
}

/** A deliberate but bounded correlate quota that preserves room for all lecture objectives. */
export function buildClinicalCorrelatePlan(library = [], count = 0, offset = 0) {
  const curated = (Array.isArray(library) ? library : []).filter((entry) => entry?.curated && entry?.id);
  const questionCount = Math.max(0, Math.floor(Number(count) || 0));
  if (!curated.length || !questionCount) return { targetCount: 0, targets: [] };
  const targetCount = Math.min(curated.length, Math.max(1, Math.round(questionCount * 0.4)));
  const stages = ["recognition", "mechanism", "discrimination"];
  const start = Math.max(0, Math.floor(Number(offset) || 0)) % curated.length;
  const rotated = [...curated.slice(start), ...curated.slice(0, start)];
  return {
    targetCount,
    targets: rotated.slice(0, targetCount).map((entry, index) => ({
      id: entry.id,
      label: entry.label,
      priority: entry.priority,
      stage: stages[index % stages.length],
    })),
  };
}

export function renderClinicalCorrelateLibrary(library = []) {
  return (Array.isArray(library) ? library : [])
    .slice(0, 24)
    .map((entry, index) => entry.curated
      ? `${index + 1}. [${entry.id}] [Priority ${entry.priority}] ${entry.label} — recognition: ${entry.recognitionCue}; structure/mechanism: ${entry.structureMechanism}; discriminator: ${entry.discriminator}; source: ${entry.sourcePage}`
      : `${index + 1}. ${entry.label} [${(entry.sourceKinds || []).join(", ")}; repeated ${entry.frequency}x]${entry.evidence?.length ? ` — evidence: ${entry.evidence.join(", ")}` : ""}`)
    .join("\n");
}
