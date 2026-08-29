export function highlightRanges(text, highlights = []) {
  return highlights.flatMap((h) => {
    // Old phrase highlights migrate to their first occurrence, not every match.
    const start = typeof h === "string" ? text.indexOf(h) : h?.start;
    const end = typeof h === "string" ? start + h.length : h?.end;
    return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length
      ? [{ start, end }] : [];
  }).sort((a,b) => a.start - b.start);
}

export function sameHighlight(a, b) { return a?.start === b?.start && a?.end === b?.end; }

export function applyRangeHighlights(parts, highlights) {
  const text = parts.map(p => p.content ?? p.raw ?? "").join("");
  const ranges = highlightRanges(text, highlights);
  if (!ranges.length) return parts;
  let offset = 0;
  return parts.flatMap(part => {
    const value = part.content ?? part.raw ?? "";
    const start = offset; offset += value.length;
    const cuts = [...new Set([start, offset, ...ranges.flatMap(r => [r.start, r.end]).filter(n => n > start && n < offset)])].sort((a,b)=>a-b);
    return cuts.slice(0,-1).map((a,i) => {
      const b = cuts[i+1]; const range = ranges.find(r=>r.start<=a && r.end>=b);
      if (!range && a === start && b === offset) return part;
      return { type: range ? "mark" : "text", content: value.slice(a-start,b-start), range };
    });
  });
}
