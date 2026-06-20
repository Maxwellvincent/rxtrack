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
    expect(d.nodes[0].x).toBe(0);
    expect(d.nodes[1].y).toBe(100);
    expect(d.edges).toHaveLength(1);
  });
  it("returns null when fewer than 2 valid nodes", () => {
    expect(normalizeDiagram({ nodes: [{ id: "n1", label: "x" }] })).toBeNull();
    expect(normalizeDiagram({ nodes: [{ id: "n1" }, { id: "n2" }] })).toBeNull();
    expect(normalizeDiagram(null)).toBeNull();
  });
  it("caps node count at 8", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: "n" + i, label: "L" + i, x: 10, y: 10 }));
    expect(normalizeDiagram({ nodes }).nodes).toHaveLength(8);
  });
});
