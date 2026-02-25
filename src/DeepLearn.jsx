import { useState, useCallback } from "react";
import { useTheme } from "./theme";

const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

const PHASES = [
  { num: 1, icon: "🏥", title: "Clinical Anchor", subtitle: "Pattern Recognition First", color: "#ef4444", description: "Start with a real patient. Build context before mechanisms.", generates: "vignette" },
  { num: 2, icon: "🔬", title: "Pathway Backtracking", subtitle: "Mechanism Mapping", color: "#f97316", generates: "pathway" },
  { num: 3, icon: "⚙️", title: "Structural Identification", subtitle: "Pin the Exact Molecular Defect", color: "#f59e0b", generates: "structure" },
  { num: 4, icon: "💊", title: "Pharmacologic Intervention", subtitle: "Strategic System Override", color: "#10b981", generates: "pharmacology" },
  { num: 5, icon: "🎯", title: "Board Integration", subtitle: "Step 1 Proof", color: "#3b82f6", generates: "boards" },
  { num: 6, icon: "🔁", title: "Retention Lock", subtitle: "Active Recall Loop", color: "#a78bfa", generates: "recall" },
];

async function generatePhase(phaseNum, topic, previousContent) {
  const prompts = {
    1: `You are a medical educator. For the topic "${topic}", generate a Phase 1 Clinical Anchor.

Return JSON:
{
  "vignette": "3-4 sentence patient scenario with chief complaint, timeline, vitals, and 2-3 exam findings",
  "chiefComplaint": "one sentence",
  "timeline": "acute or chronic with duration",
  "vitals": ["vital sign 1", "vital sign 2", "vital sign 3"],
  "examFindings": ["finding 1", "finding 2", "finding 3"],
  "labAbnormalities": ["lab 1", "lab 2"],
  "systemQuestion": "What organ system is most involved?",
  "dangerousQuestion": "What is the most dangerous possibility?",
  "commonQuestion": "What is the most common possibility?",
  "systemAnswer": "answer",
  "dangerousAnswer": "answer",
  "commonAnswer": "answer",
  "syndromePattern": "1-2 sentence pattern summary"
}`,
    2: `For the topic "${topic}" and patient: ${typeof previousContent?.[1] === "object" && previousContent[1]?.vignette ? previousContent[1].vignette : "patient case"}.

Generate Phase 2 Pathway Backtracking. Return JSON:
{
  "layers": [
    { "level": "Organ dysfunction", "description": "what fails at organ level" },
    { "level": "Cellular dysfunction", "description": "what fails at cell level" },
    { "level": "Signaling pathway", "description": "what pathway is disrupted" },
    { "level": "Molecular defect", "description": "specific enzyme/receptor/transporter" }
  ],
  "clozeStatements": [
    "↓ ___ leads to accumulation of ___.",
    "Failure of ___ receptor causes inability to ___.",
    "Mutation in ___ enzyme blocks conversion of ___ to ___."
  ],
  "clozeAnswers": ["answer1", "answer2", "answer3"],
  "causalChain": "clean 1-paragraph causal chain from symptom to molecule"
}`,
    3: `For "${topic}". Generate Phase 3 Structural Identification. Return JSON:
{
  "defectType": "enzyme deficiency | receptor malfunction | transport problem | transcription problem",
  "specificDefect": "exact molecular defect name",
  "location": "tissue or organelle where defect occurs",
  "accumulates": "what accumulates as result",
  "deficient": "what becomes deficient",
  "kinetics": "competitive vs noncompetitive if applicable or N/A",
  "gainLoss": "gain of function vs loss of function",
  "inheritance": "autosomal dominant | autosomal recessive | X-linked | mitochondrial | N/A",
  "cleanStatement": "This disease is a failure of ___ located in ___ causing ___ accumulation.",
  "questions": [
    { "q": "Is this an enzyme deficiency?", "a": "yes/no + explanation" },
    { "q": "Is this a receptor malfunction?", "a": "yes/no + explanation" },
    { "q": "Is this a transport problem?", "a": "yes/no + explanation" }
  ]
}`,
    4: `For "${topic}". Generate Phase 4 Pharmacologic Intervention. Return JSON:
{
  "interventions": [
    {
      "problem": "physiologic problem",
      "physiologicFix": "what the fix does",
      "drugExample": "drug name",
      "mechanism": "how drug works mechanistically"
    }
  ],
  "bypassDrug": "drug that bypasses the block",
  "inhibitorDrug": "drug that inhibits toxic buildup",
  "receptorTarget": "receptor we can stimulate instead",
  "upstreamDownstream": "pathway we can modify upstream or downstream"
}`,
    5: `For "${topic}". Generate Phase 5 Board Integration Layer. Return JSON:
{
  "buzzwords": ["word1", "word2", "word3", "word4"],
  "mostCommonComplication": "...",
  "mostDeadlyComplication": "...",
  "labSignature": "characteristic lab findings",
  "histologyClue": "what to look for on histology slide",
  "inheritance": "genetic pattern",
  "trickAnswers": ["what they might trick you with 1", "trick 2"],
  "secondBestAnswer": "what the second-best choice usually is and why it's wrong",
  "mnemonics": ["mnemonic 1 if applicable"],
  "firstAidPage": "approximate First Aid chapter/topic reference"
}`,
    6: `For "${topic}" summarize everything for Phase 6 Retention Lock. Return JSON:
{
  "oralExplanation": "2-3 paragraph explanation as if teaching a classmate, no jargon without explanation",
  "ankiPrompts": [
    { "front": "cloze prompt 1", "back": "answer 1" },
    { "front": "cloze prompt 2", "back": "answer 2" },
    { "front": "cloze prompt 3", "back": "answer 3" }
  ],
  "miniVignette": "1 short self-generated vignette the student can quiz themselves with",
  "miniVignetteAnswer": "answer and explanation",
  "sideEffectPrediction": "predict a drug side effect based on mechanism",
  "sideEffectAnswer": "the answer with mechanism explanation",
  "masteryStatement": "one sentence: what you now own about this topic"
}`,
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompts[phaseNum] }] }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.7 },
        safetySettings: [
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        ],
      }),
    }
  );
  const d = await res.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const first = Math.min(
    text.indexOf("{") === -1 ? Infinity : text.indexOf("{"),
    text.indexOf("[") === -1 ? Infinity : text.indexOf("[")
  );
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (first === Infinity || last === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(first, last + 1));
}

