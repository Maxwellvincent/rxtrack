import { callAIJSON } from "../aiClient.js";

function clamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** Validate + clamp a model diagram spec into a safe renderable shape, or null. */
export function normalizeDiagram(spec) {
  if (!spec || typeof spec !== "object") return null;
  const nodes = (Array.isArray(spec.nodes) ? spec.nodes : [])
    .filter((n) => n && n.id != null && typeof n.label === "string" && n.label.trim())
    .slice(0, 8)
    .map((n) => ({
      id: String(n.id),
      label: String(n.label).slice(0, 60),
      x: clamp(n.x, 0, 100, 50),
      y: clamp(n.y, 0, 100, 50),
      detail: typeof n.detail === "string" ? n.detail.slice(0, 300) : "",
    }));
  if (nodes.length < 2) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(spec.edges) ? spec.edges : [])
    .map((e) => e && { from: String(e.from), to: String(e.to), label: typeof e.label === "string" ? e.label.slice(0, 30) : "" })
    .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  return { title: typeof spec.title === "string" ? spec.title.slice(0, 80) : "", nodes, edges };
}

const SYS =
  "You produce CONCEPTUAL mechanism diagrams as JSON. Schematic boxes + arrows only — " +
  "never describe or imply photorealistic anatomy. Plain high-yield labels.";

/** Ask the AI for a conceptual cause→effect diagram of the concept/mechanism. */
export async function generateDiagram(concept, mechanism) {
  const prompt =
    `Concept: "${concept}". Mechanism: ${mechanism || "(none given)"}.\n` +
    `Return a conceptual cause→effect diagram as JSON only:\n` +
    `{"title":"short title","nodes":[{"id":"n1","label":"short step label","x":0-100,"y":0-100,"detail":"what happens here, 1-2 sentences"}],"edges":[{"from":"n1","to":"n2","label":""}]}\n` +
    `Use 3-7 nodes in a left→right or top→down flow. x/y are percent positions spread across the canvas (don't overlap). JSON only.`;
  try {
    const spec = await callAIJSON(SYS, prompt, null, 1200);
    return normalizeDiagram(spec);
  } catch {
    return null;
  }
}
