// Shared status segments (symbol + pattern, never color alone) for objective coverage charts.
export const segments = [
 { key: "m", label: "Mastered", symbol: "✓", color: "#0072b2", pattern: "none" },
 { key: "ip", label: "Learning", symbol: "~", color: "#e69f00", pattern: "repeating-linear-gradient(0deg, transparent 0 6px, #17212b 6px 8px)" },
 { key: "st", label: "Needs review", symbol: "!", color: "#cc79a7", pattern: "repeating-linear-gradient(45deg, transparent 0 6px, #17212b 6px 8px)" },
 { key: "ut", label: "Not yet tested", symbol: "○", color: "#f3f4f6", pattern: "radial-gradient(#536171 1px, transparent 1px)", size: "6px 6px" },
];
export const segmentStyle = segment => ({ backgroundColor: segment.color, backgroundImage: segment.pattern, backgroundSize: segment.size, borderTop: "1px solid #17212b" });
