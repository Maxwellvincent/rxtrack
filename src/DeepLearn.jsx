import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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

// ── Deep Learn Config (auto topics + weak areas) ─────────────────────────────
function DeepLearnConfig({ blockId, lecs, blockObjectives, onStart, T, tc }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const topicPool = useMemo(() => {
    const topics = [];

    lecs.filter((l) => l.blockId === blockId).forEach((lec) => {
      topics.push({
        id: lec.id + "_full",
        label: lec.lectureTitle || lec.fileName,
        sublabel: (lec.lectureType || "Lec") + (lec.lectureNumber || ""),
        source: "lecture",
        lecId: lec.id,
        weak: false,
      });
      (lec.subtopics || []).forEach((sub, i) => {
        topics.push({
          id: lec.id + "_sub_" + i,
          label: sub,
          sublabel: (lec.lectureType || "Lec") + (lec.lectureNumber || ""),
          source: "subtopic",
          lecId: lec.id,
          weak: false,
        });
      });
    });

    const weakObjs = (blockObjectives || []).filter(
      (o) => o.status === "struggling" || o.status === "untested"
    );
    const weakByLec = {};
    weakObjs.forEach((o) => {
      const key = o.activity || "Unknown";
      if (!weakByLec[key]) weakByLec[key] = { label: key, objs: [], lectureTitle: o.lectureTitle };
      weakByLec[key].objs.push(o);
    });
    Object.entries(weakByLec).forEach(([key, group]) => {
      topics.push({
        id: "weak_" + key,
        label: group.lectureTitle || key,
        sublabel: "⚠ " + group.objs.length + " weak objectives",
        source: "weak",
        lecId: null,
        weak: true,
        objectives: group.objs,
      });
    });

    return topics;
  }, [lecs, blockObjectives, blockId]);

  const weakTopics = topicPool.filter((t) => t.weak);
  const allTopics = topicPool.filter((t) => !t.weak);

  const [selected, setSelected] = useState(() =>
    weakTopics.length > 0 ? [weakTopics[0].id] : allTopics.slice(0, 1).map((t) => t.id)
  );
  const [sessionType, setSessionType] = useState("deep");

  const toggleTopic = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedTopics = topicPool.filter((t) => selected.includes(t.id));

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { val: "weak", label: "⚠ Weak Areas First", desc: "Focus on what you're struggling with" },
          { val: "deep", label: "🚀 Deep Learn", desc: "Mastery-based active recall" },
          { val: "mixed", label: "⊞ Mixed Review", desc: "Blend of all topics" },
        ].map((opt) => (
          <div
            key={opt.val}
            onClick={() => setSessionType(opt.val)}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 9,
              cursor: "pointer",
              border: "1px solid " + (sessionType === opt.val ? tc : T.border1),
              background: sessionType === opt.val ? tc + "15" : T.inputBg,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 700,
                color: sessionType === opt.val ? tc : T.text1,
              }}
            >
              {opt.label}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>{opt.desc}</div>
          </div>
        ))}
      </div>

      {weakTopics.length > 0 && (
        <div>
          <div style={{ fontFamily: MONO, color: T.red, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>
            ⚠ WEAK AREAS — PRIORITIZE THESE
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {weakTopics.map((t) => (
              <div
                key={t.id}
                onClick={() => toggleTopic(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: "1px solid " + (selected.includes(t.id) ? T.red : T.border1),
                  background: selected.includes(t.id) ? T.redBg : T.inputBg,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    flexShrink: 0,
                    border: "2px solid " + (selected.includes(t.id) ? T.red : T.border1),
                    background: selected.includes(t.id) ? T.red : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected.includes(t.id) && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO, color: T.text1, fontSize: 13 }}>{t.label}</div>
                  <div style={{ fontFamily: MONO, color: T.red, fontSize: 11 }}>{t.sublabel}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>
          ALL TOPICS
        </div>
        <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
          {allTopics.map((t) => (
            <div
              key={t.id}
              onClick={() => toggleTopic(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 12px",
                borderRadius: 7,
                cursor: "pointer",
                border: "1px solid " + (selected.includes(t.id) ? tc : T.border1),
                background: selected.includes(t.id) ? tc + "12" : T.inputBg,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  flexShrink: 0,
                  border: "2px solid " + (selected.includes(t.id) ? tc : T.border1),
                  background: selected.includes(t.id) ? tc : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selected.includes(t.id) && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: MONO, color: T.text1, fontSize: 13 }}>{t.label}</div>
                <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>{t.sublabel}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        disabled={selected.length === 0}
        onClick={() => onStart({ sessionType, selectedTopics, blockId })}
        style={{
          background: selected.length === 0 ? T.border1 : tc,
          border: "none",
          color: "#fff",
          padding: "13px 0",
          borderRadius: 10,
          cursor: "pointer",
          fontFamily: SERIF,
          fontSize: 17,
          fontWeight: 900,
        }}
      >
        Start Deep Learn →
      </button>
    </div>
  );
}

// ── Deep Learn Session (mastery loop: can't advance until correct or 3 attempts) ──
function DeepLearnSession({
  topic,
  objectives,
  blockId,
  questionBanksByFile,
  onComplete,
  onBackToConfig,
  onUpdateObjective,
  T,
  tc,
}) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const [phase, setPhase] = useState("loading");
  const [question, setQuestion] = useState(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [selectedOpt, setSelectedOpt] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [streak, setStreak] = useState(0);
  const [totalDone, setTotalDone] = useState(0);
  const [queueIdx, setQueueIdx] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [patientCase, setPatientCase] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    generateQuestions();
  }, []);

  const generateQuestions = async () => {
    setPhase("loading");
    setGenerating(true);
    setPatientCase(null);
    try {
      const objList = (objectives || [])
        .slice(0, 15)
        .map((o, i) => `${i + 1}. ${o.objective}`)
        .join("\n");

      const safetySettings = [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      ];
      const headers = { "Content-Type": "application/json" };
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

      const casePrompt =
        "Create a detailed patient case for a medical school deep learning session on: " +
        (topic || "clinical medicine") +
        "\n\n" +
        "The case should:\n" +
        "- Present a realistic patient with age, gender, occupation, chief complaint\n" +
        "- Include relevant history, vitals, physical exam findings, and initial labs\n" +
        "- Contain clues that connect to multiple learning objectives\n" +
        "- NOT reveal the diagnosis — let the student figure it out\n\n" +
        "Objectives this case covers:\n" +
        objList +
        "\n\n" +
        'Return ONLY JSON:\n{"case":"A 54-year-old male construction worker presents to the ED with...","diagnosis":"hidden"}';

      const caseRes = await fetch(geminiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: casePrompt }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.7 },
          safetySettings,
        }),
      });
      const caseD = await caseRes.json();
      const caseRaw = (caseD.candidates?.[0]?.content?.parts?.[0]?.text || "")
        .replace(/^```json\s*/i, "")
        .replace(/```$/g, "")
        .trim();
      let caseParsed = null;
      try {
        const first = caseRaw.indexOf("{");
        const last = caseRaw.lastIndexOf("}");
        if (first !== -1 && last !== -1) caseParsed = JSON.parse(caseRaw.slice(first, last + 1));
      } catch (_) {}
      const anchorCase = caseParsed?.case || null;
      setPatientCase(anchorCase);

      const styleExamples = Object.values(questionBanksByFile || {})
        .flat()
        .slice(0, 3)
        .map(
          (q) =>
            `Q: ${q.stem}\nA: ${q.choices?.A} B: ${q.choices?.B} C: ${q.choices?.C} D: ${q.choices?.D}\nCorrect: ${q.correct}`
        )
        .join("\n\n");

      const prompt =
        "Generate 8 deep learning questions for active recall mastery.\n" +
        (anchorCase
          ? "All questions must refer back to THIS specific patient case:\n" + anchorCase + "\n\n"
          : "") +
        "Mix question types:\n" +
        "- 3 multiple choice (clinical vignettes)\n" +
        "- 3 short answer (require 1-3 sentence explanation)\n" +
        "- 2 fill-in-the-blank (key term or mechanism)\n\n" +
        "OBJECTIVES:\n" +
        objList +
        "\n\n" +
        (styleExamples ? "EXAM STYLE REFERENCE:\n" + styleExamples + "\n\n" : "") +
        "For each question include what a CORRECT answer must contain.\n\n" +
        "Return ONLY JSON:\n" +
        '{"questions":[{\n' +
        '  "type":"mcq",\n' +
        '  "stem":"A 45-year-old...",\n' +
        '  "choices":{"A":"...","B":"...","C":"...","D":"..."},\n' +
        '  "correct":"B",\n' +
        '  "explanation":"The correct answer is B because...",\n' +
        '  "mustInclude":["key concept","mechanism"],\n' +
        '  "hint":"Think about the mechanism of..."\n' +
        "},{\n" +
        '  "type":"short",\n' +
        '  "stem":"Explain why...",\n' +
        '  "correct":"Model answer here",\n' +
        '  "explanation":"A complete answer should mention...",\n' +
        '  "mustInclude":["term1","term2"],\n' +
        '  "hint":"Consider the role of..."\n' +
        "}]}";

      const res = await fetch(geminiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, temperature: 0.8 },
          safetySettings,
        }),
      });
      const d = await res.json();
      const raw = (d.candidates?.[0]?.content?.parts?.[0]?.text || "")
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      const parsed = JSON.parse(raw.slice(first, last + 1));
      const qs = (parsed.questions || []).map((q) => ({
        ...q,
        difficulty: q.difficulty || "medium",
      }));
      setQuestions(qs);
      setQueueIdx(0);
      setQuestion(qs[0] || null);
      setPhase("question");
    } catch (e) {
      console.error("DeepLearn generate failed:", e);
    }
    setGenerating(false);
  };

  const submitAnswer = async () => {
    const answer = question.type === "mcq" ? selectedOpt : userAnswer.trim();
    if (!answer) return;

    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    setPhase("evaluating");

    if (question.type === "mcq") {
      const correct = answer === question.correct;
      setFeedback({
        correct,
        message: correct ? "Correct! ✓" : `Not quite — you chose ${answer}.`,
        explanation: question.explanation,
        hint: !correct && newAttempts < 3 ? question.hint : null,
        showAnswer: newAttempts >= 3,
        correctAnswer: question.correct,
        correctText: question.choices?.[question.correct],
      });
      setPhase("feedback");
      return;
    }

    try {
      const evalPrompt =
        "Evaluate this student answer for a medical school question.\n\n" +
        "QUESTION: " +
        question.stem +
        "\n" +
        "MODEL ANSWER: " +
        question.correct +
        "\n" +
        "MUST INCLUDE: " +
        (question.mustInclude || []).join(", ") +
        "\n" +
        "STUDENT ANSWER: " +
        answer +
        "\n\n" +
        "Determine if the answer is correct, partially correct, or incorrect.\n" +
        "Be strict — medical accuracy matters.\n\n" +
        "Return ONLY JSON:\n" +
        '{"correct":true,"partial":false,"score":0-100,\n' +
        '"feedback":"Your answer correctly identified X but missed Y...",\n' +
        '"correction":"The complete answer should include...",\n' +
        '"missingConcepts":["concept1","concept2"]}';

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: evalPrompt }] }],
            generationConfig: { maxOutputTokens: 600, temperature: 0.1 },
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
      const raw = (d.candidates?.[0]?.content?.parts?.[0]?.text || "")
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      const eval_ = JSON.parse(raw.slice(first, last + 1));

      setFeedback({
        correct: eval_.correct || eval_.score >= 80,
        partial: eval_.partial || (eval_.score >= 50 && eval_.score < 80),
        score: eval_.score,
        message: eval_.feedback,
        correction: eval_.correction,
        missing: eval_.missingConcepts || [],
        hint: !eval_.correct && newAttempts < 3 ? question.hint : null,
        showAnswer: newAttempts >= 3,
        correctAnswer: question.correct,
        explanation: question.explanation,
      });
    } catch (e) {
      setFeedback({
        correct: false,
        message: "Could not evaluate — check your answer against: " + question.correct,
        showAnswer: true,
        correctAnswer: question.correct,
      });
    }
    setPhase("feedback");
  };

  const advance = () => {
    if (!feedback?.correct && attempts < 3) {
      setSelectedOpt(null);
      setUserAnswer("");
      setFeedback(null);
      setPhase("question");
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    const wasCorrect = feedback?.correct;
    setStreak((prev) => (wasCorrect ? prev + 1 : 0));
    setTotalDone((prev) => prev + 1);

    const next = queueIdx + 1;
    if (next >= questions.length) {
      setPhase("mastered");
      return;
    }

    setQueueIdx(next);
    setQuestion(questions[next]);
    setAttempts(0);
    setSelectedOpt(null);
    setUserAnswer("");
    setFeedback(null);
    setPhase("question");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const progressPct = questions.length > 0 ? Math.round((queueIdx / questions.length) * 100) : 0;

  if (phase === "loading")
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            margin: "0 auto 16px",
            border: "3px solid " + T.border1,
            borderTopColor: tc,
            animation: "spin 0.8s linear infinite",
          }}
        />
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}>Generating deep learn session...</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );

  if (phase === "mastered")
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
        <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 24, fontWeight: 900, marginBottom: 8 }}>
          Session Complete!
        </div>
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14, marginBottom: 24 }}>
          {totalDone} questions · {streak} streak
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={onBackToConfig || generateQuestions}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "12px 24px",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            New Session →
          </button>
          <button
            onClick={onComplete}
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              color: T.text2,
              padding: "12px 24px",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 14,
            }}
          >
            Done
          </button>
        </div>
      </div>
    );

  if (!question) return null;

  const isCorrect = feedback?.correct;
  const canAdvance = feedback && (isCorrect || attempts >= 3);

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {patientCase && (
        <div
          style={{
            background: T.inputBg,
            border: "1px solid " + tc + "40",
            borderLeft: "4px solid " + tc,
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontFamily: MONO, color: tc, fontSize: 9, letterSpacing: 1.5, marginBottom: 6 }}>
            PATIENT CASE
          </div>
          <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 14, lineHeight: 1.7 }}>{patientCase}</div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 4, background: T.border1, borderRadius: 2 }}>
          <div
            style={{
              height: "100%",
              background: tc,
              borderRadius: 2,
              width: progressPct + "%",
              transition: "width 0.4s",
            }}
          />
        </div>
        <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
          {queueIdx + 1}/{questions.length}
        </span>
        {streak >= 2 && (
          <span style={{ fontFamily: MONO, color: "#f59e0b", fontSize: 12 }}>
            🔥{streak}
          </span>
        )}
      </div>

      <div style={{ fontFamily: MONO, color: tc, fontSize: 11, letterSpacing: 1.5 }}>
        {question.type === "mcq" ? "MULTIPLE CHOICE" : question.type === "short" ? "SHORT ANSWER" : "FILL IN THE BLANK"}
        {attempts > 0 && !feedback?.correct && (
          <span style={{ color: T.red, marginLeft: 12 }}>ATTEMPT {attempts}/3</span>
        )}
      </div>

      <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 18, lineHeight: 1.6, fontWeight: 600 }}>
        {question.stem}
      </div>

      {question.type === "mcq" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(question.choices || {}).map(([key, val]) => {
            let bg = T.inputBg;
            let border = T.border1;
            let color = T.text1;

            if (feedback) {
              if (key === question.correct) {
                bg = T.greenBg;
                border = T.green;
                color = T.green;
              } else if (key === selectedOpt && !isCorrect) {
                bg = T.redBg;
                border = T.red;
                color = T.red;
              }
            } else if (key === selectedOpt) {
              bg = tc + "18";
              border = tc;
              color = tc;
            }

            return (
              <div
                key={key}
                onClick={() => !feedback && setSelectedOpt(key)}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "11px 14px",
                  borderRadius: 9,
                  border: "1px solid " + border,
                  background: bg,
                  cursor: feedback ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontFamily: MONO, fontWeight: 700, color, fontSize: 15, flexShrink: 0 }}>
                  {key}.
                </span>
                <span style={{ fontFamily: MONO, color, fontSize: 14, lineHeight: 1.5 }}>{val}</span>
              </div>
            );
          })}
        </div>
      )}

      {question.type !== "mcq" && (
        <textarea
          ref={inputRef}
          value={userAnswer}
          onChange={(e) => setUserAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) submitAnswer();
          }}
          disabled={!!feedback}
          placeholder={
            question.type === "fill"
              ? "Type the answer..."
              : "Type your explanation... (⌘+Enter to submit)"
          }
          style={{
            background: T.inputBg,
            border: "1px solid " + T.border1,
            borderRadius: 9,
            padding: "12px 14px",
            color: T.text1,
            fontFamily: MONO,
            fontSize: 14,
            lineHeight: 1.6,
            resize: "vertical",
            minHeight: question.type === "fill" ? 44 : 100,
            width: "100%",
            boxSizing: "border-box",
            opacity: feedback ? 0.7 : 1,
          }}
        />
      )}

      {feedback && (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            border:
              "1px solid " + (isCorrect ? T.green : feedback.partial ? T.amber : T.red),
            background: isCorrect ? T.greenBg : feedback.partial ? T.amberBg : T.redBg,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontWeight: 700,
              fontSize: 15,
              color: isCorrect ? T.green : feedback.partial ? T.amber : T.red,
              marginBottom: 6,
            }}
          >
            {isCorrect ? "✓ Correct!" : feedback.partial ? "◐ Partially correct" : "✗ Not quite"}
            {feedback.score != null && !isCorrect && (
              <span style={{ fontSize: 12, marginLeft: 8 }}>{feedback.score}%</span>
            )}
          </div>

          <div style={{ fontFamily: MONO, color: T.text1, fontSize: 13, lineHeight: 1.6, marginBottom: feedback.missing?.length ? 8 : 0 }}>
            {feedback.message || feedback.explanation}
          </div>

          {feedback.missing?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ fontFamily: MONO, color: T.amber, fontSize: 11, letterSpacing: 1 }}>
                MISSING:{" "}
              </span>
              <span style={{ fontFamily: MONO, color: T.amber, fontSize: 12 }}>
                {feedback.missing.join(" · ")}
              </span>
            </div>
          )}

          {feedback.correction && !isCorrect && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                background: T.cardBg,
                borderRadius: 6,
                fontFamily: MONO,
                color: T.text1,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <span style={{ color: tc, fontWeight: 700 }}>Complete answer: </span>
              {feedback.correction}
            </div>
          )}

          {feedback.hint && !canAdvance && (
            <div style={{ marginTop: 8, fontFamily: MONO, color: T.amber, fontSize: 12, fontStyle: "italic" }}>
              💡 {feedback.hint}
            </div>
          )}

          {feedback.showAnswer && !isCorrect && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                background: T.greenBg,
                borderRadius: 6,
                border: "1px solid " + T.green,
              }}
            >
              <span style={{ fontFamily: MONO, color: T.green, fontWeight: 700, fontSize: 12 }}>
                CORRECT ANSWER:{" "}
              </span>
              <span style={{ fontFamily: MONO, color: T.text1, fontSize: 13 }}>
                {question.type === "mcq"
                  ? `${feedback.correctAnswer}. ${question.choices?.[feedback.correctAnswer]}`
                  : feedback.correctAnswer}
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {!feedback ? (
          <button
            onClick={submitAnswer}
            disabled={phase === "evaluating" || (!selectedOpt && !userAnswer.trim())}
            style={{
              flex: 1,
              background: tc,
              border: "none",
              color: "#fff",
              padding: "12px 0",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 17,
              fontWeight: 900,
              opacity: !selectedOpt && !userAnswer.trim() ? 0.4 : 1,
            }}
          >
            {phase === "evaluating" ? "Evaluating..." : "Submit →"}
          </button>
        ) : canAdvance ? (
          <button
            onClick={advance}
            style={{
              flex: 1,
              background: tc,
              border: "none",
              color: "#fff",
              padding: "12px 0",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 17,
              fontWeight: 900,
            }}
          >
            {queueIdx + 1 >= questions.length ? "Finish ✓" : "Next Question →"}
          </button>
        ) : (
          <button
            onClick={advance}
            style={{
              flex: 1,
              background: T.redBg,
              border: "1px solid " + T.red,
              color: T.red,
              padding: "12px 0",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            Try Again ({3 - attempts} attempts left)
          </button>
        )}
      </div>
    </div>
  );
}