export default function DeepLearn({ lecture, subtopic, profile, onBack, termColor, onMastered }) {
  const { T } = useTheme();
  const accent = termColor || T.purple;
  const [phase, setPhase] = useState(1);
  const [content, setContent] = useState({});
  const [loading, setLoading] = useState(false);
  const [userInput, setUserInput] = useState({});
  const [completed, setCompleted] = useState({});
  const [topic, setTopic] = useState(subtopic || (lecture?.subtopics?.[0]) || "");
  const [revealed, setRevealed] = useState({});
  const [flippedCards, setFlippedCards] = useState({});
  const [phase6Mastered, setPhase6Mastered] = useState(false);

  const startDeepLearn = useCallback(async () => {
    const t = topic.trim();
    if (!t) return;
    setLoading(true);
    try {
      const c1 = await generatePhase(1, t, {});
      setContent((prev) => ({ ...prev, 1: c1 }));
      setPhase(1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [topic]);

  const completePhase = useCallback(async (p) => {
    setCompleted((prev) => ({ ...prev, [p]: true }));
    if (p >= 6) return;
    const next = p + 1;
    setPhase(next);
    if (!content[next]) {
      setLoading(true);
      try {
        const c = await generatePhase(next, topic.trim(), content);
        setContent((prev) => ({ ...prev, [next]: c }));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
  }, [topic, content]);

  const toggleReveal = (key) => setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleCard = (idx) => setFlippedCards((prev) => ({ ...prev, [idx]: !prev[idx] }));

  const handleMastered = () => {
    setPhase6Mastered(true);
    onMastered?.(topic.trim());
  };

  return (
    <div style={{ padding: "24px 32px 48px", maxWidth: 720, margin: "0 auto", fontFamily: MONO }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <button
          type="button"
          onClick={onBack}
          style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: MONO, fontSize: 12 }}
        >
          ← Back
        </button>
        <h1 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 900, color: T.text1, margin: 0 }}>🧬 Deep Learn</h1>
      </div>

      {/* Topic selector — show when no content yet */}
      {!content[1] && (
        <div style={{ background: T.cardBg, border: "1px solid " + T.border2, borderRadius: 14, padding: "20px 24px", marginBottom: 24 }}>
          <div style={{ fontFamily: MONO, color: T.text4, fontSize: 9, letterSpacing: 2, marginBottom: 10 }}>TOPIC</div>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. G6PD deficiency, Hypertrophic cardiomyopathy"
            style={{ width: "100%", boxSizing: "border-box", background: T.inputBg, border: "1px solid " + T.border1, color: T.text1, fontFamily: MONO, fontSize: 14, padding: "12px 14px", borderRadius: 10, outline: "none", marginBottom: 14 }}
          />
          <button
            type="button"
            onClick={startDeepLearn}
            disabled={!topic.trim() || loading}
            style={{ background: accent, border: "none", color: T.text1, padding: "12px 24px", borderRadius: 10, cursor: loading ? "wait" : "pointer", fontFamily: MONO, fontSize: 13, fontWeight: 600 }}
          >
            {loading ? "Generating Phase 1…" : "Begin Deep Learn →"}
          </button>
        </div>
      )}

      {/* Progress bar */}
      {content[1] && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            {PHASES.map((ph) => (
              <div
                key={ph.num}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: completed[ph.num] ? T.green : phase === ph.num ? ph.color : T.border2,
                  opacity: phase > ph.num ? 1 : phase === ph.num ? 1 : 0.4,
                }}
              />
            ))}
          </div>
          <div style={{ fontFamily: MONO, color: T.text4, fontSize: 10 }}>Phase {phase} of 6</div>
        </div>
      )}

      {/* Phase cards */}
      {content[1] &&
        PHASES.map((ph) => {
          const isActive = phase === ph.num;
          const isDone = completed[ph.num];
          const isLocked = phase < ph.num;
          const data = content[ph.num];

          return (
            <div
              key={ph.num}
              style={{
                background: T.cardBg,
                border: "1px solid " + (isActive ? ph.color : T.border2),
                borderRadius: 14,
                marginBottom: 12,
                overflow: "hidden",
                opacity: isLocked ? 0.6 : 1,
                boxShadow: isActive ? `0 0 24px ${ph.color}22` : "none",
                borderLeft: "4px solid " + (isDone ? T.green : isActive ? ph.color : "transparent"),
              }}
            >
              {/* Phase header — always visible */}
              <div
                style={{
                  padding: "14px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  borderBottom: isActive && data ? "1px solid " + T.border2 : "none",
                }}
              >
                <span style={{ fontSize: 24 }}>{ph.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: SERIF, color: isLocked ? T.text4 : T.text1, fontSize: 16, fontWeight: 700 }}>{ph.title}</div>
                  <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11 }}>{ph.subtitle}</div>
                </div>
                {isDone && <span style={{ color: T.green, fontSize: 18 }}>✓</span>}
              </div>

              {/* Phase body — expanded only when active and has content */}
              {isActive && data && (
                <div style={{ padding: "20px 24px", animation: "fadeIn 0.3s ease" }}>
                  {ph.num === 1 && <Phase1Content data={data} T={T} userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} SERIF={SERIF} MONO={MONO} />}
                  {ph.num === 2 && <Phase2Content data={data} T={T} userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} MONO={MONO} />}
                  {ph.num === 3 && <Phase3Content data={data} T={T} userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} MONO={MONO} SERIF={SERIF} />}
                  {ph.num === 4 && <Phase4Content data={data} T={T} revealed={revealed} toggleReveal={toggleReveal} MONO={MONO} />}
                  {ph.num === 5 && <Phase5Content data={data} T={T} MONO={MONO} SERIF={SERIF} />}
                  {ph.num === 6 && (
                    <Phase6Content
                      data={data}
                      T={T}
                      MONO={MONO}
                      SERIF={SERIF}
                      revealed={revealed}
                      toggleReveal={toggleReveal}
                      flippedCards={flippedCards}
                      toggleCard={toggleCard}
                      phase6Mastered={phase6Mastered}
                      onMastered={handleMastered}
                      accent={accent}
                    />
                  )}

                  <div style={{ marginTop: 24 }}>
                    <button
                      type="button"
                      onClick={() => completePhase(ph.num)}
                      style={{
                        background: ph.color,
                        border: "none",
                        color: "#fff",
                        padding: "12px 24px",
                        borderRadius: 10,
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {ph.num === 6 ? "Finish" : "Complete Phase → Unlock Next"}
                    </button>
                  </div>
                </div>
              )}

              {/* Collapsed summary for completed */}
              {isDone && !isActive && (
                <div style={{ padding: "12px 20px", fontFamily: MONO, color: T.text4, fontSize: 12 }}>
                  {ph.title} completed
                </div>
              )}
            </div>
          );
        })}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

