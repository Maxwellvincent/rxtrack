// User-supplied Study Buddy examples are writing benchmarks, never a question
// bank, answer history, source key, or factual authority for another lecture.
export const QUESTION_WRITING_BENCHMARKS = [
  { id: "csf-absorption", concepts: [/hydrocephalus/i, /arachnoid|csf absorption/i], order: "second-order",
    stem: "A 68-year-old man develops progressive difficulty walking, urinary incontinence, and cognitive impairment. Brain imaging shows enlargement of all four ventricles. Impaired function of which of the following structures most likely explains this patient’s condition?",
    choices: ["Cerebral aqueduct", "Interventricular foramen", "Arachnoid villi", "Foramen of Luschka", "Central canal of the spinal cord"],
    writingLesson: "Clinical and ventricular findings lead to one requested absorption structure; do not claim the ventricular pattern alone proves a specific diagnosis." },
  { id: "cellular-edema", concepts: [/edema|swelling/i, /ischemia|cytotoxic|intracellular/i], order: "second-order",
    stem: "A patient with cerebral ischemia develops brain swelling. The blood-brain barrier remains intact, but neurons and glial cells accumulate intracellular Na⁺ and water. Which of the following mechanisms most likely accounts for this finding?",
    choices: ["Increased capillary permeability", "Failure of ATP-dependent Na⁺/K⁺ pumps", "Increased CSF secretion by the choroid plexus", "Impaired CSF absorption at arachnoid villi", "Disruption of endothelial tight junctions"],
    writingLesson: "The compartment and intact barrier discriminate the mechanism. The ischemic context matters; a longer vignette would not add reasoning." },
  { id: "bbb-transport", concepts: [/blood.brain barrier|\bbbb\b/i, /glucose|facilitated diffusion/i], order: "first-order",
    stem: "A pharmacologist compares the ability of several substances to enter the CNS. One compound has poor lipid solubility but nevertheless readily enters the brain through facilitated diffusion. Which of the following substances most likely uses this mechanism?",
    choices: ["Mannitol", "Dopamine", "Glucose", "Sodium", "Penicillin"],
    writingLesson: "A useful focused recall item, not advanced reasoning merely because it has an experimental setting." },
  { id: "csf-obstruction", concepts: [/ventricle|hydrocephalus/i, /aqueduct|obstruction/i], order: "second-order",
    stem: "A 6-month-old infant is brought to the physician because of increasing head circumference and downward deviation of the eyes. Imaging demonstrates marked enlargement of both lateral ventricles and the third ventricle, with a normal-sized fourth ventricle. Obstruction at which site best explains these findings?",
    choices: ["Arachnoid villi", "Cerebral aqueduct", "Foramen of Magendie", "Superior sagittal sinus", "Bilateral foramina of Luschka"],
    writingLesson: "Interpret the upstream/downstream ventricular pattern to localize one obstruction. Do not inflate this to third order by splitting localization into several listed steps." },
  { id: "vascular-edema", concepts: [/edema|swelling/i, /vasogenic|white matter|plasma filtrate/i], order: "second-order",
    stem: "A patient with a brain tumor develops cerebral edema. Analysis indicates accumulation of protein-containing plasma filtrate predominantly in the white matter. Which of the following changes is most directly responsible?",
    choices: ["Failure of neuronal Na⁺/K⁺-ATPase", "Decreased CSF production", "Increased permeability of cerebral capillaries", "Increased intracellular osmolarity with an intact BBB", "Obstruction of the cerebral aqueduct"],
    writingLesson: "Fluid composition and distribution discriminate the mechanism. Distractors represent a competing edema model or CSF-flow mechanism." },
];

export function questionWritingBenchmarkPrompt({ objectives = [], atoms = [], lectureText = "" } = {}) {
  const context = [lectureText, ...objectives.map(o => o.objective || o.text || ""), ...atoms.map(a => `${a.term || ""} ${a.content || ""}`)].join(" ");
  const focused = [...objectives.map(o => o.objective || o.text || ""), ...atoms.map(a => `${a.term || ""} ${a.content || ""}`)].join(" ").trim();
  const examples = QUESTION_WRITING_BENCHMARKS
    .map(example => ({ example, relevance: example.concepts.filter(pattern => pattern.test(focused || context)).length }))
    .filter(({ example, relevance }) => relevance > 0 && example.concepts.every(pattern => pattern.test(context)))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 2).map(({ example }) => example);
  return `\nQUESTION WRITING STANDARD: Use one focused endpoint, concise discriminating clues, and plausible alternatives representing nearby misconceptions. Short clinical or experimental items are welcome when they genuinely apply a relationship. First-order recall remains first order even in a patient story. Third-order means integrating two distinct source-supported relationships to predict something new, not enumerating substeps of one localization task. Explain the decisive clue-to-answer connection in 1-3 sentences; give one concise misconception contrast per distractor. Do not repeat the answer explanation in every choice note.\n` +
    (examples.length ? `USER-SUPPLIED WRITING BENCHMARKS (not official school questions or medical evidence; no credit or answers imported):\n${JSON.stringify(examples.map(({ id, stem, choices, order, writingLesson }) => ({ id, stem, choices, assessedOrder: order, writingLesson })))}\nUse their clarity and clue-to-target construction, not their wording or factual claims. Supplied lecture evidence must independently support every new item. Official ExamSoft/IMCQ examples remain the school-style reference.\n` : "");
}
