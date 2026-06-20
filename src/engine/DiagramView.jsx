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