function Phase1Content({ data, T, userInput, setUserInput, revealed, toggleReveal, SERIF, MONO }) {
  const v = data.vignette || "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ borderLeft: "4px solid " + T.red, background: T.inputBg, padding: "16px 18px", borderRadius: 0, fontFamily: MONO, color: T.text2, fontSize: 13, lineHeight: 1.7 }}>{v}</div>
      <QuestionBox label={data.systemQuestion} answer={data.systemAnswer} uid="p1_system" userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} T={T} MONO={MONO} />
      <QuestionBox label={data.dangerousQuestion} answer={data.dangerousAnswer} uid="p1_dangerous" userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} T={T} MONO={MONO} />
      <QuestionBox label={data.commonQuestion} answer={data.commonAnswer} uid="p1_common" userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} T={T} MONO={MONO} />
      {revealed.p1_system && revealed.p1_dangerous && revealed.p1_common && data.syndromePattern && (
        <div style={{ background: T.border2, padding: "12px 16px", borderRadius: 10, fontFamily: MONO, color: T.text3, fontSize: 12 }}><strong>Pattern:</strong> {data.syndromePattern}</div>
      )}
    </div>
  );
}

function QuestionBox({ label, answer, uid, userInput, setUserInput, revealed, toggleReveal, T, MONO }) {
  return (
    <div style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 8 }}>{label}</div>
      <input
        type="text"
        value={userInput[uid] ?? ""}
        onChange={(e) => setUserInput((p) => ({ ...p, [uid]: e.target.value }))}
        placeholder="Your answer…"
        style={{ width: "100%", boxSizing: "border-box", background: T.cardBg, border: "1px solid " + T.border2, color: T.text1, fontFamily: MONO, fontSize: 12, padding: "8px 12px", borderRadius: 6, outline: "none", marginBottom: 8 }}
      />
      <button type="button" onClick={() => toggleReveal(uid)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>{revealed[uid] ? "Hide" : "Reveal"} answer</button>
      {revealed[uid] && <div style={{ marginTop: 8, fontFamily: MONO, color: T.green, fontSize: 12 }}>{answer}</div>}
    </div>
  );
}

