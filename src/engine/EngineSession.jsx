import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "../ui/Button.jsx";
import { readConcepts, writeConcept } from "./masteryStore.js";
import { ensureBlockItems, pickItemForConcept } from "./content.js";
import { selectNext } from "./selectConcept.js";
import { createSession, advanceSession, sessionSummary } from "./session.js";
import { recordOutcome } from "./mastery.js";

const BURST = 10;

export function EngineSession({ userId, blockId, blockName, newPool = [], onExit }) {
  const [items, setItems] = useState(null); // null=loading
  const [session, setSession] = useState(() => createSession(BURST));
  const [current, setCurrent] = useState(null); // { concept, mode, item, isNew }
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const it = await ensureBlockItems(userId, blockId);
      if (alive) setItems(it);
    })();
    return () => { alive = false; };
  }, [userId, blockId]);

  // Seed a "new material" pool from the bank's diagnoses (real concepts) so a
  // fresh block — no stored concepts yet — can still teach. De-duped; the
  // caller's newPool prop takes priority.
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
    setPicked(null); setRevealed(false);
    const concepts = readConcepts(blockId);
    // Don't re-introduce a concept that's already tracked (would reset its progress).
    const known = new Set(concepts.map((c) => (c.concept || "").toLowerCase()));
    const pool = derivedPool.filter((p) => !known.has((p.concept || "").toLowerCase()));
    const sel = selectNext(concepts, pool);
    if (!sel) { setCurrent(null); return; }
    const item = pickItemForConcept(items || [], sel.concept.concept);
    setCurrent({ ...sel, item });
  }, [blockId, derivedPool, items]);

  // Kick the first item, and restart after "Another round". Guard prevents
  // double-firing with the synchronous nextItem() in submit (current is set there).
  useEffect(() => { if (items && !current && !session.done) nextItem(); }, [items, current, session.done, nextItem]);

  const submit = useCallback((outcome) => {
    if (!current) return;
    const updated = recordOutcome(current.concept, outcome);
    const becameMastered = updated.masteryLevel === "mastered" && current.concept.masteryLevel !== "mastered";
    writeConcept(blockId, updated);
    const next = advanceSession(session, { concept: current.concept.concept, mode: current.mode, outcome, becameMastered });
    setSession(next);
    if (next.done) setCurrent(null);
    else nextItem();
  }, [current, session, blockId, nextItem]);

  if (items === null) return <Centered>Loading your session…</Centered>;

  if (session.done) {
    const s = sessionSummary(session);
    return (
      <Centered>
        <div className="text-lg font-bold text-text-1">Session complete</div>
        <div className="mt-2 font-mono text-xs text-text-2">
          {s.total} items · {s.correct} correct · {s.wrong} missed · {s.masteredGained} newly mastered
        </div>
        <div className="mt-4 flex gap-2 justify-center">
          <Button onClick={() => { setSession(createSession(BURST)); setCurrent(null); }}>Another round</Button>
          <Button variant="outline" onClick={onExit}>Done</Button>
        </div>
      </Centered>
    );
  }

  if (!current) {
    return <Centered>Nothing to study in {blockName} yet — build the recognition bank first.<div className="mt-3"><Button variant="outline" onClick={onExit}>Back</Button></div></Centered>;
  }

  const q = current.item?.data;
  const modeLabel = { teach: "Teach", recognize: "Recognize", test: "Test" }[current.mode];

  return (
    <div className="mx-auto max-w-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-accent-text">{modeLabel} · {current.concept.concept}</span>
        <span className="font-mono text-[11px] text-text-3">{session.index + 1}/{session.size}</span>
      </div>

      {!q && <Centered>No case available for this concept.<div className="mt-3"><Button onClick={() => submit("exposure")}>Skip</Button></div></Centered>}

      {q && current.mode === "teach" && (
        <div className="space-y-3">
          <Panel label="Mechanism">{q.mechanism}</Panel>
          {q.keyDifferentiator && <Panel label="Key differentiator">{q.keyDifferentiator}</Panel>}
          <div className="rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-2">{q.vignette}</div>
          <Button onClick={() => submit("exposure")}>Got it →</Button>
        </div>
      )}

      {q && (current.mode === "recognize" || current.mode === "test") && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-bg-elevated p-4 text-sm text-text-1">{q.vignette}</div>
          <div className="text-sm font-semibold text-text-1">{q.leadIn || "Most likely diagnosis?"}</div>
          <div className="flex flex-col gap-2">
            {(q.options || []).map((o) => {
              const isPicked = picked === o.letter;
              const show = revealed;
              const cls = !show ? "border-border" : o.isCorrect ? "border-good" : isPicked ? "border-bad" : "border-border";
              return (
                <button key={o.letter} disabled={revealed}
                  onClick={() => { setPicked(o.letter); setRevealed(true); }}
                  className={"flex items-center gap-2 rounded-lg border bg-bg-elevated px-3 py-2 text-left text-sm text-text-1 " + cls}>
                  <span className="font-mono text-text-3">{o.letter}</span>{o.text}
                </button>
              );
            })}
          </div>
          {revealed && (
            <div className="space-y-2">
              {current.mode === "recognize" && <Panel label="Mechanism">{q.mechanism}</Panel>}
              <Button onClick={() => {
                const correct = (q.options || []).find((o) => o.letter === picked)?.isCorrect;
                submit(correct ? "correct" : "wrong");
              }}>Next →</Button>
            </div>
          )}
        </div>
      )}

      <button onClick={onExit} className="mt-6 text-xs text-text-3 hover:text-text-1">Exit session</button>
    </div>
  );
}

function Panel({ label, children }) {
  return (
    <div className="rounded-lg border-l-2 border-accent bg-bg-elevated p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-3">{label}</div>
      <div className="text-sm leading-relaxed text-text-1 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Centered({ children }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center text-sm text-text-2">{children}</div>;
}
