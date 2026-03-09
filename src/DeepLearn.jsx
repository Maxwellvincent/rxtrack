import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useTheme, getScoreColor } from "./theme";
import { LEVEL_NAMES, LEVEL_COLORS, LEVEL_BG } from "./bloomsTaxonomy";
import { callAI } from "./aiClient";

const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

/** Extracts the first matching field from an AI JSON response. */
function parseAIField(raw, ...fields) {
  try {
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw.replace(/```json\n?|```/g, "").trim())
        : raw;
    for (const field of fields) {
      if (parsed?.[field]) return parsed[field];
    }
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
}

const PATIENT_CASE_FOCUS_FALLBACK = "Consider how the mechanisms from this lecture explain this presentation.";

/** Extract { case, focus } from API raw response. State will NEVER contain raw JSON. */
function extractCaseAndFocusFromRaw(raw) {
  if (raw == null) return { case: "", focus: PATIENT_CASE_FOCUS_FALLBACK };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    let c = raw.case ?? raw.vignette ?? raw.text;
    if (typeof c === "string" && c.trim().startsWith("{")) {
      try {
        const inner = JSON.parse(c.replace(/```json\n?|```/g, "").trim());
        c = inner.case || inner.vignette || inner.text || c;
      } catch {
        const m = c.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || c.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*)/);
        c = m ? m[1].replace(/\\"/g, '"').trim() : c.replace(/^\s*\{\s*"case"\s*:\s*"/, "").replace(/"\s*,?\s*"focus".*$/, "").replace(/\\"/g, '"').trim();
      }
    }
    const caseStr = typeof c === "string" ? c : (c != null ? String(c) : "");
    const f = raw.focus;
    const focusStr = typeof f === "string" ? f : PATIENT_CASE_FOCUS_FALLBACK;
    return { case: caseStr, focus: focusStr };
  }
  const s = String(raw).replace(/```json\n?|```/g, "").trim();
  if (s.startsWith("{")) {
    try {
      const p = JSON.parse(s);
      return {
        case: p.case || p.vignette || p.text || "",
        focus: p.focus || PATIENT_CASE_FOCUS_FALLBACK,
      };
    } catch {
      const caseMatch = s.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || s.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*)/);
      const focusMatch = s.match(/"focus"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || s.match(/"focus"\s*:\s*"((?:[^"\\]|\\.)*)/);
      const caseStr = caseMatch ? caseMatch[1].replace(/\\"/g, '"').trim() : s.replace(/^\s*\{\s*"case"\s*:\s*"/, "").replace(/"\s*,?\s*"focus".*$/, "").replace(/\\"/g, '"').trim();
      const focusStr = focusMatch ? focusMatch[1].replace(/\\"/g, '"').trim() : PATIENT_CASE_FOCUS_FALLBACK;
      return { case: caseStr || s, focus: focusStr };
    }
  }
  return { case: s, focus: PATIENT_CASE_FOCUS_FALLBACK };
}

/** Normalize patient case from API raw response to { case, focus }. */
function extractPatientCase(raw, fallbackFocus = PATIENT_CASE_FOCUS_FALLBACK) {
  const out = extractCaseAndFocusFromRaw(raw);
  if (raw == null && !out.case) return null;
  return out;
}

/** Safety net at render: always show case text only (never raw JSON). */
function getPatientCaseText(pc) {
  if (pc == null) return "";
  if (typeof pc === "object" && !Array.isArray(pc)) {
    let c = pc.case ?? pc.vignette ?? pc.text ?? "";
    if (typeof c === "string" && c.trim().startsWith("{")) {
      try {
        const p = JSON.parse(c.replace(/```json\n?|```/g, "").trim());
        return p.case || p.vignette || p.text || c;
      } catch {
        const m = c.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || c.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*)/);
        if (m) return m[1].replace(/\\"/g, '"').trim();
        const fallback = c.replace(/^\s*\{\s*"case"\s*:\s*"/, "").replace(/"\s*,?\s*"focus".*$/, "").replace(/\\"/g, '"');
        return fallback.trim() || c;
      }
    }
    return typeof c === "string" ? c : "";
  }
  if (typeof pc === "string" && pc.trim().startsWith("{")) {
    try {
      const p = JSON.parse(pc.replace(/```json\n?|```/g, "").trim());
      return p.case || p.vignette || p.text || pc;
    } catch {
      const m = pc.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || pc.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (m) return m[1].replace(/\\"/g, '"').trim();
      const fallback = pc.replace(/^\s*\{\s*"case"\s*:\s*"/, "").replace(/"\s*,?\s*"focus".*$/, "").replace(/\\"/g, '"');
      return fallback.trim() || pc;
    }
  }
  return typeof pc === "string" ? pc : "";
}

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
      const objList = (resolvedObjectives || [])
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
        <style>{`
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
`}</style>
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
          <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 14, lineHeight: 1.7 }}>{getPatientCaseText(patientCase)}</div>
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

async function generateSAQs(lectureContent, blockObjectives, lectureTitle, patientCaseText) {
  const fallback = [];
  try {
    const lecObjs = (blockObjectives || [])
      .slice(0, 5)
      .map((o) => `- ${(o.objective || o.text || "").slice(0, 60)}`)
      .filter((s) => s.length > 3)
      .join("\n");
    const systemPrompt = `You are a medical school tutor. You MUST generate exactly 3 questions.
Respond ONLY with raw JSON, no markdown, no backticks, no extra text.
You MUST include exactly 3 items in the array — not 1, not 2, exactly 3:
{"q":["<question 1>","<question 2>","<question 3>"]}`;
    const userPrompt = `Lecture: ${(lectureTitle || "Medical Lecture").slice(0, 60)}
Objectives:
${lecObjs || "Key concepts from the lecture."}`;
    const text = await callAI(systemPrompt, userPrompt, 800);
    const clean = (text || "").replace(/```json\n?|```/g, "").trim();
    let parsed = null;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const first = clean.indexOf("{");
      const last = clean.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try {
          parsed = JSON.parse(clean.slice(first, last + 1));
        } catch {}
      }
    }
    if (!parsed || typeof parsed !== "object") {
      const qMatch = clean.match(/"q"\s*:\s*\[([\s\S]*?)\]/);
      const questionsMatch = clean.match(/"questions"\s*:\s*\[([\s\S]*?)\]/);
      const arrMatch = qMatch || questionsMatch;
      if (arrMatch) {
        const items = arrMatch[1].match(/"((?:[^"\\]|\\.)*)"/g)?.map((s) => s.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim()).filter((s) => s.length > 5) || [];
        if (items.length > 0) parsed = { q: items };
      }
    }
    if ((!parsed || !parsed.q?.length) && clean.length > 0) {
      const questionLines = clean.split(/\n/).map((s) => s.replace(/^\s*[\d.]+\s*[-–]?\s*/, "").trim()).filter((s) => s.length > 15 && (s.endsWith("?") || /^(what|which|how|why|describe|explain|identify)/i.test(s)));
      if (questionLines.length > 0) parsed = { q: questionLines.slice(0, 5) };
    }
    const rawQuestions = parsed?.q ?? parsed?.questions ?? [];
    const rawArray = Array.isArray(rawQuestions) ? rawQuestions : (rawQuestions != null ? [rawQuestions] : []);
    console.log("generateSAQs raw result:", parsed != null ? "ok" : "parse failed", "questions count:", rawArray.length);
    const objList = (blockObjectives || []).slice(0, 5);
    const questions = rawArray
      .map((qText, i) => ({
        q: typeof qText === "string" ? qText : (qText?.q ?? qText?.question ?? ""),
        keyPoints: typeof qText === "object" && qText != null
          ? (Array.isArray(qText.keyPoints) ? qText.keyPoints.join(", ") : (qText.keyPoints ?? qText.key_points ?? ""))
          : "",
        objectiveText: objList[i]?.objective || objList[i]?.text || "",
      }))
      .filter((item) => (item.q || "").length > 5);
    console.log("setSaqs called with:", questions.length, "questions");
    return questions.length > 0 ? questions : fallback;
  } catch (err) {
    console.error("generateSAQs error:", err);
    return fallback;
  }
}

function getSAQEvalPrompt(attemptNumber) {
  if (attemptNumber === 1)
    return `You are a Socratic medical tutor.
Score the answer and give ONE probing question that guides the student toward what they missed.
Do NOT give the answer. Make them think.
Raw JSON only, no markdown:
{"score": <0-100>, "feedback": "<15 words max critique>", "hint": "<one Socratic question to guide them, max 20 words>"}`;
  if (attemptNumber === 2)
    return `You are a Socratic medical tutor on the student's second attempt.
Score the answer. Give a stronger hint — name the concept they're missing but not the full answer.
Raw JSON only, no markdown:
{"score": <0-100>, "feedback": "<15 words max>", "hint": "<name the missing concept, give a partial scaffold, max 25 words>"}`;
  return `You are a medical tutor. Student has attempted this 3 times.
Score and now fully explain the correct answer with clinical relevance.
Raw JSON only, no markdown:
{"score": <0-100>, "feedback": "<15 words max>", "hint": "", "teaching": "<correct answer in 2 sentences>", "clinical": "<why this matters clinically, 1 sentence>"}`;
}

