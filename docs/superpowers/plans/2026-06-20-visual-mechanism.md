# Visual Mechanism (Clickable Concept Diagrams) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An on-demand 🖼️ Visualize button in the engine reveal that turns a concept/mechanism into a clickable conceptual diagram (nodes + arrows; click a node to see what happens there), via a validated model-produced spec the app renders.

**Architecture:** New `src/engine/visualize.js` (pure `normalizeDiagram` + `generateDiagram` AI adapter) and `src/engine/DiagramView.jsx` (renders the spec as positioned clickable nodes over an SVG edge layer), wired into `EngineSession.jsx`. Conceptual schematic only; the app renders all markup (no model SVG/HTML injected).

**Tech Stack:** React 19, Tailwind (shell tokens), vitest (node env — pure logic only), existing `aiClient.callAIJSON`.

## Global Constraints

- Conceptual/schematic only (boxes + arrows + labels). Never render model-authored SVG/HTML — all node/edge text rendered as escaped React/SVG children.
- On-demand: one AI call only when the user clicks Visualize.
- Diagram spec: `{ title, nodes:[{id,label,x,y,detail}], edges:[{from,to,label}] }`; `x`/`y` are 0–100 percent; 2–8 nodes after validation.
- `normalizeDiagram` returns `null` for < 2 valid nodes; the feature is optional (text mechanism always remains).
- AI via existing `aiClient.callAIJSON` (Claude/Gemini). Failures degrade gracefully.
- Engine code in `src/engine/`. vitest node env — pure logic only; views verified by build + manual `?shell=new`. Branch `app-rework`. Exact simple `-m` commits.

---

## File Structure

- `src/engine/visualize.js` — `normalizeDiagram(spec)` (pure), `generateDiagram(concept, mechanism)` (AI adapter). **New.** Test: `src/engine/visualize.test.js`.
- `src/engine/DiagramView.jsx` — renders a normalized diagram as clickable nodes + SVG edges. **New.**
- `src/engine/EngineSession.jsx` — **Modify**: 🖼️ Visualize button + DiagramView in the reveal; per-item state reset.

---

## Task 1: Diagram spec validation + generation (pure TDD + adapter)

**Files:** Create `src/engine/visualize.js`, Test `src/engine/visualize.test.js`

**Interfaces:**
- `normalizeDiagram(spec): { title, nodes:[{id,label,x,y,detail}], edges:[{from,to,label}] } | null` — pure. Keeps valid nodes (id + non-empty label), clamps x/y to 0–100 (fallback 50), caps 8 nodes, drops edges with missing/self endpoints, returns null if < 2 nodes.
- `generateDiagram(concept, mechanism): Promise<Diagram|null>` — prompts `callAIJSON`, runs `normalizeDiagram`; returns null on any failure.

- [ ] **Step 1: Write the failing tests**

```javascript
// src/engine/visualize.test.js
import { describe, it, expect } from "vitest";
import { normalizeDiagram } from "./visualize.js";

describe("normalizeDiagram", () => {
  it("keeps valid nodes, clamps coords, builds edges", () => {
    const d = normalizeDiagram({
      title: "HF",
      nodes: [
        { id: "n1", label: "↓ contractility", x: -5, y: 30, detail: "weak pump" },
        { id: "n2", label: "↓ stroke volume", x: 50, y: 200 },
      ],
      edges: [{ from: "n1", to: "n2", label: "" }, { from: "n1", to: "zzz" }],
    });
    expect(d.nodes).toHaveLength(2);
    expect(d.nodes[0].x).toBe(0);     // clamped from -5
    expect(d.nodes[1].y).toBe(100);   // clamped from 200
    expect(d.edges).toHaveLength(1);  // dropped the edge to missing node
  });
  it("returns null when fewer than 2 valid nodes", () => {
    expect(normalizeDiagram({ nodes: [{ id: "n1", label: "x" }] })).toBeNull();
    expect(normalizeDiagram({ nodes: [{ id: "n1" }, { id: "n2" }] })).toBeNull(); // no labels
    expect(normalizeDiagram(null)).toBeNull();
  });
  it("caps node count at 8", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: "n" + i, label: "L" + i, x: 10, y: 10 }));
    expect(normalizeDiagram({ nodes }).nodes).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test → FAIL.** `npm test -- src/engine/visualize.test.js`

- [ ] **Step 3: Implement `src/engine/visualize.js`**

```javascript
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
```

- [ ] **Step 4: Run test → PASS (3).** `npm test -- src/engine/visualize.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/engine/visualize.js src/engine/visualize.test.js
git commit -m "feat: conceptual diagram spec validation + generation"
```

---

## Task 2: DiagramView (clickable rendered diagram)

**Files:** Create `src/engine/DiagramView.jsx`

**Interfaces:**
- Consumes: a normalized `Diagram` from Task 1.
- `DiagramView({ diagram })` — renders nodes as absolutely-positioned clickable buttons over an SVG edge layer; clicking a node toggles its `detail` below. Renders nothing if `diagram` is null.

- [ ] **Step 1: Create `src/engine/DiagramView.jsx`**

```javascript
import { useState } from "react";

/**
 * Render a normalized conceptual diagram: SVG arrows behind, clickable node
 * buttons positioned by percent. All text is escaped React children — no model
 * markup is injected. Click a node to reveal its detail.
 */
