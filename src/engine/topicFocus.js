// "Practice a topic": find the objectives and lectures in one block that a typed
// topic covers (objective wording, key facts, lecture titles), with common
// neuro/vascular abbreviations expanded so "PICA" matches the spelled-out form.

const ABBREVIATIONS = {
  pica: "posterior inferior cerebellar artery lateral medullary wallenberg",
  aica: "anterior inferior cerebellar artery lateral pontine",
  sca: "superior cerebellar artery",
  mca: "middle cerebral artery",
  aca: "anterior cerebral artery",
  pca: "posterior cerebral artery",
  asa: "anterior spinal artery medial medullary",
  ica: "internal carotid artery",
  cn: "cranial nerve",
  mlf: "medial longitudinal fasciculus internuclear ophthalmoplegia",
  dcml: "dorsal column medial lemniscus",
  umn: "upper motor neuron",
  lmn: "lower motor neuron",
  mdd: "major depressive disorder",
  gad: "generalized anxiety disorder",
  ptsd: "posttraumatic stress disorder",
  ocd: "obsessive compulsive disorder",
};
const STOP = new Set("the and for with from into vs versus lesion lesions questions question practice about what which how why of on in to a an syndrome syndromes".split(" "));

// Light stemming so "medulla"/"medullary", "artery"/"arteries" compare equal.
const stem = word => word.length >= 6 ? word.replace(/(?:ary|aries|ies|es|s|a)$/, "") : word.replace(/s$/, "");
const tokenize = text => String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const wordsOf = text => new Set(tokenize(text).map(stem));

/** Each query part ("PICA", "medial medulla") is a concept: all of its words, or an abbreviation's full name. */
function concepts(query) {
  return String(query || "").split(/,|;|\/|\bvs\.?\b|\bversus\b|\bor\b|\band\b/i).map(part => {
    const words = tokenize(part).filter(word => word.length >= 3 && !STOP.has(word));
    if (!words.length) return null;
    const acronyms = words.filter(word => ABBREVIATIONS[word]);
    // An abbreviation must appear in capitals ("PICA", not the eating disorder "pica").
    const alternatives = [{ words: words.filter(word => !ABBREVIATIONS[word]).map(stem), acronyms: acronyms.map(word => word.toUpperCase()) }];
    for (const word of acronyms) alternatives.push({ words: ABBREVIATIONS[word].split(" ").slice(0, 4).map(stem), acronyms: [] });
    return { label: words.join(" "), alternatives };
  }).filter(Boolean);
}
/** True when one sentence/line of raw text contains every word of an alternative. */
function conceptIn(concept, rawText) {
  const segments = String(rawText || "").split(/(?<=[.!?])\s+|\n+/);
  return segments.some(segment => {
    const words = wordsOf(segment);
    return concept.alternatives.some(alt => (alt.words.length || alt.acronyms.length)
      && alt.words.every(word => words.has(word))
      && alt.acronyms.every(acronym => new RegExp(`\\b${acronym}\\b`).test(segment)));
  });
}
const countIn = (concept, rawText) => String(rawText || "").split(/(?<=[.!?])\s+|\n+/).filter(segment => conceptIn(concept, segment)).length;

/**
 * Objectives in one block that a typed topic covers. Signals: objective wording (3),
 * key facts (2), the lecture's own text (lectureTexts, loaded on demand) and title (1).
 */
export function matchTopicObjectives(query, { blockId, lectures = [], objectives = [], lectureTexts = {} } = {}) {
  const wanted = concepts(query);
  if (!wanted.length) return { objectives: [], lectures: [] };
  const blockLectures = new Map(lectures.filter(lecture => lecture.blockId === blockId && !lecture.mergedInto).map(lecture => [lecture.id, lecture]));
  const textHits = new Map([...blockLectures.keys()].map(id => [id, wanted.map(concept => ({ concept, n: countIn(concept, lectureTexts[id]) })).filter(row => row.n > 0)]));
  const rows = [];
  for (const objective of objectives) {
    const lecture = blockLectures.get(objective.linkedLecId);
    if (!lecture) continue;
    const reasons = [];
    let score = 0;
    const text = objective.objective || objective.text || "";
    const inObjective = wanted.filter(concept => conceptIn(concept, text));
    if (inObjective.length) { score += 3 * inObjective.length; reasons.push(`objective: ${inObjective.map(c => c.label).join(", ")}`); }
    const facts = (lecture.atoms || []).filter(atom => !(atom.objectiveIds || []).length || atom.objectiveIds.includes(objective.id)).map(atom => `${atom.term || ""}. ${atom.content || ""}`);
    const inFacts = wanted.filter(concept => !inObjective.includes(concept) && facts.some(fact => conceptIn(concept, fact)));
    if (inFacts.length) { score += 2 * inFacts.length; reasons.push(`key facts: ${inFacts.map(c => c.label).join(", ")}`); }
    const lectureHits = textHits.get(lecture.id) || [];
    if (lectureHits.length) {
      // Lecture text identifies the lecture; prefer its clinical/lesion objectives.
      const clinical = /lesion|locali|clinical|deficit|syndrome|stroke|blood supply|arter|vascular|disorder|diagnos|differentiat/i.test(text) ? 1 : 0;
      score += Math.min(4, lectureHits.reduce((sum, row) => sum + row.n, 0)) / 2 + clinical;
      reasons.push(`lecture text: ${lectureHits.map(row => `${row.concept.label} ×${row.n}`).join(", ")}`);
    }
    const inTitle = wanted.filter(concept => conceptIn(concept, lecture.lectureTitle || lecture.title));
    if (inTitle.length) { score += inTitle.length; reasons.push(`lecture title: ${inTitle.map(c => c.label).join(", ")}`); }
    if (score >= 2) rows.push({ id: objective.id, objective, lectureId: lecture.id, lectureTitle: lecture.lectureTitle || lecture.title, score, reasons });
  }
  rows.sort((a, b) => b.score - a.score || String(a.objective.objective).localeCompare(String(b.objective.objective)));
  const top = rows.slice(0, 8);
  const lectureRows = [...new Map(top.map(row => [row.lectureId, { id: row.lectureId, title: row.lectureTitle }])).values()];
  return { objectives: top, lectures: lectureRows };
}

export function topicFocusNotes(query) {
  return `TOPIC PRACTICE: "${String(query).trim()}". Keep every item on this topic within the selected objectives. Follow each objective's mastery-ladder step: repair what was missed first, then recall, application, and look-alike discrimination between the contrasts this topic is known for (for example neighbouring vascular territories or syndromes), then integration. Vary the clinical findings and requested endpoint across items instead of repeating one fact.`;
}
