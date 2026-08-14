import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "../ui/Button.jsx";
import { readConcepts, writeConcept } from "./masteryStore.js";
import { ensureBlockItems, pickItemForConcept } from "./content.js";
import { selectNext } from "./selectConcept.js";
import { createSession, advanceSession } from "./session.js";
import { recordOutcome } from "./mastery.js";
import { classify, summarize } from "./calibration.js";
import { appendCalibration } from "./calibrationStore.js";
import { BuildStatus, NothingToStudy } from "./SessionStatus.jsx";

const BURST = 10;

const CONF = [
  { level: 1, label: "Guess" },
  { level: 2, label: "Unsure" },
  { level: 3, label: "Leaning" },
  { level: 4, label: "Confident" },
  { level: 5, label: "Certain" },
];

// Per-item gap line: the emotional hook — confidence vs. outcome.
const GAP = {
  "confident-right": { text: "Right — and you were sure. Solid.", cls: "text-good" },
  "confident-wrong": { text: "Wrong — but you were sure. ⚠ Landmine.", cls: "text-bad font-bold" },
  "unsure-right": { text: "Right — though you weren't sure. Shaky win.", cls: "text-good" },
  "unsure-wrong": { text: "Wrong — and you knew you weren't sure.", cls: "text-bad" },
};

