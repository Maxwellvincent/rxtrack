import React from "react";

/** Stable text form for prompts, tutor mode, and explanations. */
export function choiceValueToText(value) {
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, cell]) => `${key}: ${cell ?? ""}`).join("; ");
  }
  return String(value ?? "");
}

function Cell({ value }) {
  const text = String(value ?? "");
  const parts = text.split(/(↑|↓|↗|↘|→|←)/g);
  return <>{parts.map((part, index) => {
    if (/^(↑|↗)$/.test(part)) return <span key={index} className="font-bold text-good" aria-label="increased">{part}</span>;
    if (/^(↓|↘)$/.test(part)) return <span key={index} className="font-bold text-bad" aria-label="decreased">{part}</span>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  })}</>;
}

/** Renders a table-valued answer choice without collapsing rows into [object Object]. */
export function ChoiceValue({ value, columns = [], table = false }) {
  const isRow = value && typeof value === "object" && !Array.isArray(value);
  if (!table && !isRow) return <Cell value={value} />;
  const row = isRow ? value : { Value: value };
  const headers = columns.length ? columns : Object.keys(row);
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]" aria-label="Answer choice data">
        <thead><tr>{headers.map((header) => <th key={header} className="border-b border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-text-3">{header}</th>)}</tr></thead>
        <tbody><tr>{headers.map((header) => <td key={header} className="border-b border-border/50 px-2 py-1.5 text-text-1"><Cell value={row[header] ?? "—"} /></td>)}</tr></tbody>
      </table>
    </div>
  );
}

export function hasTableChoices(question) {
  return question?.choiceLayout === "table" || Object.values(question?.choices || {}).some((value) => value && typeof value === "object");
}