function Phase2Content({ data, T, userInput, setUserInput, revealed, toggleReveal, MONO }) {
  const layers = data.layers || [];
  const cloze = data.clozeStatements || [];
  const clozeAnswers = data.clozeAnswers || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 4 }}>LAYERS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {layers.map((layer, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.amber, color: T.text1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>{i + 1}</div>
            <div style={{ flex: 1, background: T.border2, padding: "12px 14px", borderRadius: 10 }}>
              <div style={{ fontFamily: MONO, color: T.amber, fontSize: 11, marginBottom: 4 }}>{layer.level}</div>
              <div style={{ fontFamily: MONO, color: T.text2, fontSize: 12 }}>{layer.description}</div>
            </div>
            {i < layers.length - 1 && <div style={{ color: T.text4, fontSize: 14 }}>↓</div>}
          </div>
        ))}
      </div>
      {data.causalChain && <div style={{ background: T.inputBg, padding: "14px 16px", borderRadius: 10, fontFamily: MONO, color: T.text2, fontSize: 12, lineHeight: 1.6 }}>{data.causalChain}</div>}
      <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 4 }}>CLOZE</div>
      {cloze.map((stmt, i) => (
        <div key={i} style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 12, marginBottom: 8 }}>{stmt}</div>
          <input
            type="text"
            value={userInput[`p2_cloze_${i}`] ?? ""}
            onChange={(e) => setUserInput((p) => ({ ...p, [`p2_cloze_${i}`]: e.target.value }))}
            placeholder="Your fill-in…"
            style={{ width: "100%", boxSizing: "border-box", background: T.cardBg, border: "1px solid " + T.border2, color: T.text1, fontFamily: MONO, fontSize: 12, padding: "8px 12px", borderRadius: 6, outline: "none", marginBottom: 6 }}
          />
          <button type="button" onClick={() => toggleReveal(`p2_cloze_${i}`)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>Reveal</button>
          {revealed[`p2_cloze_${i}`] && <div style={{ marginTop: 6, fontFamily: MONO, color: T.green, fontSize: 12 }}>{clozeAnswers[i]}</div>}
        </div>
      ))}
    </div>
  );
}

