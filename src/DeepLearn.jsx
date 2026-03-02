import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useTheme, getScoreColor } from "./theme";
import { LEVEL_NAMES, LEVEL_COLORS, LEVEL_BG } from "./bloomsTaxonomy";

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

// ── AI Context Badge (mirrors App.jsx for Deep Learn config)
function AIContextBadge({ context, T, MONO }) {
  if (!context) return null;
  return (
    <div
      style={{
        background: T.inputBg,
        border: "1px solid " + T.border1,
        borderRadius: 10,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1.5 }}>
        AI CONTEXT — WHAT WILL BE USED TO GENERATE YOUR QUESTIONS
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 5,
            background: context.hasUploadedQs ? T.statusGoodBg : T.statusBadBg,
            color: context.hasUploadedQs ? T.statusGood : T.statusBad,
            border: "1px solid " + (context.hasUploadedQs ? T.statusGoodBorder : T.statusBadBorder),
          }}
        >
          {context.hasUploadedQs ? `✓ ${context.relevantQs.length} uploaded questions as style guide` : "✗ No uploaded questions matched"}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 5,
            background: context.hasLectureContent ? T.statusGoodBg : T.statusBadBg,
            color: context.hasLectureContent ? T.statusGood : T.statusBad,
            border: "1px solid " + (context.hasLectureContent ? T.statusGoodBorder : T.statusBadBorder),
          }}
        >
          {context.hasLectureContent ? `✓ Lecture slides loaded (${Math.round(context.lectureChunks.length / 100) * 100} chars)` : "✗ No lecture slides uploaded"}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 5,
            background: context.hasObjectives ? T.statusGoodBg : T.statusWarnBg,
            color: context.hasObjectives ? T.statusGood : T.statusWarn,
            border: "1px solid " + (context.hasObjectives ? T.statusGoodBorder : T.statusWarnBorder),
          }}
        >
          {context.hasObjectives ? `✓ ${context.objectives.length} objectives targeted` : "⚠ No objectives linked"}
        </span>
      </div>
      {context.styleAnalysis?.sourceFiles?.length > 0 && (
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>Style learned from: {context.styleAnalysis.sourceFiles.join(", ")}</div>
      )}
    </div>
  );
}

// ── Study mode detection (mirrors App.jsx for discipline-based recommendation)
function detectStudyMode(lec, objectives = []) {
  const title = (lec?.lectureTitle || lec?.fileName || "").toLowerCase();
  const discipline = (lec?.subject || lec?.discipline || "").toLowerCase();
  const objText = (objectives || []).map((o) => o.objective).join(" ").toLowerCase();
  const allText = title + " " + discipline + " " + objText;
  if (/\banat|anatomy|muscle|bone|nerve|artery|vein|ligament|joint|vertebr|spinal|plexus|foramen|fossa|groove|insertion|origin|landmark|imaging|radiol|x.ray|mri|ct scan|ultrasound|histol/i.test(allText)) {
    return { mode: "anatomy", label: "Anatomy & Structure", icon: "🦴", recommended: ["flashcards", "imageQuiz", "labelDiagram"], avoid: ["deepLearn"], reason: "Anatomy is best learned through visual recognition, spatial relationships, and active labeling — not text-based reasoning.", color: "#6366f1" };
  }
  if (/\bhisto|histol|microscop|stain|cell type|tissue|epithelial|connective|gland|slide/i.test(allText)) {
    return { mode: "histology", label: "Histology", icon: "🔬", recommended: ["imageQuiz", "flashcards"], avoid: ["deepLearn"], reason: "Histology is purely visual — image-based quizzing and flashcards are far more effective than text study.", color: "#a78bfa" };
  }
  if (/\bphar|drug|pharmac|receptor|agonist|antagonist|inhibit|mechanism|dose|toxicity|side effect|contraindic/i.test(allText)) {
    return { mode: "pharmacology", label: "Pharmacology", icon: "💊", recommended: ["deepLearn", "flashcards", "mcq"], avoid: [], reason: "Pharmacology requires understanding mechanisms and drug class patterns.", color: "#10b981" };
  }
  if (/\bbchm|biochem|metabol|pathway|enzyme|substrate|cofactor|atp|nadh|glycol|krebs|oxidat|synthesis|protein|dna|rna|gene|transcri|translat/i.test(allText)) {
    return { mode: "biochemistry", label: "Biochemistry & Pathways", icon: "⚗️", recommended: ["deepLearn", "algorithmDraw", "mcq"], avoid: [], reason: "Biochemistry pathways need step-by-step algorithm drawing and mechanism explanation.", color: "#f59e0b" };
  }
  if (/\bphys|physiol|homeosta|pressure|volume|flow|cardiac|respirat|renal|filtrat|hormonal|feedback|regulation/i.test(allText)) {
    return { mode: "physiology", label: "Physiology", icon: "❤️", recommended: ["deepLearn", "mcq"], avoid: [], reason: "Physiology needs clinical reasoning and mechanism-based deep learning.", color: "#ef4444" };
  }
  if (/\bpath|disease|disorder|syndrome|lesion|tumor|inflam|necrosis|infarct|diagnosis/i.test(allText)) {
    return { mode: "pathology", label: "Pathology", icon: "🧬", recommended: ["deepLearn", "mcq", "flashcards"], avoid: [], reason: "Pathology combines mechanisms with clinical presentations — Deep Learn is ideal.", color: "#f97316" };
  }
  return { mode: "clinical", label: "Clinical Sciences", icon: "🏥", recommended: ["deepLearn", "mcq"], avoid: [], reason: "Mixed clinical content works well with Deep Learn and MCQ practice.", color: "#60a5fa" };
}

