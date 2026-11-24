import { alignSchoolQuestions } from "./schoolAlignment.js";
import { exemplarSourceTier } from "./mcq.js";

// Only exact school objective codes and stored objective links count as
// "the school tests this objective". Word overlap is a retrieval hint, not
// evidence of emphasis, so it never contributes to the ranking.
const EMPHASIS_BASES = new Set(["school-code", "candidate-stored-link"]);

/** Count uploaded school questions tied to each objective (clickers excluded). */
export function schoolEmphasisCounts(examples = [], objectives = []) {
  const counts = new Map();
  const eligible = (examples || []).filter(question => exemplarSourceTier(question) !== "clicker");
  if (!eligible.length || !objectives?.length) return counts;
  for (const { links } of alignSchoolQuestions(eligible, objectives, [])) {
    const ids = new Set(links.filter(link => link.kind === "objective" && EMPHASIS_BASES.has(link.basis)).map(link => String(link.targetId)));
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

/** Annotate objectives with `_schoolEmphasis`; a tie-break, never a status override. */
export function withSchoolEmphasis(objectives = [], examples = []) {
  const counts = schoolEmphasisCounts(examples, objectives);
  if (!counts.size) return objectives;
  return objectives.map(objective => {
    const count = counts.get(String(objective.id || objective.code)) || 0;
    return count ? { ...objective, _schoolEmphasis: count } : objective;
  });
}
