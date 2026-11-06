import { LOCAL_WRITER_WIRE, LOCAL_AUDIT_WIRE, LOCAL_FAST_WRITER_WIRE } from './localQuestionWire.js';
import { GENERATED_QUESTION_CONTRACT } from './questionContract.js';
import { numberedAuditEvidence } from './auditEvidence.js';
import { retrieveLectureEvidence } from './schoolAlignment.js';
import { lectureSourceObjectives } from './sourceObjectiveScope.js';
import { preparedLectureCatalog } from './lectureQuestionContext.js';

const objectives = cfg => (cfg.objectives || []).map(o => ({ id: o.id || o.code, code: o.code, text: o.objective || o.text, targetCount: o._targetQuestionCount, targetOrder: o._targetOrder }));
const catalog = (cfg, queries) => preparedLectureCatalog(cfg) || numberedAuditEvidence(
  String(cfg.lectureText || '').trim().length >= 150 ? { ...cfg, atoms: [] } : cfg,
  retrieveLectureEvidence(cfg.lectureText || '', cfg.objectives || [], queries, 7500),
);
const scope = cfg => (preparedLectureCatalog(cfg) && cfg.lectureQuestionContext.scope) || lectureSourceObjectives(cfg.lectureText || '', { id: 'review-scope' }, null)
  .map(o => ({ code: o.code, text: o.objective || o.text }));

export function buildLocalMcqPrompt(cfg, examples = []) {
  return `${catalog(cfg, cfg.atoms || [])}\nWrite ${cfg.count || 1} complete lecture-objective questions in this batch. Return JSON only.
${GENERATED_QUESTION_CONTRACT}
Use a concise patient or functional scenario with a decisive observation. Apply the assigned objective's taught relationship to predict or explain something new. Second-order needs clue interpretation plus application; third-order needs two connected relationships. A defining phrase followed by its name, or a stated outcome followed by its synonym, remains recall. Competing options must require the relationship to distinguish them. Hypothetical settings are allowed; diagnostic relationships and necessary negative findings require lecture evidence. Explain the decisive clue and one positive contradiction per alternative. Source silence is not a reason a distractor is wrong. Use the exact source routes; never combine neighboring pathways. Match the final ask to the objective: for functions or lesion-associated signs, prefer predicting a deficit from a stated lesion or pathway change. Use diagnosis-from-findings only when the objective and taught discriminators support that task. Do not infer a diagnosis from nonspecific symptoms or one imaging adjective. Avoid overlapping anatomical choices unless the supplied source and clue uniquely separate them.
DEPTH CONSTRUCTION CHECK: When the objective concerns clinical signs, an explicitly named diagnosis or lesion followed by a choice of its listed signs is still recall. Do not generate that pattern for a second/third-order allocation. Instead use an unexplained but source-supported pattern of examination findings and require a further supported inference, such as localizing the side and then predicting a different examination result. If the stem states the localization, a second taught relationship or perturbation must be necessary; recalling one associated sign is insufficient. Naming a described symptom is not an inference. Do not add unsupported clinical discriminators to manufacture depth.
REQUESTED DIFFICULTY: ${cfg.difficulty || "medium"}\nOBJECTIVES:\n${JSON.stringify(objectives(cfg))}
SOURCE OBJECTIVE SCOPE (not medical evidence):\n${JSON.stringify(scope(cfg))}
SCHOOL STYLE ONLY (not factual authority):\n${JSON.stringify(examples.map(q => ({ stem: q.stem, choices: q.choices })))}
LEARNER TARGETING (suggestions, not factual authority):\n${String(cfg.focusNotes || '').slice(-1800)}
AVOID PRIOR STEMS:\n${JSON.stringify((cfg.avoidStems || []).slice(-8))}
Choose one assigned primary objective. Quote the source passage supporting the tested relationship. Change the relationship or inference direction when practicing a concept again. Preserve useful school vocabulary. Return every supported complete item; report a specific source shortfall if none can be made.
${(cfg.blindSourceReview ? LOCAL_FAST_WRITER_WIRE : LOCAL_WRITER_WIRE).replace('"requested difficulty"', JSON.stringify(cfg.difficulty || "medium"))}`;
}

export function buildLocalAuditPrompt(questions, cfg) {
  const queries = questions.map(q => ({ term: q.topic, content: `${q.stem} ${JSON.stringify(q.choices)} ${q.explanation}`, sourceQuotes: q.questionPlan?.sourceQuotes || [] }));
  return `${catalog(cfg, queries)}\nIndependently audit every generated question in this batch. Return one review per index. Return JSON only. Fail uncertain items.
${GENERATED_QUESTION_CONTRACT}
Verify the key and every explanation against the source. Find the closest alternative and quote the exact FINAL stem clue excluding it. Source silence is not a positive contradiction. Reject overlapping choices, unstated diagnostic premises, invented relationships, definition matching, outcome restatement and lower-than-assigned reasoning. Hypothetical patients and observations are allowed when their interpretation uses taught rules. Second-order requires interpreting a clue and applying a relationship; third-order requires two connected relationships. Verify actual depth, not the writer's label.
Independently choose the strongest source objective, then compare it with the assigned objective. Return objectiveAligned:false for a different target. Quote the exact assigned objective clause; report its exact source code and why it fits better than the nearest neighbor. Objective text is scope, never factual evidence. Cite evidenceIds from the source catalog. Third-order needs two distinct source excerpts. Return all required verdict fields; omissions cannot establish approval.
OBJECTIVES:\n${JSON.stringify(objectives(cfg))}
NEIGHBORING SOURCE OBJECTIVES:\n${JSON.stringify(scope(cfg))}
QUESTIONS:\n${JSON.stringify(questions)}
${LOCAL_AUDIT_WIRE}
Reject with specific issues such as incorrect_key, ambiguous_key, unsupported_fact, objective_mismatch, answer_choice_shortcut, order_level_mismatch, weak_explanation, non_discriminating_clues. Never return replacement questions.`;
}