// ── Deep Learn Config (auto topics + weak areas) ─────────────────────────────
function DeepLearnConfig({ blockId, lecs, blockObjectives, questionBanksByFile, buildQuestionContext, detectStudyMode: detectStudyModeProp, onStart, T, tc }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const detectStudyModeFn = detectStudyModeProp || detectStudyMode;

  const topicPool = useMemo(() => {
    const topics = [];
    const blockLecs = lecs || [];

    // Always add each lecture itself as a topic
    blockLecs.forEach((lec) => {
      topics.push({
        id: lec.id + "_full",
        label:
          lec.lectureTitle ||
          lec.fileName ||
          ("Lecture " + (lec.lectureNumber || "")),
        sublabel: (lec.lectureType || "Lec") + (lec.lectureNumber || ""),
        source: "lecture",
        lecId: lec.id,
        weak: false,
      });

      // Add a few subtopics per lecture if present
      (lec.subtopics || [])
        .slice(0, 4)
        .forEach((sub, i) => {
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

    // Weak / untested objective groups
    const weakObjs = (blockObjectives || []).filter(
      (o) => o.status === "struggling" || o.status === "untested"
    );

    const weakByLec = {};
    weakObjs.forEach((o) => {
      const key = o.activity || o.lectureTitle || "Unknown";
      if (!weakByLec[key]) {
        weakByLec[key] = {
          label: o.lectureTitle || key,
          objs: [],
          activity: key,
        };
      }
      weakByLec[key].objs.push(o);
    });

    Object.entries(weakByLec).forEach(([key, group]) => {
      // Skip tiny groups
      if (group.objs.length < 2) return;
      topics.push({
        id: "weak_" + key,
        label: group.label,
        sublabel: "⚠ " + group.objs.length + " weak objectives",
        source: "weak",
        lecId: null,
        weak: true,
        objectives: group.objs,
      });
    });

    return topics;
  }, [lecs, blockObjectives]);

  const weakTopics = topicPool.filter((t) => t.weak);
  const allTopics = topicPool.filter((t) => !t.weak);

  const [selected, setSelected] = useState(() => {
    const firstWeak = topicPool.find((t) => t.weak);
    const firstLec = topicPool.find((t) => t.source === "lecture");
    const first = firstWeak || firstLec || topicPool[0];
    return first ? [first.id] : [];
  });
  const [sessionType, setSessionType] = useState("deep");

  // Debug: make sure config receives data and topics build correctly
  useEffect(() => {
    console.log("DeepLearnConfig:", {
      blockId,
      lecs: lecs?.length,
      blockObjectives: blockObjectives?.length,
      topicPool: topicPool?.length,
      selected,
    });
  }, [blockId, lecs, blockObjectives, topicPool?.length, selected.length]);

  // Ensure something is always selected once topics load
  useEffect(() => {
    if (selected.length === 0 && topicPool.length > 0) {
      const firstWeak = topicPool.find((t) => t.weak);
      const firstLec = topicPool.find((t) => t.source === "lecture");
      const first = firstWeak || firstLec || topicPool[0];
      if (first) setSelected([first.id]);
    }
  }, [topicPool.length]);

  const toggleTopic = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedTopics = topicPool.filter((t) => selected.includes(t.id));

  const aiContext = useMemo(() => {
    if (!buildQuestionContext || !blockId) return null;
    const first = selectedTopics[0] || topicPool[0];
    return buildQuestionContext(blockId, first?.lecId ?? null, questionBanksByFile || {}, "deeplearn");
  }, [buildQuestionContext, blockId, selectedTopics, topicPool, questionBanksByFile]);

  const selectedLec = lecs.find((l) => l.id === selectedTopics[0]?.lecId);
  const studyMode = selectedLec
    ? detectStudyModeFn(selectedLec, (blockObjectives || []).filter((o) => o.linkedLecId === selectedLec.id))
    : null;
  const deepLearnWarning = studyMode?.avoid?.includes("deepLearn");

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {deepLearnWarning && studyMode && (
        <div
          style={{
            background: T.statusWarnBg,
            border: "1px solid " + T.statusWarnBorder,
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>{studyMode.icon}</span>
          <div>
            <div style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Deep Learn may not be the best approach for {studyMode.label}
            </div>
            <div style={{ fontFamily: MONO, color: T.text2, fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>{studyMode.reason}</div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
              Better options for this content:
              <strong style={{ color: T.statusWarn }}>
                {" "}
                {studyMode.recommended
                  .map((r) => ({ flashcards: "Flashcards", imageQuiz: "Image Quiz", labelDiagram: "Label Diagrams" }[r] || r))
                  .join(", ")}
              </strong>
            </div>
          </div>
        </div>
      )}
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

      {(() => {
        const lecTopics = topicPool.filter((t) => t.source === "lecture");
        const weakTopicsList = topicPool.filter((t) => t.source === "weak");

        return (
          <>
            {weakTopicsList.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: MONO, color: T.statusBad, fontSize: 9, letterSpacing: 1.5, marginBottom: 8 }}>
                  ⚠ WEAK AREAS
                </div>
                {weakTopicsList.map((topic) => (
                  <div
                    key={topic.id}
                    onClick={() => toggleTopic(topic.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      border: "1px solid " + (selected.includes(topic.id) ? T.statusBad : T.border1),
                      background: selected.includes(topic.id) ? T.statusBadBg : T.inputBg,
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 3,
                        flexShrink: 0,
                        border: "2px solid " + (selected.includes(topic.id) ? T.statusBad : T.border1),
                        background: selected.includes(topic.id) ? T.statusBad : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {selected.includes(topic.id) && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: MONO, color: T.text1, fontSize: 13 }}>{topic.label}</div>
                      <div style={{ fontFamily: MONO, color: T.statusBad, fontSize: 11 }}>{topic.sublabel}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1.5, marginBottom: 8 }}>
              ALL TOPICS
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
              {lecTopics.map((lecTopic) => {
                const subtopics = topicPool.filter((t) => t.source === "subtopic" && t.lecId === lecTopic.lecId);
                const isLecSel = selected.includes(lecTopic.id);

                return (
                  <div key={lecTopic.id} style={{ marginBottom: 8 }}>
                    <div
                      onClick={() =>
                        setSelected((prev) =>
                          prev.includes(lecTopic.id) ? prev.filter((id) => id !== lecTopic.id) : [...prev, lecTopic.id]
                        )
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "11px 14px",
                        borderRadius: subtopics.length > 0 ? "10px 10px 0 0" : 10,
                        background: isLecSel ? tc + "12" : T.inputBg,
                        borderTop: "1px solid " + (isLecSel ? tc + "60" : T.border1),
                        borderRight: "1px solid " + (isLecSel ? tc + "60" : T.border1),
                        borderBottom: subtopics.length > 0 ? "none" : "1px solid " + (isLecSel ? tc + "60" : T.border1),
                        borderLeft: "1px solid " + (isLecSel ? tc + "60" : T.border1),
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          flexShrink: 0,
                          border: "2px solid " + (isLecSel ? tc : T.border1),
                          background: isLecSel ? tc : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {isLecSel && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: MONO,
                            color: T.text1,
                            fontSize: 13,
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {lecTopic.label}
                        </div>
                        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                          {lecTopic.sublabel}
                          {subtopics.length > 0 && ` · ${subtopics.length} subtopics`}
                        </div>
                      </div>
                    </div>

                    {subtopics.length > 0 && (
                      <div
                        style={{
                          borderTop: "1px solid " + T.border2,
                          borderRight: "1px solid " + (isLecSel ? tc + "60" : T.border1),
                          borderBottom: "1px solid " + (isLecSel ? tc + "60" : T.border1),
                          borderLeft: "1px solid " + (isLecSel ? tc + "60" : T.border1),
                          borderRadius: "0 0 10px 10px",
                          overflow: "hidden",
                        }}
                      >
                        {subtopics.map((sub, si) => {
                          const subSel = selected.includes(sub.id);
                          return (
                            <div
                              key={sub.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected((prev) => {
                                  const next = subSel
                                    ? prev.filter((id) => id !== sub.id)
                                    : [...prev, sub.id];
                                  if (!subSel && !isLecSel && !next.includes(lecTopic.id)) {
                                    return [...next, lecTopic.id];
                                  }
                                  return next;
                                });
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "8px 14px 8px 40px",
                                background: subSel ? tc + "0a" : T.cardBg,
                                borderBottom: si < subtopics.length - 1 ? "1px solid " + T.border2 : "none",
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.background = subSel ? tc + "14" : (T.hoverBg || T.cardBg))}
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.background = subSel ? tc + "0a" : T.cardBg)}
                            >
                              <div
                                style={{
                                  width: 14,
                                  height: 14,
                                  borderRadius: 3,
                                  flexShrink: 0,
                                  border: "2px solid " + (subSel ? tc : T.border1),
                                  background: subSel ? tc : "transparent",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {subSel && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontFamily: MONO,
                                    color: T.text2,
                                    fontSize: 12,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {sub.label}
                                </div>
                              </div>
                              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 9, flexShrink: 0 }}>
                                subtopic
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {aiContext && <AIContextBadge context={aiContext} T={T} MONO={MONO} />}

      {(() => {
        const selectedObjs = selectedTopics.flatMap((t) =>
          t.lecId ? (blockObjectives || []).filter((o) => o.linkedLecId === t.lecId) : (t.objectives || [])
        );
        if (!selectedObjs.length) return null;
        const avgBloom = Math.round(
          selectedObjs.reduce((s, o) => s + (o.bloom_level ?? 2), 0) / selectedObjs.length
        );
        const phaseRec =
          avgBloom <= 2
            ? "Brain dump + Read-Recall will be most valuable for these objectives."
            : avgBloom <= 4
              ? "Patient Case + Algorithm phases are key — these require application and analysis."
              : "Full sandwich recommended — these high-order objectives need evaluation and synthesis practice.";
        return (
          <div
            style={{
              background: LEVEL_BG[avgBloom] || T.inputBg,
              border: "1px solid " + (LEVEL_COLORS[avgBloom] || T.border1) + "40",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                color: LEVEL_COLORS[avgBloom] || T.text3,
                fontSize: 10,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              L{avgBloom} {LEVEL_NAMES[avgBloom] || "Understand"} avg — {selectedObjs.length} objectives
            </div>
            <div style={{ fontFamily: MONO, color: T.text2, fontSize: 11, lineHeight: 1.5 }}>{phaseRec}</div>
          </div>
        );
      })()}

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

// ── Deep Learn Session (legacy mastery loop: can't advance until correct or 3 attempts) ──
function LegacyDeepLearnSession({
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
          <span style={{ color: T.statusBad, marginLeft: 12 }}>ATTEMPT {attempts}/3</span>
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
                bg = T.statusGoodBg;
                border = T.statusGood;
                color = T.statusGood;
              } else if (key === selectedOpt && !isCorrect) {
                bg = T.statusBadBg;
                border = T.statusBad;
                color = T.statusBad;
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
              "1px solid " + (isCorrect ? T.statusGood : feedback.partial ? T.statusWarn : T.statusBad),
            background: isCorrect ? T.statusGoodBg : feedback.partial ? T.statusWarnBg : T.statusBadBg,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontWeight: 700,
              fontSize: 15,
              color: isCorrect ? T.statusGood : feedback.partial ? T.statusWarn : T.statusBad,
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
              <span style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 11, letterSpacing: 1 }}>
                MISSING:{" "}
              </span>
              <span style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 12 }}>
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
            <div style={{ marginTop: 8, fontFamily: MONO, color: T.statusWarn, fontSize: 12, fontStyle: "italic" }}>
              💡 {feedback.hint}
            </div>
          )}

          {feedback.showAnswer && !isCorrect && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                background: T.statusGoodBg,
                borderRadius: 6,
                border: "1px solid " + T.statusGood,
              }}
            >
              <span style={{ fontFamily: MONO, color: T.statusGood, fontWeight: 700, fontSize: 12 }}>
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
              background: T.statusBadBg,
              border: "1px solid " + T.statusBad,
              color: T.statusBad,
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

// ── Deep Learn Session — Testing Sandwich flow ─────────────────────────────
function DeepLearnSession({
  topic,
  lectureTitle,
  objectives,
  blockId,
  lectureContent,
  questionBanksByFile,
  buildQuestionContext,
  onComplete,
  onUpdateObjective,
  T,
  tc,
  makeTopicKey,
  sessionId,
  saveProgress,
  deleteSession,
  resuming,
  initialPhase,
  initialBrainDump,
  initialBrainDumpFeedback,
  initialSaqAnswers,
  initialSaqFeedback,
  initialSaqQuestions,
  initialPatientCase,
  initialStructureContent,
  initialAlgorithm,
  initialAlgorithmText,
  initialAlgorithmFeedback,
  initialRecallPrompts,
  initialCurrentRecall,
  initialRecallAnswer,
  initialRecallFeedback,
  initialMcqQuestions,
  initialMcqAnswers,
  initialMcqResults,
  initialPreSAQScore,
  initialInputMode,
  initialHandwriteDone,
}) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

  // Phase state machine
  // Phases: "brainDump" | "patientCase" | "structureFunction" |
  //         "algorithmDraw" | "readRecall" | "mcq" | "summary"
  const [phase, setPhase] = useState(initialPhase || "brainDump");
  const [loading, setLoading] = useState(false);
  const [patientCase, setPatientCase] = useState(initialPatientCase ?? null);
  const [structureContent, setStructureContent] = useState(initialStructureContent ?? null);
  const [algorithm, setAlgorithm] = useState(initialAlgorithm ?? null);
  const [recallPrompts, setRecallPrompts] = useState(initialRecallPrompts ?? []);
  const [mcqQuestions, setMcqQuestions] = useState(initialMcqQuestions ?? []);
  const [currentRecall, setCurrentRecall] = useState(initialCurrentRecall ?? 0);
  const [currentMCQ, setCurrentMCQ] = useState(0);

  // User inputs per phase
  const [inputMode, setInputMode] = useState(initialInputMode || "type"); // "type" | "handwrite"
  const [handwriteDone, setHandwriteDone] = useState(initialHandwriteDone ?? false);
  const [brainDump, setBrainDump] = useState(initialBrainDump || "");
  const [brainDumpFeedback, setBrainDumpFeedback] = useState(initialBrainDumpFeedback ?? null);
  const [saqAnswers, setSaqAnswers] = useState(initialSaqAnswers ?? {});
  const [saqFeedback, setSaqFeedback] = useState(initialSaqFeedback ?? {});
  const [saqQuestions, setSaqQuestions] = useState(initialSaqQuestions ?? []);
  const [recallAnswer, setRecallAnswer] = useState(initialRecallAnswer || "");
  const [recallFeedback, setRecallFeedback] = useState(initialRecallFeedback ?? null);
  const [algorithmText, setAlgorithmText] = useState(initialAlgorithmText || "");
  const [algorithmFeedback, setAlgorithmFeedback] = useState(initialAlgorithmFeedback ?? null);
  const [mcqSelected, setMcqSelected] = useState(null);
  const [mcqFeedback, setMcqFeedback] = useState(null);
  const [mcqResults, setMcqResults] = useState(initialMcqResults ?? []);
  const [confidenceLevel, setConfidenceLevel] = useState(null);

  // Scores
  const [preSAQScore, setPreSAQScore] = useState(initialPreSAQScore ?? null);
  const [postMCQScore, setPostMCQScore] = useState(null);

  // Persist after every phase change
  useEffect(() => {
    if (!sessionId || !saveProgress || phase === "summary") return;
    saveProgress(sessionId, {
      sessionId,
      blockId,
      lecId: objectives?.[0]?.linkedLecId ?? topic?.lecId,
      lectureTitle,
      topic: typeof topic === "object" ? topic?.label : topic,
      objectives,
      lectureContent,
      phase,
      brainDump,
      brainDumpFeedback,
      saqAnswers,
      saqFeedback,
      saqQuestions,
      patientCase,
      structureContent,
      algorithm,
      algorithmText,
      algorithmFeedback,
      recallPrompts,
      currentRecall,
      recallAnswer,
      recallFeedback,
      mcqQuestions,
      mcqAnswers: {}, // current selection not persisted per question
      mcqResults,
      preSAQScore,
      inputMode,
      handwriteDone,
    });
  }, [phase, sessionId, saveProgress]);

  const safeJSONLocal = (raw) => {
    if (!raw) return {};
    const cleaned = String(raw)
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      if (first !== -1 && last !== -1) {
        try {
          return JSON.parse(cleaned.slice(first, last + 1));
        } catch {
          return {};
        }
      }
      return {};
    }
  };

  const objList = (objectives || [])
    .slice(0, 15)
    .map((o, i) => `${i + 1}. ${o.objective}`)
    .join("\n");

  const gemini = async (prompt, maxTokens = 2000) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
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
    return raw;
  };

  const geminiJSON = async (prompt, maxTokens = 2000) => {
    const raw = await gemini(prompt, maxTokens);
    return safeJSONLocal(raw);
  };

  // PHASE 1: Brain Dump + SAQ Priming
  const initBrainDump = async () => {
    setLoading(true);
    try {
      const parsed = await geminiJSON(
        `Generate 5 short-answer priming questions for a medical student about to study: ${lectureTitle}\n\n` +
          `Objectives:\n${objList}\n\n` +
          `Questions should identify gaps BEFORE studying — not test mastery.\n` +
          `Keep them quick-fire: one sentence each.\n\n` +
          `Return ONLY JSON:\n` +
          `{"questions":["What is the primary function of X?","Where does Y occur?"]}`,
        800
      );
      setSaqQuestions(parsed?.questions || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initBrainDump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitBrainDump = async () => {
    if (!brainDump.trim()) return;
    setLoading(true);
    try {
      const raw = await gemini(
        `A medical student was asked to brain dump everything they know about: ${lectureTitle}\n\n` +
          `Their response:\n"${brainDump}"\n\n` +
          `Learning objectives:\n${objList}\n\n` +
          `Evaluate what they got right, what gaps exist, and what misconceptions to watch for.\n` +
          `Be encouraging but honest.\n\n` +
          `Return ONLY JSON:\n` +
          `{"strengths":["knew X","mentioned Y"],"gaps":["missing A","no mention of B"],"misconceptions":["confused X with Y"],"readinessScore":40,"message":"Good start! You have the basics of X but..."}`,
        1000
      );
      const evalText = String(raw || "")
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/g, "")
        .trim();
      let evalData = null;
      try {
        evalData = JSON.parse(evalText);
      } catch {
        const match = evalText.match(/\{[\s\S]*\}/);
        if (match) try { evalData = JSON.parse(match[0]); } catch {}
      }
      if (evalData) {
        setBrainDumpFeedback({
          strengths: evalData.strengths ?? evalData.Strengths ?? [],
          gaps: evalData.gaps ?? evalData.Gaps ?? [],
          misconceptions: evalData.misconceptions ?? evalData.Misconceptions ?? [],
          readinessScore: evalData.readinessScore ?? evalData.readiness_score ?? evalData.score ?? evalData.Score ?? 0,
          message: evalData.message ?? evalData.Message ?? "",
        });
      } else {
        setBrainDumpFeedback({
          strengths: [],
          gaps: [],
          misconceptions: [],
          readinessScore: 0,
          message: "Could not parse evaluation.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const submitSAQ = async (idx, answer) => {
    if (!answer?.trim()) return;
    const q = saqQuestions[idx];
    const raw = await gemini(
      `Evaluate this student answer for a medical priming question.\n\n` +
        `Topic: ${lectureTitle}\nQuestion: ${q}\nStudent answer: ${answer}\n\n` +
        `Return ONLY JSON:\n` +
        `{"correct":true,"score":70,"feedback":"Good — you identified X but missed Y","keyPoint":"The key concept is..."}`,
      400
    );
    const evalText = String(raw || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/g, "")
      .trim();
    let evalData = null;
    try {
      evalData = JSON.parse(evalText);
    } catch {
      const match = evalText.match(/\{[\s\S]*\}/);
      if (match) try { evalData = JSON.parse(match[0]); } catch {}
    }
    const fb = evalData
      ? {
          correct: evalData.correct ?? evalData.Correct ?? (evalData.score >= 70),
          score: evalData.score ?? evalData.Score ?? evalData.percentage ?? 0,
          feedback: evalData.feedback ?? evalData.Feedback ?? evalData.explanation ?? "",
          keyPoint: evalData.keyPoint ?? evalData.key_point ?? evalData.keypoint ?? "",
        }
      : { correct: false, score: 0, feedback: "", keyPoint: "" };
    setSaqFeedback((prev) => ({ ...prev, [idx]: fb }));

    const allFb = { ...saqFeedback, [idx]: fb };
    const scores = Object.values(allFb).map((f) => f?.score ?? 0);
    if (scores.length === saqQuestions.length) {
      setPreSAQScore(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length));
    }
  };

  const advanceFromBrainDump = async () => {
    setLoading(true);
    try {
      const [caseResult, structResult] = await Promise.all([
        geminiJSON(
          `Create a realistic patient case for studying: ${lectureTitle}\n\n` +
            `Objectives:\n${objList}\n\n` +
            `The case MUST:\n` +
            `- Present age, gender, occupation, chief complaint, history, vitals, exam, labs\n` +
            `- Contain clues linking to the learning objectives above\n` +
            `- NOT reveal the diagnosis — student must figure it out\n` +
            `- Be clinically realistic and detailed (4-6 sentences)\n\n` +
            `Return ONLY JSON:\n` +
            `{"case":"A 54-year-old male presents with...","hiddenDiagnosis":"[kept hidden]","clinicalClues":["clue1","clue2"]}`,
          800
        ),
        geminiJSON(
          `Create a structural and functional breakdown for: ${lectureTitle}\n\n` +
            `Objectives:\n${objList}\n\n` +
            `Follow this hierarchy: Patient Complaint → Organ → Architecture → Cell → Protein → Clinical Application\n\n` +
            `For each level, explain the "Why?" — how does it connect to patient care?\n` +
            `Apply the "Make Me Care" test — only include facts that directly explain patient presentations.\n\n` +
            `Return ONLY JSON:\n` +
            `{"levels":[{"level":"Patient Complaint","content":"Patient presents with X because...","whyItMatters":"This matters clinically because..."},...],"keyMechanism":"The core mechanism connecting all levels is..."}`,
          2000
        ),
      ]);

      setPatientCase(caseResult);
      setStructureContent(structResult);
      setPhase("patientCase");
    } finally {
      setLoading(false);
    }
  };

  // PHASE 2: Patient Case Presentation
  // PHASE 3: Structure/Function Mastery
  const advanceToAlgorithm = async () => {
    setLoading(true);
    try {
      const parsed = await geminiJSON(
        `Create a diagnostic/management algorithm for: ${lectureTitle}\n\n` +
          `The algorithm must:\n` +
          `- Start from a clear entry point (a patient symptom or lab finding)\n` +
          `- Use Yes/No decision branches\n` +
          `- Be completeable from memory\n` +
          `- Cover the 80% high-yield pathway\n\n` +
          `Return ONLY JSON:\n` +
          `{"title":"Algorithm for X","entryPoint":"Patient presents with Y","steps":[{"step":1,"question":"Is Z present?","yes":"Go to step 2","no":"Consider diagnosis A"},...],"keyBranches":["Branch 1: if X then Y","Branch 2: if A then B"],"memoryHook":"Remember: ABCDE"}`,
        1500
      );
      setAlgorithm(parsed);
      setPhase("algorithmDraw");
    } finally {
      setLoading(false);
    }
  };

  const submitAlgorithm = async () => {
    if (!algorithmText.trim()) return;
    setLoading(true);
    try {
      const fb = await geminiJSON(
        `A student was asked to write out the diagnostic algorithm for: ${lectureTitle}\n\n` +
          `The correct algorithm:\n${JSON.stringify(algorithm?.steps)}\n\n` +
          `Student's attempt:\n"${algorithmText}"\n\n` +
          `Evaluate if they captured the key decision branches. Be specific about what they missed.\n\n` +
          `Return ONLY JSON:\n` +
          `{"score":75,"correct":["got entry point","identified branch 1"],"missed":["missed branch 2","forgot endpoint"],"feedback":"Good structure but..."}`,
        800
      );
      setAlgorithmFeedback(fb);
    } finally {
      setLoading(false);
    }
  };

  const advanceToReadRecall = async () => {
    setLoading(true);
    try {
      const parsed = await geminiJSON(
        `Generate 3 read-and-recall questions for: ${lectureTitle}\n\n` +
          `Patient context: ${patientCase?.case || ""}\n` +
          `Objectives:\n${objList}\n\n` +
          `Each question should:\n` +
          `- Require the student to EXPLAIN a mechanism (not recall a fact)\n` +
          `- Reference the patient case where possible\n` +
          `- Be answerable in 2-4 sentences\n` +
          `- Test the "Why?" not the "What?"\n\n` +
          `Return ONLY JSON:\n` +
          `{"prompts":[{"question":"Explain why this patient has X given what you know about Y...","keyPoints":["must mention A","must mention B"],"hint":"Think about the pathway from X to Z"}]}`,
        1200
      );
      setRecallPrompts(parsed?.prompts || []);
      setCurrentRecall(0);
      setRecallAnswer("");
      setRecallFeedback(null);
      setPhase("readRecall");
    } finally {
      setLoading(false);
    }
  };

  const submitRecall = async () => {
    if (!recallAnswer.trim()) return;
    setLoading(true);
    try {
      const prompt = recallPrompts[currentRecall];
      const fb = await geminiJSON(
        `Evaluate this student's explanation for a medical read-recall exercise.\n\n` +
          `Question: ${prompt?.question}\n` +
          `Key points required: ${prompt?.keyPoints?.join(", ")}\n` +
          `Student answer: ${recallAnswer}\n\n` +
          `Be strict — this is meant to build deep understanding.\n` +
          `Identify exactly what concepts they connected correctly and what gaps remain.\n\n` +
          `Return ONLY JSON:\n` +
          `{"score":80,"correct":true,"conceptsLinked":["correctly linked X to Y"],"gaps":["didn't mention Z"],"correction":"The complete explanation should include...","reinforcement":"Remember: the key connection is..."}`,
        800
      );
      setRecallFeedback(fb);
    } finally {
      setLoading(false);
    }
  };

  const nextRecall = () => {
    if (currentRecall < recallPrompts.length - 1) {
      setCurrentRecall((prev) => prev + 1);
      setRecallAnswer("");
      setRecallFeedback(null);
    } else {
      advanceToMCQ();
    }
  };

  const advanceToMCQ = async () => {
    setLoading(true);
    try {
      let styleSection = "";
      if (buildQuestionContext && blockId) {
        const ctx = buildQuestionContext(blockId, topic?.lecId ?? null, questionBanksByFile || {}, "deeplearn");
        if (ctx?.relevantQs?.length > 0 && ctx?.styleAnalysis) {
          const { relevantQs, styleAnalysis } = ctx;
          styleSection =
            `\nYOUR SCHOOL'S EXAM STYLE (${relevantQs.length} questions from ${(styleAnalysis.sourceFiles || []).join(", ")}):\n` +
            `Match this style:\n` +
            relevantQs
              .slice(0, 3)
              .map((q) => `Q: ${q.stem}\nCorrect: ${q.choices?.[q.correct] ?? ""}`)
              .join("\n\n") +
            "\n\n";
        }
      }
      if (!styleSection) {
        const styleExamples = Object.values(questionBanksByFile || {})
          .flat()
          .slice(0, 3)
          .map((q) => `Q: ${q.stem}\nCorrect: ${q.choices?.[q.correct]}`)
          .join("\n\n");
        styleSection = styleExamples ? `Match this exam style:\n${styleExamples}\n\n` : "";
      }

      const parsed = await geminiJSON(
        `Generate 5 high-quality MCQs to close this learning session on: ${lectureTitle}\n\n` +
          `Patient case context: ${patientCase?.case || ""}\n\n` +
          `Learning objectives:\n${objList}\n\n` +
          styleSection +
          `Rules:\n` +
          `- Each question must start from the PATIENT (vignette-first)\n` +
          `- Ask "what is the underlying mechanism" not "what is the drug"\n` +
          `- Make wrong answers clinically plausible\n` +
          `- Reference the patient case where possible\n` +
          `- Every stem MUST end with a question ending in "?"\n` +
          `- Keep explanations under 60 words\n\n` +
          `Return ONLY JSON:\n` +
          `{"questions":[{"stem":"The patient above now develops X. Which mechanism best explains...?","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveId":"","topic":"${lectureTitle}"}]}`,
        4000
      );

      const qs = (parsed?.questions || []).map((q, i) => ({
        ...q,
        id: `dl_${Date.now()}_${i}`,
        num: i + 1,
        difficulty: "medium",
      }));
      setMcqQuestions(qs);
      setCurrentMCQ(0);
      setMcqSelected(null);
      setMcqFeedback(null);
      setPhase("mcq");
    } finally {
      setLoading(false);
    }
  };

  const submitMCQ = () => {
    if (!mcqSelected) return;
    const q = mcqQuestions[currentMCQ];
    const correct = mcqSelected === q.correct;
    const result = {
      correct,
      score: correct ? 100 : 0,
      objectiveId: q.objectiveId,
      topic: q.topic,
    };
    setMcqFeedback({
      correct,
      explanation: q.explanation,
      correctAnswer: q.correct,
      correctText: q.choices?.[q.correct],
    });
    setMcqResults((prev) => [...prev, result]);
  };

  const nextMCQ = () => {
    if (currentMCQ < mcqQuestions.length - 1) {
      setCurrentMCQ((prev) => prev + 1);
      setMcqSelected(null);
      setMcqFeedback(null);
    } else {
      const score =
        mcqResults.length > 0
          ? Math.round(
              (mcqResults.filter((r) => r.correct).length / mcqResults.length) * 100
            )
          : 0;
      setPostMCQScore(score);
      setPhase("summary");
    }
  };

  if (loading && phase === "brainDump")
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            margin: "0 auto 16px",
            border: "3px solid " + T.border1,
            borderTopColor: tc,
            animation: "spin 0.8s linear infinite",
          }}
        />
        <div
          style={{
            fontFamily: SERIF,
            color: T.text1,
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Preparing your learning session...
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );

  // Phase indicator
  const phases = [
    { id: "brainDump", label: "Prime", icon: "🧠" },
    { id: "patientCase", label: "Patient", icon: "🏥" },
    { id: "structureFunction", label: "Structure", icon: "🔬" },
    { id: "algorithmDraw", label: "Algorithm", icon: "📊" },
    { id: "readRecall", label: "Recall", icon: "💭" },
    { id: "mcq", label: "Apply", icon: "✅" },
    { id: "summary", label: "Summary", icon: "📈" },
  ];
  const phaseIdx = phases.findIndex((p) => p.id === phase);

  const PhaseBar = () => (
    <div style={{ display: "flex", gap: 4, marginBottom: 20, overflowX: "auto" }}>
      {phases.map((p, i) => {
        const done = i < phaseIdx;
        const current = i === phaseIdx;
        return (
          <div
            key={p.id}
            style={{
              flex: 1,
              minWidth: 60,
              textAlign: "center",
              padding: "7px 4px",
              borderRadius: 8,
              background: current ? tc + "20" : done ? T.statusGoodBg : T.inputBg,
              border: "1px solid " + (current ? tc : done ? T.statusGood : T.border1),
            }}
          >
            <div style={{ fontSize: 14 }}>{p.icon}</div>
            <div
              style={{
                fontFamily: MONO,
                color: current ? tc : done ? T.statusGood : T.text3,
                fontSize: 9,
                fontWeight: current ? 700 : 400,
              }}
            >
              {p.label}
            </div>
          </div>
        );
      })}
    </div>
  );

  const PatientBanner = () =>
    patientCase ? (
      <div
        style={{
          background: T.inputBg,
          border: "1px solid " + tc + "50",
          borderLeft: "4px solid " + tc,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            color: tc,
            fontSize: 9,
            letterSpacing: 1.5,
            marginBottom: 5,
          }}
        >
          YOUR PATIENT
        </div>
        <div
          style={{
            fontFamily: SERIF,
            color: T.text1,
            fontSize: 14,
            lineHeight: 1.65,
          }}
        >
          {patientCase.case}
        </div>
        {patientCase.clinicalClues?.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {patientCase.clinicalClues.map((clue, i) => (
              <span
                key={i}
                style={{
                  fontFamily: MONO,
                  color: tc,
                  fontSize: 9,
                  background: tc + "15",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                {clue}
              </span>
            ))}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div style={{ padding: "20px 24px", maxWidth: 720, margin: "0 auto" }}>
      <PhaseBar />

      {/* Phase 1: Brain Dump + SAQ */}
      {phase === "brainDump" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              PHASE 1 OF 6 · ACTIVE RECALL PRIMING
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Brain Dump
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Before we begin — write down everything you already know about{" "}
              <strong style={{ color: T.text1 }}>{lectureTitle}</strong>. Don't look anything up. This
              primes your brain for new information.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[
              { val: "type", icon: "⌨️", label: "Type it" },
              { val: "handwrite", icon: "✍️", label: "Handwrite on iPad" },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => setInputMode(opt.val)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 9,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 700,
                  background: inputMode === opt.val ? tc + "18" : T.inputBg,
                  border: "2px solid " + (inputMode === opt.val ? tc : T.border1),
                  color: inputMode === opt.val ? tc : T.text3,
                  transition: "all 0.15s",
                }}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>

          {inputMode === "type" ? (
            <textarea
              value={brainDump}
              onChange={(e) => setBrainDump(e.target.value)}
              placeholder="Write everything you know... anatomy, physiology, clinical relevance, drugs, anything."
              style={{
                background: T.inputBg,
                border: "1px solid " + T.border1,
                borderRadius: 10,
                padding: "14px 16px",
                color: T.text1,
                fontFamily: MONO,
                fontSize: 13,
                lineHeight: 1.6,
                resize: "vertical",
                minHeight: 140,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          ) : (
            <div
              style={{
                background: tc + "0d",
                border: "2px dashed " + tc + "50",
                borderRadius: 12,
                padding: "28px 20px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>✍️</div>
              <div
                style={{
                  fontFamily: SERIF,
                  color: T.text1,
                  fontSize: 16,
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                Write it out on your iPad
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  color: T.text3,
                  fontSize: 12,
                  lineHeight: 1.7,
                  marginBottom: 20,
                }}
              >
                Open your notes app and do your brain dump by hand.
                <br />
                Handwriting strengthens recall better than typing.
                <br />
                Come back here when you're done.
              </div>
              <button
                onClick={() => {
                  setBrainDump("✍️ Handwritten — completed on iPad");
                  setHandwriteDone(true);
                  setBrainDumpFeedback({
                    strengths: ["Completed handwritten brain dump — great for active recall"],
                    gaps: [],
                    misconceptions: [],
                    readinessScore: 50,
                    message: "Handwritten — AI evaluation skipped. Handwriting strengthens recall.",
                  });
                }}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "12px 32px",
                  borderRadius: 9,
                  cursor: "pointer",
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                ✓ Done — I wrote it out
              </button>
            </div>
          )}

          {!brainDumpFeedback ? (
            inputMode === "type" && (
              <button
                onClick={submitBrainDump}
                disabled={!(brainDump.trim().length > 20) || loading}
                style={{
                  background: brainDump.trim().length > 20 ? tc : T.border1,
                  border: "none",
                  color: "#fff",
                  padding: "13px 0",
                  borderRadius: 10,
                  cursor: brainDump.trim().length > 20 ? "pointer" : "not-allowed",
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                {loading ? "Analyzing..." : "Submit Brain Dump →"}
              </button>
            )
          ) : (
            <div
              style={{
                background: T.cardBg,
                border: "1px solid " + T.border1,
                borderRadius: 12,
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  color: tc,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                Readiness: {brainDumpFeedback?.readinessScore ?? "—"}%
              </div>

              {brainDumpFeedback.message && (
                <div
                  style={{
                    fontFamily: MONO,
                    color: T.text1,
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  {brainDumpFeedback.message}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {brainDumpFeedback.strengths?.length > 0 && (
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontFamily: MONO,
                        color: T.statusGood,
                        fontSize: 9,
                        letterSpacing: 1,
                        marginBottom: 4,
                      }}
                    >
                      ✓ YOU KNOW
                    </div>
                    {brainDumpFeedback.strengths.map((s, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: MONO,
                          color: T.text2,
                          fontSize: 11,
                          marginBottom: 2,
                        }}
                      >
                        • {s}
                      </div>
                    ))}
                  </div>
                )}
                {brainDumpFeedback.gaps?.length > 0 && (
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontFamily: MONO,
                        color: T.statusBad,
                        fontSize: 9,
                        letterSpacing: 1,
                        marginBottom: 4,
                      }}
                    >
                      ○ GAPS TO FILL
                    </div>
                    {brainDumpFeedback.gaps.map((g, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: MONO,
                          color: T.text2,
                          fontSize: 11,
                          marginBottom: 2,
                        }}
                      >
                        • {g}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {saqQuestions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  fontFamily: MONO,
                  color: T.text3,
                  fontSize: 9,
                  letterSpacing: 1.5,
                }}
              >
                5 QUICK-FIRE GAP FINDERS
              </div>
              {saqQuestions.map((q, idx) => (
                <div
                  key={idx}
                  style={{
                    background: T.cardBg,
                    border: "1px solid " + T.border1,
                    borderRadius: 10,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontFamily: SERIF,
                      color: T.text1,
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 8,
                    }}
                  >
                    {idx + 1}. {q}
                  </div>
                  <textarea
                    value={saqAnswers[idx] || ""}
                    onChange={(e) =>
                      setSaqAnswers((prev) => ({ ...prev, [idx]: e.target.value }))
                    }
                    placeholder="Quick answer..."
                    rows={2}
                    style={{
                      background: T.inputBg,
                      border: "1px solid " + T.border1,
                      borderRadius: 7,
                      padding: "8px 12px",
                      color: T.text1,
                      fontFamily: MONO,
                      fontSize: 12,
                      width: "100%",
                      boxSizing: "border-box",
                      resize: "none",
                    }}
                  />
                  {!saqFeedback[idx] ? (
                    <button
                      onClick={() => submitSAQ(idx, saqAnswers[idx])}
                      disabled={!saqAnswers[idx]?.trim()}
                      style={{
                        marginTop: 6,
                        background: saqAnswers[idx]?.trim() ? tc + "18" : T.inputBg,
                        border:
                          "1px solid " +
                          (saqAnswers[idx]?.trim() ? tc : T.border1),
                        color: saqAnswers[idx]?.trim() ? tc : T.text3,
                        padding: "5px 14px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: 10,
                      }}
                    >
                      Check →
                    </button>
                  ) : (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "8px 10px",
                        background: saqFeedback[idx]?.correct ? T.statusGoodBg : T.statusWarnBg,
                        border:
                          "1px solid " +
                          (saqFeedback[idx]?.correct ? T.statusGood : T.statusWarn),
                        borderRadius: 6,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          color: saqFeedback[idx]?.correct ? T.statusGood : T.statusWarn,
                          fontWeight: 700,
                          marginBottom: 3,
                        }}
                      >
                        {saqFeedback[idx]?.score ?? "—"}% · {saqFeedback[idx]?.feedback ?? ""}
                      </div>
                      {saqFeedback[idx]?.keyPoint && (
                        <div
                          style={{
                            fontFamily: MONO,
                            color: T.text2,
                            fontSize: 10,
                          }}
                        >
                          💡 {saqFeedback[idx].keyPoint}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {brainDumpFeedback && (
            <button
              onClick={advanceFromBrainDump}
              disabled={loading}
              style={{
                background: tc,
                border: "none",
                color: "#fff",
                padding: "14px 0",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: SERIF,
                fontSize: 16,
                fontWeight: 900,
              }}
            >
              {loading ? "Preparing patient case..." : "Meet Your Patient →"}
            </button>
          )}
        </div>
      )}

      {/* Phase 2: Patient Case */}
      {phase === "patientCase" && patientCase && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              PHASE 2 OF 6 · CLINICAL ANCHOR
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Meet Your Patient
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              This patient will guide your entire session. Every concept you learn
              today connects back to understanding what's happening to them.
            </div>
          </div>

          <div
            style={{
              background: T.cardBg,
              border: "2px solid " + tc + "40",
              borderLeft: "5px solid " + tc,
              borderRadius: 12,
              padding: "20px 24px",
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 10,
                letterSpacing: 1.5,
                marginBottom: 10,
              }}
            >
              🏥 PATIENT PRESENTATION
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 16,
                lineHeight: 1.75,
                fontWeight: 500,
              }}
            >
              {patientCase.case}
            </div>
          </div>

          <div
            style={{
              background: T.statusWarnBg,
              border: "1px solid " + T.statusWarnBorder,
              borderRadius: 10,
              padding: "12px 16px",
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                color: T.statusWarn,
                fontSize: 10,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              🧩 WHAT DO YOU NOTICE?
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text2,
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              Look for the clinical clues embedded in this presentation. As you
              study today, keep asking: "How does this explain what's happening to my
              patient?"
            </div>
          </div>

          <button
            onClick={() => setPhase("structureFunction")}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "14px 0",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 16,
              fontWeight: 900,
            }}
          >
            Start Learning →
          </button>
        </div>
      )}

      {/* Phase 3: Structure/Function */}
      {phase === "structureFunction" && structureContent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div>
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              PHASE 3 OF 6 · THE NO-GAPS MODEL
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Structure → Function → Patient
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
              }}
            >
              Walk the hierarchy. At each level ask: "How does this explain my
              patient's presentation?"
            </div>
          </div>

          {(structureContent.levels || []).map((level, i) => (
            <div
              key={i}
              style={{
                background: T.cardBg,
                border: "1px solid " + T.border1,
                borderRadius: 12,
                padding: "16px 20px",
                borderLeft: "4px solid " + tc,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  color: tc,
                  fontSize: 9,
                  letterSpacing: 1.5,
                  marginBottom: 6,
                }}
              >
                LEVEL {i + 1} · {level.level?.toUpperCase()}
              </div>
              <div
                style={{
                  fontFamily: SERIF,
                  color: T.text1,
                  fontSize: 15,
                  lineHeight: 1.7,
                  marginBottom: 8,
                }}
              >
                {level.content}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  color: T.statusWarn,
                  fontSize: 12,
                  lineHeight: 1.5,
                  borderTop: "1px solid " + T.border2,
                  paddingTop: 8,
                }}
              >
                💡 <strong>Why it matters:</strong> {level.whyItMatters}
              </div>
            </div>
          ))}

          {structureContent.keyMechanism && (
            <div
              style={{
                background: tc + "15",
                border: "1px solid " + tc + "40",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  color: tc,
                  fontSize: 9,
                  letterSpacing: 1.5,
                  marginBottom: 4,
                }}
              >
                CORE MECHANISM
              </div>
              <div
                style={{
                  fontFamily: SERIF,
                  color: T.text1,
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.6,
                }}
              >
                {structureContent.keyMechanism}
              </div>
            </div>
          )}

          <button
            onClick={advanceToAlgorithm}
            disabled={loading}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "14px 0",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 16,
              fontWeight: 900,
            }}
          >
            {loading ? "Building algorithm..." : "Build the Algorithm →"}
          </button>
        </div>
      )}

      {/* Phase 4: Algorithm Draw */}
      {phase === "algorithmDraw" && algorithm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div>
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              PHASE 4 OF 6 · ALGORITHM SYNTHESIS
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Draw the Algorithm
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Without looking anything up, write out the decision algorithm for{" "}
              <strong style={{ color: T.text1 }}>{algorithm.title}</strong>. If you can't draw it from
              memory, you don't know it yet.
            </div>
          </div>

          <details
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 10,
              padding: "12px 16px",
            }}
          >
            <summary
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 12,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              📋 See algorithm structure (use only if stuck)
            </summary>
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontFamily: MONO,
                  color: tc,
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                Entry: {algorithm.entryPoint}
              </div>
              {(algorithm.steps || []).map((step, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: MONO,
                    color: T.text2,
                    fontSize: 11,
                    marginBottom: 4,
                    paddingLeft: 12,
                  }}
                >
                  {step.step}. {step.question}
                  <span style={{ color: T.statusGood }}> YES → {step.yes}</span>
                  <span style={{ color: T.statusBad }}> | NO → {step.no}</span>
                </div>
              ))}
              {algorithm.memoryHook && (
                <div
                  style={{
                    fontFamily: MONO,
                    color: T.statusWarn,
                    fontSize: 11,
                    marginTop: 8,
                  }}
                >
                  🧠 Memory hook: {algorithm.memoryHook}
                </div>
              )}
            </div>
          </details>

          <textarea
            value={algorithmText}
            onChange={(e) => setAlgorithmText(e.target.value)}
            placeholder="Write your algorithm here... Start point → Decision 1 → Yes/No branches → Endpoints"
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 10,
              padding: "14px 16px",
              color: T.text1,
              fontFamily: MONO,
              fontSize: 13,
              lineHeight: 1.6,
              resize: "vertical",
              minHeight: 160,
              width: "100%",
              boxSizing: "border-box",
            }}
          />

          {!algorithmFeedback ? (
            <button
              onClick={submitAlgorithm}
              disabled={!algorithmText.trim() || loading}
              style={{
                background: algorithmText.trim() ? tc : T.border1,
                border: "none",
                color: "#fff",
                padding: "13px 0",
                borderRadius: 10,
                cursor: algorithmText.trim() ? "pointer" : "not-allowed",
                fontFamily: SERIF,
                fontSize: 15,
                fontWeight: 900,
              }}
            >
              {loading ? "Evaluating..." : "Check My Algorithm →"}
            </button>
          ) : (
            <>
              <div
                style={{
                  background: T.cardBg,
                  border: "1px solid " + T.border1,
                  borderRadius: 12,
                  padding: "16px 20px",
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    color: tc,
                    fontSize: 13,
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  Score: {algorithmFeedback.score}%
                </div>
                {algorithmFeedback.correct?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {algorithmFeedback.correct.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: MONO,
                          color: T.statusGood,
                          fontSize: 12,
                        }}
                      >
                        ✓ {c}
                      </div>
                    ))}
                  </div>
                )}
                {algorithmFeedback.missed?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {algorithmFeedback.missed.map((m, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: MONO,
                          color: T.statusBad,
                          fontSize: 12,
                        }}
                      >
                        ✗ {m}
                      </div>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    fontFamily: MONO,
                    color: T.text2,
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {algorithmFeedback.feedback}
                </div>
              </div>
              <button
                onClick={advanceToReadRecall}
                disabled={loading}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "13px 0",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                {loading ? "Preparing recall..." : "Read & Recall →"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Phase 5: Read & Recall */}
      {phase === "readRecall" && recallPrompts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div>
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              PHASE 5 OF 6 · READ & RECALL ({currentRecall + 1}/{recallPrompts.length})
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Explain the Mechanism
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              No notes. No looking up. Explain this in your own words — connecting it back to your
              patient.
            </div>
          </div>

          <div
            style={{
              background: T.cardBg,
              border: "1px solid " + T.border1,
              borderRadius: 12,
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 16,
                lineHeight: 1.7,
                fontWeight: 600,
              }}
            >
              {recallPrompts[currentRecall]?.question}
            </div>
            {recallPrompts[currentRecall]?.hint && (
              <div
                style={{
                  fontFamily: MONO,
                  color: T.statusWarn,
                  fontSize: 11,
                  marginTop: 8,
                  fontStyle: "italic",
                }}
              >
                💡 Hint: {recallPrompts[currentRecall].hint}
              </div>
            )}
          </div>

          <textarea
            value={recallAnswer}
            onChange={(e) => setRecallAnswer(e.target.value)}
            placeholder="Explain the mechanism in your own words... connect it to the patient."
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 10,
              padding: "14px 16px",
              color: T.text1,
              fontFamily: MONO,
              fontSize: 13,
              lineHeight: 1.6,
              resize: "vertical",
              minHeight: 120,
              width: "100%",
              boxSizing: "border-box",
              opacity: recallFeedback ? 0.7 : 1,
            }}
            disabled={!!recallFeedback}
          />

          {!recallFeedback ? (
            <button
              onClick={submitRecall}
              disabled={!recallAnswer.trim() || loading}
              style={{
                background: recallAnswer.trim() ? tc : T.border1,
                border: "none",
                color: "#fff",
                padding: "13px 0",
                borderRadius: 10,
                cursor: recallAnswer.trim() ? "pointer" : "not-allowed",
                fontFamily: SERIF,
                fontSize: 15,
                fontWeight: 900,
              }}
            >
              {loading ? "Evaluating..." : "Submit Explanation →"}
            </button>
          ) : (
            <>
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: recallFeedback.correct ? T.statusGoodBg : T.statusWarnBg,
                  border:
                    "1px solid " +
                    (recallFeedback.correct ? T.statusGood : T.statusWarn),
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    color: recallFeedback.correct ? T.statusGood : T.statusWarn,
                    fontSize: 13,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  {recallFeedback.score}% ·{" "}
                  {recallFeedback.correct ? "Strong explanation" : "Needs more depth"}
                </div>
                {recallFeedback.conceptsLinked?.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {recallFeedback.conceptsLinked.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: MONO,
                          color: T.statusGood,
                          fontSize: 12,
                        }}
                      >
                        ✓ {c}
                      </div>
                    ))}
                  </div>
                )}
                {recallFeedback.gaps?.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {recallFeedback.gaps.map((g, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: MONO,
                          color: T.statusBad,
                          fontSize: 12,
                        }}
                      >
                        ✗ {g}
                      </div>
                    ))}
                  </div>
                )}
                {recallFeedback.correction && (
                  <div
                    style={{
                      fontFamily: MONO,
                      color: T.text1,
                      fontSize: 12,
                      lineHeight: 1.5,
                      marginTop: 6,
                      borderTop: "1px solid " + T.border2,
                      paddingTop: 6,
                    }}
                  >
                    {recallFeedback.correction}
                  </div>
                )}
                {recallFeedback.reinforcement && (
                  <div
                    style={{
                      fontFamily: MONO,
                      color: tc,
                      fontSize: 11,
                      marginTop: 6,
                      fontStyle: "italic",
                    }}
                  >
                    🔁 {recallFeedback.reinforcement}
                  </div>
                )}
              </div>
              <button
                onClick={nextRecall}
                disabled={loading}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "13px 0",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                {loading
                  ? "Preparing MCQs..."
                  : currentRecall < recallPrompts.length - 1
                  ? "Next Recall →"
                  : "Apply Your Knowledge →"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Phase 6: MCQ Application */}
      {phase === "mcq" && mcqQuestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div>
            <div
              style={{
                fontFamily: MONO,
                color: tc,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              PHASE 6 OF 6 · MCQ APPLICATION ({currentMCQ + 1}/{mcqQuestions.length})
            </div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Apply Your Knowledge
            </div>
          </div>

          <div style={{ height: 5, background: T.border1, borderRadius: 3 }}>
            <div
              style={{
                height: "100%",
                background: tc,
                borderRadius: 3,
                width: (currentMCQ / mcqQuestions.length) * 100 + "%",
                transition: "width 0.4s",
              }}
            />
          </div>

          <div
            style={{
              background: T.cardBg,
              border: "1px solid " + T.border1,
              borderRadius: 12,
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 16,
                lineHeight: 1.75,
                fontWeight: 600,
              }}
            >
              {mcqQuestions[currentMCQ]?.stem}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(mcqQuestions[currentMCQ]?.choices || {}).map(
              ([key, val]) => {
                let bg = T.inputBg;
                let border = T.border1;
                let color = T.text1;
                if (mcqFeedback) {
                  if (key === mcqQuestions[currentMCQ].correct) {
                    bg = T.statusGoodBg;
                    border = T.statusGood;
                    color = T.statusGood;
                  } else if (key === mcqSelected && !mcqFeedback.correct) {
                    bg = T.statusBadBg;
                    border = T.statusBad;
                    color = T.statusBad;
                  }
                } else if (key === mcqSelected) {
                  bg = tc + "18";
                  border = tc;
                  color = tc;
                }
                return (
                  <div
                    key={key}
                    onClick={() => !mcqFeedback && setMcqSelected(key)}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "13px 16px",
                      borderRadius: 10,
                      border: "1px solid " + border,
                      background: bg,
                      cursor: mcqFeedback ? "default" : "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: MONO,
                        fontWeight: 700,
                        color,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {key}.
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        color,
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      {val}
                    </span>
                  </div>
                );
              }
            )}
          </div>

          {!mcqFeedback ? (
            <button
              onClick={submitMCQ}
              disabled={!mcqSelected}
              style={{
                background: mcqSelected ? tc : T.border1,
                border: "none",
                color: "#fff",
                padding: "13px 0",
                borderRadius: 10,
                cursor: mcqSelected ? "pointer" : "not-allowed",
                fontFamily: SERIF,
                fontSize: 15,
                fontWeight: 900,
              }}
            >
              Submit Answer →
            </button>
          ) : (
            <>
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: mcqFeedback.correct ? T.statusGoodBg : T.statusBadBg,
                  border:
                    "1px solid " + (mcqFeedback.correct ? T.statusGood : T.statusBad),
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 13,
                    color: mcqFeedback.correct ? T.statusGood : T.statusBad,
                    marginBottom: 6,
                  }}
                >
                  {mcqFeedback.correct ? "✓ Correct!" : "✗ Incorrect"}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    color: T.text1,
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {mcqFeedback.explanation}
                </div>
                {!mcqFeedback.correct && (
                  <div
                    style={{
                      fontFamily: MONO,
                      color: T.statusGood,
                      fontSize: 12,
                      marginTop: 6,
                    }}
                  >
                    Correct: {mcqFeedback.correctAnswer}. {mcqFeedback.correctText}
                  </div>
                )}
              </div>
              <button
                onClick={nextMCQ}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "13px 0",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                {currentMCQ < mcqQuestions.length - 1
                  ? "Next Question →"
                  : "See Results →"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Summary phase */}
      {phase === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎓</div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 24,
                fontWeight: 900,
                marginBottom: 4,
              }}
            >
              Session Complete
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
              }}
            >
              {lectureTitle}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div
              style={{
                flex: 1,
                background: T.cardBg,
                border: "1px solid " + T.border1,
                borderRadius: 12,
                padding: "16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  color: T.text3,
                  fontSize: 9,
                  letterSpacing: 1,
                  marginBottom: 6,
                }}
              >
                PRE-STUDY SAQ
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 900,
                  fontSize: 28,
                  color: getScoreColor(T, preSAQScore ?? 0),
                }}
              >
                {preSAQScore ?? "—"}%
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontFamily: MONO,
                color: T.text3,
                fontSize: 20,
              }}
            >
              →
            </div>
            <div
              style={{
                flex: 1,
                background: T.cardBg,
                border: "1px solid " + T.border1,
                borderRadius: 12,
                padding: "16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  color: T.text3,
                  fontSize: 9,
                  letterSpacing: 1,
                  marginBottom: 6,
                }}
              >
                POST-STUDY MCQ
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 900,
                  fontSize: 28,
                  color: getScoreColor(T, postMCQScore ?? 0),
                }}
              >
                {postMCQScore ?? "—"}%
              </div>
            </div>
          </div>

          {preSAQScore !== null && postMCQScore !== null && (
            <div
              style={{
                background: postMCQScore > preSAQScore ? T.statusGoodBg : T.statusWarnBg,
                border:
                  "1px solid " +
                  (postMCQScore > preSAQScore ? T.statusGood : T.statusWarn),
                borderRadius: 10,
                padding: "12px 16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  color: postMCQScore > preSAQScore ? T.statusGood : T.statusWarn,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {postMCQScore > preSAQScore
                  ? `↑ +${postMCQScore - preSAQScore}% improvement this session`
                  : postMCQScore === preSAQScore
                  ? "→ Maintained — keep reviewing"
                  : `↓ ${preSAQScore - postMCQScore}% gap — schedule a review`}
              </div>
            </div>
          )}

          <div
            style={{
              background: T.cardBg,
              border: "1px solid " + T.border1,
              borderRadius: 12,
              padding: "16px 20px",
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 10,
              }}
            >
              📅 SPACED REPETITION SCHEDULE
            </div>
            {[
              { label: "1 Day", desc: "Quick recall check", urgent: true },
              { label: "10 Days", desc: "Full sandwich review", urgent: false },
              { label: "1 Month", desc: "Consolidation session", urgent: false },
            ].map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: i < 2 ? "1px solid " + T.border2 : "none",
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    color: r.urgent ? tc : T.text3,
                    fontSize: 12,
                    fontWeight: 700,
                    minWidth: 60,
                  }}
                >
                  {r.label}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    color: T.text2,
                    fontSize: 12,
                  }}
                >
                  {r.desc}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 8,
              }}
            >
              CONFIDENCE LEVEL — determines next review interval
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Low", "Medium", "High"].map((level) => (
                <div
                  key={level}
                  onClick={() => setConfidenceLevel(level)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    textAlign: "center",
                    borderRadius: 9,
                    cursor: "pointer",
                    border:
                      "1px solid " +
                      (confidenceLevel === level ? tc : T.border1),
                    background:
                      confidenceLevel === level ? tc + "18" : T.inputBg,
                    fontFamily: MONO,
                    fontSize: 13,
                    fontWeight: 700,
                    color: confidenceLevel === level ? tc : T.text2,
                    transition: "all 0.15s",
                  }}
                >
                  {level === "Low" ? "😰" : level === "Medium" ? "😐" : "💪"}{" "}
                  {level}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              const results = mcqResults;
              const nextReview =
                confidenceLevel === "Low" ? 1
                  : confidenceLevel === "Medium" ? 10 : 30;
              const meta = {
                blockId,
                topicKey: makeTopicKey
                  ? makeTopicKey(objectives?.[0]?.linkedLecId ?? null, blockId)
                  : (blockId + "__" + (objectives?.[0]?.linkedLecId || "block")),
                difficulty: "medium",
                targetObjectives: objectives,
                preSAQScore,
                postMCQScore,
                confidenceLevel,
                nextReview,
                sessionType: "deepLearn",
                lectureId: objectives?.[0]?.linkedLecId ?? null,
              };
              if (sessionId && deleteSession) deleteSession(sessionId);
              onComplete?.(results, meta);
            }}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "14px 0",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 16,
              fontWeight: 900,
            }}
          >
            Save & Schedule Review →
          </button>
        </div>
      )}
    </div>
  );
}

