/** Normalize source IDs/codes without inventing a semantic mapping. */
export function canonicalObjectiveIds(ids = [], objectives = []) {
  const byRef = new Map();
  for (const o of objectives) {
    if (!o?.id) continue;
    byRef.set(String(o.id), o.id);
    if (o.code) byRef.set(String(o.code), o.id);
  }
  return [...new Set(ids.map(id => byRef.get(String(id))).filter(Boolean))];
}

export function objectiveCoverage(atoms = [], objectives = []) {
  const counts = Object.fromEntries(objectives.map(o => [o.id, 0]));
  let linkedAtoms = 0;
  for (const atom of atoms) {
    const ids = canonicalObjectiveIds(atom.objectiveIds || [], objectives);
    if (ids.length) linkedAtoms++;
    ids.forEach(id => counts[id]++);
  }
  return { counts, linkedAtoms, unlinkedAtoms: atoms.length - linkedAtoms, uncovered: objectives.filter(o => !counts[o.id]) };
}