function Phase3Content({ data, T, userInput, setUserInput, revealed, toggleReveal, MONO, SERIF }) {
  const qs = data.questions || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: T.text1, background: T.inputBg, padding: "18px 20px", borderRadius: 12, borderLeft: "4px solid " + T.amber }}>{data.cleanStatement}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {["defectType", "kinetics", "gainLoss", "inheritance"].map((k) => data[k] && (
          <span key={k} style={{ background: T.amberBg, border: "1px solid " + T.amber, color: T.amber, fontFamily: MONO, fontSize: 11, padding: "6px 12px", borderRadius: 20 }}>{k.replace(/([A-Z])/g, " $1").trim()}: {data[k]}</span>
        ))}
      </div>
      {qs.map((item, i) => (
        <div key={i} style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontFamily: MONO, color: T.text4, fontSize: 12, marginBottom: 8 }}>{item.q}</div>
          <input
            type="text"
            value={userInput[`p3_q_${i}`] ?? ""}
            onChange={(e) => setUserInput((p) => ({ ...p, [`p3_q_${i}`]: e.target.value }))}
            placeholder="Your answer…"
            style={{ width: "100%", boxSizing: "border-box", background: T.cardBg, border: "1px solid " + T.border2, color: T.text1, fontFamily: MONO, fontSize: 12, padding: "8px 12px", borderRadius: 6, outline: "none", marginBottom: 8 }}
          />
          <button type="button" onClick={() => toggleReveal(`p3_q_${i}`)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>Reveal</button>
          {revealed[`p3_q_${i}`] && <div style={{ marginTop: 8, fontFamily: MONO, color: "#10b981", fontSize: 12 }}>{item.a}</div>}
        </div>
      ))}
    </div>
  );
}

function Phase4Content({ data, T, revealed, toggleReveal, MONO }) {
  const rows = data.interventions || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "2px solid " + T.border2, color: T.text4 }}>Problem</th>
              <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "2px solid " + T.border2, color: T.text4 }}>Physiologic Fix</th>
              <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "2px solid " + T.border2, color: T.text4 }}>Drug</th>
              <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "2px solid " + T.border2, color: T.text4 }}>Mechanism</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid " + T.border1 }}>
                <td style={{ padding: "12px", color: T.text2 }}>{r.problem}</td>
                <td style={{ padding: "12px", color: T.text2 }}>{r.physiologicFix}</td>
                <td style={{ padding: "12px", color: T.green }}>{r.drugExample}</td>
                <td style={{ padding: "12px" }}>
                  <button type="button" onClick={() => toggleReveal(`p4_mech_${i}`)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>{revealed[`p4_mech_${i}`] ? "Hide" : "Show"} mechanism</button>
                  {revealed[`p4_mech_${i}`] && <div style={{ marginTop: 6, color: T.text2, fontSize: 12 }}>{r.mechanism}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.bypassDrug && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}><strong>Bypass:</strong> {data.bypassDrug}</div>}
      {data.inhibitorDrug && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}><strong>Inhibitor:</strong> {data.inhibitorDrug}</div>}
    </div>
  );
}

