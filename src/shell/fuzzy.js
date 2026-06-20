/** Subsequence fuzzy match on item.label (case-insensitive). Empty query = all. */
export function fuzzyFilter(items, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return items || [];
  return (items || []).filter((it) => {
    const label = String(it.label || "").toLowerCase();
    let qi = 0;
    for (let i = 0; i < label.length && qi < q.length; i++) {
      if (label[i] === q[qi]) qi++;
    }
    return qi === q.length;
  });
}
