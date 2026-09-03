import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.jsx";
import { advanceOnEnter } from "../ui/nextQuestion.js";
import { highlightRanges, sameHighlight } from "../ui/highlightRanges.js";
import { classify, atomsToReview } from "../engine/calibration.js";
import { appendCalibration } from "../engine/calibrationStore.js";
import { recordAnswer } from "../stores/lectureQuestionStats.js";
import { recordAtomAnswer } from "../stores/atomProgress.js";
import { recordEvidence, recordReflection } from "../stores/learnerEvidence.js";
import { classifyLeadIn, ERROR_REASONS, extractLeadIn } from "./features/exam/questionReading.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import { recordObjectiveAttempt, selectBlockObjectives, storageKeyFor, toEntry } from "./logic/objectives.js";
import * as generatedQuestionsStore from "../stores/generatedQuestions.js";
import { LabAnnotatedText } from "../ui/LabValue.jsx";
import { useFocusHudSignal } from "./hooks/useFocusHudSignal.js";
import { recordAttempt as recordMentalModelAttempt } from "../stores/mentalModelImpact.js";

// Split explanation into: lead (correct answer) + per-wrong-choice bullets.
// Handles patterns like "(A) text", "(B) text" anywhere in the string.
function parseExplanation(text) {
  if (!text) return { lead: "", bullets: [] };
  // Split on "(Letter)" markers, keeping the letter
  const parts = text.split(/\s*\(([A-E])\)\s*/);
  // parts: [lead, "A", text_A, "B", text_B, ...]
  const lead = (parts[0] || "").trim();
  const bullets = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const letter = parts[i];
    const body = (parts[i + 1] || "").trim();
    if (body) bullets.push({ letter, body });
  }
  return { lead, bullets };
}

/**
 * Per-choice bullets, structured first.
 *
 * New questions carry `whyWrong` keyed by letter, which survives the answer shuffle. Questions
 * generated before that field existed only have prose, so their letters are recovered from
 * "(A)" markers in the text — worse, but better than dropping the breakdown for a bank the
 * student already paid to generate.
 */
function choiceBullets(whyWrong, parsedBullets, choices) {
  const letters = Object.keys(whyWrong || {}).filter((l) => l in (choices || {}));
  if (letters.length) return letters.sort().map((letter) => ({ letter, body: whyWrong[letter] }));
  return parsedBullets;
}

