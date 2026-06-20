import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "../ui/Button.jsx";
import { readConcepts, writeConcept } from "./masteryStore.js";
import { ensureBlockItems, pickItemForConcept } from "./content.js";
import { selectNext } from "./selectConcept.js";
import { createSession, advanceSession, sessionSummary } from "./session.js";
import { recordOutcome } from "./mastery.js";
import { callAIJSON } from "../aiClient.js";

const BURST = 10;

export function EngineSession({ userId, blockId, blockName, newPool = [], onExit }) {
  const [items, setItems] = useState(null); // null=loading
  const [session, setSession] = useState(() => createSession(BURST));
  const [current, setCurrent] = useState(null); // { concept, mode, item, isNew }
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [struck, setStruck] = useState(() => new Set()); // eliminated choices
  const [deep, setDeep] = useState("");
  const [deepLoading, setDeepLoading] = useState(false);
  const toggleStrike = (letter) =>
    setStruck((prev) => {
      const n = new Set(prev);
      n.has(letter) ? n.delete(letter) : n.add(letter);
      return n;
    });

  // Live Claude/Gemini Socratic mechanism deepening for the current item.
  const teachDeeper = useCallback(async (item) => {
    const dx = item?.data?.correctDiagnosis;
    if (!dx) return;
    setDeepLoading(true);
    try {
      const data = await callAIJSON(
        "You are a USMLE Step 1 tutor. Teach mechanism-first, Socratic, high-yield.",
        `For the diagnosis "${dx}", teach the mechanism Socratically for USMLE Step 1.
Walk from first cause → downstream effects → how each classic finding arises. End with
the 1-2 facts most likely tested. JSON: {"teaching":"string (3-6 sentences, mechanism-first)"}`,
        null,
        1200
      );
      setDeep(data?.teaching || "No deeper explanation available.");
    } catch (e) {
      setDeep("Could not load deeper teaching: " + (e?.message || ""));
    } finally {
      setDeepLoading(false);
    }
  }, []);

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
    setPicked(null); setRevealed(false); setStruck(new Set()); setDeep(""); setDeepLoading(false);
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
  // All modes are question-first; the label hints how much teaching follows.
  const modeLabel = { teach: "New · full teach", recognize: "Review", test: "Test" }[current.mode];

  return (
    <div className="mx-auto max-w-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-accent-text">
          {modeLabel}
          {current.item?.lecture && <span className="ml-2 normal-case tracking-normal text-text-3">· {current.item.lecture}</span>}
        </span>
        <span className="font-mono text-[11px] text-text-3">{session.index + 1}/{session.size}</span>
      </div>

      {!q && <Centered>No case available for this concept.<div className="mt-3"><Button onClick={() => submit("exposure")}>Skip</Button></div></Centered>}

      {q && (
        <div className="space-y-3">
          {/* Always question-first: read the case, think, answer — THEN teaching. */}
          <div className="rounded-lg border border-border bg-bg-elevated p-4 text-sm leading-relaxed text-text-1 whitespace-pre-wrap">{q.vignette}</div>
          <div className="text-sm font-semibold text-text-1">{q.leadIn || "Most likely diagnosis?"}</div>
          <div className="flex flex-col gap-2">
            {(q.options || []).map((o) => {
              const isPicked = picked === o.letter;
              const isStruck = struck.has(o.letter);
              const cls = !revealed
                ? (isStruck ? "border-border opacity-40 line-through" : "border-border hover:border-border-strong cursor-pointer")
                : o.isCorrect ? "border-good" : isPicked ? "border-bad" : "border-border opacity-60";
              return (
                <div key={o.letter} className="flex items-center gap-2">
                  <button
                    disabled={revealed || isStruck}
                    onClick={() => { setPicked(o.letter); setRevealed(true); }}
                    className={"flex flex-1 items-center gap-2 rounded-lg border bg-bg-elevated px-3 py-2 text-left text-sm text-text-1 " + cls}
                  >
                    <span className="font-mono text-text-3">{o.letter}</span>{o.text}
                  </button>
                  {!revealed && (
                    <button
                      onClick={() => toggleStrike(o.letter)}
                      title={isStruck ? "Bring back" : "Eliminate"}
                      className="rounded-md px-2 py-1 text-xs text-text-3 hover:text-bad"
                    >
                      {isStruck ? "↩" : "✕"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Reveal: depth scales with mastery — teach=full, review=mechanism, test=minimal. */}
          {revealed && (() => {
            const correct = (q.options || []).find((o) => o.letter === picked)?.isCorrect;
            return (
              <div className="space-y-2">
                <div className={"text-sm font-semibold " + (correct ? "text-good" : "text-bad")}>
                  {correct ? "✓ Correct" : "✕ Not quite"} — {q.correctDiagnosis}
                </div>
                {(current.mode === "teach" || current.mode === "recognize") && q.mechanism && (
                  <Panel label="Mechanism">{q.mechanism}</Panel>
                )}
                {current.mode === "teach" && q.keyDifferentiator && (
                  <Panel label="Key differentiator">{q.keyDifferentiator}</Panel>
                )}
                {(current.mode === "teach" || current.mode === "recognize") && (
                  <Deeper loading={deepLoading} deep={deep} onClick={() => teachDeeper(current.item)} />
                )}
                <Button onClick={() => submit(correct ? "correct" : "wrong")}>Next →</Button>
              </div>
            );
          })()}
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

function Deeper({ loading, deep, onClick }) {
  if (deep) {
    return (
      <div className="rounded-lg border border-border bg-accent-soft p-3 text-sm leading-relaxed text-text-1 whitespace-pre-wrap">
        {deep}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-accent-text hover:bg-panel disabled:opacity-50"
    >
      {loading ? "Teaching…" : "🧠 Teach me deeper"}
    </button>
  );
}

function Centered({ children }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center text-sm text-text-2">{children}</div>;
}