const phaseNumber = (phase) =>
  ({
    brainDump: 1,
    saq: 1,
    patientCase: 2,
    structureFunction: 3,
    algorithmDraw: 4,
    readRecall: 5,
    mcq: 6,
    summary: 7,
  }[phase] ?? 1);

// Wrapper: show Config then Session (mastery loop)
export default function DeepLearn({
  blockId,
  lecs = [],
  blockObjectives = [],
  questionBanksByFile = {},
  buildQuestionContext,
  detectStudyMode: detectStudyModeProp,
  onBack,
  termColor,
  makeTopicKey,
}) {
  const { T } = useTheme();
  const tc = termColor || T.purple;
  const [phase, setPhase] = useState("config");
  const [sessionParams, setSessionParams] = useState(null);

  const [savedDeepLearnSessions, setSavedDeepLearnSessions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-dl-sessions") || "{}");
    } catch {
      return {};
    }
  });

  const saveDeepLearnProgress = useCallback((sessionId, data) => {
    setSavedDeepLearnSessions((prev) => {
      const updated = {
        ...prev,
        [sessionId]: {
          ...data,
          lastSaved: new Date().toISOString(),
        },
      };
      localStorage.setItem("rxt-dl-sessions", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteDeepLearnSession = useCallback((sessionId) => {
    setSavedDeepLearnSessions((prev) => {
      const updated = { ...prev };
      delete updated[sessionId];
      localStorage.setItem("rxt-dl-sessions", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const [pendingDeepLearnStart, setPendingDeepLearnStart] = useState(null);

  const launchDeepLearn = useCallback(
    (cfg, sid) => {
      const { selectedTopics, blockId: bid } = cfg;
      setSessionParams({ sessionType: cfg.sessionType, selectedTopics, blockId: bid, sessionId: sid });
      setPhase("session");
    },
    []
  );

  const handleStart = useCallback(
    ({ sessionType, selectedTopics, blockId: bid }) => {
      const sessionId = `dl_${bid}_${selectedTopics?.[0]?.lecId}_${Date.now()}`;
      const existingSession = Object.values(savedDeepLearnSessions).find(
        (s) =>
          s.blockId === bid &&
          s.lecId === selectedTopics?.[0]?.lecId &&
          s.phase !== "summary"
      );
      if (existingSession) {
        setPendingDeepLearnStart({
          cfg: { sessionType, selectedTopics, blockId: bid },
          sessionId,
          existingSession,
        });
        return;
      }
      launchDeepLearn({ sessionType, selectedTopics, blockId: bid }, sessionId);
    },
    [savedDeepLearnSessions, launchDeepLearn]
  );

  const firstTopic = sessionParams?.resuming
    ? { label: sessionParams.lectureTitle, lecId: sessionParams.lecId, id: (sessionParams.lecId || "") + "_full" }
    : sessionParams?.selectedTopics?.[0];
  const lectureForTopic = firstTopic?.lecId ? lecs.find((l) => l.id === firstTopic.lecId) : null;
  const objectivesForSession = sessionParams?.resuming
    ? sessionParams.objectives || []
    : firstTopic?.weak
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

      {pendingDeepLearnStart && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000000cc",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
        >
          <div
            style={{
              background: T.cardBg,
              borderRadius: 18,
              padding: "28px 32px",
              maxWidth: 420,
              width: "100%",
              border: "1px solid " + T.border1,
            }}
          >
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 20,
                fontWeight: 900,
                marginBottom: 6,
              }}
            >
              Resume Session?
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 11,
                marginBottom: 20,
              }}
            >
              You have an unfinished Deep Learn session for{" "}
              <strong style={{ color: T.text1 }}>
                {pendingDeepLearnStart.existingSession.lectureTitle}
              </strong>
              {" "}— paused at{" "}
              <strong style={{ color: tc }}>
                Phase {phaseNumber(pendingDeepLearnStart.existingSession.phase)}{" "}
                ({pendingDeepLearnStart.existingSession.phase})
              </strong>
              <br />
              <span style={{ color: T.text3, fontSize: 10 }}>
                Last saved:{" "}
                {new Date(pendingDeepLearnStart.existingSession.lastSaved).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => {
                  setSessionParams({ ...pendingDeepLearnStart.existingSession, resuming: true });
                  setPhase("session");
                  setPendingDeepLearnStart(null);
                }}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                ▶ Resume from Phase {phaseNumber(pendingDeepLearnStart.existingSession.phase)}
              </button>
              <button
                onClick={() => {
                  deleteDeepLearnSession(pendingDeepLearnStart.existingSession.sessionId);
                  launchDeepLearn(pendingDeepLearnStart.cfg, pendingDeepLearnStart.sessionId);
                  setPendingDeepLearnStart(null);
                }}
                style={{
                  background: T.inputBg,
                  border: "1px solid " + T.border1,
                  color: T.text2,
                  padding: "14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 13,
                }}
              >
                🔄 Start Fresh
              </button>
              <button
                onClick={() => setPendingDeepLearnStart(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "6px",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "config" && (
        <>
          {(() => {
            const blockSessions = Object.values(savedDeepLearnSessions).filter(
              (s) => s.blockId === blockId && s.phase !== "summary"
            );
            if (!blockSessions.length) return null;
            return (
              <div
                style={{
                  background: T.statusWarnBg,
                  border: "1px solid " + T.statusWarnBorder,
                  borderRadius: 10,
                  padding: "12px 16px",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    color: T.statusWarn,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    marginBottom: 8,
                  }}
                >
                  ⏸ PAUSED SESSIONS
                </div>
                {blockSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: "1px solid " + T.statusWarnBorder,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.text1,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {s.lectureTitle}
                      </div>
                      <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                        Phase {phaseNumber(s.phase)} · {s.phase}
                        {" · "}saved{" "}
                        {new Date(s.lastSaved).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSessionParams({ ...s, resuming: true });
                        setPhase("session");
                      }}
                      style={{
                        background: T.statusWarn,
                        border: "none",
                        color: "#fff",
                        padding: "6px 14px",
                        borderRadius: 7,
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      Resume →
                    </button>
                    <button
                      onClick={() => deleteDeepLearnSession(s.sessionId)}
                      style={{
                        background: "none",
                        border: "none",
                        color: T.text3,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = T.statusBad)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = T.text3)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
          <DeepLearnConfig
            blockId={blockId}
            lecs={lecs}
            blockObjectives={blockObjectives}
            questionBanksByFile={questionBanksByFile}
            buildQuestionContext={buildQuestionContext}
            detectStudyMode={detectStudyModeProp}
            onStart={handleStart}
            T={T}
            tc={tc}
          />
        </>
      )}

      {phase === "session" && firstTopic && (
        <DeepLearnSession
          topic={firstTopic}
          lectureTitle={lectureForTopic?.lectureTitle || firstTopic.label}
          lectureContent={sessionParams?.resuming ? sessionParams.lectureContent : lectureForTopic?.fullText || ""}
          objectives={objectivesForSession}
          blockId={blockId}
          questionBanksByFile={questionBanksByFile}
          buildQuestionContext={buildQuestionContext}
          onComplete={(results, meta) => {
            onBack(results, meta);
          }}
          onUpdateObjective={() => {}}
          T={T}
          tc={tc}
          makeTopicKey={makeTopicKey}
          sessionId={sessionParams?.sessionId}
          saveProgress={saveDeepLearnProgress}
          deleteSession={deleteDeepLearnSession}
          resuming={sessionParams?.resuming || false}
          initialPhase={sessionParams?.resuming ? sessionParams.phase : undefined}
          initialBrainDump={sessionParams?.resuming ? sessionParams.brainDump : undefined}
          initialBrainDumpFeedback={sessionParams?.resuming ? sessionParams.brainDumpFeedback : undefined}
          initialSaqAnswers={sessionParams?.resuming ? sessionParams.saqAnswers : undefined}
          initialSaqFeedback={sessionParams?.resuming ? sessionParams.saqFeedback : undefined}
          initialSaqQuestions={sessionParams?.resuming ? sessionParams.saqQuestions : undefined}
          initialPatientCase={sessionParams?.resuming ? sessionParams.patientCase : undefined}
          initialStructureContent={sessionParams?.resuming ? sessionParams.structureContent : undefined}
          initialAlgorithm={sessionParams?.resuming ? sessionParams.algorithm : undefined}
          initialAlgorithmText={sessionParams?.resuming ? sessionParams.algorithmText : undefined}
          initialAlgorithmFeedback={sessionParams?.resuming ? sessionParams.algorithmFeedback : undefined}
          initialRecallPrompts={sessionParams?.resuming ? sessionParams.recallPrompts : undefined}
          initialCurrentRecall={sessionParams?.resuming ? sessionParams.currentRecall : undefined}
          initialRecallAnswer={sessionParams?.resuming ? sessionParams.recallAnswer : undefined}
          initialRecallFeedback={sessionParams?.resuming ? sessionParams.recallFeedback : undefined}
          initialMcqQuestions={sessionParams?.resuming ? sessionParams.mcqQuestions : undefined}
          initialMcqAnswers={sessionParams?.resuming ? sessionParams.mcqAnswers : undefined}
          initialMcqResults={sessionParams?.resuming ? sessionParams.mcqResults : undefined}
          initialPreSAQScore={sessionParams?.resuming ? sessionParams.preSAQScore : undefined}
          initialInputMode={sessionParams?.resuming ? sessionParams.inputMode : undefined}
          initialHandwriteDone={sessionParams?.resuming ? sessionParams.handwriteDone : undefined}
        />
      )}
    </div>
  );
}

function Phase1Content({ data, T, userInput, setUserInput, revealed, toggleReveal, SERIF, MONO }) {
  const v = data.vignette || "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ borderLeft: "4px solid " + T.statusBad, background: T.inputBg, padding: "16px 18px", borderRadius: 0, fontFamily: MONO, color: T.text2, fontSize: 15, lineHeight: 1.7 }}>{v}</div>
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
      {revealed[uid] && <div style={{ marginTop: 8, fontFamily: MONO, color: T.statusGood, fontSize: 14 }}>{answer}</div>}
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
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.statusWarn, color: T.text1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 14, fontWeight: 700 }}>{i + 1}</div>
            <div style={{ flex: 1, background: T.border2, padding: "12px 14px", borderRadius: 10 }}>
              <div style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 13, marginBottom: 4 }}>{layer.level}</div>
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
          {revealed[`p2_cloze_${i}`] && <div style={{ marginTop: 6, fontFamily: MONO, color: T.statusGood, fontSize: 14 }}>{clozeAnswers[i]}</div>}
        </div>
      ))}
    </div>
  );
}

function Phase3Content({ data, T, userInput, setUserInput, revealed, toggleReveal, MONO, SERIF }) {
  const qs = data.questions || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: T.text1, background: T.inputBg, padding: "18px 20px", borderRadius: 12, borderLeft: "4px solid " + T.statusWarn }}>{data.cleanStatement}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {["defectType", "kinetics", "gainLoss", "inheritance"].map((k) => data[k] && (
          <span key={k} style={{ background: T.statusWarnBg, border: "1px solid " + T.statusWarn, color: T.statusWarn, fontFamily: MONO, fontSize: 13, padding: "6px 12px", borderRadius: 20 }}>{k.replace(/([A-Z])/g, " $1").trim()}: {data[k]}</span>
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
                <td style={{ padding: "12px", color: T.statusGood }}>{r.drugExample}</td>
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
          <span key={i} style={{ background: T.statusBadBg, border: "1px solid " + T.statusBad, color: T.statusBad, fontFamily: MONO, fontSize: 14, padding: "6px 12px", borderRadius: 20 }}>{w}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", background: T.statusWarnBg, border: "1px solid " + T.statusWarn, borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 12, marginBottom: 6 }}>MOST COMMON COMPLICATION</div>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14 }}>{data.mostCommonComplication}</div>
        </div>
        <div style={{ flex: "1 1 200px", background: T.statusBadBg, border: "1px solid " + T.statusBad, borderRadius: 12, padding: "14px 16px", boxShadow: "0 0 12px " + T.statusBad + "22" }}>
          <div style={{ fontFamily: MONO, color: T.statusBad, fontSize: 12, marginBottom: 6 }}>MOST DEADLY COMPLICATION</div>
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
        {revealed.p6_mini && <div style={{ marginTop: 8, fontFamily: MONO, color: T.statusGood, fontSize: 14 }}>{data.miniVignetteAnswer}</div>}
      </div>
      <div>
        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 13, marginBottom: 8 }}>SIDE EFFECT PREDICTION</div>
        <div style={{ fontFamily: MONO, color: T.text2, fontSize: 14, marginBottom: 8 }}>{data.sideEffectPrediction}</div>
        <button type="button" onClick={() => toggleReveal("p6_side")} style={{ background: "none", border: "1px solid " + T.border2, color: T.text3, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Show Answer</button>
        {revealed.p6_side && <div style={{ marginTop: 8, fontFamily: MONO, color: T.statusGood, fontSize: 14 }}>{data.sideEffectAnswer}</div>}
      </div>
      <div style={{ background: accent + "18", border: "1px solid " + accent, borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: T.text1, marginBottom: 12 }}>{data.masteryStatement}</div>
        {!phase6Mastered ? (
          <button type="button" onClick={onMastered} style={{ background: accent, border: "none", color: T.text1, padding: "12px 24px", borderRadius: 10, cursor: "pointer", fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>✓ I Own This</button>
        ) : (
          <span style={{ color: T.statusGood, fontFamily: MONO, fontSize: 16 }}>✓ Marked as mastered</span>
        )}
      </div>
    </div>
  );
}
