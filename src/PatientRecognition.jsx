import React, { useState, useEffect, useCallback, useRef } from "react";
import { callAIJSON } from "./aiClient";

// ── Patient Recognition ────────────────────────────────────────────────────
// Vignette → diagnosis mode. Shows a USMLE Step 1-style clinical vignette built
// from the user's study-guide objectives (the knowledge base), the user names
// the disease, then a Socratic mechanism-teaching reveal fires: the mechanism
// of the disease + why each distractor is wrong + the key differentiator.
//
// Tutoring is a STYLE here, not a chat: every answer teaches mechanism-first,
// and "Teach me deeper" pulls a richer mechanism explanation on demand.
//
// Self-contained: reads objectives from localStorage (rxt-block-objectives) so
// it needs no prop plumbing. Props: T (theme), onClose.

const OBJ_KEY = "rxt-block-objectives";

// Flatten the objectives store into a pool of {text, block} anchors.
function readObjectivePool() {
  try {
    const raw = localStorage.getItem(OBJ_KEY);
    if (!raw) return [];
    const store = JSON.parse(raw);
    if (!store || typeof store !== "object") return [];
    const pool = [];
    for (const [block, bucket] of Object.entries(store)) {
      const list = Array.isArray(bucket)
        ? bucket
        : bucket && typeof bucket === "object"
        ? [...(bucket.imported || []), ...(bucket.extracted || [])]
        : [];
      for (const o of list) {
        const text = (o && (o.objective || o.text || o.term)) || "";
        if (typeof text === "string" && text.trim().length > 8) {
          pool.push({ text: text.trim(), block });
        }
      }
    }
    return pool;
  } catch {
    return [];
  }
}

function pickAnchors(pool, n = 2) {
  if (pool.length === 0) return [];
  const out = [];
  const used = new Set();
  for (let i = 0; i < n && i < pool.length; i++) {
    let idx;
    do {
      idx = Math.floor(Math.random() * pool.length);
    } while (used.has(idx) && used.size < pool.length);
    used.add(idx);
    out.push(pool[idx]);
  }
  return out;
}

const SYSTEM_PROMPT =
  "You are an expert USMLE Step 1 item-writer and clinical educator. You write " +
  "high-yield patient vignettes that test DISEASE RECOGNITION — the student must " +
  "identify the underlying disease from the clinical picture, not just recall a term. " +
  "You teach in a Socratic, mechanism-first style. Always respond with valid JSON only.";

function buildUserPrompt(anchors, topicHint) {
  const anchorText = anchors.length
    ? anchors.map((a, i) => `${i + 1}. ${a.text}`).join("\n")
    : topicHint || "general high-yield preclinical medicine";
  return `Write ONE Step 1-style patient vignette that tests recognition of the disease
underlying these study-guide objective(s):

${anchorText}

Requirements:
- The vignette is a realistic clinical case (age/sex, presentation, relevant history,
  exam findings, and key labs/imaging where appropriate). Do NOT name the disease in the stem.
- The lead-in asks for the MOST LIKELY DIAGNOSIS (recognition), not a fact recall.
- Provide 5 answer options that are plausible diseases/diagnoses (realistic look-alikes),
  exactly one correct.
- For EACH wrong option, give a one-sentence "whyWrong" that contrasts it with the correct
  disease on a distinguishing feature (teach the differential).
- Teach the MECHANISM of the correct disease (pathophysiology that explains the findings),
  in 2-4 sentences, mechanism-first.
- Give one "keyDifferentiator": the single highest-yield feature that nails this diagnosis.

Respond with JSON exactly in this shape:
{
  "vignette": "string (the clinical case, no diagnosis named)",
  "leadIn": "What is the most likely diagnosis?",
  "correctDiagnosis": "string",
  "options": [
    {"letter":"A","text":"disease name","isCorrect":false,"whyWrong":"..."},
    {"letter":"B","text":"disease name","isCorrect":true,"whyWrong":""},
    {"letter":"C","text":"disease name","isCorrect":false,"whyWrong":"..."},
    {"letter":"D","text":"disease name","isCorrect":false,"whyWrong":"..."},
    {"letter":"E","text":"disease name","isCorrect":false,"whyWrong":"..."}
  ],
  "mechanism": "string (pathophysiology that explains the vignette findings)",
  "keyDifferentiator": "string"
}`;
}

export default function PatientRecognition({ T, onClose }) {
  const [pool] = useState(() => readObjectivePool());
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
    try {
      const data = await callAIJSON(
        SYSTEM_PROMPT,
        buildUserPrompt(chosen, topicHint),
        null,
        2600
      );
      if (myReq !== reqIdRef.current) return; // superseded
      if (!data || !Array.isArray(data.options) || !data.vignette) {
        setError("Could not generate a case. Check your AI key, then retry.");
      } else {
        setQ(data);
      }
    } catch (e) {
      if (myReq !== reqIdRef.current) return;
      setError("Generation failed: " + (e?.message || "unknown error"));
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [pool, topicHint]);

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answered = picked != null && q;
  const correctLetter = q?.options?.find((o) => o.isCorrect)?.letter;

  const onPick = (letter) => {
    if (answered) return;
    setPicked(letter);
    setSeen((n) => n + 1);
    if (letter === correctLetter) setCorrect((n) => n + 1);
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