export function CalibrationSession({ userId, blockId, blockName, newPool = [], onExit }) {
  const [items, setItems] = useState(null); // null = loading
  const [build, setBuild] = useState(null); // { phase, pooled, generated } while the bank builds
  const [session, setSession] = useState(() => createSession(BURST));
  const [current, setCurrent] = useState(null); // { concept, mode, item }
  const [picked, setPicked] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [records, setRecords] = useState([]); // {concept, confidence, correct} this session

  useEffect(() => {
    let alive = true;
    (async () => {
      const it = await ensureBlockItems(userId, blockId, {
        onProgress: (p) => { if (alive) setBuild(p); },
      });
      if (alive) { setItems(it); setBuild((b) => (b?.phase === "failed" ? b : null)); }
    })();
    return () => { alive = false; };
  }, [userId, blockId]);

  const derivedPool = useMemo(() => {
    const fromItems = (items || [])
      .map((it) => it?.data?.correctDiagnosis || it?.subject)
      .filter(Boolean)
      .map((concept) => ({ concept, blockId }));
    const seen = new Set();
    const uniq = [];
    for (const p of [...(newPool || []), ...fromItems]) {
      const k = (p.concept || "").toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); uniq.push(p); }
    }
    return uniq;
  }, [items, newPool, blockId]);

  const nextItem = useCallback(() => {
    setPicked(null); setConfidence(null); setRevealed(false);
    const concepts = readConcepts(blockId);
    const known = new Set(concepts.map((c) => (c.concept || "").toLowerCase()));
    const pool = derivedPool.filter((p) => !known.has((p.concept || "").toLowerCase()));
    const sel = selectNext(concepts, pool);
    if (!sel) { setCurrent(null); return; }
    const item = pickItemForConcept(items || [], sel.concept.concept);
    setCurrent({ ...sel, item });
  }, [blockId, derivedPool, items]);

  // Kick the first item once items load, and restart after "Another round".
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional first-item kick (same pattern as EngineSession)
  useEffect(() => { if (items && !current && !session.done) nextItem(); }, [items, current, session.done, nextItem]);

  // Rate confidence → this locks the answer and reveals. Records calibration + mastery.
  const rate = useCallback((level) => {
    if (!current || picked == null || revealed) return;
    const q = current.item?.data;
    const correct = !!(q?.options || []).find((o) => o.letter === picked)?.isCorrect;
    const concept = current.concept.concept;

    setConfidence(level);
    setRevealed(true);

    const rec = { concept, confidence: level, correct };
    appendCalibration(userId, blockId, rec);
    setRecords((prev) => [...prev, rec]);

    // Mastery unchanged by confidence (calibration-only): record correct/wrong as usual.
    writeConcept(blockId, recordOutcome(current.concept, correct ? "correct" : "wrong"));
  }, [current, picked, revealed, blockId]);

  const advance = useCallback(() => {
    if (!current) return;
    const next = advanceSession(session, { concept: current.concept.concept, mode: current.mode });
    setSession(next);
    if (next.done) setCurrent(null);
    else nextItem();
  }, [current, session, nextItem]);

  // Keyboard: A–E pick (no 1–5-as-option here — digits are for confidence);
  // then 1–5 rate confidence; Enter to advance after reveal.
  useEffect(() => {
    const data = current?.item?.data;
    if (!data) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const opts = data.options || [];
      if (picked == null) {
        const letter = (e.key || "").toUpperCase();
        const opt = opts.find((o) => o.letter === letter);
        if (opt) { e.preventDefault(); setPicked(letter); }
      } else if (!revealed) {
        if (/^[1-5]$/.test(e.key)) { e.preventDefault(); rate(Number(e.key)); }
      } else if (e.key === "Enter") {
        e.preventDefault(); advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, picked, revealed, rate, advance]);

  if (items === null) return <Centered><BuildStatus build={build} blockName={blockName} /></Centered>;

  if (session.done) return <Summary records={records} onAnother={() => { setSession(createSession(BURST)); setRecords([]); setCurrent(null); }} onExit={onExit} />;

  if (!current) return <Centered><NothingToStudy blockName={blockName} build={build} onExit={onExit} /></Centered>;

  const q = current.item?.data;
  const correct = revealed && (q.options || []).find((o) => o.letter === picked)?.isCorrect;
  const quadrant = revealed ? classify({ confidence, correct }) : null;

  return (
    <div className="mx-auto max-w-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[13px] uppercase tracking-wider text-accent-text">
          Calibrate
          {current.item?.lecture && <span className="ml-2 normal-case tracking-normal text-text-3">· {current.item.lecture}</span>}
        </span>
        <span className="font-mono text-[13px] text-text-3">{session.index + 1}/{session.size}</span>
      </div>

      {!q && <Centered>No case available for this concept.<div className="mt-3"><Button onClick={advance}>Skip</Button></div></Centered>}

      {q && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-bg-elevated p-4 text-sm leading-relaxed text-text-1 whitespace-pre-wrap">{q.vignette}</div>
          <div className="text-sm font-semibold text-text-1">{q.leadIn || "Most likely diagnosis?"}</div>

          {/* Options — no eliminate crutch; pick locks nothing until confidence rated. */}
          <div className="flex flex-col gap-2">
            {(q.options || []).map((o) => {
              const isPicked = picked === o.letter;
              const cls = !revealed
                ? (isPicked ? "border-accent" : "border-border hover:border-border-strong cursor-pointer")
                : o.isCorrect ? "border-good" : isPicked ? "border-bad" : "border-border opacity-60";
              return (
                <button
                  key={o.letter}
                  disabled={revealed}
                  onClick={() => { if (!revealed) setPicked(o.letter); }}
                  className={"flex flex-1 items-center gap-2 rounded-lg border bg-bg-elevated px-3 py-2 text-left text-sm text-text-1 " + cls}
                >
                  <span className="font-mono text-text-3">{o.letter}</span>{o.text}
                </button>
              );
            })}
          </div>

          {/* Confidence step — appears after pick, before reveal. THE mechanism. */}
          {picked != null && !revealed && (
            <div className="rounded-lg border border-border-strong bg-panel p-3">
              <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-3">How sure are you? (1–5)</div>
              <div className="flex gap-2">
                {CONF.map((c) => (
                  <button
                    key={c.level}
                    onClick={() => rate(c.level)}
                    className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-border px-2 py-2 text-center hover:border-accent"
                  >
                    <span className="font-mono text-sm text-text-1">{c.level}</span>
                    <span className="text-[12px] text-text-3">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reveal — outcome + the calibration gap line + minimal teaching. */}
          {revealed && (
            <div className="space-y-2">
              <div className={"text-sm " + (GAP[quadrant]?.cls || "")}>
                {correct ? "✓ " : "✕ "}{GAP[quadrant]?.text} <span className="text-text-3">— {q.correctDiagnosis}</span>
              </div>
              {q.mechanism && <Panel label="Mechanism">{q.mechanism}</Panel>}
              <Button onClick={advance}>Next → <span className="opacity-60">(Enter)</span></Button>
            </div>
          )}
        </div>
      )}

      <button onClick={onExit} className="mt-6 text-xs text-text-3 hover:text-text-1">Exit session</button>
    </div>
  );
}

function Summary({ records, onAnother, onExit }) {
  const s = summarize(records);
  const pct = (a) => (a == null ? "—" : Math.round(a * 100) + "%");
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="text-lg font-bold text-text-1">Session complete · {records.length} items</div>

      <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-4">
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-3">Calibration — accuracy by confidence</div>
        <div className="flex flex-col gap-1.5">
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
        <div className="mt-1 text-[12px] text-text-3">Well-calibrated = higher confidence → higher accuracy.</div>
      </div>

      {s.landmines.length > 0 && (
        <div className="mt-4 rounded-lg border border-bad bg-bg-elevated p-4">
          <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-bad">⚠ Review first — sure but wrong</div>
          <ul className="flex flex-col gap-1 text-sm text-text-1">
            {s.landmines.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-bad">•</span>{l.concept}
                <span className="ml-auto font-mono text-[12px] text-text-3">{CONF[l.confidence - 1].label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <Button onClick={onAnother}>Another round</Button>
        <Button variant="outline" onClick={onExit}>Done</Button>
      </div>
    </div>
  );
}

function Panel({ label, children }) {
  return (
    <div className="rounded-lg border-l-2 border-accent bg-bg-elevated p-3">
      <div className="mb-1 font-mono text-[12px] uppercase tracking-wider text-text-3">{label}</div>
      <div className="text-sm leading-relaxed text-text-1 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Centered({ children }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center text-sm text-text-2">{children}</div>;
}
