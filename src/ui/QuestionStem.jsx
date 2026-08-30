import { useState } from "react";
import { LabAnnotatedText } from "./LabValue.jsx";
import { sameHighlight } from "./highlightRanges.js";

/** Session-local annotations. Exam stems never expose lab-reference hints. */
export function QuestionStem({ text, questionId }) {
  const [byText, setByText] = useState({});
  const scope = JSON.stringify([questionId ?? null, text]);
  const highlights = byText[scope] || [];
  const change = (next) => setByText(prev => ({ ...prev, [scope]: next }));
  return <div className="mb-2">
    <LabAnnotatedText text={text} className="block whitespace-pre-line text-sm text-text-1" annotateLabs={false}
      highlights={highlights} onHighlight={range => change(highlights.some(h=>sameHighlight(h,range)) ? highlights : [...highlights,range])}
      onRemoveHighlight={range => change(highlights.filter(h=>!sameHighlight(h,range)))} />
    {!!highlights.length && <button className="min-h-9 text-xs text-text-2 underline" onClick={()=>change([])}>Clear highlights</button>}
  </div>;
}