// Wrapper: show Config then Session (mastery loop)
export default function DeepLearn({
  blockId,
  lecs = [],
  blockObjectives = [],
  questionBanksByFile = {},
  onBack,
  termColor,
}) {
  const { T } = useTheme();
  const tc = termColor || T.purple;
  const [phase, setPhase] = useState("config");
  const [sessionParams, setSessionParams] = useState(null);

  const handleStart = useCallback(({ sessionType, selectedTopics, blockId: bid }) => {
    setSessionParams({ sessionType, selectedTopics, blockId: bid });
    setPhase("session");
  }, []);

  const firstTopic = sessionParams?.selectedTopics?.[0];
  const lectureForTopic = firstTopic?.lecId ? lecs.find((l) => l.id === firstTopic.lecId) : null;
  const objectivesForSession =
    firstTopic?.weak
      ? firstTopic.objectives || []
      : (blockObjectives || []).filter(
          (o) =>
            o.lectureId === firstTopic?.lecId ||
            (lectureForTopic &&
              (o.activity === lectureForTopic.lectureTitle || o.activity === lectureForTopic.fileName))
        );

  return (
    <div style={{ padding: "24px 32px 48px", maxWidth: 720, margin: "0 auto", fontFamily: MONO }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <button
          type="button"
          onClick={() => {
            if (phase === "session") {
              setPhase("config");
              setSessionParams(null);
            } else {
              onBack();
            }
          }}
          style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: MONO, fontSize: 14 }}
        >
          ← Back
        </button>
        <h1 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 900, color: T.text1, margin: 0 }}>🧬 Deep Learn</h1>
      </div>

      {phase === "config" && (
        <DeepLearnConfig
          blockId={blockId}
          lecs={lecs}
          blockObjectives={blockObjectives}
          onStart={handleStart}
          T={T}
          tc={tc}
        />
      )}

      {phase === "session" && firstTopic && (
        <DeepLearnSession
          topic={firstTopic}
          objectives={objectivesForSession}
          blockId={blockId}
          questionBanksByFile={questionBanksByFile}
          onComplete={onBack}
          onBackToConfig={() => { setPhase("config"); setSessionParams(null); }}
          onUpdateObjective={() => {}}
          T={T}
          tc={tc}
        />
      )}
    </div>
  );
}

