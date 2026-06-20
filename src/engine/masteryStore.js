const KEY = "rxt-weak-concepts";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}

/** Concepts for a block (array), or []. */
export function readConcepts(blockId) {
  const all = readAll();
  return Array.isArray(all[blockId]) ? all[blockId] : [];
}

/** Upsert a concept (matched by name) into a block, persist, notify. */
export function writeConcept(blockId, concept) {
  if (!blockId || !concept?.concept) return;
  const all = readAll();
  const list = Array.isArray(all[blockId]) ? [...all[blockId]] : [];
  const name = concept.concept.toLowerCase();
  const idx = list.findIndex((c) => (c.concept || "").toLowerCase() === name);
  if (idx === -1) list.push(concept);
  else list[idx] = concept;
  all[blockId] = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  try { window.dispatchEvent(new CustomEvent("rxt-weak-concepts-updated")); } catch {}
}
