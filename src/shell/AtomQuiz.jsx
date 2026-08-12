import { useState } from "react";
import { Button } from "../ui/Button.jsx";
import { classify, summarize } from "../engine/calibration.js";
import { appendCalibration } from "../engine/calibrationStore.js";

const CONF = [
  { level: 1, label: "Guess" },
  { level: 2, label: "Unsure" },
  { level: 3, label: "Leaning" },
  { level: 4, label: "Confident" },
  { level: 5, label: "Certain" },
];

const GAP = {
  "confident-right": { text: "Right — and you were sure. Solid.", cls: "text-good" },
  "confident-wrong": { text: "Wrong — but you were sure. ⚠ Landmine.", cls: "text-bad font-bold" },
  "unsure-right": { text: "Right — though you weren't sure.", cls: "text-good" },
  "unsure-wrong": { text: "Wrong — and you knew you weren't sure.", cls: "text-bad" },
};

// Calibrated quiz over atom-generated questions: pick → rate confidence → reveal
// gap. Confidence logs to the block's calibration record; session ends with the
// accuracy-by-confidence curve + landmine list.
export function AtomQuiz({ questions, blockId = "lecture-extract", userId, onDone }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [records, setRecords] = useState([]);
  const [done, setDone] = useState(false);

  if (done) return <Summary records={records} />;

  const q = questions[i];
  const revealed = confidence != null;
  const correct = revealed && picked === q.correct;
  const quadrant = revealed ? classify({ confidence, correct }) : null;

  const rate = (level) => {
    if (picked == null || revealed) return;
    const isCorrect = picked === q.correct;
    setConfidence(level);
    const rec = { concept: q.topic || q.stem.slice(0, 40), confidence: level, correct: isCorrect };
    appendCalibration(userId, blockId, rec);
    setRecords((prev) => [...prev, rec]);
  };

  const next = () => {
    if (i + 1 >= questions.length) {
      setDone(true);
      const correctCount = records.filter((r) => r.correct).length;
      onDone?.({ correct: correctCount, total: questions.length });
      return;
    }
    setI(i + 1); setPicked(null); setConfidence(null);
  };

  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-accent-text">
        <span>Calibrated quiz — from your atoms</span><span className="text-text-3">{i + 1}/{questions.length}</span>
      </div>
      <div className="rounded-lg border border-border bg-bg-elevated p-3">
        {/* Stimulus first, the way a real Step 1 item presents it: read the tissue, then the
            stem. No caption — the label would answer the question. */}
        {q.image?.url && (
          <img
            src={q.image.url}
            alt="Histologic image accompanying this question"
            loading="lazy"
            className="mb-2 max-h-64 w-full rounded-lg border border-border bg-panel object-contain"
          />
        )}
        <div className="mb-2 text-sm text-text-1">{q.stem}</div>
        <div className="flex flex-col gap-1.5">
          {Object.entries(q.choices).map(([letter, txt]) => {
            const isPicked = picked === letter;
            const cls = !revealed
              ? (isPicked ? "border-accent" : "border-border hover:border-border-strong cursor-pointer")
              : letter === q.correct ? "border-good" : isPicked ? "border-bad" : "border-border opacity-60";
            return (
              <button key={letter} disabled={revealed}
                onClick={() => !revealed && setPicked(letter)}
                className={"flex items-center gap-2 rounded-lg border bg-bg px-3 py-2 text-left text-xs text-text-1 " + cls}>
                <span className="font-mono text-text-3">{letter}</span>{txt}
              </button>
            );
          })}
        </div>

        {picked != null && !revealed && (
          <div className="mt-3 rounded-lg border border-border-strong bg-panel p-2">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-3">How sure? (1–5)</div>
            <div className="flex gap-1.5">
              {CONF.map((c) => (
                <button key={c.level} onClick={() => rate(c.level)}
                  className="flex flex-1 flex-col items-center rounded-lg border border-border py-1.5 hover:border-accent">
                  <span className="font-mono text-xs text-text-1">{c.level}</span>
                  <span className="text-[9px] text-text-3">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {revealed && (
          <div className="mt-3 space-y-2">
            <div className={"text-xs " + (GAP[quadrant]?.cls || "")}>
              {correct ? "✓ " : "✕ "}{GAP[quadrant]?.text}
            </div>
            {q.explanation && <div className="rounded border-l-2 border-accent bg-panel p-2 text-[11px] leading-relaxed text-text-2">{q.explanation}</div>}
            <Button onClick={next}>{i + 1 >= questions.length ? "See calibration" : "Next →"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ records }) {
  const s = summarize(records);
  const pct = (a) => (a == null ? "—" : Math.round(a * 100) + "%");
  return (
    <div className="mb-5 space-y-3">
      <div className="text-sm font-bold text-text-1">Calibration · {records.length} answered</div>
      <div className="rounded-lg border border-border bg-bg-elevated p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Accuracy by confidence</div>
        {[...s.curve].reverse().map((r) => (
          <div key={r.level} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-text-2">{CONF[r.level - 1].label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-panel">
              <div className="h-full bg-accent" style={{ width: r.accuracy == null ? 0 : r.accuracy * 100 + "%" }} />
            </div>
            <span className="w-16 text-right font-mono text-text-3">{pct(r.accuracy)}{r.count ? ` (${r.count})` : ""}</span>
          </div>
        ))}
      </div>
      {s.landmines.length > 0 && (
        <div className="rounded-lg border border-bad bg-bg-elevated p-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-bad">⚠ Review first — sure but wrong</div>
          <ul className="flex flex-col gap-1 text-xs text-text-1">
            {s.landmines.map((l, i) => <li key={i}>• {l.concept}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
