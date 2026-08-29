/**
 * SP1 T2.2 — tie each high-yield atom to the objective(s) it serves.
 *
 * This is the join that SP2's learner model needs: a quiz question is written
 * from an atom, so an atom tagged to an objective turns "got this question
 * wrong" into "this objective is weak" — which is the unit the curriculum is
 * actually written in.
 *
 * Two passes, cheapest first: an exact term match that needs no model at all,
 * then one AI call for whatever is left. Tagging is additive — an atom that
 * matches nothing keeps an empty list rather than a wrong guess.
 */

import { canonicalObjectiveIds } from "./objectiveLinks.js";

const SYSTEM =
  "You map lecture facts onto learning objectives. Return ONLY valid JSON — no markdown, no prose.";

/** Objective text, whichever field this row happens to use. */
export function objectiveText(objective) {
  return String(objective?.objective || objective?.text || "").trim();
}

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Objectives whose text literally contains the atom's term.
 * Catches the easy majority ("Describe the adenohypophysis" ← atom
 * "Adenohypophysis Histology") without spending a token.
 */
export function matchByTerm(atom, objectives) {
  const term = normalize(atom?.term);
  if (term.length < 4) return [];
  return (objectives || [])
    .filter((o) => normalize(objectiveText(o)).includes(term))
    .map((o) => o.id)
    .filter(Boolean);
}

/** Prompt for the leftovers, with objectives numbered so the model can cite them. */
export function buildTagPrompt(atoms, objectives) {
  const objectiveList = objectives
    .map((o, i) => `${i + 1}. ${o.code ? `[${o.code}] ` : ""}${objectiveText(o)}`)
    .join("\n");
  const atomList = atoms.map((a, i) => `${i + 1}. [${a.type}] ${a.term}: ${a.content}`).join("\n");

  return (
    `Each FACT below was extracted from one lecture. Map each fact to the learning objective(s) it helps a student meet.\n\n` +
    `Rules:\n` +
    `- Use ONLY the objective numbers listed. Never invent one.\n` +
    `- A fact may map to several objectives, or to none — an empty list is the right answer when nothing fits.\n` +
    `- Map on what the fact TESTS, not on shared vocabulary.\n\n` +
    `OBJECTIVES:\n${objectiveList}\n\n` +
    `FACTS:\n${atomList}\n\n` +
    `Return ONLY valid JSON: {"tags":[{"fact":1,"objectives":[2,5]}]}`
  );
}

/** Model output → atom index → objective ids, dropping anything out of range. */
export function applyTags(atoms, objectives, raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.tags) ? raw.tags : [];
  const byAtomIndex = new Map();
  for (const row of rows) {
    const atomIndex = Number(row?.fact) - 1;
    if (!Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex >= atoms.length) continue;
    const ids = (Array.isArray(row?.objectives) ? row.objectives : [])
      .map((n) => objectives[Number(n) - 1]?.id)
      .filter(Boolean);
    if (ids.length) byAtomIndex.set(atomIndex, [...new Set(ids)]);
  }
  return atoms.map((atom, i) => ({ ...atom, objectiveIds: byAtomIndex.get(i) || atom.objectiveIds || [] }));
}

/**
 * Tag a lecture's atoms against that lecture's objectives.
 *
 * @returns {Promise<{atoms: object[], tagged: number, byTerm: number, error: string|null}>}
 */
export async function tagAtomsWithObjectives(atoms, objectives, deps = {}) {
  const { callAIJSON, maxTokens = 4000 } = deps;
  const list = Array.isArray(atoms) ? atoms : [];
  const objs = (Array.isArray(objectives) ? objectives : []).filter((o) => o?.id && objectiveText(o));
  if (!list.length) return { atoms: [], tagged: 0, byTerm: 0, error: "No atoms to tag." };
  if (!objs.length) return { atoms: list, tagged: 0, byTerm: 0, error: "This lecture has no objectives linked to it." };

  // Pass 1 — free.
  const seeded = list.map((atom) => {
    const ids = canonicalObjectiveIds([...(atom.objectiveIds || []), ...matchByTerm(atom, objs)], objs);
    return { ...atom, objectiveIds: ids };
  });
  const byTerm = seeded.filter((a) => a.objectiveIds.length).length;

  const remainingIndexes = seeded
    .map((a, i) => (a.objectiveIds.length ? -1 : i))
    .filter((i) => i >= 0);
  if (!remainingIndexes.length) return { atoms: seeded, tagged: byTerm, byTerm, error: null };

  // Pass 2 — one call for the rest.
  try {
    const subset = remainingIndexes.map((i) => seeded[i]);
    const result = await callAIJSON(SYSTEM, buildTagPrompt(subset, objs), { tags: [] }, maxTokens);
    const tagged = applyTags(subset, objs, result);
    const merged = [...seeded];
    remainingIndexes.forEach((atomIndex, subsetIndex) => { merged[atomIndex] = tagged[subsetIndex]; });
    return {
      atoms: merged,
      tagged: merged.filter((a) => a.objectiveIds?.length).length,
      byTerm,
      error: null,
    };
  } catch (e) {
    return { atoms: seeded, tagged: byTerm, byTerm, error: e?.message || String(e) };
  }
}

/** Objective id → number of atoms teaching it. The rollup SP2 will read. */
export function atomsPerObjective(atoms) {
  const counts = {};
  for (const atom of atoms || []) {
    for (const id of atom?.objectiveIds || []) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}
