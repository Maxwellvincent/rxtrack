import { statusToken } from "../shell/status.js";

/** Status glyph (dot/diamond) + optional label. Color + shape both encode status. */
export function StatusGlyph({ status, size = 7 }) {
  const { colorVar, shape } = statusToken(status);
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, background: colorVar, display: "inline-block",
        borderRadius: shape === "dot" ? "50%" : 0,
        transform: shape === "diamond" ? "rotate(45deg)" : "none",
      }}
    />
  );
}

export function Badge({ status, children }) {
  const { label } = statusToken(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
      <StatusGlyph status={status} />
      {children ?? label}
    </span>
  );
}