function Phase5Content({ data, T, MONO, SERIF }) {
  const buzz = data.buzzwords || [];
  const tricks = data.trickAnswers || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {buzz.map((w, i) => (
          <span key={i} style={{ background: T.redBg, border: "1px solid " + T.red, color: T.red, fontFamily: MONO, fontSize: 12, padding: "6px 12px", borderRadius: 20 }}>{w}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", background: T.amberBg, border: "1px solid " + T.amber, borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: MONO, color: T.amber, fontSize: 10, marginBottom: 6 }}>MOST COMMON COMPLICATION</div>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 12 }}>{data.mostCommonComplication}</div>
        </div>
        <div style={{ flex: "1 1 200px", background: T.redBg, border: "1px solid " + T.red, borderRadius: 12, padding: "14px 16px", boxShadow: "0 0 12px " + T.red + "22" }}>
          <div style={{ fontFamily: MONO, color: T.red, fontSize: 10, marginBottom: 6 }}>MOST DEADLY COMPLICATION</div>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 12 }}>{data.mostDeadlyComplication}</div>
        </div>
      </div>
      {data.labSignature && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}><strong>Lab signature:</strong> {data.labSignature}</div>}
      {data.histologyClue && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}><strong>Histology:</strong> {data.histologyClue}</div>}
      {Array.isArray(tricks) && tricks.length > 0 && (
        <div style={{ background: T.border2, padding: "12px 16px", borderRadius: 10 }}>
          <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 8 }}>Trick answers to avoid</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: T.text2, fontSize: 12 }}>{tricks.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      {data.secondBestAnswer && <div style={{ fontFamily: MONO, color: T.text4, fontSize: 12 }}><strong>Second-best trap:</strong> {data.secondBestAnswer}</div>}
      {data.firstAidPage && <div style={{ fontFamily: MONO, color: T.blue, fontSize: 12 }}>📖 First Aid: {data.firstAidPage}</div>}
    </div>
  );
}

function Phase6Content({ data, T, MONO, SERIF, revealed, toggleReveal, flippedCards, toggleCard, phase6Mastered, onMastered, accent }) {
  const anki = data.ankiPrompts || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 8 }}>EXPLAIN IT OUT LOUD</div>
        <div style={{ background: T.border2, padding: "16px 18px", borderRadius: 10, fontFamily: MONO, color: T.text2, fontSize: 12, lineHeight: 1.7 }}>{data.oralExplanation}</div>
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 8 }}>ANKI-STYLE CARDS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {anki.map((card, i) => (
            <div
              key={i}
              onClick={() => toggleCard(i)}
              style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "14px 16px", cursor: "pointer", minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 12, color: T.text1, textAlign: "center" }}
            >
              {flippedCards[i] ? card.back : card.front}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 8 }}>MINI VIGNETTE</div>
        <div style={{ background: T.inputBg, padding: "14px 16px", borderRadius: 10, fontFamily: MONO, color: T.text2, fontSize: 12, marginBottom: 8 }}>{data.miniVignette}</div>
        <button type="button" onClick={() => toggleReveal("p6_mini")} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>Show Answer</button>
        {revealed.p6_mini && <div style={{ marginTop: 8, fontFamily: MONO, color: T.green, fontSize: 12 }}>{data.miniVignetteAnswer}</div>}
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, marginBottom: 8 }}>SIDE EFFECT PREDICTION</div>
        <div style={{ fontFamily: MONO, color: T.text2, fontSize: 12, marginBottom: 8 }}>{data.sideEffectPrediction}</div>
        <button type="button" onClick={() => toggleReveal("p6_side")} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>Show Answer</button>
        {revealed.p6_side && <div style={{ marginTop: 8, fontFamily: MONO, color: T.green, fontSize: 12 }}>{data.sideEffectAnswer}</div>}
      </div>
      <div style={{ background: accent + "18", border: "1px solid " + accent, borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: T.text1, marginBottom: 12 }}>{data.masteryStatement}</div>
        {!phase6Mastered ? (
          <button type="button" onClick={onMastered} style={{ background: accent, border: "none", color: T.text1, padding: "12px 24px", borderRadius: 10, cursor: "pointer", fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>✓ I Own This</button>
        ) : (
          <span style={{ color: T.green, fontFamily: MONO, fontSize: 14 }}>✓ Marked as mastered</span>
        )}
      </div>
    </div>
  );
}
