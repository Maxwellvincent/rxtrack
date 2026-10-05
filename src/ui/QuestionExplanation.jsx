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

function condensedSourcePoint(text, correctText = "") {
  const clean = cleanText(text);
  const sentences = (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((part) => part.trim())
    .filter((part) => part.length > 20 && !/^(?:INCORRECT ANSWERS\b|Choice\s+[A-H]\b)/i.test(part));
  if (!sentences.length) return clean.slice(0, 360);
  const answer = String(correctText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const answerLead = answer.split(" ").filter((word) => word.length > 3).slice(0, 3).join(" ");
  const ranked = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    let score = Math.max(0, 2 - index * 0.15);
    if (/because|therefore|indicat|result|caus|leads? to|due to|deficien|inactivat|inhibit|increase|decreas|characteriz/i.test(sentence)) score += 3;
    if (answerLead && lower.includes(answerLead)) score += 5;
    if (/incorrect|wrong answer|distractor|however,? (?:the )?(?:other|remaining)/i.test(sentence)) score -= 2;
    return { sentence, index, score };
  });
  const selected = ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2).sort((a, b) => a.index - b.index).map((item) => item.sentence);
  let summary = selected.join(" ");
  if (summary.length > 460) summary = `${summary.slice(0, 457).replace(/\s+\S*$/, "")}…`;
  return summary;
}

/** Shared answer reasoning for lecture quizzes, Practice, and submitted Exams. */
export function QuestionExplanation({ text, correctLetter, whyWrong, choices = {}, sourceType = null, selectedLetter = null }) {
  const parsed = parsedBullets(text);
  const structured = Object.keys(whyWrong || {})
    .filter((letter) => letter in choices)
    .sort()
    .map((letter) => ({ letter, body: cleanText(whyWrong[letter]) }));
  const bullets = structured.length ? structured : parsed.bullets;
  const selectedContrast = selectedLetter !== correctLetter ? bullets.find(item => item.letter === selectedLetter) : null;
  const isSourceBank = sourceType === "question-bank";
  const condensed = isSourceBank ? condensedSourcePoint(text, choices[correctLetter]) : "";

  return (
    <div className="space-y-2 rounded border-l-2 border-accent bg-panel p-3 text-[13px] leading-relaxed text-text-2">
      {isSourceBank && <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-text-3">Source key preserved · source rationale not independently medically verified</div>}
      {isSourceBank && condensed && <div className="rounded border border-border/60 bg-bg-elevated p-2.5"><div className="mb-1 font-semibold text-text-1">Key point · condensed from source</div><LabAnnotatedText text={condensed} className="block" /></div>}
      {!isSourceBank && parsed.lead && <div className="rounded border border-border/60 bg-bg-elevated p-2.5"><LabAnnotatedText text={parsed.lead} className="block" /></div>}
      {!isSourceBank && selectedContrast && <div className="rounded border border-border/60 bg-bg-elevated p-2.5">
        <div className="mb-1 font-semibold text-text-1">Your choice · {selectedLetter}</div>
        <LabAnnotatedText text={selectedContrast.body} className="block" />
      </div>}
      {bullets.length > 0 && !isSourceBank && (
        <details className="rounded border border-border/60 bg-bg-elevated p-2.5">
        <summary className="cursor-pointer font-semibold text-text-2">Compare answer choices</summary>
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
        </details>
      )}
      {isSourceBank && (parsed.lead || bullets.length > 0) && <details className="rounded border border-border/60 bg-bg-elevated p-2.5">
        <summary className="cursor-pointer font-semibold text-text-2">Full source rationale{bullets.length ? " and choice notes" : ""}</summary>
        {parsed.lead && <div className="mt-2"><LabAnnotatedText text={parsed.lead} className="block" /></div>}
        {bullets.length > 0 && <ul className="mt-2 flex flex-col gap-2 border-t border-border/40 pt-2" aria-label="Answer-choice reasoning">
          {bullets.map(({ letter, body }) => <li key={letter} className="flex items-start gap-2 rounded border border-border/70 bg-bg p-2.5">
            <span className={`mt-0.5 shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] font-bold ${letter === correctLetter ? "text-good" : "text-text-3"}`}>{letter === correctLetter ? "✓" : "✕"} {letter}</span>
            <span className="flex-1">{choices[letter] && <strong className="text-text-1"><ChoiceValue value={choices[letter]} table={choices[letter] && typeof choices[letter] === "object"} /> — </strong>}<LabAnnotatedText text={body} className="text-text-2" /></span>
          </li>)}
        </ul>}
      </details>}
    </div>
  );
}