export function DiagramView({ diagram }) {
  const [sel, setSel] = useState(null);
  if (!diagram) return null;
  const byId = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]));
  const selNode = sel ? byId[sel] : null;

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      {diagram.title && <div className="mb-2 text-sm font-semibold text-text-1">{diagram.title}</div>}
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 56" preserveAspectRatio="none">
          <defs>
            <marker id="rxt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="var(--border-strong)" />
            </marker>
          </defs>
          {diagram.edges.map((e, i) => {
            const a = byId[e.from], b = byId[e.to];
            if (!a || !b) return null;
            return (
              <line key={i} x1={a.x} y1={a.y * 0.56} x2={b.x} y2={b.y * 0.56}
                stroke="var(--border-strong)" strokeWidth="0.4" markerEnd="url(#rxt-arrow)" />
            );
          })}
        </svg>
        {diagram.nodes.map((n) => (
          <button
            key={n.id}
            onClick={() => setSel(n.id === sel ? null : n.id)}
            style={{ left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)" }}
            className={
              "absolute max-w-[30%] rounded-md border px-2 py-1 text-[11px] leading-tight " +
              (sel === n.id
                ? "border-accent bg-accent-soft text-text-1"
                : "border-border-strong bg-panel text-text-2 hover:text-text-1")
            }
          >
            {n.label}
          </button>
        ))}
      </div>
      {selNode?.detail && (
        <div className="mt-2 rounded-md border-l-2 border-accent bg-accent-soft p-2 text-xs leading-relaxed text-text-1">
          {selNode.detail}
        </div>
      )}
      <div className="mt-1 text-[10px] text-text-3">Click a step to see what happens there.</div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build` → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/engine/DiagramView.jsx
git commit -m "feat: clickable conceptual diagram renderer"
```

---

## Task 3: Wire 🖼️ Visualize into EngineSession

**Files:** Modify `src/engine/EngineSession.jsx`

**Interfaces:**
- Consumes: `generateDiagram` (Task 1), `DiagramView` (Task 2).

- [ ] **Step 1: Add imports + per-item diagram state**

READ `src/engine/EngineSession.jsx` first. Add near the other engine imports:
```javascript
import { generateDiagram } from "./visualize.js";
import { DiagramView } from "./DiagramView.jsx";
```

Add state alongside `deep`/`deepLoading`:
```javascript
  const [diagram, setDiagram] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagErr, setDiagErr] = useState(false);

  const visualize = useCallback(async (item, conceptName) => {
    setDiagLoading(true); setDiagErr(false);
    const d = await generateDiagram(conceptName, item?.data?.mechanism);
    setDiagram(d); setDiagErr(!d); setDiagLoading(false);
  }, []);
```

Reset them in `nextItem` (extend the existing reset line):
```javascript
    setPicked(null); setRevealed(false); setStruck(new Set()); setDeep(""); setDeepLoading(false);
    setDiagram(null); setDiagLoading(false); setDiagErr(false);
```

- [ ] **Step 2: Add the Visualize button + view in the reveal**

In the reveal block, next to the `<Deeper .../>` line (for teach/recognize modes), add:
```javascript
                {(current.mode === "teach" || current.mode === "recognize") && (
                  <div className="space-y-2">
                    {!diagram && (
                      <button
                        type="button"
                        onClick={() => visualize(current.item, current.concept.concept)}
                        disabled={diagLoading}
                        className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-accent-text hover:bg-panel disabled:opacity-50"
                      >
                        {diagLoading ? "Drawing…" : "🖼️ Visualize"}
                      </button>
                    )}
                    {diagErr && <div className="text-xs text-text-3">Couldn't build a diagram — try again.</div>}
                    {diagram && <DiagramView diagram={diagram} />}
                  </div>
                )}
```
(Place it just before the existing `<Deeper ... />` so Visualize and Teach-me-deeper sit together.)

- [ ] **Step 3: Build + manual verify**

Run: `npm run build` → `✓ built`. `npm test` → all pass (existing + visualize unit tests).
Manual (`?shell=new`, a block with bank items, browser AI key set): answer an item → reveal → click 🖼️ Visualize → a node/arrow diagram renders → click nodes → details show. Next item clears it.

- [ ] **Step 4: Commit**

```bash
git add src/engine/EngineSession.jsx
git commit -m "feat: 🖼️ Visualize — clickable concept diagram in the engine reveal"
```

---

## Self-Review Notes

- **Spec coverage:** structured spec + validation (Task 1 `normalizeDiagram`), AI generation via aiClient (Task 1 `generateDiagram`), clickable rendered diagram with no injected markup (Task 2), on-demand button + reveal wiring + per-item reset + error/loading states (Task 3). Out-of-scope (caching, Anki images, anatomy shapes, animation) untouched.
- **Safety:** model output only ever populates validated strings rendered as React/SVG children — never `dangerouslySetInnerHTML`; coords clamped; node count capped.
- **Type consistency:** `Diagram { title, nodes:[{id,label,x,y,detail}], edges:[{from,to,label}] }` consistent across `normalizeDiagram` → `DiagramView` → `generateDiagram`; `visualize(item, conceptName)` matches the Task 3 button call.
- **Graceful degradation:** `generateDiagram` returns null on failure → `diagErr` shows a retry; the text mechanism is always present regardless.
