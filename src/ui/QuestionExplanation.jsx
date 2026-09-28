import { LabAnnotatedText } from "./LabValue.jsx";
import { ChoiceValue } from "./ChoiceValue.jsx";

function cleanText(text) {
  return String(text || "").replace(/\[PAGE_BREAK(?::\d+)?\]/gi, " ").replace(/\s+/g, " ").trim();
}

function parsedBullets(text) {
  const clean = cleanText(text);
  const sourceChoicePattern = /\bChoice\s+([A-H])\b\s*/gi;
  const sourceMatches = [...clean.matchAll(sourceChoicePattern)];
  if (sourceMatches.length) {
    const bullets = sourceMatches.map((match, index) => ({
      letter: match[1].toUpperCase(),
      body: clean.slice(match.index + match[0].length, sourceMatches[index + 1]?.index ?? clean.length).replace(/^\s*[:–—-]\s*/, "").trim(),
    })).filter((item) => item.body);
    return { lead: clean.slice(0, sourceMatches[0].index).replace(/\bINCORRECT ANSWERS\s*:?\s*$/i, "").trim(), bullets };
  }
  const parts = clean.split(/\s*\(([A-H])\)\s*/);
  const bullets = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const body = String(parts[i + 1] || "").trim();
    if (body) bullets.push({ letter: parts[i], body: cleanText(body) });
  }
  return { lead: String(parts[0] || "").trim(), bullets };
}

/** Shared answer reasoning for lecture quizzes, Practice, and submitted Exams. */
export function QuestionExplanation({ text, correctLetter, whyWrong, choices = {}, sourceType = null }) {
  const parsed = parsedBullets(text);
  const structured = Object.keys(whyWrong || {})
    .filter((letter) => letter in choices)
    .sort()
    .map((letter) => ({ letter, body: cleanText(whyWrong[letter]) }));
  const bullets = structured.length ? structured : parsed.bullets;

  return (
    <div className="space-y-2 rounded border-l-2 border-accent bg-panel p-3 text-[13px] leading-relaxed text-text-2">
      {sourceType === "question-bank" && <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-text-3">Source rationale · keyed answer preserved; not independently medically verified</div>}
      {parsed.lead && <div className="rounded border border-border/60 bg-bg-elevated p-2.5"><LabAnnotatedText text={parsed.lead} className="block" /></div>}
      {bullets.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-border/40 pt-2" aria-label="Answer-choice reasoning">
          {bullets.map(({ letter, body }) => {
            const correct = letter === correctLetter;
            return (
              <li key={letter} className="flex items-start gap-2 rounded border border-border/70 bg-bg-elevated p-2.5">
                <span className={`mt-0.5 shrink-0 rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] font-bold ${correct ? "text-good" : "text-text-3"}`}>
                  {correct ? "✓" : "✕"} {letter}
                </span>
                <span className="flex-1">
                  {choices[letter] && <strong className="text-text-1"><ChoiceValue value={choices[letter]} table={choices[letter] && typeof choices[letter] === "object"} /> — </strong>}
                  <LabAnnotatedText text={body} className={correct ? "text-text-2" : "text-text-3"} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