function Phase1Content({ data, T, userInput, setUserInput, revealed, toggleReveal, SERIF, MONO }) {
  const v = data.vignette || "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ borderLeft: "4px solid " + T.red, background: T.inputBg, padding: "16px 18px", borderRadius: 0, fontFamily: MONO, color: T.text2, fontSize: 15, lineHeight: 1.7 }}>{v}</div>
      <QuestionBox label={data.systemQuestion} answer={data.systemAnswer} uid="p1_system" userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} T={T} MONO={MONO} />
      <QuestionBox label={data.dangerousQuestion} answer={data.dangerousAnswer} uid="p1_dangerous" userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} T={T} MONO={MONO} />
      <QuestionBox label={data.commonQuestion} answer={data.commonAnswer} uid="p1_common" userInput={userInput} setUserInput={setUserInput} revealed={revealed} toggleReveal={toggleReveal} T={T} MONO={MONO} />
      {revealed.p1_system && revealed.p1_dangerous && revealed.p1_common && data.syndromePattern && (
        <div style={{ background: T.border2, padding: "12px 16px", borderRadius: 10, fontFamily: MONO, color: T.text3, fontSize: 14 }}><strong>Pattern:</strong> {data.syndromePattern}</div>
      )}
    </div>
  );
}

function QuestionBox({ label, answer, uid, userInput, setUserInput, revealed, toggleReveal, T, MONO }) {
  return (
    <div style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>{label}</div>
      <input
        type="text"
        value={userInput[uid] ?? ""}
        onChange={(e) => setUserInput((p) => ({ ...p, [uid]: e.target.value }))}
        placeholder="Your answer…"
        style={{ width: "100%", boxSizing: "border-box", background: T.cardBg, border: "1px solid " + T.border2, color: T.text1, fontFamily: MONO, fontSize: 14, padding: "8px 12px", borderRadius: 6, outline: "none", marginBottom: 8 }}
      />
      <button type="button" onClick={() => toggleReveal(uid)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>{revealed[uid] ? "Hide" : "Reveal"} answer</button>
      {revealed[uid] && <div style={{ marginTop: 8, fontFamily: MONO, color: T.green, fontSize: 14 }}>{answer}</div>}
    </div>
  );
}

function Phase2Content({ data, T, userInput, setUserInput, revealed, toggleReveal, MONO }) {
  const layers = data.layers || [];
  const cloze = data.clozeStatements || [];
  const clozeAnswers = data.clozeAnswers || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 4 }}>LAYERS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {layers.map((layer, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.amber, color: T.text1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 14, fontWeight: 700 }}>{i + 1}</div>
            <div style={{ flex: 1, background: T.border2, padding: "12px 14px", borderRadius: 10 }}>
              <div style={{ fontFamily: MONO, color: T.amber, fontSize: 13, marginBottom: 4 }}>{layer.level}</div>
              <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14 }}>{layer.description}</div>
            </div>
            {i < layers.length - 1 && <div style={{ color: T.text4, fontSize: 16 }}>↓</div>}
          </div>
        ))}
      </div>
      {data.causalChain && <div style={{ background: T.inputBg, padding: "14px 16px", borderRadius: 10, fontFamily: MONO, color: T.text2, fontSize: 14, lineHeight: 1.6 }}>{data.causalChain}</div>}
      <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 4 }}>CLOZE</div>
      {cloze.map((stmt, i) => (
        <div key={i} style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14, marginBottom: 8 }}>{stmt}</div>
          <input
            type="text"
            value={userInput[`p2_cloze_${i}`] ?? ""}
            onChange={(e) => setUserInput((p) => ({ ...p, [`p2_cloze_${i}`]: e.target.value }))}
            placeholder="Your fill-in…"
            style={{ width: "100%", boxSizing: "border-box", background: T.cardBg, border: "1px solid " + T.border2, color: T.text1, fontFamily: MONO, fontSize: 14, padding: "8px 12px", borderRadius: 6, outline: "none", marginBottom: 6 }}
          />
          <button type="button" onClick={() => toggleReveal(`p2_cloze_${i}`)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Reveal</button>
          {revealed[`p2_cloze_${i}`] && <div style={{ marginTop: 6, fontFamily: MONO, color: T.green, fontSize: 14 }}>{clozeAnswers[i]}</div>}
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
          <span key={k} style={{ background: T.amberBg, border: "1px solid " + T.amber, color: T.amber, fontFamily: MONO, fontSize: 13, padding: "6px 12px", borderRadius: 20 }}>{k.replace(/([A-Z])/g, " $1").trim()}: {data[k]}</span>
        ))}
      </div>
      {qs.map((item, i) => (
        <div key={i} style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontFamily: MONO, color: T.text4, fontSize: 14, marginBottom: 8 }}>{item.q}</div>
          <input
            type="text"
            value={userInput[`p3_q_${i}`] ?? ""}
            onChange={(e) => setUserInput((p) => ({ ...p, [`p3_q_${i}`]: e.target.value }))}
            placeholder="Your answer…"
            style={{ width: "100%", boxSizing: "border-box", background: T.cardBg, border: "1px solid " + T.border2, color: T.text1, fontFamily: MONO, fontSize: 14, padding: "8px 12px", borderRadius: 6, outline: "none", marginBottom: 8 }}
          />
          <button type="button" onClick={() => toggleReveal(`p3_q_${i}`)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Reveal</button>
          {revealed[`p3_q_${i}`] && <div style={{ marginTop: 8, fontFamily: MONO, color: "#10b981", fontSize: 14 }}>{item.a}</div>}
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
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 14 }}>
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
                  <button type="button" onClick={() => toggleReveal(`p4_mech_${i}`)} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>{revealed[`p4_mech_${i}`] ? "Hide" : "Show"} mechanism</button>
                  {revealed[`p4_mech_${i}`] && <div style={{ marginTop: 6, color: T.text2, fontSize: 14 }}>{r.mechanism}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.bypassDrug && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}><strong>Bypass:</strong> {data.bypassDrug}</div>}
      {data.inhibitorDrug && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}><strong>Inhibitor:</strong> {data.inhibitorDrug}</div>}
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
          <span key={i} style={{ background: T.redBg, border: "1px solid " + T.red, color: T.red, fontFamily: MONO, fontSize: 14, padding: "6px 12px", borderRadius: 20 }}>{w}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", background: T.amberBg, border: "1px solid " + T.amber, borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: MONO, color: T.amber, fontSize: 12, marginBottom: 6 }}>MOST COMMON COMPLICATION</div>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14 }}>{data.mostCommonComplication}</div>
        </div>
        <div style={{ flex: "1 1 200px", background: T.redBg, border: "1px solid " + T.red, borderRadius: 12, padding: "14px 16px", boxShadow: "0 0 12px " + T.red + "22" }}>
          <div style={{ fontFamily: MONO, color: T.red, fontSize: 12, marginBottom: 6 }}>MOST DEADLY COMPLICATION</div>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14 }}>{data.mostDeadlyComplication}</div>
        </div>
      </div>
      {data.labSignature && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}><strong>Lab signature:</strong> {data.labSignature}</div>}
      {data.histologyClue && <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}><strong>Histology:</strong> {data.histologyClue}</div>}
      {Array.isArray(tricks) && tricks.length > 0 && (
        <div style={{ background: T.border2, padding: "12px 16px", borderRadius: 10 }}>
          <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>Trick answers to avoid</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: T.text2, fontSize: 14 }}>{tricks.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      {data.secondBestAnswer && <div style={{ fontFamily: MONO, color: T.text4, fontSize: 14 }}><strong>Second-best trap:</strong> {data.secondBestAnswer}</div>}
      {data.firstAidPage && <div style={{ fontFamily: MONO, color: T.blue, fontSize: 14 }}>📖 First Aid: {data.firstAidPage}</div>}
    </div>
  );
}

