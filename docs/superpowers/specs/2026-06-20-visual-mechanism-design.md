# Visual Mechanism (Clickable Concept Diagrams) — Design

**Date:** 2026-06-20
**Status:** Approved (design), pending spec review
**Branch:** `app-rework` (engine feature)

## Where this fits

Enhances the adaptive engine (sub-project #2). The user is a visual/interactive
learner and wants to *see* the concept — a schematic pump, the affected region,
the cause→effect flow — and click into it, not read a wall of text.

## Goal

An on-demand **🖼️ Visualize** action in the engine's reveal that turns the
current concept/mechanism into a **clickable conceptual diagram**: labeled nodes
connected by arrows, where clicking a node reveals what happens there. Conceptual
and schematic (a *diagram* of a pump, not a fake radiograph) — accurate because
it's text-derived, safe because we render it (no raw model SVG).

## Decisions (from brainstorming)

- **Conceptual, not photorealistic.** Schematic boxes/arrows/labels — never
  AI-generated "real" anatomy/imaging (hallucination risk for Step 1).
- **On-demand button** — one AI call only when the user clicks Visualize.
- **Clickable parts** — each diagram node is clickable to reveal its detail.
- **Structured spec, not raw SVG.** The model returns a validated JSON diagram
  spec; the app renders the SVG. This makes "clickable parts" reliable and
  avoids injecting model-authored markup.
- Tutor model: Claude when available, else Gemini — via existing `aiClient`.

## The diagram spec (model output contract)

`aiClient.callAIJSON` is prompted to return:

```json
{
  "title": "Left heart failure",
  "nodes": [
    { "id": "n1", "label": "↓ LV contractility", "x": 15, "y": 30, "detail": "Weak pump → less blood ejected per beat." },
    { "id": "n2", "label": "↓ Stroke volume", "x": 50, "y": 30, "detail": "..." }
  ],
  "edges": [ { "from": "n1", "to": "n2", "label": "" } ]
}
```

- `x`/`y` are 0–100 (percent of the canvas). 3–7 nodes. `detail` ≤ ~200 chars.
- The prompt asks for a left→right or top→down cause→effect flow of the
  mechanism, plain conceptual labels.

## Architecture (isolated, in `src/engine/`)

- `src/engine/visualize.js` —
  - `normalizeDiagram(spec): Diagram | null` — **pure.** Validate + clamp:
    keep nodes with `id` + `label`, clamp `x`/`y` to 0–100, drop edges whose
    endpoints don't exist, cap node count (8). Returns null if < 2 valid nodes.
    Unit-tested.
  - `generateDiagram(concept, mechanism): Promise<Diagram|null>` — builds the
    prompt, calls `callAIJSON`, runs `normalizeDiagram`. (Thin AI adapter.)
- `src/engine/DiagramView.jsx` — renders a `Diagram` as an SVG: nodes as
  labelled rounded rects at their `x`/`y`, edges as arrowed lines between node
  centers. Clicking a node selects it and shows its `detail` below. No raw HTML
  from the model — only our elements bound to validated strings (rendered as
  text, never `dangerouslySetInnerHTML`).
- `src/engine/EngineSession.jsx` — add a **🖼️ Visualize** button in the reveal
  (alongside Teach-me-deeper). On click → `generateDiagram(concept, mechanism)`
  → render `DiagramView`. Loading + error states. Reset on next item.

## Data flow

Reveal → click 🖼️ Visualize → `generateDiagram(current.concept.concept,
q.mechanism)` → `callAIJSON` → `normalizeDiagram` → `DiagramView` renders
clickable nodes → click a node → its `detail` shows. State lives in
`EngineSession` (per item), reset by `nextItem`.

## Error handling

- Model returns junk / < 2 nodes → `normalizeDiagram` returns null → show a
  small "couldn't build a diagram — try again" with a retry; never crash.
- No AI key (browser) → the call fails; surface "needs an AI key" (same as
  Teach-me-deeper). Diagram is optional; the text mechanism still stands.
- All node text rendered as SVG `<text>`/React children (escaped) — no markup
  injection from the model.

## Testing

- **Unit (vitest, node):** `normalizeDiagram` — clamps coords, drops invalid
  nodes/edges, null on too-few nodes, caps node count. Pure.
- **Manual:** Visualize on a real item → diagram renders, nodes clickable,
  details reveal, dark/light readable.

## Out of scope (this spec)

- Pre-generation/caching of diagrams (on-demand only for now).
- Real Anki image surfacing (separate follow-up).
- Region-shaded anatomy bodies (v1 is node/edge flow; richer shapes later).
- Animation.