async function evaluateSAQAnswer(question, answer, keyPoints, lectureContent, attemptNumber = 1) {
  if (!answer || answer.trim().length < 5) return { score: 0, feedback: "", hint: "", teaching: "", clinical: "" };

  const fallback = { score: null, feedback: "Could not evaluate — check your API key or try again.", hint: "", teaching: "", clinical: "" };

  const kp = keyPoints == null ? [] : Array.isArray(keyPoints) ? keyPoints : [String(keyPoints)];
  const keyPointsStr = kp.join(", ") || "key concepts from the lecture";
  const systemPrompt = `Medical school tutor. Score this answer 0-100.
Return ONLY raw JSON, no markdown: {"score":<0-100>,"feedback":"<10 words max>","hint":"<Socratic question if score under 60, else empty>"}`;
  const userPrompt = `Question: ${String(question || "").slice(0, 500)}
Expected concepts: ${keyPointsStr}
Student answer: ${String(answer || "(no answer provided)").slice(0, 500)}`;

  console.log("SAQ eval context — question length:", String(question || "").length, "keyPoints count:", kp.length);
  console.log("Full eval userPrompt:", userPrompt);

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const text = await callAI(systemPrompt, userPrompt, 800);
      const clean = (text || "").replace(/```json\n?|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        const match = clean.match(/\{[\s\S]*\}/);
        try {
          parsed = match ? JSON.parse(match[0]) : {};
        } catch {
          const scoreMatch = clean.match(/"score"\s*:\s*(\d+)/);
          const feedbackMatch = clean.match(/"feedback"\s*:\s*"([^"]{0,300})/);
          if (scoreMatch) {
            parsed = { score: parseInt(scoreMatch[1], 10), feedback: feedbackMatch ? feedbackMatch[1] + "…" : "" };
          } else {
            parsed = {};
          }
        }
      }

      const rawScore = Number(parsed.score);
      let score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, rawScore)) : null;
      let feedback = parsed.feedback || "";
      const hasUseful = score !== null || (feedback && feedback.trim().length > 0);
      if (hasUseful) {
        console.log("SAQ eval success:", { score, feedback: feedback?.slice(0, 50) });
        return {
          score: score ?? null,
          feedback: feedback.trim(),
          hint: parsed.hint || "",
          teaching: parsed.teaching || "",
          clinical: parsed.clinical || "",
        };
      }
      // Salvage from truncated or malformed JSON (e.g. missing closing brace)
      if (clean.length > 30) {
        const scoreSalvage = clean.match(/"score"\s*:\s*(\d+)/);
        const feedbackSalvage = clean.match(/"feedback"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
        const s = scoreSalvage ? Math.min(100, Math.max(0, parseInt(scoreSalvage[1], 10))) : null;
        const f = feedbackSalvage ? feedbackSalvage[1].replace(/\\"/g, '"').trim() : "";
        if (s !== null || f.length > 0) {
          console.log("SAQ eval salvaged:", { score: s, feedback: f?.slice(0, 50) });
          return { score: s, feedback: f, hint: "", teaching: "", clinical: "" };
        }
      }
      if (attempt < maxAttempts) {
        console.warn("SAQ eval attempt", attempt, "no usable score/feedback, retrying...");
        await delay(800 * attempt);
      }
    } catch (err) {
      console.error("SAQ eval failed (attempt " + attempt + "):", err);
      if (attempt < maxAttempts) {
        await delay(800 * attempt);
      } else {
        const msg = err?.message?.trim?.() || "";
        const friendly =
          /api key|API key|no.*key set/i.test(msg)
            ? "API key missing or invalid. Set VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY in .env (or VITE_ANTHROPIC_API_KEY if using Claude)."
            : msg.length > 80
              ? msg.slice(0, 80) + "…"
              : msg || fallback.feedback;
        return { ...fallback, feedback: friendly };
      }
    }
  }
  return fallback;
}

async function generatePatientCase(lectureContent, objectives, lectureTitle) {
  try {
    const system = "You are a medical education expert. Create a specific, realistic clinical vignette. Return ONLY this JSON (no markdown): {\"case\": \"...\", \"focus\": \"...\"}";
    const user = `Lecture topic: ${lectureTitle || "Medical Lecture"}
Key objectives: ${(objectives || []).slice(0, 3).map((o) => o.objective).join("; ")}
Lecture content excerpt: ${(lectureContent || "").slice(0, 1500)}

Write a 3-4 sentence patient case that:
- Features a SPECIFIC patient (age, sex, chief complaint)
- Has symptoms/signs DIRECTLY related to the anatomy or pathology in this lecture
- Gives enough clinical detail to be interesting
- Is NOT generic — must be specific to ${lectureTitle || "this topic"}

Return ONLY: {"case": "specific patient case here", "focus": "specific thing to look for"}`;
    const text = await callAI(system, user, 1800);
    const clean = text.replace(/```json\n?|```/g, "").trim();

    try {
      const parsed = JSON.parse(clean);
      let caseVal = parsed.case || parsed.presentation || parsed.vignette || parsed.text || "";
      if (typeof caseVal === "string" && caseVal.trim().startsWith("{")) {
        try {
          const inner = JSON.parse(caseVal.replace(/```json\n?|```/g, "").trim());
          caseVal = inner.case || inner.vignette || inner.text || caseVal;
        } catch {
          const m = caseVal.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || caseVal.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*)/);
          if (m) caseVal = m[1].replace(/\\"/g, '"').trim();
        }
      }
      return {
        case: caseVal,
        focus: parsed.focus || "Consider how the mechanisms from this lecture explain this presentation.",
      };
    } catch {
      const caseMatch = clean.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*?)"(?:\s*[,}])?/) || clean.match(/"case"\s*:\s*"((?:[^"\\]|\\.)*)/);
      const caseText = caseMatch ? caseMatch[1].replace(/\\"/g, '"').trim() : null;
      return {
        case: caseText || clean.replace(/^\s*\{\s*"case"\s*:\s*"/, "").replace(/"\s*,?\s*"focus".*$/, "").replace(/\\"/g, '"').trim() || "A patient presents with symptoms relevant to today's lecture content.",
        focus: "Consider how the mechanisms from this lecture explain this presentation.",
      };
    }
  } catch (err) {
    console.error("generatePatientCase error:", err);
    return {
      case: `A 45-year-old patient presents to the clinic with findings relevant to ${lectureTitle || "today's lecture"}. As you review this case, consider the anatomical structures and mechanisms covered in your lecture materials.`,
      focus: "Think about how the core concepts from this lecture explain this patient's presentation.",
    };
  }
}

function FirstPassWalkthrough({
  lec,
  lectureContent,
  lecObjectives: lecObjectivesProp,
  blockId,
  lecId,
  lectureNumber,
  lectureType,
  mergedFrom,
  getBlockObjectives,
  lectureTitle,
  patientCase,
  T,
  tc,
  onComplete,
  sessionId,
  deleteSession,
}) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const [step, setStep] = useState(0);
  const [reflection, setReflection] = useState("");
  const [sectionThought, setSectionThought] = useState("");
  const [showTakeaway, setShowTakeaway] = useState(false);
  const [sectionData, setSectionData] = useState(null);
  const [loading, setLoading] = useState(false);

  const objectives = useMemo(() => {
    if (lecObjectivesProp && lecObjectivesProp.length > 0) return lecObjectivesProp;
    const blockObjs = getBlockObjectives?.(blockId) || [];
    const allIds = new Set([lecId, ...(mergedFrom || [])].filter(Boolean));
    const byId = blockObjs.filter((o) => allIds.has(o.linkedLecId));
    if (byId.length > 0) return byId;
    const byTypeNum = blockObjs.filter(
      (o) =>
        String(o.lectureNumber) === String(lectureNumber) &&
        (o.lectureType || "LEC").toUpperCase() === (lectureType || "LEC").toUpperCase()
    );
    if (byTypeNum.length > 0) return byTypeNum;
    return blockObjs.filter((o) => String(o.lectureNumber) === String(lectureNumber));
  }, [lecObjectivesProp, blockId, lecId, lectureNumber, lectureType, mergedFrom, getBlockObjectives]);

  console.log("Walkthrough — lectureContent length:", lectureContent?.length);
  console.log("Walkthrough — objectives for this section:", objectives?.length, objectives?.slice(0, 2).map((o) => o?.objective?.slice(0, 40)));

  const teachingMap = lec?.teachingMap;
  const mapSections = teachingMap?.sections || [];
  const useTeachingMap = mapSections.length > 0;

  if (objectives.length === 0 && !lectureContent?.trim() && !useTeachingMap) {
    return (
      <div style={{ padding: 16, background: "#fff8ee", border: "1px solid #f59e0b", borderRadius: 10 }}>
        <div style={{ fontFamily: MONO, color: "#d97706", fontWeight: 700, marginBottom: 8 }}>No objectives found for this lecture.</div>
        <div style={{ fontSize: 13, color: "#555" }}>Re-upload the PDF to extract objectives.</div>
      </div>
    );
  }

  const lectureText = (lectureContent || "").trim();
  if (!useTeachingMap && lectureText.length < 100) {
    return (
      <div
        style={{
          padding: 20,
          background: "#fff0f0",
          border: "1.5px solid " + (T.statusBad || "#ef4444"),
          borderRadius: 12,
        }}
      >
        <div style={{ fontWeight: 700, color: T.statusBad || "#ef4444", marginBottom: 8, fontFamily: MONO }}>
          ⚠ No lecture content found
        </div>
        <div style={{ fontSize: 14, color: "#555" }}>
          The PDF text couldn't be extracted for this lecture. Try re-uploading the PDF — make sure it's not a scanned image-only PDF. If it is, enable Mistral OCR in settings for better extraction.
        </div>
      </div>
    );
  }

  const allObjs = objectives?.length > 0 ? objectives : null;
  const contentChunks =
    !allObjs && lectureContent
      ? (() => {
          const sections = lectureContent
            .split(/\n(?=[A-Z][^a-z\n]{10,}|\#{1,3}\s)/)
            .filter((s) => s.trim().length > 100)
            .slice(0, 6);
          const chunks = [];
          for (let i = 0; i < sections.length; i += 2) {
            chunks.push(sections.slice(i, i + 2).join("\n\n"));
          }
          return chunks.length > 0 ? chunks : [lectureContent.slice(0, 2000)];
        })()
      : null;

  const objChunks = allObjs
    ? (() => {
        const chunks = [];
        for (let i = 0; i < allObjs.length; i += 3) {
          chunks.push({ type: "objectives", items: allObjs.slice(i, i + 3) });
        }
        return chunks;
      })()
    : (contentChunks || [lectureContent?.slice(0, 2000) || ""]).map((c) => ({
        type: "content",
        content: c,
      }));

  const totalSteps = useTeachingMap ? Math.max(mapSections.length, 1) : Math.max(objChunks.length, 1);
  const currentChunk = objChunks[step] || { type: "content", content: "" };
  const currentSectionData = useTeachingMap ? mapSections[step] : null;

  useEffect(() => {
    if (useTeachingMap && currentSectionData) {
      setSectionData({
        title: currentSectionData.title || `Section ${step + 1}`,
        teach: currentSectionData.coreContent || "",
        keyTerms: Array.isArray(currentSectionData.keyTerms) ? currentSectionData.keyTerms : [],
        patientLink: currentSectionData.clinicalRelevance || "Consider how this section connects to the patient.",
        anchorQuestion: currentSectionData.anchorQuestion || "What stands out most from this section?",
        takeaway: currentSectionData.commonMistakes || "Remember the key concepts from this section.",
      });
      setSectionThought("");
      setShowTakeaway(false);
      setLoading(false);
      return;
    }

    if (!currentChunk || objChunks.length === 0) {
      setSectionData({
        title: "Overview",
        teach: "No objectives or lecture content available for this section.",
        keyTerms: [],
        patientLink: "Connect what you know to your patient case.",
        anchorQuestion: "What would you like to focus on?",
        takeaway: "Use your lecture materials to fill in this section.",
      });
      setLoading(false);
      return;
    }

    const sectionObjs = currentChunk.type === "objectives" ? currentChunk.items || [] : [];
    const objList =
      sectionObjs.length > 0
        ? sectionObjs.map((o) => `- ${o.objective || o.text || ""}`).join("\n")
        : "Key concepts from the lecture content below.";
    const totalSections = totalSteps;
    const sectionIndex = step;
    const len = (lectureContent || "").length;
    const contentSnippet = (lectureContent || "")
      .slice(
        Math.floor((sectionIndex / totalSections) * len),
        Math.floor(((sectionIndex + 1) / totalSections) * len)
      )
      .slice(0, 2000);

    setLoading(true);
    setSectionData(null);
    setSectionThought("");
    setShowTakeaway(false);

    const systemPrompt = `You are an expert medical school tutor doing a first-pass teaching session.
Your job is to TEACH the student this content clearly — they have NOT read the slides.
Write like a brilliant tutor explaining to a smart student, not like a textbook.
Use clear language. Define key terms inline. Build from basic to clinical.
Raw JSON only, no markdown:
{
  "title": "<section title, 4-6 words>",
  "teach": "<3-5 sentence explanation of the core concepts, define all key terms, explain mechanisms clearly>",
  "keyTerms": ["<term 1>", "<term 2>", "<term 3>"],
  "patientLink": "<1-2 sentences connecting these concepts directly to the patient case>",
  "anchorQuestion": "<one question that makes the student think — not recall, but reason>",
  "takeaway": "<the single most important thing to remember from this section, 1 sentence>"
}`;
    const userPrompt = `Lecture: ${lectureTitle}
Section ${sectionIndex + 1} of ${totalSections}
Objectives for this section:
${objList}
Relevant lecture content:
${contentSnippet || "(Use the objectives above to teach this section.)"}
Patient case: ${getPatientCaseText(patientCase) || "No patient case available."}`;

    (async () => {
      try {
        const text = await callAI(systemPrompt, userPrompt, 1200);
        const clean = (text || "").replace(/```json\n?|```/g, "").trim();
        const first = clean.indexOf("{");
        const last = clean.lastIndexOf("}");
        const jsonStr = first >= 0 && last > first ? clean.slice(first, last + 1) : clean;
        let parsed = {};
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          parsed = {};
        }
        setSectionData({
          title: parsed.title || `Section ${sectionIndex + 1}`,
          teach: parsed.teach || "Review the objectives and lecture content for this section.",
          keyTerms: Array.isArray(parsed.keyTerms) ? parsed.keyTerms : [],
          patientLink: parsed.patientLink || "Consider how these concepts apply to your patient.",
          anchorQuestion: parsed.anchorQuestion || "What stands out most from this section?",
          takeaway: parsed.takeaway || "Remember the key concepts from the objectives above.",
        });
      } catch (err) {
        console.error("Walkthrough teaching generation failed:", err);
        setSectionData({
          title: currentChunk.type === "objectives" ? (currentChunk.items?.[0]?.objective?.slice(0, 40) || `Section ${step + 1}`) : `Section ${step + 1}`,
          teach:
            currentChunk.type === "objectives"
              ? currentChunk.items.map((o) => o.objective).join(" ")
              : "Review the lecture content for this section.",
          keyTerms: currentChunk.type === "objectives" ? (currentChunk.items || []).map((o) => o.objective || o.text) : [],
          patientLink: "Connect these concepts to your patient case.",
          anchorQuestion: "How do these concepts relate to the patient?",
          takeaway: "Review your materials to lock in the key points.",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [step, useTeachingMap, currentSectionData, objChunks.length, totalSteps, lectureContent, lectureTitle, patientCase]);

  const wrongObjectivesDetected =
    objectives.length > 0 &&
    objectives[0]?.objective?.toLowerCase().includes("axilla");

  return (
    <div>
      {wrongObjectivesDetected && sessionId && deleteSession && (
        <div
          style={{
            background: T.statusWarnBg || "#fef3c7",
            border: "1px solid " + (T.statusWarnBorder || "#f59e0b"),
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              color: T.statusWarn || "#d97706",
              fontSize: 11,
              marginBottom: 8,
            }}
          >
            △ Wrong objectives detected — these are from a different lecture
          </div>
          <button
            type="button"
            onClick={() => {
              deleteSession(sessionId);
              window.location.reload();
            }}
            style={{
              background: T.statusWarn || "#d97706",
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: 6,
              fontFamily: MONO,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ↻ Restart with correct objectives
          </button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
          SECTION {step + 1} OF {totalSteps}
          {sectionData?.title ? " · " + (sectionData.title || "").toUpperCase() : ""}
        </span>
        <div style={{ flex: 1, height: 4, background: T.border1, borderRadius: 2 }}>
          <div
            style={{
              height: "100%",
              borderRadius: 2,
              background: tc,
              width: ((step + 1) / totalSteps) * 100 + "%",
            }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "24px 0", color: T.text3 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid " + tc,
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 12 }}>Loading walkthrough...</span>
        </div>
      ) : (
        sectionData && (
          <div>
            {/* TEACH block */}
            <div
              style={{
                background: "white",
                border: "1.5px solid #e5e7eb",
                borderRadius: 12,
                padding: "18px 20px",
                marginBottom: 16,
                lineHeight: 1.75,
                fontSize: 15,
                color: "#222",
              }}
            >
              {sectionData.teach}
            </div>

            {sectionData.keyTerms?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {sectionData.keyTerms.map((term, i) => (
                  <span
                    key={i}
                    style={{
                      background: "#f0f7ff",
                      border: "1px solid " + (T.statusGood || "#22c55e"),
                      borderRadius: 20,
                      padding: "3px 12px",
                      fontSize: 12,
                      fontFamily: MONO,
                      color: T.statusGood || "#22c55e",
                    }}
                  >
                    {term}
                  </span>
                ))}
              </div>
            )}

            <div
              style={{
                background: "#fff8f0",
                borderLeft: "3px solid " + (T.statusWarn || "#f59e0b"),
                borderRadius: "0 8px 8px 0",
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 13,
                color: "#554",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: "bold",
                  color: T.statusWarn || "#f59e0b",
                  fontFamily: MONO,
                  marginBottom: 4,
                }}
              >
                YOUR PATIENT
              </div>
              {sectionData.patientLink}
            </div>

            <div
              style={{
                background: "#fffff0",
                border: "1.5px solid #e8e0a0",
                borderRadius: 12,
                padding: "14px 16px",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: "bold",
                  color: "#998800",
                  fontFamily: MONO,
                  marginBottom: 6,
                }}
              >
                💭 THINK ABOUT THIS
              </div>
              <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>{sectionData.anchorQuestion}</div>
              <textarea
                value={sectionThought}
                onChange={(e) => setSectionThought(e.target.value)}
                placeholder="Write your thoughts — this won't be graded, just makes it stick..."
                style={{
                  width: "100%",
                  minHeight: 80,
                  padding: "10px 12px",
                  border: "1.5px solid #ddd",
                  borderRadius: 8,
                  resize: "vertical",
                  fontFamily: MONO,
                  fontSize: 13,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            {(sectionThought.length > 20 || showTakeaway) && (
              <div
                style={{
                  background: "#f0fff4",
                  borderLeft: "3px solid " + (T.statusGood || "#22c55e"),
                  borderRadius: "0 8px 8px 0",
                  padding: "10px 14px",
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: "bold",
                    color: T.statusGood || "#22c55e",
                    fontFamily: MONO,
                    marginBottom: 4,
                  }}
                >
                  ✓ KEY TAKEAWAY
                </div>
                {sectionData.takeaway}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSectionThought("");
                    setShowTakeaway(false);
                    setStep((s) => s - 1);
                  }}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: T.inputBg,
                    border: "1px solid " + T.border1,
                    borderRadius: 10,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 13,
                    color: T.text2,
                    fontWeight: 700,
                  }}
                >
                  ← Previous Section
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSectionThought("");
                  setShowTakeaway(false);
                  if (step < totalSteps - 1) {
                    setStep((s) => s + 1);
                  } else {
                    onComplete();
                  }
                }}
                style={{
                  flex: 2,
                  padding: 16,
                  background: tc,
                  border: "none",
                  color: "#fff",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 15,
                  fontWeight: "bold",
                }}
              >
                {step < totalSteps - 1
                  ? `Next Section → (${step + 2}/${totalSteps})`
                  : "Build the Algorithm →"}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Deep Learn Session — Testing Sandwich flow ─────────────────────────────
function DeepLearnSession({
  topic,
  lectureTitle,
  objectives,
  blockId,
  blockObjectives,
  getBlockObjectives,
  lec,
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
  isFirstPass = true,
  initialPhase,
  initialBrainDump,
  initialBrainDumpFeedback,
  initialSaqAnswers,
  initialSaqFeedback,
  initialSaqQuestions,
  initialStructureSaqQuestions,
  initialStructureSaqAnswers,
  initialStructureSaqEvals,
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
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const [patientCase, setPatientCase] = useState(() => {
    if (initialPatientCase == null) return null;
    const e = extractCaseAndFocusFromRaw(initialPatientCase);
    return e.case ? e : null;
  });
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
  const [saqEvals, setSaqEvals] = useState(initialSaqFeedback ?? {});
  const [saqEvaluatingIdx, setSaqEvaluatingIdx] = useState(null);
  const [saqQuestions, setSaqQuestions] = useState(initialSaqQuestions ?? []);
  const [structureSaqQuestions, setStructureSaqQuestions] = useState(initialStructureSaqQuestions ?? []);
  const [structureSaqAnswers, setStructureSaqAnswers] = useState(initialStructureSaqAnswers ?? {});
  const [structureSaqEvals, setStructureSaqEvals] = useState(initialStructureSaqEvals ?? {});
  const [structureSaqAttempts, setStructureSaqAttempts] = useState({});
  const [structureSaqEvaluatingIdx, setStructureSaqEvaluatingIdx] = useState(null);
  const [recallAnswer, setRecallAnswer] = useState(initialRecallAnswer || "");
  const [recallFeedback, setRecallFeedback] = useState(initialRecallFeedback ?? null);
  const [recallStep, setRecallStep] = useState("read");
  const [recallText, setRecallText] = useState("");
  const [recallResult, setRecallResult] = useState(null);
  const [algorithmText, setAlgorithmText] = useState(initialAlgorithmText || "");
  const [algorithmFeedback, setAlgorithmFeedback] = useState(initialAlgorithmFeedback ?? null);
  const [algorithmDoneOnIpad, setAlgorithmDoneOnIpad] = useState(false);
  const [mcqSelected, setMcqSelected] = useState(null);
  const [mcqFeedback, setMcqFeedback] = useState(null);
  const [mcqResults, setMcqResults] = useState(initialMcqResults ?? []);
  const [confidenceLevel, setConfidenceLevel] = useState(null);

  const [manualObjectives, setManualObjectives] = useState([]);
  const [manualInput, setManualInput] = useState("");
  const [usingManualObjectives, setUsingManualObjectives] = useState(false);

  const activityStrLec = lec ? `${(lec.lectureType || "LEC")} ${lec.lectureNumber ?? ""}`.trim() : "";
  const normActivityStr = (s) => (s || "").toUpperCase().replace(/\s+/g, "").trim();
  const resolvedObjectives = useMemo(() => {
    if (objectives?.length > 0) return objectives;
    if (manualObjectives?.length > 0) return manualObjectives;
    if (lec?.id && (blockObjectives || []).length > 0) {
      const fromBlock = (blockObjectives || []).filter(
        (o) =>
          o.linkedLecId === lec.id ||
          (lec.mergedFrom || []).some((m) => m && (m.id || m) === o.linkedLecId) ||
          (String(o.lectureNumber) === String(lec.lectureNumber) &&
            String(o.lectureType || "LEC").toUpperCase() === String(lec.lectureType || "LEC").toUpperCase()) ||
          (activityStrLec && normActivityStr(o.activity) === normActivityStr(activityStrLec))
      );
      if (fromBlock.length > 0) return fromBlock;
    }
    return [];
  }, [objectives, manualObjectives, lec?.id, lec?.mergedFrom, lec?.lectureNumber, lec?.lectureType, activityStrLec, blockObjectives]);
  const walkthroughObjectives = useMemo(() => {
    const list = resolvedObjectives || [];
    if (!lec?.id) return list;
    const forThisLec = list.filter(
      (o) =>
        o.linkedLecId === lec.id ||
        (lec.mergedFrom || []).some((m) => m && (m.id || m) === o.linkedLecId)
    );
    if (forThisLec.length > 0) return forThisLec;
    const actStr = lec ? `${(lec.lectureType || "LEC")} ${lec.lectureNumber ?? ""}`.trim() : "";
    const normAct = (s) => (s || "").toUpperCase().replace(/\s+/g, "").trim();
    const fromBlock = (blockObjectives || []).filter(
      (o) =>
        o.linkedLecId === lec.id ||
        (lec.mergedFrom || []).some((m) => m && (m.id || m) === o.linkedLecId) ||
        (String(o.lectureNumber) === String(lec.lectureNumber) &&
          String(o.lectureType || "LEC").toUpperCase() === String(lec.lectureType || "LEC").toUpperCase()) ||
        (actStr && normAct(o.activity) === normAct(actStr))
    );
    if (fromBlock.length > 0) return fromBlock;
    return list;
  }, [resolvedObjectives, lec?.id, lec?.mergedFrom, lec?.lectureNumber, lec?.lectureType, blockObjectives]);

  // Scores
  const [preSAQScore, setPreSAQScore] = useState(initialPreSAQScore ?? null);
  const [postMCQScore, setPostMCQScore] = useState(null);

  const PHASE_ORDER = [
    "brainDump",
    "patientCase",
    "structureFunction",
    "algorithmDraw",
    "readRecall",
    "mcq",
    "summary",
  ];

  const [visitedPhases, setVisitedPhases] = useState(() => {
    const order = ["brainDump", "patientCase", "structureFunction", "algorithmDraw", "readRecall", "mcq", "summary"];
    const idx = initialPhase ? order.indexOf(initialPhase) : 0;
    const upTo = idx >= 0 ? idx + 1 : 1;
    return new Set(order.slice(0, upTo));
  });

  const advancePhase = (nextPhase) => {
    setVisitedPhases((prev) => new Set([...prev, phase, nextPhase]));
    setPhase(nextPhase);
  };

  const goBackPhase = () => {
    const currentIndex = PHASE_ORDER.indexOf(phase);
    if (currentIndex > 0) {
      setPhase(PHASE_ORDER[currentIndex - 1]);
    }
  };

  // Persist after every phase change
  useEffect(() => {
    if (!sessionId || !saveProgress || phase === "summary") return;
    saveProgress(sessionId, {
      sessionId,
      blockId,
      lecId: resolvedObjectives?.[0]?.linkedLecId ?? topic?.lecId,
      lectureTitle,
      topic: typeof topic === "object" ? topic?.label : topic,
      objectives: resolvedObjectives,
      lectureContent,
      phase,
      brainDump,
      brainDumpFeedback,
      saqAnswers,
      saqFeedback: saqEvals,
      saqQuestions,
      structureSaqQuestions,
      structureSaqAnswers,
      structureSaqEvals,
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

  // First-pass fallback: skip "read" step and go straight to recall (student was taught in Phase 4)
  useEffect(() => {
    if (phase === "readRecall" && recallPrompts.length === 0) {
      setRecallStep("recall");
    }
  }, [phase, recallPrompts.length]);

  useEffect(() => {
    console.log("DeepLearn launched with content length:", (lectureContent || "").length, "objectives:", (resolvedObjectives || []).length);
  }, []);

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

  const objList = (resolvedObjectives || [])
    .slice(0, 15)
    .map((o, i) => `${i + 1}. ${o.objective}`)
    .join("\n");

  const isAnatomyContent = useMemo(() => {
    const subject = (resolvedObjectives || []).map((o) => o.objective || o.text || "").join(" ").toLowerCase();
    const text = ((lectureTitle || "") + " " + subject).toLowerCase();
    return /anatomy|histolog|morpholog|structural|vertebr|spinal|muscl|nerve|vessel|bone|joint/.test(text);
  }, [lectureTitle, resolvedObjectives]);

  const algorithmPhaseConfig = useMemo(
    () =>
      isAnatomyContent
        ? {
            title: "Map the Structure",
            subtitle: "STRUCTURAL SYNTHESIS",
            instruction: `Without looking anything up, map out the key structures and their relationships for ${lectureTitle || "this topic"}. Draw connections: what connects to what, what supplies what, what passes through what.`,
            overviewHelp: "The overview below is a scaffold of key structures and relationships from the lecture — open it if you're stuck or want a starting point.",
            placeholder: `Map it out here...
Example format:
Structure A → attaches to B → supplied by C
Nerve X → originates from Y → innervates Z
Region 1 contains: (list structures)`,
            hint: "Structural overview",
            buttonLabel: "Check My Map →",
            evalPrompt: `Evaluate this anatomy structure map. Check if key structures, relationships, nerve supplies, and clinical correlations are correctly identified. Be encouraging but specific about gaps.`,
          }
        : {
            title: "Draw the Algorithm",
            subtitle: "ALGORITHM SYNTHESIS",
            instruction: `Without looking anything up, write out the decision algorithm for ${lectureTitle || "this topic"}. If you can't draw it from memory, you don't know it yet.`,
            overviewHelp: "The overview below is a scaffold from the lecture — open it if you're stuck or want a starting point.",
            placeholder: "Write your algorithm here... Start point → Decision 1 → Yes/No branches → Endpoints",
            hint: "Algorithm structure",
            buttonLabel: "Check My Algorithm →",
            evalPrompt: `Evaluate this clinical decision algorithm. Check if the key decision points, branches, and endpoints are correct. Be specific about what's missing or wrong.`,
          },
    [isAnatomyContent, lectureTitle]
  );

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

  const normalizeSaqQuestions = (raw) => {
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => {
      if (typeof item === "string") return { question: item, keyPoints: [], objectiveText: "" };
      const question = item?.q ?? item?.question ?? "";
      const kp = item?.keyPoints;
      const keyPoints = Array.isArray(kp) ? kp : (typeof kp === "string" ? kp.split(/,\s*/).map((s) => s.trim()) : []);
      const objectiveText = item?.objectiveText ?? "";
      return { question, keyPoints, objectiveText };
    });
  };

  // PHASE 1: Brain Dump + SAQ Priming (retry a few times; fallback to generateSAQs so questions show without user clicking Retry)
  const initBrainDump = async () => {
    setLoading(true);
    const maxAttempts = 3;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let questions = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
          const raw = parsed?.questions || [];
          questions = normalizeSaqQuestions(raw);
          if (questions.length > 0) break;
        } catch (err) {
          console.warn("initBrainDump attempt", attempt, err);
          if (attempt < maxAttempts) await delay(1200 * attempt);
        }
      }
      if (questions.length > 0) {
        setSaqQuestions(questions);
      } else {
        try {
          const saqs = await generateSAQs(lectureContent, resolvedObjectives || [], lectureTitle, null);
          const fallback = normalizeSaqQuestions(saqs);
          if (fallback.length > 0) {
            setSaqQuestions(fallback);
          } else {
            setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
          }
        } catch (fallbackErr) {
          console.error("initBrainDump fallback generateSAQs error:", fallbackErr);
          setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
        }
      }
    } catch (err) {
      console.error("initBrainDump SAQ generation error:", err);
      setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
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
      let evalData = safeJSONLocal(raw);
      if (!evalData || Object.keys(evalData).length === 0) {
        const first = evalText.indexOf("{");
        const last = evalText.lastIndexOf("}");
        if (first !== -1 && last > first) {
          try {
            evalData = JSON.parse(evalText.slice(first, last + 1));
          } catch {
            evalData = null;
          }
        }
      }
      if (!evalData || Object.keys(evalData).length === 0) {
        const scoreMatch = evalText.match(/"readinessScore"\s*:\s*(\d+)/i) || evalText.match(/"score"\s*:\s*(\d+)/i);
        const msgMatch = evalText.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const strengthsMatch = evalText.match(/"strengths"\s*:\s*\[([^\]]*)\]/);
        const gapsMatch = evalText.match(/"gaps"\s*:\s*\[([^\]]*)\]/);
        const readiness = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 0;
        const message = msgMatch ? msgMatch[1].replace(/\\"/g, '"').slice(0, 300) : "";
        const strengths = strengthsMatch
          ? strengthsMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/^"|"$/g, "").replace(/\\"/g, '"')) ?? []
          : [];
        const gaps = gapsMatch
          ? gapsMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/^"|"$/g, "").replace(/\\"/g, '"')) ?? []
          : [];
        if (readiness > 0 || message || strengths.length > 0 || gaps.length > 0) {
          evalData = { readinessScore: readiness, message, strengths, gaps, misconceptions: [] };
        }
      }
      if (evalData && Object.keys(evalData).length > 0) {
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
          message: "The evaluation response couldn’t be read. You can continue to the questions below.",
        });
      }
      const saqs = await generateSAQs(lectureContent, resolvedObjectives || [], lectureTitle, null);
      const next = normalizeSaqQuestions(saqs);
      setSaqQuestions((prev) => (next.length > 0 ? next : prev.length > 0 ? prev : []));
    } catch (err) {
      console.error("submitBrainDump error:", err);
      setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
    } finally {
      setLoading(false);
    }
  };

  const submitSAQ = async (idx, answer) => {
    if (!answer?.trim()) return;
    setSaqEvaluatingIdx(idx);
    try {
      const q = saqQuestions[idx];
      const questionText =
        typeof q === "object" && q?.question != null ? q.question : q;
      const keyPoints =
        (typeof q === "object" && Array.isArray(q?.keyPoints) && q.keyPoints) ||
        [];
      const result = await evaluateSAQAnswer(
        questionText,
        answer,
        keyPoints,
        lectureContent
      );
      setSaqEvals((prev) => {
        const next = { ...prev, [idx]: result };
        const scores = Object.values(next)
          .map((r) => r?.score)
          .filter((s) => s != null && typeof s === "number");
        if (scores.length === saqQuestions.length) {
          setPreSAQScore(
            Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          );
        }
        return next;
      });
    } finally {
      setSaqEvaluatingIdx(null);
    }
  };

  const submitStructureSAQ = async (idx, answer) => {
    if (!answer?.trim()) return;
    setStructureSaqEvaluatingIdx(idx);
    try {
      const q = structureSaqQuestions[idx];
      const questionText =
        typeof q === "object" && (q?.question != null || q?.q != null) ? (q?.question ?? q?.q) : q;
      const keyPoints =
        (typeof q === "object" && Array.isArray(q?.keyPoints) && q.keyPoints) ||
        (typeof q?.keyPoints === "string" ? q.keyPoints.split(/,\s*/).map((s) => s.trim()) : []);
      const result = await evaluateSAQAnswer(
        questionText,
        answer,
        keyPoints,
        lectureContent,
        (structureSaqAttempts[idx] || 0) + 1
      );
      if (result.score !== null && result.score !== undefined) {
        setStructureSaqAttempts((prev) => ({ ...prev, [idx]: (prev[idx] || 0) + 1 }));
        setStructureSaqEvals((prev) => ({ ...prev, [idx]: result }));
      } else {
        setStructureSaqEvals((prev) => ({
          ...prev,
          [idx]: { score: null, feedback: result.feedback || "Could not evaluate — try again.", hint: "", teaching: "", clinical: "" },
        }));
      }
    } finally {
      setStructureSaqEvaluatingIdx(null);
    }
  };

  const advanceFromBrainDump = async () => {
    advancePhase("patientCase");
    setPatientCase(null);
    setLoadingTooLong(false);
    setLoading(true);
    try {
      const structResult = await geminiJSON(
        `Create a structural and functional breakdown for: ${lectureTitle}\n\n` +
          `Objectives:\n${objList}\n\n` +
          `Follow this hierarchy: Patient Complaint → Organ → Architecture → Cell → Protein → Clinical Application\n\n` +
          `For each level, explain the "Why?" — how does it connect to patient care?\n` +
          `Apply the "Make Me Care" test — only include facts that directly explain patient presentations.\n\n` +
          `Return ONLY JSON:\n` +
          `{"levels":[{"level":"Patient Complaint","content":"Patient presents with X because...","whyItMatters":"This matters clinically because..."},...],"keyMechanism":"The core mechanism connecting all levels is..."}`,
        2000
      );
      setStructureContent(structResult);
    } catch (err) {
      console.error("advanceFromBrainDump structure content failed:", err);
      setStructureContent({
        levels: [{ level: "Overview", content: "Structure breakdown could not be generated. You can continue with the patient case and questions below.", whyItMatters: "Use the lecture objectives to guide your study." }],
        keyMechanism: "Proceed with the patient case and SAQs to reinforce the material.",
      });
    } finally {
      setLoading(false);
    }
  };

  const patientCaseFallback = () => ({
    case: `A 45-year-old patient presents with findings relevant to ${lectureTitle || "today's lecture"}. As you study the material, consider how the anatomical structures and physiological mechanisms covered explain this patient's presentation and symptoms.`,
    focus: "Think about how the core concepts from this lecture explain this patient's presentation.",
  });

  useEffect(() => {
    if (phase !== "patientCase") return;
    if (patientCase?.case) return;

    if (lec?.teachingMap?.clinicalHook) {
      setPatientCase({
        case: lec.teachingMap.clinicalHook,
        focus: "Think about how the core concepts from this lecture explain this patient's presentation.",
      });
      return;
    }

    let cancelled = false;

    const load = async () => {
        console.log("DeepLearn patient case load — content length:", (lectureContent || "").length, "objectives:", (resolvedObjectives || []).length);

      if (!lectureContent || lectureContent.length < 100) {
        console.warn("DeepLearn: lecture content too short, using fallback patient case");
        if (!cancelled) {
          setPatientCase({
            case: `This lecture has limited uploaded content. A 45-year-old patient presents with findings related to ${lectureTitle || "today's topic"}. Use your knowledge of the subject to work through the case.`,
            focus: "Apply what you know about this topic to explain the clinical presentation.",
          });
        }
        return;
      }

      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          console.warn("Patient case generation timed out — using fallback");
          setPatientCase(patientCaseFallback());
        }
      }, 15000);

      try {
        const result = await generatePatientCase(lectureContent, resolvedObjectives || [], lectureTitle);
        if (!cancelled) {
          clearTimeout(timeoutId);
          const extracted = extractCaseAndFocusFromRaw(result);
          setPatientCase(extracted.case ? extracted : patientCaseFallback());
        }
      } catch (err) {
        console.error("Patient case failed:", err);
        if (!cancelled) {
          clearTimeout(timeoutId);
          setPatientCase(patientCaseFallback());
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [phase, lectureTitle, lectureContent, resolvedObjectives, lec?.teachingMap?.clinicalHook]);

  useEffect(() => {
    if (phase === "structureFunction" && resolvedObjectives.length === 0 && (blockObjectives || []).length > 0 && !manualInput) {
      const text = (blockObjectives || []).map((o) => (o.objective || o.text || "").trim()).filter(Boolean).join("\n");
      if (text) setManualInput(text);
    }
  }, [phase, resolvedObjectives.length, blockObjectives, manualInput]);

  useEffect(() => {
    if (resolvedObjectives.length === 0 && (blockObjectives || []).length > 0 && !manualInput && lec?.id) {
      const forThisLec = (blockObjectives || []).filter(
        (o) => o.linkedLecId === lec.id || (lec.mergedFrom || []).some((m) => m && (m.id || m) === o.linkedLecId)
      );
      const text = forThisLec.map((o) => (o.objective || o.text || "").trim()).filter(Boolean).join("\n");
      if (text) setManualInput(text);
    }
  }, [resolvedObjectives.length, blockObjectives, manualInput, lec?.id, lec?.mergedFrom]);

  useEffect(() => {
    if (phase !== "patientCase" || patientCase?.case) {
      setLoadingTooLong(false);
      return;
    }
    const t = setTimeout(() => setLoadingTooLong(true), 8000);
    return () => clearTimeout(t);
  }, [phase, patientCase?.case]);

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
      advancePhase("algorithmDraw");
    } finally {
      setLoading(false);
    }
  };

  const submitAlgorithm = async () => {
    if (!algorithmText.trim()) return;
    setLoading(true);
    try {
      const fb = await geminiJSON(
        `A student was asked to ${isAnatomyContent ? "map key structures and relationships for" : "write out the diagnostic algorithm for"}: ${lectureTitle}\n\n` +
          `The correct reference:\n${JSON.stringify(algorithm?.steps || algorithm)}\n\n` +
          `Student's attempt:\n"${algorithmText}"\n\n` +
          `${algorithmPhaseConfig.evalPrompt}\n\n` +
          `Return ONLY JSON:\n` +
          `{"score":75,"correct":["got entry point","identified branch 1"],"missed":["missed branch 2","forgot endpoint"],"feedback":"Good structure but..."}`,
        600
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
      advancePhase("readRecall");
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
        600
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
      advancePhase("mcq");
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
      advancePhase("summary");
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
        <style>{`
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
`}</style>
      </div>
    );

  const phaseIcons = {
    brainDump: "🧠",
    patientCase: "🏥",
    structureFunction: "🔬",
    algorithmDraw: "📊",
    readRecall: "📖",
    mcq: "✅",
  };
  const phaseLabels = {
    brainDump: "Prime",
    patientCase: "Patient",
    structureFunction: "Structure",
    algorithmDraw: "Algorithm",
    readRecall: "Recall",
    mcq: "Apply",
  };

  const PhaseBar = () => (
    <div style={{ display: "flex", gap: 4, marginBottom: 20, overflowX: "auto" }}>
      {PHASE_ORDER.filter((p) => p !== "summary").map((p) => {
        const isActive = phase === p;
        const isVisited = visitedPhases.has(p);
        const isFuture = !isVisited && !isActive;

        return (
          <button
            key={p}
            type="button"
            onClick={() => {
              if (isVisited || isActive) setPhase(p);
            }}
            disabled={isFuture}
            title={
              isFuture
                ? "Complete previous phases to unlock"
                : isVisited
                  ? `Return to ${phaseLabels[p]}`
                  : "Current phase"
            }
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "10px 16px",
              borderRadius: 10,
              cursor: isFuture ? "not-allowed" : "pointer",
              opacity: isFuture ? 0.35 : 1,
              border: "2px solid " + (isActive ? tc : isVisited ? T.border1 : T.border2),
              background: isActive ? tc + "15" : isVisited ? T.inputBg : T.cardBg,
              transition: "all 0.15s",
              position: "relative",
              flex: 1,
              minWidth: 60,
            }}
            onMouseEnter={(e) => {
              if (!isFuture && !isActive) {
                e.currentTarget.style.borderColor = tc + "80";
                e.currentTarget.style.background = tc + "08";
              }
            }}
            onMouseLeave={(e) => {
              if (!isFuture && !isActive) {
                e.currentTarget.style.borderColor = isVisited ? T.border1 : T.border2;
                e.currentTarget.style.background = isVisited ? T.inputBg : T.cardBg;
              }
            }}
          >
            {isVisited && !isActive && (
              <div
                style={{
                  position: "absolute",
                  top: -5,
                  right: -5,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: T.statusGood,
                  border: "2px solid " + T.cardBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 8,
                  color: "#fff",
                  fontWeight: 900,
                }}
              >
                ✓
              </div>
            )}
            <span style={{ fontSize: 20 }}>{phaseIcons[p]}</span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: isActive ? 700 : 400,
                color: isActive ? tc : isVisited ? T.text2 : T.text3,
              }}
            >
              {phaseLabels[p]}
            </span>
          </button>
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
          {getPatientCaseText(patientCase)}
        </div>
        {patientCase?.clinicalClues?.length > 0 && (
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {PHASE_ORDER.indexOf(phase) > 0 && phase !== "summary" && (
              <button
                type="button"
                onClick={goBackPhase}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text3;
                }}
              >
                ← Previous Phase
              </button>
            )}
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
              PHASE {PHASE_ORDER.indexOf(phase) + 1} OF {PHASE_ORDER.length - 1} · ACTIVE RECALL PRIMING
            </div>
            {PHASE_ORDER.indexOf(phase) === 0 && <div />}
          </div>
          <div>
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
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginTop: 6 }}>
              A few sentences are enough — key terms and main ideas. The evaluation will point out gaps; you don’t need to write an essay.
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
              <div style={{ fontFamily: MONO, color: T.text2, fontSize: 11, marginBottom: 4 }}>
                Short answers are fine — 1–2 sentences per question. We’re finding gaps before you study.
              </div>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, marginBottom: 8, fontStyle: "italic" }}>
                Tip: Cover each part the question asks for (e.g. attachments, innervation, actions). A sentence or two per part is enough; feedback will tell you what to add.
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
                    {idx + 1}. {typeof q === "object" && q?.question != null ? q.question : q}
                  </div>
                  <textarea
                    value={saqAnswers[idx] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSaqAnswers((prev) => ({ ...prev, [idx]: val }));
                      setSaqEvals((prev) => ({ ...prev, [idx]: null }));
                    }}
                    onBlur={async (e) => {
                      const val = e.target.value;
                      if (val.trim().length < 10) return;
                      await submitSAQ(idx, val);
                    }}
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
                  {saqEvals?.[idx] && (
                    <div
                      style={{
                        background:
                          saqEvals[idx].score >= 70
                            ? T.statusGoodBg
                            : saqEvals[idx].score >= 40
                              ? T.statusWarnBg
                              : T.statusBadBg,
                        border:
                          "1px solid " +
                          (saqEvals[idx].score >= 70
                            ? T.statusGoodBorder
                            : saqEvals[idx].score >= 40
                              ? T.statusWarnBorder
                              : T.statusBadBorder),
                        borderRadius: 8,
                        padding: "10px 12px",
                        marginTop: 8,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: MONO,
                          fontWeight: 700,
                          color:
                            saqEvals[idx].score == null
                              ? T.text3
                              : saqEvals[idx].score >= 70
                                ? T.statusGood
                                : saqEvals[idx].score >= 40
                                  ? T.statusWarn
                                  : T.statusBad,
                        }}
                      >
                        {saqEvals[idx].score != null ? `${saqEvals[idx].score}%` : ""}
                      </span>
                      {saqEvals[idx].score == null && (
                        <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginLeft: 8 }}>
                          {saqEvals[idx].feedback || "Evaluation didn’t return a score."} Evaluation can take 10–15 seconds; click Retry if it didn’t load.
                        </span>
                      )}
                      {saqEvals[idx].score != null && saqEvals[idx].feedback && (
                        <span
                          style={{
                            fontFamily: MONO,
                            color: T.text2,
                            fontSize: 11,
                            marginLeft: 10,
                          }}
                        >
                          · {saqEvals[idx].feedback}
                        </span>
                      )}
                      {saqEvals[idx].score == null && (
                        <button
                          type="button"
                          disabled={saqEvaluatingIdx === idx}
                          onClick={() => {
                            setSaqEvals((prev) => {
                              const next = { ...prev };
                              delete next[idx];
                              return next;
                            });
                            submitSAQ(idx, saqAnswers?.[idx] ?? "");
                          }}
                          style={{
                            marginLeft: 12,
                            fontFamily: MONO,
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 6,
                            border: "1px solid " + T.border1,
                            background: T.inputBg,
                            color: T.text2,
                            cursor: saqEvaluatingIdx === idx ? "wait" : "pointer",
                            opacity: saqEvaluatingIdx === idx ? 0.8 : 1,
                          }}
                        >
                          {saqEvaluatingIdx === idx ? "Evaluating…" : "Retry"}
                        </button>
                      )}
                    </div>
                  )}
                  {saqAnswers?.[idx]?.trim().length >= 10 && !saqEvals?.[idx] && (
                    <div
                      style={{
                        fontFamily: MONO,
                        color: T.text3,
                        fontSize: 10,
                        marginTop: 6,
                        fontStyle: "italic",
                      }}
                    >
                      {saqEvaluatingIdx === idx ? "Evaluating… (may take 10–15 s)" : "Click elsewhere to evaluate →"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {saqQuestions.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: "16px" }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>Questions could not be generated.</div>
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  try {
                    const saqs = await generateSAQs(lectureContent, resolvedObjectives || [], lectureTitle, null);
                    const next = normalizeSaqQuestions(saqs);
                    setSaqQuestions((prev) => (next.length > 0 ? next : prev.length > 0 ? prev : []));
                  } catch {
                    setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "10px 20px",
                  borderRadius: 8,
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: loading ? "default" : "pointer",
                }}
              >
                {loading ? "Generating…" : "⟳ Retry"}
              </button>
            </div>
          )}

          {brainDumpFeedback && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                The patient case will load on the next screen (may take a few seconds).
              </div>
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
                  width: "100%",
                }}
              >
                {loading ? "Preparing patient case..." : "Meet Your Patient →"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase 2: Patient Case */}
      {phase === "patientCase" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {PHASE_ORDER.indexOf(phase) > 0 && phase !== "summary" && (
              <button
                type="button"
                onClick={goBackPhase}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text3;
                }}
              >
                ← Previous Phase
              </button>
            )}
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
              PHASE {PHASE_ORDER.indexOf(phase) + 1} OF {PHASE_ORDER.length - 1} · CLINICAL ANCHOR
            </div>
            {PHASE_ORDER.indexOf(phase) === 0 && <div />}
          </div>
          <div>
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
              minHeight: 80,
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
            {!patientCase?.case ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  padding: "20px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: T.text3,
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "2px solid " + tc,
                      borderTopColor: "transparent",
                      animation: "spin 0.8s linear infinite",
                    }}
                  />
                  <span style={{ fontFamily: MONO, fontSize: 12, color: T.text3 }}>
                    Generating patient case...
                  </span>
                </div>
                {loadingTooLong && (
                  <button
                    onClick={() => {
                      setPatientCase(null);
                      setLoadingTooLong(false);
                      generatePatientCase(lectureContent, resolvedObjectives || [], lectureTitle)
                        .then((result) => {
                          const extracted = extractCaseAndFocusFromRaw(result);
                          setPatientCase(extracted.case ? extracted : { case: `A patient presents with findings relevant to ${lectureTitle || "today's lecture"}.`, focus: "Consider how the core concepts explain this presentation." });
                        })
                        .catch(() =>
                          setPatientCase({
                            case: `A patient presents with findings relevant to ${lectureTitle || "today's lecture"}.`,
                            focus: "Consider how the core concepts explain this presentation.",
                          })
                        );
                    }}
                    style={{
                      background: tc,
                      border: "none",
                      color: "#fff",
                      padding: "8px 18px",
                      borderRadius: 8,
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ↻ Retry
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  fontFamily: SERIF,
                  color: T.text1,
                  fontSize: 16,
                  lineHeight: 1.75,
                  fontWeight: 500,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "break-word",
                }}
              >
                {getPatientCaseText(patientCase)}
              </div>
            )}
          </div>

          <div
            style={{
              background: T.statusWarnBg,
              border: "1px solid " + (T.statusWarnBorder || T.statusWarn),
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                color: T.statusWarn,
                fontSize: 10,
                letterSpacing: 1.5,
                marginBottom: 6,
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
              {patientCase?.focus || "Look for the clinical clues embedded in this presentation. As you study today, keep asking: \"How does this explain what's happening to my patient?\""}
            </div>
          </div>

          <button
            onClick={() => advancePhase("structureFunction")}
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {PHASE_ORDER.indexOf(phase) > 0 && phase !== "summary" && (
              <button
                type="button"
                onClick={goBackPhase}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text3;
                }}
              >
                ← Previous Phase
              </button>
            )}
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
              PHASE {PHASE_ORDER.indexOf(phase) + 1} OF {PHASE_ORDER.length - 1} · THE NO-GAPS MODEL
            </div>
            {PHASE_ORDER.indexOf(phase) === 0 && <div />}
          </div>
          <div>
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
              patient's presentation?" Answer each question, then connect it to your patient's presentation.
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

          {resolvedObjectives.length === 0 && (!structureSaqQuestions || structureSaqQuestions.length === 0) && !loading ? (
            <div
              style={{
                padding: 20,
                background: "#fff8ee",
                border: "1.5px solid " + (T.statusWarn || "#f59e0b"),
                borderRadius: 12,
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 14, color: "#555", marginBottom: 8 }}>Enter objectives to generate questions:</div>
              <textarea
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder={"One per line, e.g.:\nDescribe the key structures and their function\nIdentify the main clinical correlations\nExplain the underlying mechanism"}
                style={{
                  width: "100%",
                  minHeight: 100,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1.5px solid #ddd",
                  fontFamily: MONO,
                  fontSize: 13,
                  resize: "vertical",
                  marginBottom: 10,
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={async () => {
                  const lines = manualInput
                    .split("\n")
                    .map((l) => l.trim())
                    .filter((l) => l.length > 5)
                    .map((text, i) => ({
                      id: `manual-${i}`,
                      text,
                      objective: text,
                      linkedLecId: lec?.id,
                      sourceFile: lec?.id,
                      lectureType: lec?.lectureType,
                      lectureNumber: lec?.lectureNumber,
                      status: "untested",
                      bloom_level: 2,
                      bloom_level_name: "Understand",
                    }));
                  if (lines.length === 0) return;
                  setManualObjectives(lines);
                  setUsingManualObjectives(true);
                  setLoading(true);
                  try {
                    const saqs = await generateSAQs(lectureContent, lines, lectureTitle, patientCase?.case ?? null);
                    const normalized = normalizeSaqQuestions(saqs);
                    setStructureSaqQuestions(normalized.length > 0 ? normalized : []);
                  } catch {
                    setStructureSaqQuestions([]);
                  } finally {
                    setLoading(false);
                  }
                }}
                style={{
                  padding: "10px 20px",
                  background: T.statusWarn || "#f59e0b",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ✓ Generate Questions From These
              </button>
            </div>
          ) : structureSaqQuestions && structureSaqQuestions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1.5 }}>
                3 OBJECTIVE-BASED CHECK
              </div>
              <div style={{ fontFamily: MONO, color: T.text2, fontSize: 11, marginBottom: 4 }}>
                Aim for 2–3 sentences covering the main points asked (e.g. attachments, innervation, actions). You don’t need every detail — hit the key concepts to get feedback.
              </div>
              {structureSaqQuestions.map((q, idx) => (
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
                    {idx + 1}. {typeof q === "object" && (q?.question != null || q?.q != null) ? (q?.question ?? q?.q) : q}
                  </div>
                  <textarea
                    value={structureSaqAnswers[idx] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStructureSaqAnswers((prev) => ({ ...prev, [idx]: val }));
                      setStructureSaqEvals((prev) => ({ ...prev, [idx]: null }));
                    }}
                    onBlur={async (e) => {
                      const val = e.target.value;
                      if (val.trim().length < 10) return;
                      await submitStructureSAQ(idx, val);
                    }}
                    placeholder="Your answer..."
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
                  {structureSaqEvals?.[idx] &&
                    (() => {
                      const result = structureSaqEvals[idx];
                      const attempts = structureSaqAttempts[idx] || 1;
                      const score = result.score;
                      const isPassing = score != null && score >= 65;
                      return (
                        <div style={{ marginTop: 8 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontFamily: MONO,
                              color: isPassing ? T.statusGood : T.statusBad,
                              marginBottom: 6,
                            }}
                          >
                            {score != null ? `${score}%` : ""}
                            {result.feedback && ` · ${result.feedback}`}
                          </div>
                          {!isPassing && attempts < 3 && result.hint && (
                            <div
                              style={{
                                padding: "10px 14px",
                                background: "#fffbf0",
                                borderLeft: "3px solid " + T.statusWarn,
                                borderRadius: "0 8px 8px 0",
                                fontSize: 13,
                                color: "#554",
                                fontStyle: "italic",
                              }}
                            >
                              💭 {result.hint}
                            </div>
                          )}
                          {!isPassing && attempts >= 3 && result.teaching && (
                            <div
                              style={{
                                padding: "10px 14px",
                                background: "#f0f7ff",
                                borderLeft: "3px solid " + (T.statusProgress || tc),
                                borderRadius: "0 8px 8px 0",
                                fontSize: 13,
                                color: "#334",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: T.statusProgress || tc,
                                  marginBottom: 4,
                                  fontFamily: MONO,
                                }}
                              >
                                ✓ AFTER 3 ATTEMPTS — HERE'S WHAT TO KNOW
                              </div>
                              {result.teaching}
                              {result.clinical && (
                                <div style={{ marginTop: 8, fontSize: 12, color: T.statusWarn, fontStyle: "italic" }}>
                                  💡 {result.clinical}
                                </div>
                              )}
                            </div>
                          )}
                          {!isPassing && attempts < 3 && (
                            <button
                              type="button"
                              onClick={() => {
                                setStructureSaqAnswers((prev) => ({ ...prev, [idx]: "" }));
                                setStructureSaqEvals((prev) => {
                                  const n = { ...prev };
                                  delete n[idx];
                                  return n;
                                });
                              }}
                              style={{
                                marginTop: 8,
                                padding: "6px 16px",
                                background: "none",
                                border: "1px solid " + T.statusWarn,
                                borderRadius: 8,
                                color: T.statusWarn,
                                fontSize: 12,
                                fontFamily: MONO,
                                cursor: "pointer",
                              }}
                            >
                              ↩ Try again ({3 - attempts} attempts left)
                            </button>
                          )}
                        </div>
                      );
                    })()}
                </div>
              ))}
            </div>
          ) : loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: "20px" }}>
              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>Generating questions…</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: "20px" }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>Questions could not be generated.</div>
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  try {
                    const saqs = await generateSAQs(lectureContent, resolvedObjectives || [], lectureTitle, patientCase?.case ?? null);
                    const normalized = normalizeSaqQuestions(saqs);
                    setStructureSaqQuestions(normalized.length > 0 ? normalized : []);
                  } catch {
                    setStructureSaqQuestions([]);
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                style={{
                  background: tc,
                  border: "none",
                  color: "#fff",
                  padding: "10px 20px",
                  borderRadius: 8,
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: loading ? "default" : "pointer",
                }}
              >
                ⟳ Retry
              </button>
            </div>
          )}

          {(() => {
            const allAttempted = structureSaqQuestions.length > 0 && structureSaqQuestions.every((_, i) => (structureSaqAttempts[i] || 0) >= 1);
            return (
              <>
                {!allAttempted && structureSaqQuestions.length > 0 && (
                  <div style={{ fontSize: 13, color: T.text3, fontFamily: MONO, marginBottom: 8 }}>
                    Answer all questions to continue
                  </div>
                )}
                <button
                  type="button"
                  onClick={advanceToAlgorithm}
                  disabled={loading || !allAttempted}
                  style={{
                    background: allAttempted ? tc : T.border1,
                    border: "none",
                    color: "#fff",
                    padding: "14px 0",
                    borderRadius: 10,
                    cursor: allAttempted && !loading ? "pointer" : "default",
                    fontFamily: SERIF,
                    fontSize: 16,
                    fontWeight: 900,
                  }}
                >
                  {loading ? "Building algorithm..." : "Build the Algorithm →"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* Phase 4: Algorithm Draw */}
      {phase === "algorithmDraw" && algorithm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {PHASE_ORDER.indexOf(phase) > 0 && phase !== "summary" && (
              <button
                type="button"
                onClick={goBackPhase}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text3;
                }}
              >
                ← Previous Phase
              </button>
            )}
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
              PHASE {PHASE_ORDER.indexOf(phase) + 1} OF {PHASE_ORDER.length - 1} · {algorithmPhaseConfig.subtitle}
            </div>
            {PHASE_ORDER.indexOf(phase) === 0 && <div />}
          </div>
          {usingManualObjectives && (
            <div style={{ fontSize: 11, color: T.statusProgress || tc, fontFamily: MONO, marginBottom: 8 }}>
              ◑ Using manually entered objectives ·
              <span
                role="button"
                tabIndex={0}
                onClick={() => {
                  setManualObjectives([]);
                  setUsingManualObjectives(false);
                  setManualInput("");
                }}
                onKeyDown={(e) => e.key === "Enter" && (setManualObjectives([]), setUsingManualObjectives(false), setManualInput(""))}
                style={{ cursor: "pointer", textDecoration: "underline", marginLeft: 4 }}
              >
                clear
              </span>
            </div>
          )}
          {isFirstPass && isAnatomyContent ? (
            walkthroughObjectives.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  background: "#fff8ee",
                  border: "1.5px solid " + (T.statusWarn || "#f59e0b"),
                  borderRadius: 12,
                  marginBottom: 20,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: T.statusWarn || "#d97706", fontFamily: MONO, marginBottom: 8 }}>
                  △ NO OBJECTIVES FOUND
                </div>
                <div style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
                  Objectives couldn't be loaded for this lecture. Enter them manually to continue — one per line, or paste them from your lecture slides.
                </div>
                <textarea
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder={"One per line, e.g.:\nDescribe the key structures and their function\nIdentify the main clinical correlations\nExplain the underlying mechanism"}
                  style={{
                    width: "100%",
                    minHeight: 120,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1.5px solid #ddd",
                    fontFamily: MONO,
                    fontSize: 13,
                    resize: "vertical",
                    marginBottom: 10,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const lines = manualInput
                      .split("\n")
                      .map((l) => l.trim())
                      .filter((l) => l.length > 5)
                      .map((text, i) => ({
                        id: `manual-${i}`,
                        text,
                        objective: text,
                        linkedLecId: lec?.id,
                        sourceFile: lec?.id,
                        lectureType: lec?.lectureType,
                        lectureNumber: lec?.lectureNumber,
                        status: "untested",
                        bloom_level: 2,
                        bloom_level_name: "Understand",
                      }));
                    if (lines.length === 0) return;
                    setManualObjectives(lines);
                    setUsingManualObjectives(true);
                  }}
                  style={{
                    padding: "10px 20px",
                    background: T.statusWarn || "#f59e0b",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  ✓ Use These Objectives
                </button>
              </div>
            ) : (
            <FirstPassWalkthrough
              lec={lec}
              lectureContent={lectureContent}
              lecObjectives={walkthroughObjectives}
              blockId={blockId}
              lecId={lec?.id}
              lectureNumber={lec?.lectureNumber}
              lectureType={lec?.lectureType}
              mergedFrom={lec?.mergedFrom || []}
              getBlockObjectives={getBlockObjectives}
              lectureTitle={lectureTitle || lec?.lectureTitle || lec?.fileName}
              patientCase={patientCase}
              T={T}
              tc={tc}
              onComplete={() => advanceToReadRecall()}
              sessionId={sessionId}
              deleteSession={deleteSession}
            />
            )
          ) : (
          <>
          <div>
            <div
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 28,
                fontWeight: 900,
                marginBottom: 12,
              }}
            >
              {algorithmPhaseConfig.title}
            </div>
            <p
              style={{
                fontFamily: MONO,
                color: T.text2,
                fontSize: 13,
                lineHeight: 1.7,
                marginBottom: 12,
              }}
            >
              {algorithmPhaseConfig.instruction}
            </p>
            {algorithmPhaseConfig.overviewHelp && (
              <p style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginBottom: 16 }}>
                {algorithmPhaseConfig.overviewHelp}
              </p>
            )}
          </div>

          <details
            open={isAnatomyContent}
            style={{
              marginBottom: 16,
              cursor: "pointer",
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
              {algorithmPhaseConfig.hint}
            </summary>
            <div style={{ marginTop: 12 }}>
              {isAnatomyContent && structureContent?.levels?.length > 0 ? (
                <>
                  <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, marginBottom: 10 }}>
                    Use this hierarchy as a scaffold: connect structures at each level (what attaches to what, what supplies what).
                  </div>
                  {(structureContent.levels || []).map((level, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 10,
                        paddingLeft: 8,
                        borderLeft: "3px solid " + tc,
                      }}
                    >
                      <div style={{ fontFamily: MONO, color: tc, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                        {level.level}
                      </div>
                      <div style={{ fontFamily: MONO, color: T.text2, fontSize: 11, lineHeight: 1.5 }}>
                        {level.content}
                      </div>
                      {level.whyItMatters && (
                        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, marginTop: 4, fontStyle: "italic" }}>
                          Why it matters: {level.whyItMatters}
                        </div>
                      )}
                    </div>
                  ))}
                  {structureContent.keyMechanism && (
                    <div style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 11, marginTop: 10, paddingTop: 8, borderTop: "1px solid " + T.border1 }}>
                      🧠 Key mechanism: {structureContent.keyMechanism}
                    </div>
                  )}
                </>
              ) : (algorithm?.entryPoint || (algorithm?.steps?.length > 0)) ? (
                <>
                  <div
                    style={{
                      fontFamily: MONO,
                      color: tc,
                      fontSize: 11,
                      fontWeight: 700,
                      marginBottom: 6,
                    }}
                  >
                    Entry: {algorithm?.entryPoint}
                  </div>
                  {(algorithm?.steps || []).map((step, i) => (
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
                  {algorithm?.memoryHook && (
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
                </>
              ) : (
                <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, lineHeight: 1.5 }}>
                  <div style={{ marginBottom: 8 }}>Use the example format in the box below. For the back, include:</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Major muscle groups and what they attach to</li>
                    <li>Nerves (e.g. dorsal rami, nerve supply to muscles)</li>
                    <li>Regions (e.g. cervical, thoracic, lumbar) and what they contain</li>
                  </ul>
                  <div style={{ marginTop: 8 }}>Example: <span style={{ color: T.text2 }}>Latissimus dorsi → attaches to spine and humerus → supplied by thoracodorsal nerve</span></div>
                </div>
              )}
            </div>
          </details>

          <textarea
            value={algorithmText}
            onChange={(e) => setAlgorithmText(e.target.value)}
            placeholder={algorithmPhaseConfig.placeholder}
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

          {!algorithmFeedback && !algorithmDoneOnIpad ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                {loading ? "Evaluating..." : algorithmPhaseConfig.buttonLabel}
              </button>
              <button
                type="button"
                onClick={() => setAlgorithmDoneOnIpad(true)}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  color: T.text3,
                  padding: "12px 0",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 12,
                }}
              >
                ✍️ I did this on iPad / paper — skip typing
              </button>
            </div>
          ) : (algorithmFeedback || algorithmDoneOnIpad) ? (
            <>
              {algorithmFeedback && (
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
              )}
              {algorithmDoneOnIpad && !algorithmFeedback && (
                <div
                  style={{
                    background: T.cardBg,
                    border: "1px solid " + T.border1,
                    borderRadius: 12,
                    padding: "16px 20px",
                    fontFamily: MONO,
                    color: T.text2,
                    fontSize: 12,
                  }}
                >
                  ✓ Done on iPad or paper — handwriting strengthens recall. Continue when ready.
                </div>
              )}
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
          ) : null}
          </>
          )}
        </div>
      )}

      {/* Phase 5: Read & Recall */}
      {phase === "readRecall" && (() => {
        const lectureText = lectureContent || lec?.fullText || lec?.extractedText || lec?.content || "";
        if (typeof console !== "undefined" && console.log) {
          console.log("Phase 5 render — recallStep:", recallStep, "recallPrompts.length:", recallPrompts.length, "content length:", lectureText?.length);
        }
        return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {PHASE_ORDER.indexOf(phase) > 0 && phase !== "summary" && (
              <button
                type="button"
                onClick={goBackPhase}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text3;
                }}
              >
                ← Previous Phase
              </button>
            )}
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
              PHASE {PHASE_ORDER.indexOf(phase) + 1} OF {PHASE_ORDER.length - 1} · READ & RECALL
              {recallPrompts.length > 0 ? ` (${currentRecall + 1}/${recallPrompts.length})` : ""}
            </div>
            {PHASE_ORDER.indexOf(phase) === 0 && <div />}
          </div>

          {recallPrompts.length > 0 ? (
            <>
              <div>
                <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
                  Explain the Mechanism
                </div>
                <div style={{ fontFamily: MONO, color: T.text3, fontSize: 13, lineHeight: 1.6 }}>
                  No notes. No looking up. Explain this in your own words — connecting it back to your patient.
                </div>
              </div>
              <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 16, lineHeight: 1.7, fontWeight: 600 }}>
                  {recallPrompts[currentRecall]?.question}
                </div>
                {recallPrompts[currentRecall]?.hint && (
                  <div style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
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
                      border: "1px solid " + (recallFeedback.correct ? T.statusGood : T.statusWarn),
                    }}
                  >
                    <div style={{ fontFamily: MONO, color: recallFeedback.correct ? T.statusGood : T.statusWarn, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      {recallFeedback.score}% · {recallFeedback.correct ? "Strong explanation" : "Needs more depth"}
                    </div>
                    {recallFeedback.conceptsLinked?.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        {recallFeedback.conceptsLinked.map((c, i) => (
                          <div key={i} style={{ fontFamily: MONO, color: T.statusGood, fontSize: 12 }}>✓ {c}</div>
                        ))}
                      </div>
                    )}
                    {recallFeedback.gaps?.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        {recallFeedback.gaps.map((g, i) => (
                          <div key={i} style={{ fontFamily: MONO, color: T.statusBad, fontSize: 12 }}>✗ {g}</div>
                        ))}
                      </div>
                    )}
                    {recallFeedback.correction && (
                      <div style={{ fontFamily: MONO, color: T.text1, fontSize: 12, lineHeight: 1.5, marginTop: 6, borderTop: "1px solid " + T.border2, paddingTop: 6 }}>
                        {recallFeedback.correction}
                      </div>
                    )}
                    {recallFeedback.reinforcement && (
                      <div style={{ fontFamily: MONO, color: tc, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>🔁 {recallFeedback.reinforcement}</div>
                    )}
                  </div>
                  <button
                    onClick={nextRecall}
                    disabled={loading}
                    style={{ background: tc, border: "none", color: "#fff", padding: "13px 0", borderRadius: 10, cursor: "pointer", fontFamily: SERIF, fontSize: 15, fontWeight: 900 }}
                  >
                    {loading ? "Preparing MCQs..." : currentRecall < recallPrompts.length - 1 ? "Next Recall →" : "Apply Your Knowledge →"}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {recallStep === "read" && !isFirstPass && (
                <div>
                  <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, marginBottom: 8, color: T.text1 }}>Read & Recall</h2>
                  <p style={{ fontFamily: MONO, fontSize: 14, color: T.text3, marginBottom: 20 }}>
                    Read through the lecture content carefully. When you're ready, you'll recall it from memory.
                  </p>
                  <div
                    style={{
                      background: T.cardBg,
                      border: "1.5px solid " + T.border1,
                      borderRadius: 12,
                      padding: "20px 24px",
                      maxHeight: 420,
                      overflowY: "auto",
                      fontFamily: MONO,
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: T.text1,
                      marginBottom: 20,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {lectureText ? lectureText.slice(0, 3000) : "No lecture content available. Use the objectives from earlier phases to recall key points."}
                    {lectureText && lectureText.length > 3000 && (
                      <div style={{ color: T.text3, marginTop: 12, fontSize: 12 }}>[Showing first 3000 characters — focus on key concepts]</div>
                    )}
                  </div>
                  <button
                    onClick={() => setRecallStep("recall")}
                    style={{
                      width: "100%",
                      padding: 16,
                      background: tc,
                      color: "#fff",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 16,
                      fontWeight: 700,
                      fontFamily: MONO,
                      cursor: "pointer",
                    }}
                  >
                    I've Read It — Now Recall →
                  </button>
                </div>
              )}
              {(recallStep === "recall" || (isFirstPass && recallPrompts.length === 0)) && (
                <div>
                  <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, marginBottom: 8, color: T.text1 }}>
                    {recallPrompts.length === 0 ? "Recall What You Learned" : "Now Recall"}
                  </h2>
                  <p style={{ fontFamily: MONO, fontSize: 14, color: T.text3, marginBottom: 16 }}>
                    {recallPrompts.length === 0
                      ? "You've been taught the key concepts. Now close your eyes and recall — what were the main ideas, key terms, and clinical connections from this lecture?"
                      : "Without looking — write everything you remember from what you just read. Structures, mechanisms, clinical points, anything."}
                  </p>
                  <textarea
                    value={recallText}
                    onChange={(e) => setRecallText(e.target.value)}
                    placeholder="Write everything you remember..."
                    style={{
                      width: "100%",
                      minHeight: 200,
                      padding: "14px 16px",
                      border: "1.5px solid " + T.border1,
                      borderRadius: 12,
                      resize: "vertical",
                      fontFamily: MONO,
                      fontSize: 14,
                      marginBottom: 16,
                      background: T.inputBg,
                      color: T.text1,
                      boxSizing: "border-box",
                    }}
                  />
                  {recallResult && (
                    <div
                      style={{
                        padding: "12px 16px",
                        background: (recallResult.score ?? 0) >= 60 ? (T.statusGoodBg || "#f0f7ff") : (T.statusWarnBg || "#fff8ee"),
                        borderLeft: "3px solid " + ((recallResult.score ?? 0) >= 60 ? (T.statusGood || T.statusProgress) : T.statusWarn),
                        borderRadius: "0 8px 8px 0",
                        marginBottom: 16,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontFamily: MONO, color: (recallResult.score ?? 0) >= 60 ? T.statusGood : T.statusWarn }}>
                        {recallResult.score}%
                      </span>
                      <span style={{ fontSize: 13, color: T.text2, marginLeft: 8 }}> - {recallResult.feedback}</span>
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      if (!recallText.trim()) return;
                      setLoading(true);
                      try {
                        const result = await geminiJSON(
                          `Grade this medical recall attempt 0-100. Raw JSON only: {"score":<0-100>,"feedback":"<15 words max>"}` +
                            `\n\nLecture: ${lectureTitle || "Medical lecture"}\nContent excerpt: ${(lectureText || "").slice(0, 1000)}\n\nStudent recall:\n${recallText}`,
                          600
                        );
                        setRecallResult(result && typeof result === "object" ? { score: result.score ?? 50, feedback: result.feedback || "Could not evaluate." } : { score: 50, feedback: "Could not evaluate." });
                      } catch {
                        setRecallResult({ score: 50, feedback: "Could not evaluate — try again." });
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    style={{
                      width: "100%",
                      padding: 16,
                      background: T.statusGood || "#10b981",
                      color: "#fff",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 16,
                      fontWeight: 700,
                      fontFamily: MONO,
                      cursor: "pointer",
                    }}
                  >
                    {loading ? "Evaluating..." : "Submit Recall →"}
                  </button>
                  {recallResult && (
                    <button
                      onClick={advanceToMCQ}
                      disabled={loading}
                      style={{
                        width: "100%",
                        padding: 14,
                        marginTop: 10,
                        background: tc,
                        color: "#fff",
                        border: "none",
                        borderRadius: 12,
                        fontSize: 15,
                        fontWeight: 700,
                        fontFamily: MONO,
                        cursor: "pointer",
                      }}
                    >
                      Continue to MCQ →
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        );
      })()}

      {/* Phase 6: MCQ Application */}
      {phase === "mcq" && mcqQuestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PatientBanner />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {PHASE_ORDER.indexOf(phase) > 0 && phase !== "summary" && (
              <button
                type="button"
                onClick={goBackPhase}
                style={{
                  background: "none",
                  border: "1px solid " + T.border1,
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: T.text3,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text3;
                }}
              >
                ← Previous Phase
              </button>
            )}
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
              PHASE {PHASE_ORDER.indexOf(phase) + 1} OF {PHASE_ORDER.length - 1} · MCQ APPLICATION ({currentMCQ + 1}/{mcqQuestions.length})
            </div>
            {PHASE_ORDER.indexOf(phase) === 0 && <div />}
          </div>
          <div>
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
                  ? makeTopicKey(resolvedObjectives?.[0]?.linkedLecId ?? null, blockId)
                  : (blockId + "__" + (resolvedObjectives?.[0]?.linkedLecId || "block")),
                difficulty: "medium",
                targetObjectives: resolvedObjectives,
                preSAQScore,
                postMCQScore,
                confidenceLevel,
                nextReview,
                sessionType: "deepLearn",
                lectureId: resolvedObjectives?.[0]?.linkedLecId ?? null,
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
  lecObjectives: lecObjectivesProp = [],
  getBlockObjectives,
  questionBanksByFile = {},
  buildQuestionContext,
  detectStudyMode: detectStudyModeProp,
  onBack,
  termColor,
  makeTopicKey,
  performanceHistory = {},
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
  const topicKeyForPerf = makeTopicKey && firstTopic?.lecId
    ? makeTopicKey(firstTopic.lecId, sessionParams?.blockId ?? blockId)
    : null;
  const perfEntry = topicKeyForPerf ? performanceHistory[topicKeyForPerf] : null;
  const isFirstPass = (perfEntry?.sessions?.length || 0) === 0;
  const activityStrForLec = lectureForTopic
    ? `${(lectureForTopic.lectureType || "LEC")} ${lectureForTopic.lectureNumber ?? ""}`.trim()
    : "";
  const normActivity = (s) => (s || "").toUpperCase().replace(/\s+/g, "").trim();
  const filteredByLec = (blockObjectives || []).filter(
    (o) =>
      o.linkedLecId === firstTopic?.lecId ||
      (lectureForTopic?.mergedFrom || []).some((m) => m && (m.id || m) === o.linkedLecId) ||
      (lectureForTopic &&
        String(o.lectureNumber) === String(lectureForTopic.lectureNumber) &&
        String(o.lectureType || "LEC").toUpperCase() === String(lectureForTopic.lectureType || "LEC").toUpperCase()) ||
      (activityStrForLec && normActivity(o.activity) === normActivity(activityStrForLec))
  );
  const objectivesForSession = sessionParams?.resuming
    ? sessionParams.objectives || []
    : firstTopic?.weak
      ? firstTopic.objectives || []
      : (lecObjectivesProp && lecObjectivesProp.length > 0)
        ? lecObjectivesProp
        : filteredByLec.length > 0
          ? filteredByLec
          : (blockObjectives && blockObjectives.length > 0 ? blockObjectives : []);

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
          lectureContent={
            sessionParams?.resuming
              ? sessionParams.lectureContent
              : lectureForTopic?.extractedText || lectureForTopic?.content || lectureForTopic?.fullText || lectureForTopic?.text || ""
          }
          objectives={objectivesForSession}
          blockId={blockId}
          blockObjectives={blockObjectives}
          getBlockObjectives={getBlockObjectives}
          lec={lectureForTopic}
          isFirstPass={isFirstPass}
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
          initialStructureSaqQuestions={sessionParams?.resuming ? sessionParams.structureSaqQuestions : undefined}
          initialStructureSaqAnswers={sessionParams?.resuming ? sessionParams.structureSaqAnswers : undefined}
          initialStructureSaqEvals={sessionParams?.resuming ? sessionParams.structureSaqEvals : undefined}
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