function ExplanationBlock({ text, correctLetter, whyWrong, choices = {} }) {
  const { lead, bullets: parsed } = parseExplanation(text);
  const bullets = choiceBullets(whyWrong, parsed, choices);
  return (
    <div className="rounded border-l-2 border-accent bg-panel p-3 text-[13px] leading-relaxed text-text-2 space-y-2">
      {lead && <LabAnnotatedText text={lead} className="block" />}
      {bullets.length > 0 && (
        <ul className="flex flex-col gap-1.5 pt-1 border-t border-border/40">
          {bullets.map(({ letter, body }) => {
            const isCorrect = letter === correctLetter;
            const optionText = choices?.[letter];
            return (
              <li key={letter} className="flex items-start gap-2">
                <span className={[
                  "mt-0.5 flex-shrink-0 flex items-center gap-0.5 font-mono text-[11px] font-bold px-1 py-0.5 rounded border",
                  isCorrect
                    ? "border-border bg-bg text-text-1"
                    : "border-border bg-bg text-text-3 line-through",
                ].join(" ")}>
                  {isCorrect ? "✓" : "✕"} {letter}
                </span>
                <span className="flex-1 text-[13px]">
                  {/* The option is repeated here so the bullet reads on its own — after a reveal
                      you are looking at the reasoning, not back up at the list. */}
                  {optionText && (
                    <span className={isCorrect ? "font-semibold text-text-1" : "font-semibold text-text-2"}>
                      {optionText} —{" "}
                    </span>
                  )}
                  <LabAnnotatedText text={body} className={isCorrect ? "text-text-2" : "text-text-3"} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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
export function AtomQuiz({ questions, blockId = "lecture-extract", lectureId = null, userId, onDone, onExit, onReviewAtom }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [records, setRecords] = useState([]);
  const [done, setDone] = useState(false);
  const [crossed, setCrossed] = useState(new Set()); // letters eliminated by user
  const [errorReason, setErrorReason] = useState(null);
  const questionStartedAtRef = useRef(Date.now());
  useEffect(() => { questionStartedAtRef.current = Date.now(); }, [i]);
  // Keyed by stem (same key generatedQuestions dedupes on) — select text in
  // the stem to mark it, like underlining on a real exam. Seeded from
  // whatever's already stored so a question you've marked before shows it
  // again.
  const [highlights, setHighlights] = useState(() => {
    const map = {};
    for (const q of questions) if (q.highlights?.length) map[q.stem] = q.highlights;
    return map;
  });

  useFocusHudSignal("questions", questions[i]?.topic ?? null, { enabled: !done });

  const onHighlight = useCallback(
    (stem, phrase) => {
      setHighlights((prev) => {
        const existing = highlightRanges(stem, prev[stem]);
        if (existing.some(h => sameHighlight(h, phrase))) return prev;
        return { ...prev, [stem]: [...existing, phrase] };
      });
      if (lectureId) generatedQuestionsStore.addHighlight(userId, lectureId, stem, phrase);
    },
    [lectureId, userId]
  );

  const removeHighlight = (stem, range) => {
    const next = range ? highlightRanges(stem, highlights[stem]).filter(h => !sameHighlight(h, range)) : [];
    setHighlights(prev => ({ ...prev, [stem]: next }));
    if (lectureId) generatedQuestionsStore.setHighlights(userId, lectureId, stem, next);
  };

  if (done) return <Summary records={records} onExit={onExit} onReviewAtom={onReviewAtom} />;

  const q = questions[i];
  const revealed = confidence != null;
  const correct = revealed && picked === q.correct;
  const quadrant = revealed ? classify({ confidence, correct }) : null;

  const rate = (level) => {
    if (picked == null || revealed) return;
    const isCorrect = picked === q.correct;
    const responseMs = Date.now() - questionStartedAtRef.current;
    setConfidence(level);
    const rec = {
      concept: q.topic || q.stem.slice(0, 60),
      stem: q.stem.slice(0, 100),
      confidence: level,
      correct: isCorrect,
      atomKey: q.atomKey || null,
      objectiveIds: q.objectiveIds || [],
      responseMs,
      taskType: q.taskType || classifyLeadIn(q.stem),
      difficulty: q.difficulty || null,
    };
    appendCalibration(userId, blockId, rec);
    recordEvidence(userId, {
      source: "quiz",
      blockId,
      lectureId,
      objectiveIds: q.objectiveIds || [],
      atomKey: q.atomKey || null,
      correct: isCorrect,
      confidence: level,
      difficulty: q.difficulty || null,
      misconception: !isCorrect ? (level >= 4 ? "landmine" : "knowledge-gap") : null,
      responseMs,
      taskType: classifyLeadIn(q.stem),
    });
    if (blockId && q.objectiveIds?.length) {
      const objectiveMap = objectivesStore.read(userId) || {};
      let blockObjectives = selectBlockObjectives(objectiveMap, blockId);
      for (const objectiveId of [...new Set(q.objectiveIds)]) {
        blockObjectives = recordObjectiveAttempt(blockObjectives, objectiveId, isCorrect, new Date());
      }
      const storeKey = storageKeyFor(objectiveMap, blockId);
      objectivesStore.write(userId, { ...objectiveMap, [storeKey]: toEntry(objectiveMap[storeKey], blockObjectives) });
    }
    // Counted at reveal, not at "next": leaving the round here still cost you the question, so
    // the lecture's total has to reflect it.
    if (lectureId) {
      recordAnswer(userId, lectureId, isCorrect);
      recordMentalModelAttempt(userId, lectureId, {
        correct: isCorrect,
        responseMs,
        difficulty: q.difficulty || null,
        taskType: classifyLeadIn(q.stem),
        stem: q.stem,
      });
      // Only questions generated one-per-atom carry an exact atomKey (Quiz mode's free-form
      // generator doesn't, yet) — no atomKey means no mastery claim gets made on its behalf.
      if (q.atomKey) recordAtomAnswer(userId, lectureId, q.atomKey, isCorrect, { ...q, picked, confidence: level });
    }
    setRecords((prev) => [...prev, rec]);
  };

  const next = () => {
    if (i + 1 >= questions.length) {
      setDone(true);
      const correctCount = records.filter((r) => r.correct).length;
      const confSum = records.reduce((s, r) => s + (r.confidence || 0), 0);
      const avgConfidence = records.length ? confSum / (records.length * 5) : 0; // normalize 1-5 → 0-1
      const hasLandmines = records.some((r) => !r.correct && r.confidence >= 4);
      onDone?.({ correct: correctCount, total: questions.length, avgConfidence, hasLandmines, records });
      return;
    }
    setI(i + 1); setPicked(null); setConfidence(null); setCrossed(new Set()); setErrorReason(null);
  };

  return (
    <div className="mb-5 space-y-3" onKeyDown={(event) => advanceOnEnter(event, next, revealed)}>
      <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-wider text-accent-text">
        <span>Objective quiz — recognition &amp; application</span><span className="text-text-3">{i + 1}/{questions.length}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-panel"
        role="progressbar"
        aria-label="Quiz progress"
        aria-valuemin={1}
        aria-valuemax={questions.length}
        aria-valuenow={i + 1}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${((i + 1) / questions.length) * 100}%` }}
        />
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
        <div className="mb-2 rounded border-l-2 border-accent bg-panel px-2.5 py-2">
          <div className="font-mono text-[11px] uppercase tracking-wider text-text-3">Read the lead-in first · what are they asking for?</div>
          <div className="mt-1 text-sm font-semibold text-text-1">{extractLeadIn(q.stem)}</div>
        </div>
        <LabAnnotatedText
          text={q.stem}
          className="mb-2 block text-sm text-text-1"
          highlights={highlights[q.stem]}
          onHighlight={(phrase) => onHighlight(q.stem, phrase)}
          onRemoveHighlight={(range) => removeHighlight(q.stem, range)}
        />
        {!!highlights[q.stem]?.length && <button className="mb-2 min-h-9 text-xs text-text-2 underline" onClick={() => removeHighlight(q.stem, null)}>Clear highlights</button>}
        <div className="flex flex-col gap-1.5">
          {Object.entries(q.choices).map(([letter, txt]) => {
            const isPicked = picked === letter;
            const isCrossed = !revealed && crossed.has(letter);
            const borderCls = !revealed
              ? isCrossed
                ? "border-border opacity-40 cursor-pointer"
                : isPicked
                  ? "border-accent"
                  : "border-border hover:border-border-strong cursor-pointer"
              : letter === q.correct
                ? "border-good"
                : isPicked
                  ? "border-bad"
                  : "border-border opacity-60";
            return (
              <div key={letter} className="flex items-center gap-1.5">
                <button
                  disabled={revealed}
                  onClick={() => !revealed && !isCrossed && setPicked(letter)}
                  aria-pressed={isPicked}
                  className={"flex flex-1 items-center gap-2 rounded-lg border bg-bg px-3 py-2 text-left text-xs text-text-1 " + borderCls}
                >
                  <span className="font-mono text-text-3">{letter}</span>
                  <span className={isCrossed ? "line-through text-text-3" : ""}>{txt}</span>
                </button>
                {/* Cross-out toggle — only before reveal */}
                {!revealed && (
                  <button
                    onClick={() => setCrossed((prev) => {
                      const next = new Set(prev);
                      next.has(letter) ? next.delete(letter) : next.add(letter);
                      // Unselect if crossing out the picked answer
                      if (next.has(letter) && picked === letter) setPicked(null);
                      return next;
                    })}
                    aria-label={`${isCrossed ? "Restore" : "Eliminate"} answer ${letter}`}
                    aria-pressed={isCrossed}
                    title={`${isCrossed ? "Restore" : "Eliminate"} answer ${letter}`}
                    className={[
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border font-mono text-[12px] transition-colors",
                      isCrossed
                        ? "border-border bg-panel text-text-2 hover:border-border-strong"
                        : "border-border text-text-3 hover:border-border-strong hover:text-bad",
                    ].join(" ")}
                  >
                    {isCrossed ? "↩" : "✕"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {picked != null && !revealed && (
          <div className="mt-3 rounded-lg border border-border-strong bg-panel p-2">
            <div className="mb-1.5 font-mono text-[12px] uppercase tracking-wider text-text-3">How sure? (1–5)</div>
            <div className="flex gap-1.5">
              {CONF.map((c) => (
                <button key={c.level} onClick={() => rate(c.level)}
                  className="flex flex-1 flex-col items-center rounded-lg border border-border py-1.5 hover:border-accent">
                  <span className="font-mono text-xs text-text-1">{c.level}</span>
                  <span className="text-[13px] text-text-3">{c.label}</span>
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
            {/* The atom/concept this question was testing — named here, not just buried in
                the end-of-quiz landmine list, so a miss tells you what to go re-study while
                the question is still on screen. Falls back to nothing rather than the stem:
                a topic-less label is worse than no label. */}
            {q.topic && q.topic !== "Uploaded" && q.topic !== "Exam Review" && (
              <div className="font-mono text-[11px] uppercase tracking-wider text-text-3">
                Concept: <span className="font-semibold text-text-1 normal-case tracking-normal">{q.topic}</span>
              </div>
            )}
            {(q.explanation || Object.keys(q.whyWrong || {}).length > 0) && (
              <ExplanationBlock
                text={q.explanation}
                correctLetter={q.correct}
                whyWrong={q.whyWrong}
                choices={q.choices}
              />
            )}
            <div className="rounded border border-border p-3 text-sm">
              <strong>Objective tested</strong>
              {q.objectiveTexts?.length ? q.objectiveTexts.map(o => <p key={o.id}>{o.code} {o.text}</p>)
                : q.objectiveIds?.length ? <p>{q.objectiveIds.join(" · ")}</p>
                : <p className="text-text-2">No objective link recorded for this question. Atom practice alone does not establish objective coverage.</p>}
            </div>
            {!correct && (
              <div className="rounded-lg border border-border bg-panel p-2.5">
                <div className="mb-2 font-mono text-[12px] font-bold text-text-2">What most caused this miss?</div>
                <div className="flex flex-wrap gap-1.5">
                  {ERROR_REASONS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        if (errorReason === value) return;
                        recordReflection(userId, value, errorReason);
                        setErrorReason(value);
                      }}
                      aria-pressed={errorReason === value}
                      className={`rounded border px-2 py-1 text-[12px] ${errorReason === value ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-1"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button onClick={next}>{i + 1 >= questions.length ? "See results" : "Next →"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Summary({ records, onExit, onReviewAtom }) {
  const toReview = atomsToReview(records);
  const objectivesTested = new Set(records.flatMap((record) => record.objectiveIds || [])).size;
  const supportingAtomsTested = new Set(records.map((record) => record.atomKey).filter(Boolean)).size;
  const pct = (a) => (a == null ? "—" : Math.round(a * 100) + "%");
  return (
    <div className="mb-5 space-y-3">
      <div className="rounded-lg border border-border bg-bg-elevated p-4">
        <div className="text-3xl font-bold text-text-1">{pct(records.length ? records.filter((r) => r.correct).length / records.length : null)}</div>
        <div className="text-sm text-text-2">{records.filter((r) => r.correct).length} / {records.length} correct · Quiz complete</div>
        {(objectivesTested > 0 || supportingAtomsTested > 0) && (
          <div className="mt-1 text-xs text-text-3">
            {objectivesTested} objective{objectivesTested === 1 ? "" : "s"} tested
            {supportingAtomsTested > 0 ? ` · ${supportingAtomsTested} supporting atom${supportingAtomsTested === 1 ? "" : "s"}` : ""}
          </div>
        )}
      </div>
      {/* Every atom left needs-review this session, not just the landmines (sure-but-wrong) —
          those are still sorted first, but a plain miss deserves a way back too instead of
          silently not appearing anywhere. */}
      {toReview.length > 0 && (
        <div className="rounded-lg border border-bad bg-bg-elevated p-3">
          <div className="mb-1.5 font-mono text-[12px] uppercase tracking-wider text-bad">
            ⚠ {toReview.length} atom{toReview.length === 1 ? "" : "s"} to review
          </div>
          <ul className="flex flex-col gap-2">
            {toReview.map((r) => {
              const landmine = classify(r) === "confident-wrong";
              const label = (
                <>
                  <span className="text-[13px] font-semibold text-text-1">✕ {r.concept}</span>
                  {landmine && (
                    <span className="ml-1.5 rounded bg-bad/15 px-1 font-mono text-[13px] text-bad">
                      sure but wrong
                    </span>
                  )}
                  {r.stem && (
                    <span className="block font-mono text-[11px] text-text-3 leading-snug">
                      {r.stem}{r.stem.length >= 100 ? "…" : ""}
                    </span>
                  )}
                </>
              );
              return (
                <li key={r.atomKey}>
                  {onReviewAtom ? (
                    <button
                      onClick={() => onReviewAtom(r.atomKey)}
                      className="flex w-full flex-col gap-0.5 rounded text-left hover:underline"
                    >
                      {label}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-0.5">{label}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {onExit && <Button onClick={onExit}>Back to lecture & model repairs</Button>}
    </div>
  );
}
