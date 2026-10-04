/** Build a compact first-pass teaching plan from lecture objectives and atoms. */
const STOP_WORDS = new Set("the and of to in for with from a an how what which identify explain describe understand compare determine role relationship system".split(" "));

function words(value = "") {
  return new Set(String(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word)));
}

function objectiveId(objective, index) {
  return String(objective?.id || objective?.code || objective?.objective || `objective-${index + 1}`);
}

export function buildTeachingBlocks(objectives = [], atoms = [], maxBlocks = 6) {
  const rows = (objectives || []).filter(Boolean).map((objective, index) => ({
    id: objectiveId(objective, index),
    title: objective?.objective || objective?.text || objective?.title || `Objective ${index + 1}`,
    tokens: words(objective?.objective || objective?.text || objective?.title),
  }));
  if (!rows.length) return [];
  const groups = [];
  for (const row of rows) {
    const prior = groups.at(-1);
    const overlap = prior ? [...row.tokens].filter((token) => prior.tokens.has(token)).length : 0;
    if (prior && (overlap > 0 || groups.length >= maxBlocks)) {
      prior.objectiveIds.push(row.id);
      prior.objectives.push(row.title);
      row.tokens.forEach((token) => prior.tokens.add(token));
    } else {
      groups.push({ id: `block-${groups.length + 1}`, title: row.title, objectiveIds: [row.id], objectives: [row.title], tokens: new Set(row.tokens), status: "untouched", phase: "orient", completedEvidence: [] });
    }
  }
  return groups.map((block, index) => {
    const linkedAtoms = (atoms || []).filter((atom) => (atom.objectiveIds || atom.objectives || []).map(String).some((id) => block.objectiveIds.includes(id)));
    return {
      id: block.id,
      title: block.objectives.length > 1 ? `${block.title} + ${block.objectives.length - 1} related objective${block.objectives.length > 2 ? "s" : ""}` : block.title,
      objectiveIds: block.objectiveIds,
      sourceAtomIds: linkedAtoms.slice(0, 18).map((atom) => String(atom.id || atom.term || "")),
      masterModel: "Build the plain-language model first, then attach the lecture terms and clinical consequences.",
      status: index === 0 ? "teaching" : "untouched",
      phase: index === 0 ? "orient" : "orient",
      internalProgress: 0,
    };
  });
}

export function lectureModelFromBlocks(blocks = [], title = "this lecture") {
  if (!blocks.length) return `This lecture builds a connected model of ${title}. We will group the objectives into teachable blocks, then use them to reason through clinical problems.`;
  const names = blocks.slice(0, 4).map((block) => block.title).join(", ");
  return `This lecture builds a connected model through ${blocks.length} teaching blocks: ${names}${blocks.length > 4 ? ", and later applications" : ""}. We will establish each block before asking you to retrieve or apply it.`;
}
