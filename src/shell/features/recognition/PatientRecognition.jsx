import React, { useState, useEffect, useCallback, useRef } from "react";
import { callAIJSON } from "../../../aiClient";
import { fetchRecognitionItems, pickWeightedItems } from "../../../recognitionBank";
import { buildUserPrompt, isUsableCase, pickAnchors, SYSTEM_PROMPT } from "./recognition.js";
import { recordEvidence } from "../../../stores/learnerEvidence.js";

// ── Patient Recognition ────────────────────────────────────────────────────
// Vignette → diagnosis mode. Shows a USMLE Step 1-style clinical vignette built
// from the user's study-guide objectives (the knowledge base), the user names
// the disease, then a Socratic mechanism-teaching reveal fires: the mechanism
// of the disease + why each distractor is wrong + the key differentiator.
//
// Tutoring is a STYLE here, not a chat: every answer teaches mechanism-first,
// and "Teach me deeper" pulls a richer mechanism explanation on demand.
//
// SP1 T3.1: no longer self-contained. The objective pool, the weak-concept
// names and the user id arrive as props from RecognitionContainer, which reads
// them through the store hooks; prompt/pool/anchor logic lives in recognition.js.
// Props: T (theme), onClose, pool, weakConcepts, userId, blockId.

export default function PatientRecognition({
  T,
  onClose,
  pool = [],
  weakConcepts = [],
  userId = null,
  blockId = null,
}) {
  const [topicHint, setTopicHint] = useState("");
  const [q, setQ] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(null); // letter
  const [anchors, setAnchors] = useState([]);

  // "Teach me deeper" state
  const [deep, setDeep] = useState("");
  const [deepLoading, setDeepLoading] = useState(false);

  // session score
  const [seen, setSeen] = useState(0);
  const [correct, setCorrect] = useState(0);

  const reqIdRef = useRef(0);

  const generate = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError("");
    setPicked(null);
    setDeep("");
    setQ(null);
    const chosen = pickAnchors(pool, 2);
    setAnchors(chosen);
    // Prefer the pre-generated bank (instant, no live AI call). The active block
    // is a prop now — it used to come from a stray `rxt-current-block` read that
    // nothing in the shell ever set.
    try {
      if (userId) {
        const blocks = blockId ? [blockId] : Array.from(new Set(pool.map((p) => p.block)));
        let items = [];
        for (const b of blocks) {
          items = items.concat(await fetchRecognitionItems(userId, b));
        }
        if (myReq !== reqIdRef.current) return; // superseded
        if (items.length > 0) {
          const [pickItem] = pickWeightedItems(items, weakConcepts, 1);
          if (pickItem?.data) {
            setQ(pickItem.data);
            setLoading(false);
            return; // served from bank — no live AI call
          }
        }
      }
    } catch { /* fall through to live generation */ }
    try {
      // 4000, not 2600: a five-option case with a whyWrong per option plus the
      // mechanism does not fit in 2600, and a truncated response comes back as
      // an empty object — which is what made this reliably fail.
      const data = await callAIJSON(
        SYSTEM_PROMPT,
        buildUserPrompt(chosen, topicHint),
        null,
        4000
      );
      if (myReq !== reqIdRef.current) return; // superseded
      if (!isUsableCase(data)) {
        setError("The model returned an unusable case (often a truncated response). Retry.");
      } else {
        setQ(data);
      }
    } catch (e) {
      if (myReq !== reqIdRef.current) return;
      setError("Generation failed: " + (e?.message || "unknown error"));
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [pool, topicHint, userId, blockId, weakConcepts]);

  // First case on open only — `generate` changes with the pool, and re-running
  // it on every change would throw away the case being answered.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generate();
  }, [generate]);

  const answered = picked != null && q;
  const correctLetter = q?.options?.find((o) => o.isCorrect)?.letter;

  const onPick = (letter) => {
    if (answered) return;
    setPicked(letter);
    setSeen((n) => n + 1);
    if (letter === correctLetter) setCorrect((n) => n + 1);
    recordEvidence(userId, {
      source: "recognition",
      blockId,
      objectiveIds: anchors.map((a) => a?.id).filter(Boolean),
      correct: letter === correctLetter,
      misconception: letter === correctLetter ? null : "recognition-error",
    });
  };

  const teachDeeper = async () => {
    if (!q) return;
    setDeepLoading(true);
    try {
      const data = await callAIJSON(
        SYSTEM_PROMPT,
        `For the diagnosis "${q.correctDiagnosis}", teach the mechanism in a Socratic,
high-yield way for USMLE Step 1. Walk from first cause → downstream effects → how each
classic finding arises. End with the 1-2 facts most likely to be tested. JSON:
{"teaching":"string (3-6 sentences, mechanism-first)"}`,
        null,
        1200
      );
      setDeep(data?.teaching || "No deeper explanation available.");
    } catch (e) {
      setDeep("Could not load deeper teaching: " + (e?.message || ""));
    } finally {
      setDeepLoading(false);
    }
  };

  // ── styles ──
  const overlay = {
    position: "fixed",
    inset: 0,
    background: T.overlayBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: 16,
    backdropFilter: "blur(3px)",
  };
  const panel = {
    background: T.cardBg,
    border: "1px solid " + T.border1,
    borderRadius: 16,
    width: "100%",
    maxWidth: 620,
    maxHeight: "92vh",
    overflowY: "auto",
    boxShadow: T.shadowMd,
    fontFamily: "var(--font-sans)",
  };
  const accent = T.statusGood;

  const optionStyle = (o) => {
    let bg = "transparent";
    let border = T.border1;
    let color = T.text1;
    if (answered) {
      if (o.letter === correctLetter) {
        bg = T.statusGoodBg;
        border = T.statusGoodBorder;
        color = T.text1;
      } else if (o.letter === picked) {
        bg = T.statusBadBg;
        border = T.statusBadBorder;
      } else {
        color = T.text3;
      }
    }
    return {
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      width: "100%",
      textAlign: "left",
      padding: "12px 14px",
      borderRadius: 11,
      border: "1px solid " + border,
      background: bg,
      color,
      cursor: answered ? "default" : "pointer",
      fontSize: 14,
      lineHeight: 1.4,
      transition: "background 140ms, border-color 140ms",
      fontFamily: "var(--font-sans)",
    };
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Patient Recognition" onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        {/* Header */}
        <div
          style={{
            padding: "18px 22px 14px",
            borderBottom: "1px solid " + T.border2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            position: "sticky",
            top: 0,
            background: T.cardBg,
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🩺</span>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600, color: T.text1 }}>
                Patient Recognition
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 3, fontFamily: "var(--font-mono)" }}>
              {seen > 0 ? `${correct}/${seen} correct this session` : "Name the disease from the case"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "none", color: T.text3, fontSize: 20, cursor: "pointer", padding: 4 }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "18px 22px 22px" }}>
          {/* Loading */}
          {loading && (
            <div style={{ padding: "40px 0", textAlign: "center", color: T.text3 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🧬</div>
              <div style={{ fontSize: 14 }}>Building a clinical case…</div>
              {anchors.length > 0 && (
                <div style={{ fontSize: 11, color: T.text4, marginTop: 8, fontFamily: "var(--font-mono)" }}>
                  from: {anchors.map((a) => a.text.slice(0, 40)).join(" · ")}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div style={{ padding: "20px 0" }}>
              <div style={{ color: T.statusBad, fontSize: 14, marginBottom: 14 }}>{error}</div>
              {pool.length === 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: T.text3, marginBottom: 6 }}>
                    No objectives found yet — type a topic to drill:
                  </div>
                  <input
                    value={topicHint}
                    onChange={(e) => setTopicHint(e.target.value)}
                    placeholder="e.g. heart failure, glomerular disease…"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 13,
                      background: T.inputBg,
                      border: "1px solid " + T.border1,
                      borderRadius: 9,
                      color: T.text1,
                      fontFamily: "var(--font-sans)",
                    }}
                  />
                </div>
              )}
              <button type="button" onClick={generate} style={primaryBtn(accent)}>
                Retry
              </button>
            </div>
          )}

          {/* Question */}
          {!loading && q && (
            <>
              {/* Vignette */}
              <div
                style={{
                  background: T.inputBg,
                  border: "1px solid " + T.border2,
                  borderRadius: 12,
                  padding: "16px 18px",
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: T.text1,
                  whiteSpace: "pre-wrap",
                }}
              >
                {q.vignette}
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, color: T.text1, margin: "16px 2px 12px" }}>
                {q.leadIn || "What is the most likely diagnosis?"}
              </div>

              {/* Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {q.options.map((o) => (
                  <button key={o.letter} type="button" onClick={() => onPick(o.letter)} style={optionStyle(o)}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        color:
                          answered && o.letter === correctLetter
                            ? T.statusGood
                            : answered && o.letter === picked
                            ? T.statusBad
                            : T.text3,
                        flexShrink: 0,
                      }}
                    >
                      {o.letter}
                    </span>
                    <span style={{ flex: 1 }}>{o.text}</span>
                    {answered && o.letter === correctLetter && <span style={{ color: T.statusGood }}>✓</span>}
                    {answered && o.letter === picked && o.letter !== correctLetter && (
                      <span style={{ color: T.statusBad }}>✕</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Reveal — mechanism teaching */}
              {answered && (
                <div style={{ marginTop: 18 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: picked === correctLetter ? T.statusGood : T.statusBad,
                      marginBottom: 12,
                    }}
                  >
                    {picked === correctLetter ? "✓ Correct" : "✕ Not quite"} — {q.correctDiagnosis}
                  </div>

                  {/* Mechanism */}
                  <TeachBlock T={T} label="Mechanism" accentColor={T.statusProgress}>
                    {q.mechanism}
                  </TeachBlock>

                  {/* Key differentiator */}
                  {q.keyDifferentiator && (
                    <TeachBlock T={T} label="Key differentiator" accentColor={T.statusWarn}>
                      {q.keyDifferentiator}
                    </TeachBlock>
                  )}

                  {/* Why the distractors are wrong */}
                  <div style={{ marginTop: 14 }}>
                    <div style={miniLabel(T)}>Why not the others</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {q.options
                        .filter((o) => !o.isCorrect && o.whyWrong)
                        .map((o) => (
                          <div key={o.letter} style={{ fontSize: 13, color: T.text2, lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: T.text3, fontFamily: "var(--font-mono)" }}>
                              {o.letter}.
                            </span>{" "}
                            <span style={{ color: T.text3 }}>{o.text}</span> — {o.whyWrong}
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Teach me deeper */}
                  <div style={{ marginTop: 16 }}>
                    {!deep && (
                      <button type="button" onClick={teachDeeper} disabled={deepLoading} style={ghostBtn(T, accent)}>
                        {deepLoading ? "Teaching…" : "🧠 Teach me deeper"}
                      </button>
                    )}
                    {deep && (
                      <div
                        style={{
                          marginTop: 4,
                          padding: "14px 16px",
                          background: T.statusProgressBg,
                          border: "1px solid " + T.statusProgressBorder,
                          borderRadius: 11,
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          color: T.text1,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {deep}
                      </div>
                    )}
                  </div>

                  {/* Next */}
                  <button type="button" onClick={generate} style={{ ...primaryBtn(accent), width: "100%", marginTop: 18 }}>
                    Next patient →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TeachBlock({ T, label, accentColor, children }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "12px 14px",
        background: T.inputBg,
        borderLeft: "3px solid " + accentColor,
        borderRadius: "0 10px 10px 0",
      }}
    >
      <div style={miniLabel(T)}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: T.text1, whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

function miniLabel(T) {
  return {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: T.text3,
    fontWeight: 700,
    marginBottom: 6,
    fontFamily: "var(--font-mono)",
  };
}

function primaryBtn(accent) {
  return {
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    background: accent,
    border: "1px solid " + accent,
    borderRadius: 10,
    color: "#fff",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
  };
}

function ghostBtn(T, accent) {
  return {
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    background: "transparent",
    border: "1px solid " + accent,
    borderRadius: 10,
    color: accent,
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
  };
}