function Phase6Content({ data, T, MONO, SERIF, revealed, toggleReveal, flippedCards, toggleCard, phase6Mastered, onMastered, accent }) {
  const anki = data.ankiPrompts || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>EXPLAIN IT OUT LOUD</div>
        <div style={{ background: T.border2, padding: "16px 18px", borderRadius: 10, fontFamily: MONO, color: T.text2, fontSize: 14, lineHeight: 1.7 }}>{data.oralExplanation}</div>
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>ANKI-STYLE CARDS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {anki.map((card, i) => (
            <div
              key={i}
              onClick={() => toggleCard(i)}
              style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "14px 16px", cursor: "pointer", minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 14, color: T.text1, textAlign: "center" }}
            >
              {flippedCards[i] ? card.back : card.front}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>MINI VIGNETTE</div>
        <div style={{ background: T.inputBg, padding: "14px 16px", borderRadius: 10, fontFamily: MONO, color: T.text2, fontSize: 14, marginBottom: 8 }}>{data.miniVignette}</div>
        <button type="button" onClick={() => toggleReveal("p6_mini")} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Show Answer</button>
        {revealed.p6_mini && <div style={{ marginTop: 8, fontFamily: MONO, color: T.green, fontSize: 14 }}>{data.miniVignetteAnswer}</div>}
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>SIDE EFFECT PREDICTION</div>
        <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14, marginBottom: 8 }}>{data.sideEffectPrediction}</div>
        <button type="button" onClick={() => toggleReveal("p6_side")} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Show Answer</button>
        {revealed.p6_side && <div style={{ marginTop: 8, fontFamily: MONO, color: T.green, fontSize: 14 }}>{data.sideEffectAnswer}</div>}
      </div>
      <div style={{ background: accent + "18", border: "1px solid " + accent, borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: T.text1, marginBottom: 12 }}>{data.masteryStatement}</div>
        {!phase6Mastered ? (
          <button type="button" onClick={onMastered} style={{ background: accent, border: "none", color: T.text1, padding: "12px 24px", borderRadius: 10, cursor: "pointer", fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>✓ I Own This</button>
        ) : (
          <span style={{ color: T.green, fontFamily: MONO, fontSize: 16 }}>✓ Marked as mastered</span>
        )}
      </div>
    </div>
  );
}
