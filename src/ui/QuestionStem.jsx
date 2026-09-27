import { useState } from "react";
import { LabAnnotatedText, parseText } from "./LabValue.jsx";
import { sameHighlight } from "./highlightRanges.js";

/** Session-local annotations. Exam stems never expose lab-reference hints. */
export function QuestionStem({ text, questionId }) {
  const [byText, setByText] = useState({});
  const [showLabRanges, setShowLabRanges] = useState(false);
  const scope = JSON.stringify([questionId ?? null, text]);
  const highlights = byText[scope] || [];
  const hasLabValues = parseText(text || "").some((part) => part.type === "lab");
  const change = (next) => setByText(prev => ({ ...prev, [scope]: next }));
  return <div className="mb-2">
    {hasLabValues && <div className="mb-1">
      <button type="button" aria-pressed={showLabRanges} className="text-[11px] font-medium text-text-3 underline underline-offset-2 hover:text-text-1" onClick={() => setShowLabRanges(value => !value)}>
        {showLabRanges ? "Hide lab & vital reference ranges" : "Show lab & vital reference ranges"}
      </button>
      {showLabRanges && <span className="ml-2 text-[11px] text-text-3">Tap underlined values to see the usual range and whether they are high or low. Ranges vary by lab and patient.</span>}
    </div>}
    <LabAnnotatedText text={text} className="block whitespace-pre-line text-sm text-text-1" annotateLabs={showLabRanges}
      highlights={highlights} onHighlight={range => change(highlights.some(h=>sameHighlight(h,range)) ? highlights : [...highlights,range])}
      onRemoveHighlight={range => change(highlights.filter(h=>!sameHighlight(h,range)))} />
    {!!highlights.length && <button className="min-h-9 text-xs text-text-2 underline" onClick={()=>change([])}>Clear highlights</button>}
  </div>;
}
