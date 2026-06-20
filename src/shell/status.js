/** Map a block/objective status → colorblind-safe color + SHAPE + label.
 *  Status is never encoded by color alone — shape carries it too. */
const MAP = {
  "in-progress": { colorVar: "var(--status-blue)", shape: "dot", label: "In progress" },
  weak:          { colorVar: "var(--status-amber)", shape: "diamond", label: "Weak" },
  review:        { colorVar: "var(--status-purple)", shape: "dot", label: "Review" },
  new:           { colorVar: "var(--status-cyan)", shape: "dot", label: "New" },
};

export function statusToken(status) {
  return MAP[status] || { colorVar: "var(--text-3)", shape: "dot", label: "—" };
}
