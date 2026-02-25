import { useState, useEffect, useRef } from "react";
import Tracker from "./Tracker";
import LearningModel from "./LearningModel.jsx";
import { loadProfile, saveProfile, recordAnswer } from "./learningModel";
import { ThemeContext, useTheme, themes } from "./theme";

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// ─────────────────────────────────────────────
// PERSISTENT STORAGE
// ─────────────────────────────────────────────
async function sGet(key) {
  try {
    const r = localStorage.getItem(key);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}
async function sSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn("storage set failed", key, e);
  }
}
async function sDel(key) {
  try { localStorage.removeItem(key); } catch {}
}

// Lectures: save metadata + fullText separately to avoid size limits
async function saveLectures(lectures) {
  const meta = lectures.map(({ fullText, ...rest }) => rest);
  await sSet("rxt-lec-meta", meta);
  for (const l of lectures) {
    if (l.fullText) await sSet("rxt-lec-" + l.id, l.fullText);
  }
}
async function loadLectures() {
  const meta = await sGet("rxt-lec-meta");
  if (!meta || !Array.isArray(meta)) return [];
  const out = [];
  for (const m of meta) {
    const fullText = (await sGet("rxt-lec-" + m.id)) || "";
    out.push({ ...m, fullText });
  }
  return out;
}

// ─────────────────────────────────────────────
// DEFAULT DATA
// ─────────────────────────────────────────────
const DEFAULT_TERMS = [
  {
    id: "term1",
    name: "Term 1",
    color: "#ef4444",
    blocks: [
      { id: "ftm1", name: "FTM 1", status: "complete" },
      { id: "ftm2", name: "FTM 2", status: "active" },
      { id: "msk",  name: "MSK",   status: "upcoming" },
      { id: "cpr1", name: "CPR 1", status: "upcoming" },
      { id: "cpr2", name: "CPR 2", status: "upcoming" },
    ],
  },
];

// ─────────────────────────────────────────────
// PDF.js
// ─────────────────────────────────────────────
let pdfLib = null;
async function getPdf() {
  if (pdfLib) return pdfLib;
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfLib = window.pdfjsLib;
    return pdfLib;
  }
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      pdfLib = window.pdfjsLib;
      res(pdfLib);
    };
    s.onerror = () => rej(new Error("PDF.js load failed"));
    document.head.appendChild(s);
  });
}
async function readPDF(file) {
  const lib = await getPdf();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 80); i++) {
    const pg = await pdf.getPage(i);
    const ct = await pg.getTextContent();
    text += "\n[Slide " + i + "]\n" + ct.items.map(x => x.str).join(" ");
  }
  return text.trim();
}

// ─────────────────────────────────────────────
// GEMINI API (claude() kept for call-site compatibility)
// ─────────────────────────────────────────────
const MAX_TOKENS_CAP = 4096;

async function claude(prompt, maxTokens, systemPrompt) {
  if (!GEMINI_KEY) throw new Error("No Gemini API key. Add VITE_GEMINI_API_KEY to .env");

  const fullPrompt = systemPrompt ? systemPrompt + "\n\n" + prompt : prompt;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens || 1200,
          temperature: 0.7,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error("API " + res.status + " — " + err);
  }

  const d = await res.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function safeJSON(raw) {
  if (raw == null || typeof raw !== "string") {
    throw new Error("safeJSON: expected string, got " + typeof raw);
  }
  // Strip everything before first { or [ and after last } or ]
  const firstBrace = Math.min(
    raw.indexOf("{") === -1 ? Infinity : raw.indexOf("{"),
    raw.indexOf("[") === -1 ? Infinity : raw.indexOf("[")
  );
  const lastBrace = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (firstBrace === Infinity || lastBrace === -1) {
    throw new Error("No JSON found in response");
  }
  let cleaned = raw.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to repair truncated JSON by finding the last complete vignette
    const lastComplete = cleaned.lastIndexOf("},");
    if (lastComplete > 0) {
      const repaired = cleaned.slice(0, lastComplete + 1) + "]}";
      try {
        const result = JSON.parse(repaired);
        console.warn("JSON was truncated — recovered " + (result.vignettes?.length || 0) + " vignettes");
        return result;
      } catch (e2) {
        throw new Error("Invalid JSON from Claude: " + e.message + ". Preview: " + raw.slice(0, 300));
      }
    }
    throw new Error("Invalid JSON from Claude: " + e.message + ". Preview: " + raw.slice(0, 300));
  }
}

async function detectMeta(text) {
  const prompt =
    "You are a medical education expert analyzing M1/M2 medical school lecture content.\n" +
    "Analyze this lecture text and return ONLY valid JSON with no markdown.\n\n" +
    "You MUST always return a specific medical subject — never return 'Unknown', 'Medicine', or 'General'.\n" +
    "Choose the most specific subject from this list that fits the content:\n" +
    "Anatomy, Physiology, Biochemistry, Microbiology, Immunology, Pathology, Pharmacology, " +
    "Neuroscience, Embryology, Histology, Genetics, Cell Biology, Behavioral Science, Biostatistics\n\n" +
    "Return exactly this shape:\n" +
    "{\"subject\":\"Physiology\",\"subtopics\":[\"Topic A\",\"Topic B\",\"Topic C\"],\"keyTerms\":[\"term1\",\"term2\",\"term3\",\"term4\",\"term5\"],\"lectureTitle\":\"Specific Title\"}\n\n" +
    "Rules:\n" +
    "- subject must be ONE of the subjects listed above, pick the closest match\n" +
    "- subtopics must be 3-6 specific topics covered in this lecture\n" +
    "- keyTerms must be 5-8 high yield medical terms from the content\n" +
    "- lectureTitle must be specific, not generic\n\n" +
    "TEXT:\n" + text.slice(0, 5000);
  const raw = await claude(prompt);
  return safeJSON(raw);
}

const VIGNETTE_JSON_INSTRUCTION = "IMPORTANT: You must complete the entire JSON response. Never cut off mid-string. If you are running low on space, reduce the explanation length but always close every JSON object, array, and string properly.";

function buildTopicVignettesPrompt(n, subject, subtopic, keyTerms, fullText, difficulty, questionType) {
  return (
    "Generate exactly " + n + " USMLE Step 1 clinical vignette questions.\n\n" +
    "Subject: " + subject + "\n" +
    "Subtopic: " + subtopic + "\n" +
    "Key terms: " + (keyTerms || []).join(", ") + "\n" +
    "Difficulty level: " + (difficulty === "auto" ? "mixed, harder on weak topics" : difficulty) + "\n" +
    "Question type focus: " + (questionType || "clinicalVignette") + "\n\n" +
    "LECTURE MATERIAL:\n" + fullText.slice(0, 6000) + "\n\n" +
    "STRICT FORMAT RULES — follow exactly:\n" +
    "1. Each vignette MUST have ALL of these fields: id, difficulty, stem, choices, correct, explanation\n" +
    "2. stem: 3-5 sentence patient scenario ending with a CLEAR QUESTION like 'Which of the following is the most likely diagnosis?' or 'What is the most appropriate next step?' or 'Which mechanism best explains this finding?' — the stem MUST end with a question\n" +
    "3. choices: exactly 4 options labeled A, B, C, D — each option must be a complete answer, not a sentence fragment\n" +
    "4. correct: must be exactly one letter: A, B, C, or D\n" +
    "5. explanation: must cover (a) why the correct answer is right with the mechanism, (b) why each wrong answer is wrong specifically, (c) one First Aid reference\n" +
    "6. difficulty: must be exactly one of: easy, medium, hard\n\n" +
    "QUESTION STYLES TO USE (rotate between these):\n" +
    "- Most likely diagnosis\n" +
    "- Most appropriate next step in management\n" +
    "- Most likely underlying mechanism\n" +
    "- Most likely causative organism or drug\n" +
    "- Best initial test or gold standard test\n\n" +
    "PATIENT SCENARIO MUST INCLUDE:\n" +
    "- Patient age and sex\n" +
    "- Chief complaint and duration\n" +
    "- Relevant history (PMH, medications, family history if relevant)\n" +
    "- Vital signs (at least 2-3 values)\n" +
    "- Physical exam findings\n" +
    "- Lab values or imaging results where relevant\n" +
    "- The stem MUST end with a question mark\n\n" +
    "EXAMPLE of correct stem format:\n" +
    "\"A 45-year-old man with a history of hypertension presents with sudden onset crushing chest pain radiating to his left arm for 2 hours. His temperature is 37.2C, blood pressure is 160/95 mmHg, heart rate is 102 bpm. ECG shows ST elevation in leads V1-V4. Troponin I is elevated at 2.8 ng/mL. Which of the following is the most appropriate immediate next step in management?\"\n\n" +
    "EXAMPLE of correct choices format:\n" +
    "\"choices\": { \"A\": \"Administer aspirin and heparin, then percutaneous coronary intervention\", \"B\": \"Order an echocardiogram before starting treatment\", \"C\": \"Start oral beta-blockers and discharge with cardiology follow-up\", \"D\": \"Perform CT angiography of the chest\" }\n\n" +
    "Return ONLY valid complete JSON with no markdown, no extra text before or after:\n" +
    "{\"vignettes\":[{\"id\":\"v1\",\"difficulty\":\"medium\",\"stem\":\"[full patient scenario ending with a question?]\",\"choices\":{\"A\":\"...\",\"B\":\"...\",\"C\":\"...\",\"D\":\"...\"},\"correct\":\"A\",\"explanation\":\"[detailed explanation]\"}]}\n\n" +
    VIGNETTE_JSON_INSTRUCTION
  );
}

async function genTopicVignettes(subject, subtopic, fullText, count, keyTerms, difficulty, questionType) {
  try {
    const BATCH_SIZE = 5;
    const diff = difficulty ?? "auto";
    const qType = questionType ?? "clinicalVignette";

    if (count <= BATCH_SIZE) {
      const prompt = buildTopicVignettesPrompt(count, subject, subtopic, keyTerms, fullText, diff, qType);
      const raw = await claude(prompt, 8000);
      const data = safeJSON(raw);
      return (data.vignettes || []).slice(0, count);
    }

    const allVignettes = [];
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const batchCount = Math.min(BATCH_SIZE, count - i);
      const prompt = buildTopicVignettesPrompt(batchCount, subject, subtopic, keyTerms, fullText, diff, qType);
      const raw = await claude(prompt, 8000);
      const data = safeJSON(raw);
      const batch = (data.vignettes || []).slice(0, batchCount);
      batch.forEach((v, j) => { v.id = "v" + (allVignettes.length + j + 1); });
      allVignettes.push(...batch);
    }
    return allVignettes.slice(0, count);
  } catch (e) {
    throw new Error("genTopicVignettes: " + (e.message || String(e)));
  }
}

async function genBlockVignettes(blockLecs, count, weakSubs, difficulty, questionType) {
  try {
    const combined = blockLecs
      .map(l => "=== " + l.lectureTitle + " [" + l.subject + "] ===\n" + l.fullText)
      .join("\n\n")
      .slice(0, 10000);
    const weakHint = weakSubs.length
      ? "\nIMPORTANT — include at least one question per weak area: " + weakSubs.join(", ")
      : "";
    const diff = difficulty ?? "auto";
    const qType = questionType ?? "clinicalVignette";
    const prompt =
      "Generate exactly " + count + " USMLE Step 1 clinical vignette questions spanning DIFFERENT topics from the block material below.\n\n" +
      "Difficulty level: " + (diff === "auto" ? "mixed, harder on weak topics" : diff) + "\n" +
      "Question type focus: " + qType + "\n\n" +
      "BLOCK MATERIAL:\n" + combined + weakHint + "\n\n" +
      "STRICT FORMAT RULES — follow exactly:\n" +
      "1. Each vignette MUST have ALL of these fields: id, difficulty, topic, stem, choices, correct, explanation\n" +
      "2. topic: short label for the topic (e.g. \"Cardiovascular\", \"Renal\")\n" +
      "3. stem: 3-5 sentence patient scenario ending with a CLEAR QUESTION like 'Which of the following is the most likely diagnosis?' or 'What is the most appropriate next step?' or 'Which mechanism best explains this finding?' — the stem MUST end with a question\n" +
      "4. choices: exactly 4 options labeled A, B, C, D — each option must be a complete answer, not a sentence fragment\n" +
      "5. correct: must be exactly one letter: A, B, C, or D\n" +
      "6. explanation: must cover (a) why the correct answer is right with the mechanism, (b) why each wrong answer is wrong specifically, (c) one First Aid reference\n" +
      "7. difficulty: must be exactly one of: easy, medium, hard\n\n" +
      "QUESTION STYLES TO USE (rotate between these):\n" +
      "- Most likely diagnosis\n" +
      "- Most appropriate next step in management\n" +
      "- Most likely underlying mechanism\n" +
      "- Most likely causative organism or drug\n" +
      "- Best initial test or gold standard test\n\n" +
      "PATIENT SCENARIO MUST INCLUDE:\n" +
      "- Patient age and sex\n" +
      "- Chief complaint and duration\n" +
      "- Relevant history (PMH, medications, family history if relevant)\n" +
      "- Vital signs (at least 2-3 values)\n" +
      "- Physical exam findings\n" +
      "- Lab values or imaging results where relevant\n" +
      "- The stem MUST end with a question mark\n\n" +
      "EXAMPLE of correct stem format:\n" +
      "\"A 45-year-old man with a history of hypertension presents with sudden onset crushing chest pain radiating to his left arm for 2 hours. His temperature is 37.2C, blood pressure is 160/95 mmHg, heart rate is 102 bpm. ECG shows ST elevation in leads V1-V4. Troponin I is elevated at 2.8 ng/mL. Which of the following is the most appropriate immediate next step in management?\"\n\n" +
      "EXAMPLE of correct choices format:\n" +
      "\"choices\": { \"A\": \"Administer aspirin and heparin, then percutaneous coronary intervention\", \"B\": \"Order an echocardiogram before starting treatment\", \"C\": \"Start oral beta-blockers and discharge with cardiology follow-up\", \"D\": \"Perform CT angiography of the chest\" }\n\n" +
      "Return ONLY valid complete JSON with no markdown, no extra text before or after:\n" +
      "{\"vignettes\":[{\"id\":\"v1\",\"difficulty\":\"medium\",\"topic\":\"label\",\"stem\":\"[full patient scenario ending with a question?]\",\"choices\":{\"A\":\"...\",\"B\":\"...\",\"C\":\"...\",\"D\":\"...\"},\"correct\":\"A\",\"explanation\":\"[detailed explanation]\"}]}\n\n" +
      VIGNETTE_JSON_INSTRUCTION;
    const raw = await claude(prompt, 10000);
    const data = safeJSON(raw);
    return (data.vignettes || []).slice(0, count);
  } catch (e) {
    throw new Error("genBlockVignettes: " + (e.message || String(e)));
  }
}

async function genAnalysis(blockSessions, blockLecs) {
  if (!blockSessions.length) return "Complete at least one session first.";
  try {
    const map = {};
    blockSessions.forEach(s => {
      const k = s.subject + " — " + s.subtopic;
      if (!map[k]) map[k] = { c: 0, t: 0 };
      map[k].c += s.correct; map[k].t += s.total;
    });
    const lines = Object.entries(map)
      .sort((a, b) => pct(a[1].c, a[1].t) - pct(b[1].c, b[1].t))
      .map(([k, v]) => k + ": " + pct(v.c, v.t) + "% (" + v.c + "/" + v.t + ")").join("\n");
    const topics = blockLecs.map(l => l.lectureTitle + " [" + l.subject + "]").join(", ");
    return await claude(
      "Medical advisor for M1/M2 student.\nBlock covers: " + topics + "\n\nPerformance (weakest first):\n" + lines + "\n\n" +
      "Provide:\n## Weak Areas (<70%) — score, 2-3 tactics (First Aid, Pathoma, Sketchy)\n## Moderate Areas (60-79%) — brief tips\n## Strengths — connections to weak areas\n## High-Yield Pearl — clinical connection\nMax 350 words.",
      1000
    );
  } catch (e) {
    throw new Error("genAnalysis: " + (e.message || String(e)));
  }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);

function syncSessionToTracker(session, studyCfg) {
  const existing = JSON.parse(localStorage.getItem("rxt-tracker-v2") || "[]");

  const matchIndex = existing.findIndex(r =>
    r.block === studyCfg.blockName &&
    r.subject === studyCfg.subject &&
    r.topic === studyCfg.subtopic
  );

  const today = new Date().toISOString().split("T")[0];
  const scorePercent = session.total > 0
    ? Math.round((session.correct / session.total) * 100)
    : 0;

  if (matchIndex >= 0) {
    const row = existing[matchIndex];
    existing[matchIndex] = {
      ...row,
      lastStudied: today,
      scores: [...(row.scores || []), scorePercent],
      reps: (row.reps || 0) + 1,
      lecture: true,
    };
  } else {
    const newRow = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      block: studyCfg.blockName || studyCfg.blockId,
      subject: studyCfg.subject || "Unknown",
      topic: studyCfg.subtopic || "Practice Session",
      lectureDate: "",
      lastStudied: today,
      ankiDate: "",
      preRead: false,
      lecture: true,
      postReview: false,
      anki: false,
      confidence: null,
      scores: [scorePercent],
      reps: 1,
      notes: "",
    };
    existing.push(newRow);
  }

  localStorage.setItem("rxt-tracker-v2", JSON.stringify(existing));
}

function getScore(sessions, fn) {
  const rel = sessions.filter(fn);
  if (!rel.length) return null;
  const c = rel.reduce((a, s) => a + s.correct, 0);
  const t = rel.reduce((a, s) => a + s.total, 0);
  return t ? Math.round((c / t) * 100) : null;
}

function mastery(p, T) {
  if (p === null) return T ? { fg: T.text4, bg: T.border2, border: T.border1, label: "Untested" } : { fg: "#4b5563", bg: "#0d1829", border: "#1a2a3a", label: "Untested" };
  if (p >= 80)   return { fg: "#10b981", bg: "#021710", border: "#064e3b", label: "Strong" };
  if (p >= 60)   return { fg: "#f59e0b", bg: "#160e00", border: "#451a03", label: "Moderate" };
  return           { fg: "#ef4444", bg: "#150404", border: "#450a0a", label: "Weak" };
}

const BLOCK_STATUS = {
  complete: { color: "#10b981", icon: "✓", label: "Completed" },
  active:   { color: "#f59e0b", icon: "◉", label: "In Progress" },
  upcoming: { color: "#374151", icon: "○", label: "Upcoming" },
};

const PALETTE = ["#60a5fa","#f472b6","#34d399","#a78bfa","#fb923c","#38bdf8","#4ade80","#facc15","#22d3ee","#fb7185"];

// ─────────────────────────────────────────────
// SMALL UI PIECES
// ─────────────────────────────────────────────
const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";

function Spinner({ msg }) {
  const { T } = useTheme();
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:18, padding:"70px 40px" }}>
      <div style={{ width:44, height:44, border:"3px solid " + T.border1, borderTopColor:"#ef4444", borderRadius:"50%", animation:"rxt-spin 0.85s linear infinite" }} />
      {msg && <p style={{ fontFamily:MONO, color:T.text3, fontSize:12, textAlign:"center", maxWidth:320, lineHeight:1.7 }}>{msg}</p>}
    </div>
  );
}

function Ring({ score, size, tint }) {
  const { T } = useTheme();
  size = size || 60;
  tint = tint || "#ef4444";
  const m = mastery(score, T);
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const fill = score !== null ? (score / 100) * circ : 0;
  return (
    <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} style={{ flexShrink:0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.border1} strokeWidth={5} />
      {score !== null && (
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={m.fg}
          strokeWidth={5} strokeDasharray={fill + " " + circ}
          strokeLinecap="round" transform={"rotate(-90 " + size/2 + " " + size/2 + ")"} />
      )}
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
        fill={score !== null ? m.fg : T.text4}
        fontSize={score !== null ? (size > 70 ? 16 : 13) : 11}
        fontFamily={MONO} fontWeight="700">
        {score !== null ? score + "%" : "—"}
      </text>
    </svg>
  );
}

function Btn({ children, onClick, color, disabled, style }) {
  const { T } = useTheme();
  color = color || T.text4;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        background: disabled ? T.border1 : color,
        border: "none", color: disabled ? T.text4 : "#fff",
        padding: "10px 22px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: MONO, fontSize: 13, fontWeight: 600,
        opacity: disabled ? 0.6 : 1, ...style,
      }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// SESSION CONFIG (before starting a session)
// ─────────────────────────────────────────────
function SessionConfig({ cfg, onStart, onBack, termColor }) {
  const [qCount, setQCount] = useState(cfg.qCount || 10);
  const [difficulty, setDifficulty] = useState("auto");
  const [mode, setMode] = useState(cfg.mode || "lecture");
  const tc = termColor || "#ef4444";
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const diffOptions = [
    { value: "auto", label: "Auto", desc: "Based on your weak areas", color: "#60a5fa" },
    { value: "easy", label: "Easy", desc: "Foundational concepts", color: "#10b981" },
    { value: "medium", label: "Medium", desc: "Standard Step 1 level", color: "#f59e0b" },
    { value: "hard", label: "Hard", desc: "Challenging distractors", color: "#ef4444" },
  ];

  const questionTypes = [
    { value: "clinicalVignette", label: "Clinical Vignette", icon: "🏥", desc: "USMLE patient scenarios" },
    { value: "mechanismBased", label: "Mechanism", icon: "⚙️", desc: "Pathophysiology focus" },
    { value: "pharmacology", label: "Pharmacology", icon: "💊", desc: "Drug mechanisms" },
    { value: "mixed", label: "Mixed", icon: "🔀", desc: "All types combined" },
  ];
  const [questionType, setQuestionType] = useState("clinicalVignette");

  return (
    <div style={{ maxWidth: 580, margin: "0 auto", padding: "40px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontFamily: MONO, fontSize: 11, marginBottom: 16, padding: 0 }}
        >
          ← Back
        </button>
        <h1 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 6 }}>
          {cfg.mode === "block" ? "Block Exam" : cfg.subtopic}
        </h1>
        <p style={{ fontFamily: MONO, color: "#6b7280", fontSize: 12 }}>
          {cfg.mode === "block"
            ? "Comprehensive review across all lectures in this block"
            : (cfg.subject || "") + " · " + (cfg.lecture?.lectureTitle || "")}
        </p>
      </div>

      <div style={{ background: "#09111e", border: "1px solid #0f1e30", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9, letterSpacing: 2, marginBottom: 16 }}>NUMBER OF QUESTIONS</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <button
            onClick={() => setQCount((q) => Math.max(1, q - 1))}
            style={{
              width: 44, height: 44, borderRadius: 10, background: "#0d1829",
              border: "1px solid #1a2a3a", color: "#f1f5f9", fontSize: 22, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#1a2a3a")}
          >
            −
          </button>
          <div style={{ textAlign: "center", minWidth: 80 }}>
            <div style={{ fontFamily: SERIF, color: tc, fontSize: 52, fontWeight: 900, lineHeight: 1 }}>{qCount}</div>
            <div style={{ fontFamily: MONO, color: "#374151", fontSize: 10, marginTop: 4 }}>
              {qCount === 1 ? "question" : "questions"} · {qCount <= 5 ? "Quick drill" : qCount <= 10 ? "Standard" : qCount <= 20 ? "Deep dive" : "Full block"}
            </div>
          </div>
          <button
            onClick={() => setQCount((q) => Math.min(40, q + 1))}
            style={{
              width: 44, height: 44, borderRadius: 10, background: "#0d1829",
              border: "1px solid #1a2a3a", color: "#f1f5f9", fontSize: 22, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#1a2a3a")}
          >
            +
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          {[5, 10, 15, 20, 30].map((n) => (
            <button
              key={n}
              onClick={() => setQCount(n)}
              style={{
                background: qCount === n ? tc + "22" : "#0d1829",
                border: "1px solid " + (qCount === n ? tc : "#1a2a3a"),
                color: qCount === n ? tc : "#6b7280",
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 11,
                transition: "all 0.15s",
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "#09111e", border: "1px solid #0f1e30", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9, letterSpacing: 2, marginBottom: 14 }}>DIFFICULTY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {diffOptions.map((d) => (
            <div
              key={d.value}
              onClick={() => setDifficulty(d.value)}
              style={{
                background: difficulty === d.value ? d.color + "18" : "#0d1829",
                border: "1px solid " + (difficulty === d.value ? d.color : "#1a2a3a"),
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontFamily: MONO, color: difficulty === d.value ? d.color : "#c4cdd6", fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{d.label}</div>
              <div style={{ fontFamily: MONO, color: "#374151", fontSize: 10 }}>{d.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#09111e", border: "1px solid #0f1e30", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9, letterSpacing: 2, marginBottom: 14 }}>QUESTION TYPE</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {questionTypes.map((t) => (
            <div
              key={t.value}
              onClick={() => setQuestionType(t.value)}
              style={{
                background: questionType === t.value ? tc + "18" : "#0d1829",
                border: "1px solid " + (questionType === t.value ? tc : "#1a2a3a"),
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <div>
                <div style={{ fontFamily: MONO, color: questionType === t.value ? "#f1f5f9" : "#c4cdd6", fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9 }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => onStart({ ...cfg, qCount, difficulty, questionType })}
        style={{
          background: tc,
          border: "none",
          color: "#fff",
          padding: "16px 0",
          borderRadius: 12,
          cursor: "pointer",
          fontFamily: SERIF,
          fontSize: 18,
          fontWeight: 900,
          letterSpacing: 0.5,
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        Start Session →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// REVIEW SESSION (missed questions)
// ─────────────────────────────────────────────
function renderStemWithHighlightsStatic(stem, highlightList) {
  if (!highlightList?.length) return <span>{stem}</span>;
  const parts = [];
  let remaining = stem;
  const sorted = [...highlightList].sort((a, b) => stem.indexOf(a.text) - stem.indexOf(b.text));
  sorted.forEach((h) => {
    const idx = remaining.indexOf(h.text);
    if (idx === -1) return;
    if (idx > 0) parts.push({ text: remaining.slice(0, idx), highlighted: false });
    parts.push({ text: h.text, highlighted: true, color: h.color });
    remaining = remaining.slice(idx + h.text.length);
  });
  if (remaining) parts.push({ text: remaining, highlighted: false });
  return (
    <>
      {parts.map((p, i) =>
        p.highlighted ? (
          <mark
            key={i}
            style={{
              background: p.color + "60",
              color: "inherit",
              borderRadius: 3,
              padding: "1px 0",
              borderBottom: "2px solid " + p.color,
            }}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

function ReviewSession({ questions, originalAnswers, highlights, onClose, termColor, renderStemWithHighlightsStatic }) {
  const [idx, setIdx] = useState(0);
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const tc = termColor || "#ef4444";
  const q = questions[idx];
  const yourAnswer = originalAnswers[q.id];
  const correctAnswer = q.correct;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
            📋 Review Missed Questions
          </h2>
          <p style={{ fontFamily: MONO, color: "#6b7280", fontSize: 11 }}>
            Question {idx + 1} of {questions.length} missed
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #1a2a3a",
            color: "#6b7280",
            padding: "8px 16px",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          ✕ Close Review
        </button>
      </div>

      <div style={{ height: 3, background: "#1a2a3a", borderRadius: 2, marginBottom: 28 }}>
        <div
          style={{
            width: ((idx + 1) / questions.length) * 100 + "%",
            height: "100%",
            background: tc,
            borderRadius: 2,
            transition: "width 0.3s",
          }}
        />
      </div>

      <div style={{ background: "#09111e", border: "1px solid #0f1e30", borderRadius: 16, padding: 28, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              background: "#ef444418",
              color: "#ef4444",
              border: "1px solid #ef444430",
              padding: "3px 10px",
              borderRadius: 5,
            }}
          >
            ✗ You answered: {yourAnswer || "Skipped"}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              background: "#10b98118",
              color: "#10b981",
              border: "1px solid #10b98130",
              padding: "3px 10px",
              borderRadius: 5,
            }}
          >
            ✓ Correct: {correctAnswer}
          </span>
        </div>

        <div
          style={{
            fontFamily: MONO,
            fontSize: 13,
            color: "#e2e8f0",
            lineHeight: 1.8,
            marginBottom: 24,
            padding: "16px",
            background: "#080f1c",
            borderRadius: 10,
            borderLeft: "3px solid " + tc,
          }}
        >
          {(highlights[q.id] || []).length > 0
            ? renderStemWithHighlightsStatic(q.stem, highlights[q.id])
            : q.stem}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {["A", "B", "C", "D"].map((letter) => {
            const isCorrect = letter === correctAnswer;
            const isYours = letter === yourAnswer;
            return (
              <div
                key={letter}
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  border: "1px solid " + (isCorrect ? "#10b981" : isYours ? "#ef4444" : "#1a2a3a"),
                  background: isCorrect ? "#10b98118" : isYours ? "#ef444418" : "#0d1829",
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 13,
                    flexShrink: 0,
                    marginTop: 1,
                    color: isCorrect ? "#10b981" : isYours ? "#ef4444" : "#6b7280",
                  }}
                >
                  {letter} {isCorrect ? "✓" : isYours ? "✗" : ""}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: isCorrect ? "#10b981" : isYours ? "#ef4444" : "#9ca3af",
                    lineHeight: 1.6,
                  }}
                >
                  {q.choices[letter]}
                </span>
              </div>
            );
          })}
        </div>

        {q.explanation && (
          <div style={{ background: "#080f1c", border: "1px solid #10b98130", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontFamily: MONO, color: "#10b981", fontSize: 9, letterSpacing: 2, marginBottom: 10 }}>
              EXPLANATION
            </div>
            <p style={{ fontFamily: MONO, fontSize: 12, color: "#c4cdd6", lineHeight: 1.8, margin: 0 }}>{q.explanation}</p>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          style={{
            background: "#0d1829",
            border: "1px solid #1a2a3a",
            color: idx === 0 ? "#1a2a3a" : "#f1f5f9",
            padding: "10px 24px",
            borderRadius: 10,
            cursor: idx === 0 ? "not-allowed" : "pointer",
            fontFamily: MONO,
            fontSize: 12,
            transition: "all 0.15s",
          }}
        >
          ← Previous
        </button>

        <span style={{ fontFamily: MONO, color: "#374151", fontSize: 11 }}>
          {idx + 1} / {questions.length}
        </span>

        {idx < questions.length - 1 ? (
          <button
            onClick={() => setIdx((i) => i + 1)}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "10px 24px",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 12,
            }}
          >
            Next →
          </button>
        ) : (
          <button
            onClick={onClose}
            style={{
              background: "#10b981",
              border: "none",
              color: "#fff",
              padding: "10px 24px",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 12,
            }}
          >
            Done ✓
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// VIGNETTE SESSION
// ─────────────────────────────────────────────
function Session({ cfg, onDone, onBack }) {
  const { T } = useTheme();
  const [vigs, setVigs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [idx, setIdx]         = useState(0);
  const [sel, setSel]         = useState(null);
  const [shown, setShown]     = useState(false);
  const [results, setResults] = useState([]);
  const [done, setDone]       = useState(false);
  const [highlights, setHighlights] = useState({}); // { [questionId]: [{ start, end, color, text, id }] }
  const [highlightColor, setHighlightColor] = useState("#fde047");
  const [eliminated, setEliminated] = useState({}); // { [questionId]: ["A","C"] }
  const [reviewMode, setReviewMode] = useState(false);
  const tc = cfg.termColor || "#ef4444";

  function toggleEliminate(questionId, choice) {
    if (vigs[idx]?.id === questionId && sel === choice) return;
    setEliminated((prev) => {
      const current = prev[questionId] || [];
      const updated = current.includes(choice)
        ? current.filter((c) => c !== choice)
        : [...current, choice];
      return { ...prev, [questionId]: updated };
    });
  }

  function handleStemMouseUp(questionId) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) return;

    const container = document.getElementById("stem-" + questionId);
    if (!container || !container.contains(range.startContainer)) return;

    setHighlights((prev) => ({
      ...prev,
      [questionId]: [
        ...(prev[questionId] || []),
        { text: selectedText, color: highlightColor, id: Date.now() },
      ],
    }));
    selection.removeAllRanges();
  }

  function removeHighlight(questionId, highlightId) {
    setHighlights((prev) => ({
      ...prev,
      [questionId]: (prev[questionId] || []).filter((h) => h.id !== highlightId),
    }));
  }

  function renderStemWithHighlights(stem, questionId) {
    const qHighlights = highlights[questionId] || [];
    if (qHighlights.length === 0) {
      return <span>{stem}</span>;
    }
    const parts = [];
    let remaining = stem;
    const sorted = [...qHighlights].sort((a, b) => stem.indexOf(a.text) - stem.indexOf(b.text));

    sorted.forEach((h) => {
      const idxH = remaining.indexOf(h.text, 0);
      if (idxH === -1) return;
      if (idxH > 0) parts.push({ text: remaining.slice(0, idxH), highlighted: false });
      parts.push({ text: h.text, highlighted: true, color: h.color, hid: h.id });
      remaining = remaining.slice(idxH + h.text.length);
    });
    if (remaining) parts.push({ text: remaining, highlighted: false });

    return (
      <>
        {parts.map((p, i) =>
          p.highlighted ? (
            <mark
              key={p.hid}
              onClick={() => removeHighlight(questionId, p.hid)}
              title="Click to remove highlight"
              style={{
                background: p.color + "60",
                color: "inherit",
                borderRadius: 3,
                padding: "1px 0",
                cursor: "pointer",
                borderBottom: "2px solid " + p.color,
              }}
            >
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </>
    );
  }

  useEffect(() => {
    if (!done || !vigs.length || !results.length) return;
    const answers = Object.fromEntries(
      results.map((r) => [r.questionId, r.chosenAnswer]).filter(([, a]) => a != null)
    );
    const missedQuestions = vigs.filter(
      (v) => answers[v.id] != null && answers[v.id] !== v.correct
    );
    if (missedQuestions.length === 0) return;
    try {
      const existingMissed = JSON.parse(localStorage.getItem("rxt-missed-questions") || "[]");
      const newMissed = missedQuestions.map((q) => ({
        ...q,
        sessionDate: new Date().toISOString().split("T")[0],
        subject: cfg.subject,
        subtopic: cfg.subtopic,
        block: cfg.blockName,
        yourAnswer: answers[q.id],
        highlights: highlights[q.id] || [],
      }));
      const combined = [...existingMissed, ...newMissed].slice(-200);
      localStorage.setItem("rxt-missed-questions", JSON.stringify(combined));
    } catch (e) {
      console.warn("Save missed questions failed", e);
    }
  }, [done, vigs, results, highlights, cfg]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let list;
        if (cfg.mode === "block") {
          const weak = (() => {
            const m = {};
            (cfg.sessions || []).filter(s => s.blockId === cfg.blockId).forEach(s => {
              if (!m[s.subtopic]) m[s.subtopic] = { c:0, t:0 };
              m[s.subtopic].c += s.correct; m[s.subtopic].t += s.total;
            });
            return Object.entries(m).filter(([, v]) => pct(v.c, v.t) < 65).map(([k]) => k);
          })();
          list = await genBlockVignettes(cfg.blockLectures, cfg.qCount, weak, cfg.difficulty, cfg.questionType);
        } else {
          list = await genTopicVignettes(cfg.subject, cfg.subtopic, cfg.lecture.fullText, cfg.qCount, cfg.lecture.keyTerms, cfg.difficulty, cfg.questionType);
        }
        if (live) setVigs(list);
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const next = () => {
    const ok = sel === vigs[idx].correct;
    const nr = [
      ...results,
      { ok, topic: vigs[idx].topic || cfg.subtopic || "Review", questionId: vigs[idx].id, chosenAnswer: sel },
    ];
    if (idx + 1 >= vigs.length) {
      onDone({ correct: nr.filter(r => r.ok).length, total: nr.length, date: new Date().toISOString() });
      setResults(nr); setDone(true);
    } else {
      setResults(nr); setIdx(i => i + 1); setSel(null); setShown(false);
    }
  };

  if (loading) {
    const msg = cfg.mode === "block"
      ? "Building block exam — " + cfg.qCount + " questions from " + (cfg.blockLectures || []).length + " lectures…"
      : "Generating " + cfg.qCount + " vignettes for \"" + cfg.subtopic + "\"…";
    return <Spinner msg={msg} />;
  }

  if (error) return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 40 }}>
      <div style={{ fontFamily: MONO, color: "#ef4444", fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
        ⚠ Session error
      </div>
      <pre
        style={{
          background: T.border2,
          border: "1px solid " + T.border1,
          borderRadius: 8,
          padding: 16,
          color: T.text1,
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "auto",
          maxHeight: 280,
          marginBottom: 24,
          textAlign: "left",
        }}
        title="Full error message (copy for debugging)"
      >
        {error}
      </pre>
      <Btn onClick={onBack} color={T.border1}>← Back</Btn>
    </div>
  );

  if (done) {
    const score = pct(results.filter(r => r.ok).length, results.length);
    const m = mastery(score, T);
    const answers = Object.fromEntries(
      results.map((r) => [r.questionId, r.chosenAnswer]).filter(([, a]) => a != null)
    );
    const missedQuestions = vigs.filter(
      (v) => answers[v.id] != null && answers[v.id] !== v.correct
    );

    if (reviewMode && missedQuestions.length > 0) {
      return (
        <ReviewSession
          questions={missedQuestions}
          originalAnswers={answers}
          highlights={highlights}
          onClose={() => setReviewMode(false)}
          termColor={tc}
          renderStemWithHighlightsStatic={renderStemWithHighlightsStatic}
        />
      );
    }

    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:24, padding:"70px 40px" }}>
        <div style={{ fontFamily:SERIF, fontSize:22, color:T.text3 }}>Session Complete</div>
        <Ring score={score} size={130} tint={tc} />
        <p style={{ fontFamily:MONO, color:T.text3, fontSize:12 }}>{results.filter(r=>r.ok).length} / {results.length} correct</p>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap", justifyContent:"center", maxWidth:420 }}>
          {results.map((r, i) => (
            <div key={i} style={{ width:38, height:38, borderRadius:9, background:r.ok?"#021710":"#150404", border:"2px solid " + (r.ok?"#10b981":"#ef4444"), display:"flex", alignItems:"center", justifyContent:"center", color:r.ok?"#10b981":"#ef4444", fontSize:15 }}>
              {r.ok ? "✓" : "✗"}
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center", alignItems:"center" }}>
          <Btn onClick={onBack} color={tc} style={{ padding:"12px 32px", fontSize:14 }}>← Back to Block</Btn>
          {missedQuestions.length > 0 && (
            <button
              onClick={() => setReviewMode(true)}
              style={{
                background:"#0d1829",
                border:"1px solid #ef4444",
                color:"#ef4444",
                padding:"12px 28px",
                borderRadius:10,
                cursor:"pointer",
                fontFamily:SERIF,
                fontSize:15,
                fontWeight:700,
              }}
            >
              📋 Review {missedQuestions.length} Missed Question{missedQuestions.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>
    );
  }

  const v = vigs[idx];
  const CHOICES = ["A","B","C","D"];
  const dColor = { easy:"#10b981", medium:"#f59e0b", hard:"#ef4444" };
  const dc = dColor[v.difficulty] || "#f59e0b";

  return (
    <div style={{ maxWidth:840, margin:"0 auto", display:"flex", flexDirection:"column", gap:20 }}>
      {/* Progress bar */}
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:T.text4, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>← Exit</button>
        <div style={{ flex:1, height:4, background:T.cardBorder, borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:(idx/vigs.length*100)+"%", background:tc, borderRadius:2, transition:"width 0.4s" }} />
        </div>
        <span style={{ fontFamily:MONO, color:T.text4, fontSize:11 }}>{idx+1}/{vigs.length}</span>
      </div>

      {/* Difficulty + topic */}
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontFamily:MONO, background:dc+"18", color:dc, fontSize:11, padding:"3px 10px", borderRadius:20, letterSpacing:1.5, border:"1px solid " + dc+"30" }}>
          {(v.difficulty||"MEDIUM").toUpperCase()}
        </span>
        {v.topic && <span style={{ fontFamily:MONO, color:T.text5, fontSize:11 }}>{v.topic}</span>}
      </div>

      {/* Stem */}
      <div style={{ background:T.inputBg, border:"1px solid " + T.cardBorder, borderRadius:16, padding:28 }}>
        {v.imageQuestion ? (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {v.questionPageImage && (
              <div style={{ background:"#0d1829", borderRadius:12, overflow:"hidden", border:"1px solid #1a2a3a" }}>
                <img
                  src={"data:image/png;base64," + v.questionPageImage}
                  alt="Histology question slide"
                  style={{ width:"100%", display:"block", borderRadius:12 }}
                />
              </div>
            )}
            <p style={{ fontFamily:MONO, color:T.text5 || "#6b7280", fontSize:11, margin:0 }}>
              🔬 Identify the structures or select the correct answer based on the histological slide above.
            </p>
            {shown && v.answerPageImage && (
              <div>
                <div style={{ fontFamily:MONO, color:"#10b981", fontSize:11, marginBottom:8, letterSpacing:1 }}>
                  ✓ ANSWER — ANNOTATED SLIDE
                </div>
                <div style={{ background:"#021710", borderRadius:12, overflow:"hidden", border:"1px solid #10b98130" }}>
                  <img
                    src={"data:image/png;base64," + v.answerPageImage}
                    alt="Histology answer slide"
                    style={{ width:"100%", display:"block", borderRadius:12 }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <span style={{ fontFamily:MONO, color:"#374151", fontSize:10 }}>Highlight:</span>
              {["#fde047","#86efac","#93c5fd","#f9a8d4","#fca5a5"].map(c => (
                <div
                  key={c}
                  onClick={() => setHighlightColor(c)}
                  style={{
                    width:18,
                    height:18,
                    borderRadius:"50%",
                    background:c,
                    cursor:"pointer",
                    border: highlightColor === c ? "2px solid #fff" : "2px solid transparent",
                    transition:"transform 0.1s",
                    transform: highlightColor === c ? "scale(1.3)" : "scale(1)",
                  }}
                />
              ))}
              <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:10, marginLeft:4 }}>
                Select text to highlight · Click highlight to remove
              </span>
            </div>
            <div
              id={"stem-" + v.id}
              onMouseUp={() => handleStemMouseUp(v.id)}
              style={{ userSelect:"text", cursor:"text", lineHeight:1.8 }}
            >
              <p style={{ fontFamily:SERIF, color:T.text2, lineHeight:1.95, fontSize:15, margin:0 }}>
                {renderStemWithHighlights(v.stem, v.id)}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Choices */}
      <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
        {CHOICES.map(letter => {
          const isEliminated = (eliminated[v.id] || []).includes(letter);
          const isSelected   = sel === letter;
          const isCorrect    = shown && letter === v.correct;
          const isWrong      = shown && isSelected && letter !== v.correct;

          let bg = T.inputBg, border = T.cardBorder, color = T.text5;
          if (shown) {
            if (letter === v.correct)     { bg = "#021710"; border = "#10b981"; color = "#6ee7b7"; }
            else if (letter === sel)      { bg = "#150404"; border = "#ef4444"; color = "#fca5a5"; }
          } else if (isSelected) {
            bg = "#091830"; border = tc; color = "#93c5fd";
          }

          return (
            <div key={letter} style={{ display:"flex", alignItems:"flex-start", gap:8, opacity: isEliminated ? 0.4 : 1 }}>
              {!shown && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleEliminate(v.id, letter); }}
                  title={isEliminated ? "Restore choice" : "Eliminate this choice"}
                  style={{
                    flexShrink: 0, width: 20, height: 20, marginTop: 2, borderRadius: 4,
                    background: "none", border: "1px solid " + T.cardBorder, color: isEliminated ? "#ef4444" : T.text5,
                    cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#ef4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = isEliminated ? "#ef4444" : T.cardBorder; }}
                >
                  {isEliminated ? "↩" : "✕"}
                </button>
              )}
              <div
                onClick={() => !shown && !isEliminated && setSel(letter)}
                style={{
                  flex: 1,
                  background: bg,
                  border: "1px solid " + border,
                  borderRadius: 11,
                  padding: "14px 18px",
                  cursor: shown || isEliminated ? "default" : "pointer",
                  display: "flex",
                  gap: 13,
                  color,
                  fontFamily: MONO,
                  fontSize: 13,
                  lineHeight: 1.65,
                  transition: "background 0.1s, border-color 0.1s",
                  textDecoration: isEliminated ? "line-through" : "none",
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 22 }}>{letter}.</span>
                <span style={{ flex: 1, color: isEliminated ? T.text5 : color }}>{v.choices[letter]}</span>
                {shown && letter === v.correct && <span style={{ color: "#10b981" }}>✓</span>}
                {shown && letter === sel && letter !== v.correct && <span style={{ color: "#ef4444" }}>✗</span>}
              </div>
            </div>
          );
        })}
      </div>
      {!shown && (
        <p style={{ fontFamily: MONO, color: T.text5 || "#2d3d4f", fontSize: 10, marginTop: 8 }}>
          ✕ Click the X button next to a choice to eliminate it · Click ↩ to restore
        </p>
      )}

      {/* Explanation */}
      {shown && (
        <div style={{ background:T.rowExpanded, border:"1px solid " + T.border1, borderRadius:14, padding:24 }}>
          <div style={{ fontFamily:MONO, color:"#3b82f6", fontSize:11, letterSpacing:3, marginBottom:12 }}>EXPLANATION</div>
          <p style={{ fontFamily:SERIF, color:T.text2, lineHeight:1.95, fontSize:14, margin:0 }}>{v.explanation}</p>
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
        {!shown
          ? <Btn onClick={() => setShown(true)} color={tc} disabled={!sel}>Reveal Answer</Btn>
          : <Btn onClick={next} color="#10b981">{idx+1>=vigs.length ? "Finish ✓" : "Next →"}</Btn>
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EDITABLE TEXT (theme-aware)
// ─────────────────────────────────────────────
function EditableText({ value, onChange, style, placeholder }) {
  const { T } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef();
  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const commit = () => { setEditing(false); if (draft.trim() !== value) onChange(draft.trim()); };
  return editing ? (
    <input
      ref={ref}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
      }}
      style={{
        background: T.inputBg,
        border: "1px solid #3b82f6",
        color: T.text1,
        fontFamily: "'DM Mono','Courier New',monospace",
        fontSize: 13,
        padding: "2px 8px",
        borderRadius: 5,
        outline: "none",
        width: "100%",
        ...style,
      }}
    />
  ) : (
    <div
      onClick={() => setEditing(true)}
      title={placeholder || "Click to edit"}
      style={{ cursor: "text", display: "flex", alignItems: "center", gap: 6, ...style }}
      onMouseEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
    >
      <span>{value || placeholder || "Click to set"}</span>
      <span style={{ fontSize: 10, opacity: 0.5 }}>✏</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// LECTURE CARD
// ─────────────────────────────────────────────
function LecCard({ lec, sessions, accent, tint, onStudy, onDelete, onUpdateLec }) {
  const { T } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const confirmTimeoutRef = useRef(null);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicDraft, setNewTopicDraft] = useState("");
  const addTopicRef = useRef();

  const clearConfirmTimeout = () => {
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
  };

  const startConfirm = (e) => {
    e.stopPropagation();
    clearConfirmTimeout();
    setConfirming(true);
    confirmTimeoutRef.current = setTimeout(() => setConfirming(false), 3000);
  };

  const cancelConfirm = (e) => {
    e?.stopPropagation();
    clearConfirmTimeout();
    setConfirming(false);
  };

  const doDelete = (e) => {
    e.stopPropagation();
    clearConfirmTimeout();
    setConfirming(false);
    onDelete(lec.id);
  };

  useEffect(() => () => clearConfirmTimeout(), []);
  useEffect(() => { if (addingTopic && addTopicRef.current) addTopicRef.current.focus(); }, [addingTopic]);

  const lecSess = sessions.filter(s => s.lectureId === lec.id);
  const overall = lecSess.length
    ? pct(lecSess.reduce((a,s)=>a+s.correct,0), lecSess.reduce((a,s)=>a+s.total,0))
    : null;

  return (
    <div style={{ background:T.cardBg, border:"1px solid "+accent+"22", borderRadius:14, padding:18, display:"flex", flexDirection:"column", gap:12, position:"relative", boxShadow:T.cardShadow }}>
      <div style={{ position:"absolute", top:12, right:12, zIndex:10, display:"flex", alignItems:"center", gap:4, pointerEvents:"auto" }}>
        {confirming ? (
          <>
            <button onClick={cancelConfirm} style={{ background:T.border1, border:"1px solid " + T.text5, color:T.text5, padding:"4px 10px", borderRadius:6, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Cancel</button>
            <button onClick={doDelete} style={{ background:"#7f1d1d", border:"1px solid #991b1b", color:"#fca5a5", padding:"4px 10px", borderRadius:6, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Delete</button>
          </>
        ) : (
          <button onClick={startConfirm} style={{ background:T.border1, border:"1px solid " + T.text5, color:T.text5, cursor:"pointer", fontSize:12, width:24, height:24, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center" }} title="Delete lecture">✕</button>
        )}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", paddingRight:20 }}>
        <div style={{ flex:1 }}>
          <div style={{ marginBottom:2 }}>
            <EditableText
              value={lec.subject}
              onChange={newSubject => onUpdateLec(lec.id, { subject: newSubject })}
              style={{ fontFamily:SERIF, color:accent, fontWeight:700, fontSize:14 }}
              placeholder="Click to set subject"
            />
          </div>
          <div style={{ marginBottom:2 }}>
            <EditableText
              value={lec.lectureTitle}
              onChange={newTitle => onUpdateLec(lec.id, { lectureTitle: newTitle })}
              style={{ fontFamily:MONO, color:T.text2, fontSize:12 }}
              placeholder="Click to set title"
            />
          </div>
          <div style={{ fontFamily:MONO, color:T.text5, fontSize:12, marginTop:2 }}>{lec.filename}</div>
        </div>
        <Ring score={overall} size={52} tint={tint} />
      </div>

      {overall !== null && (
        <div style={{ height:3, background:T.border1, borderRadius:2 }}>
          <div style={{ width:overall+"%", height:"100%", background:accent, borderRadius:2, transition:"width 1s" }} />
        </div>
      )}

      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
        {(lec.keyTerms||[]).slice(0,5).map(kt => (
          <span key={kt} style={{ fontFamily:MONO, background:T.border2, color:T.text4, fontSize:11, padding:"2px 8px", borderRadius:20 }}>{kt}</span>
        ))}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {(lec.subtopics||[]).map(sub => {
          const sp = getScore(sessions, s => s.lectureId===lec.id && s.subtopic===sub);
          const m = mastery(sp, T);
          return (
            <div key={sub}
              onClick={() => onStudy(lec, sub)}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:m.bg, border:"1px solid "+m.border, borderRadius:8, padding:"8px 12px", cursor:"pointer", transition:"padding-left 0.1s, border-color 0.1s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=m.fg; e.currentTarget.style.paddingLeft="16px"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=m.border; e.currentTarget.style.paddingLeft="12px"; }}>
              <span style={{ fontFamily:MONO, color:T.text2, fontSize:12 }}>{sub}</span>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontFamily:MONO, color:m.fg, fontWeight:700, fontSize:14 }}>{sp!==null ? sp+"%" : "—"}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onUpdateLec(lec.id, { subtopics: (lec.subtopics||[]).filter(s => s !== sub) }); }}
                  style={{ background:"none", border:"none", color:T.text5, cursor:"pointer", fontSize:12, padding:2, lineHeight:1 }}
                  title="Remove topic"
                >✕</button>
                <span style={{ color:accent, fontSize:11 }}>▶</span>
              </div>
            </div>
          );
        })}
        {addingTopic ? (
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <input
              ref={addTopicRef}
              value={newTopicDraft}
              onChange={e => setNewTopicDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const t = newTopicDraft.trim();
                  if (t) { onUpdateLec(lec.id, { subtopics: [...(lec.subtopics||[]), t] }); setNewTopicDraft(""); setAddingTopic(false); }
                }
                if (e.key === "Escape") { setNewTopicDraft(""); setAddingTopic(false); }
              }}
              style={{ flex:1, background:T.inputBg, border:"1px solid "+T.border1, color:T.text1, fontFamily:MONO, fontSize:12, padding:"6px 10px", borderRadius:6, outline:"none" }}
              placeholder="Topic name…"
            />
            <button type="button" onClick={() => { const t = newTopicDraft.trim(); if (t) { onUpdateLec(lec.id, { subtopics: [...(lec.subtopics||[]), t] }); setNewTopicDraft(""); } setAddingTopic(false); }} style={{ background:accent, border:"none", color:"#fff", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Add</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingTopic(true)} style={{ background:T.border1, border:"1px dashed "+T.text5, color:T.text5, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:11, textAlign:"left" }}>+ Add Topic</button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HEATMAP
// ─────────────────────────────────────────────
function Heatmap({ lectures, sessions, onStudy }) {
  const { T } = useTheme();
  if (!lectures.length) return (
    <div style={{ background:T.cardBg, border:"1px dashed " + T.cardBorder, borderRadius:14, padding:50, textAlign:"center", boxShadow:T.cardShadow }}>
      <p style={{ fontFamily:MONO, color:T.text5, fontSize:12 }}>Upload lectures to see the heatmap.</p>
    </div>
  );
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {lectures.map((lec, li) => {
        const overall = getScore(sessions, s => s.lectureId===lec.id);
        const m = mastery(overall, T);
        const ac = PALETTE[li % PALETTE.length];
        return (
          <div key={lec.id} style={{ background:T.cardBg, border:"1px solid "+ac+"18", borderRadius:12, padding:16, boxShadow:T.cardShadow }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div>
                <span style={{ fontFamily:MONO, color:ac, fontSize:12, fontWeight:600 }}>{lec.lectureTitle}</span>
                <span style={{ fontFamily:MONO, color:T.text5, fontSize:12, marginLeft:8 }}>{lec.subject}</span>
              </div>
              <span style={{ fontFamily:MONO, color:m.fg, fontWeight:700, fontSize:14 }}>{overall!==null ? overall+"%" : "—"}</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px,1fr))", gap:6 }}>
              {(lec.subtopics||[]).map(sub => {
                const sp = getScore(sessions, s => s.lectureId===lec.id && s.subtopic===sub);
                const sm = mastery(sp, T);
                return (
                  <div key={sub}
                    onClick={() => onStudy(lec, sub)}
                    style={{ background:sm.bg, border:"1px solid "+sm.border, borderRadius:7, padding:"7px 11px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color 0.1s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=sm.fg; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=sm.border; }}>
                    <span style={{ fontFamily:MONO, color:T.text5, fontSize:11 }}>{sub}</span>
                    <span style={{ fontFamily:MONO, color:sm.fg, fontWeight:700, fontSize:14, flexShrink:0, marginLeft:6 }}>{sp!==null ? sp+"%" : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [terms,    setTerms]    = useState([]);
  const [lectures, setLecs]     = useState([]);
  const [sessions, setSessions] = useState([]);
  const [analyses, setAnalyses] = useState({});
  const [ready,    setReady]    = useState(false);
  const [saveMsg,  setSaveMsg]  = useState("");

  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("rxt-theme") || "dark";
  });
  const isDark = theme === "dark";

  const [view,    setView]    = useState("block");
  const [termId,  setTermId]  = useState("term1");
  const [blockId, setBlockId] = useState("ftm2");
  const [tab,     setTab]     = useState("lectures");
  const [studyCfg, setStudyCfg] = useState(null);
  const [trackerKey, setTrackerKey] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg]         = useState("");
  const [aLoading, setALoading]   = useState(false);
  const [sidebar, setSidebar]     = useState(true);
  const [drag, setDrag]           = useState(false);

  const [newTermName,  setNewTermName]  = useState("");
  const [newBlockName, setNewBlockName] = useState("");
  const [showNewTerm,  setShowNewTerm]  = useState(false);
  const [showNewBlk,   setShowNewBlk]  = useState(null);

  const [learningProfile, setLearningProfile] = useState(() => loadProfile());
  const saveRef = useRef(null);

  // ── Load from storage ──────────────────────
  useEffect(() => {
    (async () => {
      try {
        const t = await sGet("rxt-terms");
        const s = await sGet("rxt-sessions");
        const a = await sGet("rxt-analyses");
        const l = await loadLectures();
        setTerms(t || DEFAULT_TERMS);
        setSessions(s || []);
        setAnalyses(a || {});
        setLecs(l || []);
      } catch (e) {
        console.error(e);
        setTerms(DEFAULT_TERMS);
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("rxt-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    saveProfile(learningProfile);
  }, [learningProfile]);

  // ── Auto-save ──────────────────────────────
  const save = (t, s, a) => {
    if (!ready) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    setSaveMsg("saving");
    saveRef.current = setTimeout(async () => {
      await sSet("rxt-terms", t);
      await sSet("rxt-sessions", s);
      await sSet("rxt-analyses", a);
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(""), 2500);
    }, 700);
  };

  useEffect(() => { if (ready) save(terms, sessions, analyses); }, [terms, sessions, analyses, ready]);
  useEffect(() => { if (ready) saveLectures(lectures); }, [lectures, ready]);

  // ── Derived ────────────────────────────────
  const activeTerm  = terms.find(t => t.id === termId);
  const activeBlock = activeTerm?.blocks.find(b => b.id === blockId);
  const blockLecs   = lectures.filter(l => l.blockId === blockId);
  const tc          = activeTerm?.color || "#ef4444";

  const bScore = (bid) => {
    const bs = sessions.filter(s => s.blockId === bid);
    if (!bs.length) return null;
    return pct(bs.reduce((a,s)=>a+s.correct,0), bs.reduce((a,s)=>a+s.total,0));
  };

  // ── Term / Block CRUD ──────────────────────
  const addTerm = () => {
    if (!newTermName.trim()) return;
    setTerms(p => [...p, { id:uid(), name:newTermName.trim(), color:"#3b82f6", blocks:[] }]);
    setNewTermName(""); setShowNewTerm(false);
  };
  const delTerm = (id) => {
    setTerms(p => p.filter(t => t.id !== id));
    setLecs(p => p.filter(l => l.termId !== id));
  };
  const addBlock = (tid) => {
    if (!newBlockName.trim()) return;
    setTerms(p => p.map(t => t.id===tid ? { ...t, blocks:[...t.blocks, { id:uid(), name:newBlockName.trim(), status:"upcoming" }] } : t));
    setNewBlockName(""); setShowNewBlk(null);
  };
  const delBlock = (tid, bid) => {
    setTerms(p => p.map(t => t.id===tid ? { ...t, blocks:t.blocks.filter(b => b.id!==bid) } : t));
    lectures.filter(l => l.blockId===bid).forEach(l => sDel("rxt-lec-"+l.id));
    setLecs(p => p.filter(l => l.blockId !== bid));
    if (blockId === bid) { setBlockId(null); setView("overview"); }
  };
  const setStatus = (tid, bid, status) =>
    setTerms(p => p.map(t => t.id===tid ? { ...t, blocks:t.blocks.map(b => b.id===bid ? { ...b, status } : b) } : t));
  const updateLec = (id, patch) => {
    setLecs(prev => {
      const updated = prev.map(l => l.id === id ? { ...l, ...patch } : l);
      saveLectures(updated);
      return updated;
    });
  };
  const delLec = (id) => {
    setLecs(prev => {
      const next = prev.filter(l => l.id !== id);
      (async () => {
        await sDel("rxt-lec-" + id);
        await saveLectures(next);
      })();
      return next;
    });
  };

  const clearBlockLectures = () => {
    if (!blockId || !activeBlock) return;
    if (!window.confirm("Delete all " + blockLecs.length + " lecture" + (blockLecs.length !== 1 ? "s" : "") + " in " + activeBlock.name + "? This cannot be undone.")) return;
    const ids = blockLecs.map(l => l.id);
    setLecs(prev => {
      const next = prev.filter(l => l.blockId !== blockId);
      (async () => {
        for (const id of ids) await sDel("rxt-lec-" + id);
        await saveLectures(next);
      })();
      return next;
    });
  };

  // ── Upload ─────────────────────────────────
  const handleFiles = async (files, bid, tid) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    const total = fileList.length;
    let added = 0;
    let failed = 0;
    const addedInBatch = new Set();
    setUploading(true);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

      const existingInBlock = lectures.some(l => l.blockId === bid && l.filename === file.name);
      const existingInBatch = addedInBatch.has(file.name);
      if ((existingInBlock || existingInBatch) && !window.confirm("A lecture named \"" + file.name + "\" already exists in this block. Replace it?")) {
        failed++;
        continue;
      }

      try {
        setUpMsg("Reading file " + (i + 1) + " of " + total + "...");
        let text = isPdf ? await readPDF(file) : await file.text();
        text = (text || "").trim();

        if (!text) {
          setUpMsg("⚠ No text in " + file.name);
          failed++;
          continue;
        }
        if (isPdf && text.length < 100) {
          setUpMsg("⚠ PDF appears to be image-based or scanned — text extraction failed. Try a text-based PDF.");
          failed++;
          continue;
        }

        setUpMsg("Analyzing with AI (file " + (i + 1) + " of " + total + ")...");
        let meta;
        let aiFailed = false;
        try {
          meta = await detectMeta(text);
        } catch {
          meta = { subject: "Unassigned", subtopics: ["Unknown"], keyTerms: [], lectureTitle: file.name };
          aiFailed = true;
        }
        let subjectWarning = false;
        const rawSubject = (meta.subject || "").trim();
        if (["Medicine", "Unknown", "General", ""].includes(rawSubject)) {
          meta = { ...meta, subject: "Unassigned" };
          subjectWarning = true;
        }

        const lec = { id: uid(), blockId: bid, termId: tid, filename: file.name, uploadedAt: new Date().toISOString(), fullText: text.slice(0, 12000), ...meta };
        setLecs(p => [...p.filter(l => !(l.blockId === bid && l.filename === file.name)), lec]);
        added++;
        addedInBatch.add(file.name);
        if (subjectWarning) {
          setUpMsg("⚠ Subject not detected — click the subject name on the card to edit it");
        } else {
          setUpMsg(aiFailed ? "⚠ AI analysis failed, lecture added with basic info" : "✓ Done");
        }
      } catch (e) {
        setUpMsg("✗ " + file.name + ": " + (e.message || String(e)));
        failed++;
      }
    }

    setUploading(false);
    const parts = [];
    if (added) parts.push("✓ Added " + added + " lecture" + (added !== 1 ? "s" : ""));
    if (failed) parts.push("⚠ " + failed + " failed");
    setUpMsg(parts.length ? parts.join(", ") : "No files processed.");
    setTimeout(() => setUpMsg(""), 8000);
  };

  // ── Study ──────────────────────────────────
  const startTopic = (lec, sub) => {
    setStudyCfg({
      mode: "lecture",
      lecture: lec,
      subject: lec.subject,
      subtopic: sub,
      qCount: 10,
      blockId: lec.blockId,
      blockName: activeBlock?.name || lec.blockId,
      sessions,
      termColor: tc,
    });
    setView("config");
  };

  const startBlock = () => {
    if (!blockLecs.length) return;
    setStudyCfg({
      mode: "block",
      blockLectures: blockLecs,
      qCount: 10,
      blockId,
      blockName: activeBlock?.name || blockId,
      sessions,
      termColor: tc,
    });
    setView("config");
  };
  const onSessionDone = ({ correct, total, date }) => {
    const base = { id:uid(), blockId, termId, correct, total, date };
    const subject = studyCfg.mode === "lecture" ? studyCfg.subject : "Block Exam";
    const subtopic = studyCfg.mode === "lecture" ? studyCfg.subtopic : "Comprehensive";
    if (studyCfg.mode === "lecture") {
      setSessions(p => [...p, { ...base, lectureId:studyCfg.lecture.id, subject, subtopic }]);
    } else {
      setSessions(p => [...p, { ...base, lectureId:null, subject, subtopic }]);
    }
    syncSessionToTracker({ correct, total }, studyCfg);
    setTrackerKey(k => k + 1);
    let nextProfile = learningProfile;
    for (let i = 0; i < correct; i++) {
      nextProfile = recordAnswer(nextProfile, subject, subtopic, true, "clinicalVignette");
    }
    for (let i = 0; i < total - correct; i++) {
      nextProfile = recordAnswer(nextProfile, subject, subtopic, false, "clinicalVignette");
    }
    setLearningProfile(nextProfile);
    saveProfile(nextProfile);
    setView("block"); setStudyCfg(null);
  };

  const runAnalysis = async () => {
    setALoading(true);
    const text = await genAnalysis(sessions.filter(s => s.blockId===blockId), blockLecs);
    setAnalyses(p => ({ ...p, [blockId]:text }));
    setALoading(false);
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  const t = themes[theme] || themes.dark;
  const themeValue = { T: t, isDark, setTheme };

  if (!ready) return (
    <ThemeContext.Provider value={themeValue}>
      <div style={{ minHeight:"100vh", background:t.appBg, color:t.text1, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <Spinner msg="Loading RxTrack…" />
      </div>
    </ThemeContext.Provider>
  );

  const INPUT = { background:t.inputBg, border:"1px solid "+t.border1, color:t.text1, padding:"7px 12px", borderRadius:7, fontFamily:MONO, fontSize:12, outline:"none", width:"100%" };
  const CARD  = { background:t.cardBg, border:"1px solid "+t.cardBorder, borderRadius:14, padding:20, boxShadow:t.cardShadow };

  return (
    <ThemeContext.Provider value={themeValue}>
    <div style={{ minHeight:"100vh", background:t.appBg, color:t.text1, display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
        @keyframes rxt-spin { to { transform:rotate(360deg); } }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:${t.scrollbarTrack}; }
        ::-webkit-scrollbar-thumb { background:${t.scrollbarThumb}; border-radius:2px; }
        input[type=range] { -webkit-appearance:none; height:4px; background:${t.border1}; border-radius:2px; outline:none; cursor:pointer; width:100%; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:#ef4444; cursor:pointer; }
      `}</style>

      {/* NAV */}
      <nav style={{ height:52, borderBottom:"1px solid "+t.navBorder, boxShadow:t.navShadow, display:"flex", alignItems:"center", padding:"0 20px", gap:12, position:"sticky", top:0, background:t.navBg, color:t.text1, backdropFilter:"blur(14px)", zIndex:300, flexShrink:0 }}>
        <button onClick={() => setSidebar(p=>!p)} style={{ background:"none", border:"none", color:"inherit", cursor:"pointer", fontSize:18, padding:"0 4px" }}>☰</button>

        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="#ef4444" strokeWidth="1.5"/>
            <path d="M10 4v6.2l3.2 1.8" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontFamily:SERIF, fontWeight:900, fontSize:16, color:"inherit" }}>Rx<span style={{ color:"#ef4444" }}>Track</span></span>
        </div>

        {(view==="block"||view==="study"||view==="config") && activeTerm && activeBlock && (
          <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:4, color:"inherit" }}>
            <span>›</span>
            <button onClick={() => setView("overview")} style={{ background:"none", border:"none", color:"inherit", cursor:"pointer", fontFamily:MONO, fontSize:13 }}>{activeTerm.name}</button>
            <span>›</span>
            <span style={{ fontFamily:MONO, color:tc, fontSize:13, fontWeight:600 }}>{activeBlock.name}</span>
            {view==="config" && <><span>›</span><span style={{ fontFamily:MONO, fontSize:13 }}>Configure</span></>}
            {view==="study" && <><span>›</span><span style={{ fontFamily:MONO, fontSize:13 }}>Session</span></>}
          </div>
        )}

        {saveMsg && (
          <span style={{ fontFamily:MONO, fontSize:11, color:saveMsg==="saved"?"#10b981":"#f59e0b", marginLeft:8 }}>
            {saveMsg==="saving" ? "⟳ Saving…" : "✓ Saved"}
          </span>
        )}

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          {[["overview","Overview"],["tracker","📋 Tracker"],["learn","🧠 Learn"],["analytics","Analytics"]].map(([v,l]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: view===v ? t.border2 : "none",
                border:"none",
                color:"inherit",
                padding:"5px 14px",
                borderRadius:7,
                cursor:"pointer",
                fontFamily:MONO,
                fontSize:13,
              }}>
              {l}
            </button>
          ))}
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            style={{
              background:"none",
              border:"1px solid "+t.cardBorder,
              borderRadius:999,
              padding:"4px 10px",
              cursor:"pointer",
              fontFamily:MONO,
              fontSize:11,
              color:"inherit",
            }}>
            {isDark ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>
      </nav>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* SIDEBAR */}
        {sidebar && (
          <aside style={{ width:228, borderRight:"1px solid "+t.border2, background:t.sidebarBg, display:"flex", flexDirection:"column", position:"sticky", top:52, height:"calc(100vh - 52px)", overflowY:"auto", flexShrink:0 }}>
            <div style={{ padding:"13px 14px 9px", borderBottom:"1px solid " + t.border2 }}>
              <div style={{ fontFamily:MONO, color:t.text4, fontSize:11, letterSpacing:2.5 }}>TERMS & BLOCKS</div>
            </div>

            {terms.map(term => (
              <div key={term.id}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px 5px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:term.color, flexShrink:0 }} />
                    <span style={{ fontFamily:MONO, color:isDark?t.text2:"#0f172a", fontSize:13, fontWeight:600 }}>{term.name}</span>
                  </div>
                  <div style={{ display:"flex", gap:3 }}>
                    <button onClick={() => setShowNewBlk(showNewBlk===term.id ? null : term.id)} style={{ background:"none", border:"none", color:t.text5, cursor:"pointer", fontSize:16, lineHeight:1, padding:2 }}>+</button>
                    <button onClick={() => delTerm(term.id)} style={{ background:"none", border:"none", color:t.border1, cursor:"pointer", fontSize:11, lineHeight:1, padding:2 }}>✕</button>
                  </div>
                </div>

                {showNewBlk===term.id && (
                  <div style={{ padding:"0 10px 8px", display:"flex", gap:5 }}>
                    <input style={INPUT} placeholder="Block name…" value={newBlockName} onChange={e=>setNewBlockName(e.target.value)}
                      onKeyDown={e=>{ if(e.key==="Enter") addBlock(term.id); if(e.key==="Escape"){ setShowNewBlk(null); setNewBlockName(""); } }} autoFocus />
                    <button onClick={() => addBlock(term.id)} style={{ background:term.color, border:"none", color:"#fff", padding:"6px 10px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600, flexShrink:0 }}>+</button>
                  </div>
                )}

                {term.blocks.map(block => {
                  const sc = bScore(block.id);
                  const isActive = blockId===block.id && view==="block";
                  const st = BLOCK_STATUS[block.status] || BLOCK_STATUS.upcoming;
                  const lc = lectures.filter(l => l.blockId===block.id).length;
                  return (
                    <div key={block.id}
                      onClick={() => { setBlockId(block.id); setTermId(term.id); setView("block"); setTab("lectures"); }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background=t.border2; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background="transparent"; }}
                      style={{ padding:"7px 14px 7px 22px", cursor:"pointer", background:isActive?(isDark?term.color+"18":term.color+"26"):"transparent", borderLeft:"2px solid "+(isActive?term.color:"transparent"), display:"flex", alignItems:"center", justifyContent:"space-between", transition:"background 0.1s", gap:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
                        <span style={{ color:st.color, fontSize:11, flexShrink:0 }}>{st.icon}</span>
                        <span style={{ fontFamily:MONO, color:isDark?(isActive?t.text1:t.text4):"#0f172a", fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{block.name}</span>
                        {lc>0 && <span style={{ fontFamily:MONO, color:t.text4, fontSize:11, flexShrink:0 }}>{lc}</span>}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                        {sc!==null && <span style={{ fontFamily:MONO, color:mastery(sc, t).fg, fontSize:14, fontWeight:700 }}>{sc}%</span>}
                        <button onClick={e=>{ e.stopPropagation(); delBlock(term.id, block.id); }} style={{ background:"none", border:"none", color:t.border2, cursor:"pointer", fontSize:11, padding:1 }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{ padding:"12px 14px", borderTop:"1px solid " + t.border2, marginTop:8 }}>
              {showNewTerm ? (
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  <input style={INPUT} placeholder="e.g. Term 2" value={newTermName} onChange={e=>setNewTermName(e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Enter") addTerm(); if(e.key==="Escape"){ setShowNewTerm(false); setNewTermName(""); } }} autoFocus />
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={addTerm} style={{ background:"#3b82f6", border:"none", color:"#fff", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600, flex:1 }}>Add</button>
                    <button onClick={() => { setShowNewTerm(false); setNewTermName(""); }} style={{ background:t.border1, border:"none", color:isDark?"#fff":t.text1, padding:"6px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600 }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNewTerm(true)} style={{ background:"none", border:"1px dashed " + t.border1, color:t.text5, padding:"7px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, width:"100%" }}>+ Add Term</button>
              )}
            </div>

            <div style={{ padding:"10px 14px 16px", marginTop:"auto", borderTop:"1px solid " + t.border2 }}>
              {[["Questions answered",sessions.reduce((a,s)=>a+s.total,0)],["Sessions",sessions.length],["Lectures",lectures.length]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ fontFamily:MONO, color:t.text4, fontSize:11 }}>{l}</span>
                  <span style={{ fontFamily:MONO, color:t.text4, fontSize:12, fontWeight:600 }}>{v}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* MAIN */}
        <main style={{ flex:1, overflowY:"auto", maxHeight:"calc(100vh - 52px)" }}>

          {view === "config" && studyCfg && (
            <div style={{ padding: "20px 32px" }}>
              <SessionConfig
                cfg={studyCfg}
                termColor={tc}
                onBack={() => setView("block")}
                onStart={(finalCfg) => {
                  setStudyCfg(finalCfg);
                  setView("study");
                }}
              />
            </div>
          )}

          {/* STUDY */}
          {view==="study" && studyCfg && (
            <div style={{ padding:"32px 36px" }}>
              <Session cfg={studyCfg} onDone={onSessionDone} onBack={() => { setView("block"); setStudyCfg(null); }} />
            </div>
          )}

          {/* TRACKER */}
          {view==="tracker" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:20, height:"100%" }}>
              <Tracker key={trackerKey} />
            </div>
          )}

          {/* LEARNING MODEL */}
          {view === "learn" && (
            <div style={{ flex:1, overflow:"auto" }}>
              <LearningModel
                profile={learningProfile}
                onProfileUpdate={(p) => { setLearningProfile(p); saveProfile(p); }}
                sessions={sessions}
                lectures={lectures}
              />
            </div>
          )}

          {/* OVERVIEW */}
          {view==="overview" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:26 }}>
              <div>
                <h1 style={{ fontFamily:SERIF, fontSize:30, fontWeight:900, letterSpacing:-1 }}>Study <span style={{ color:"#ef4444" }}>Overview</span></h1>
                <p style={{ fontFamily:MONO, color:t.text4, fontSize:11, marginTop:5, letterSpacing:2 }}>PRE-CLINICAL · M1/M2 · STEP 1</p>
              </div>
              {(() => {
                const tq=sessions.reduce((a,s)=>a+s.total,0);
                const tc2=sessions.reduce((a,s)=>a+s.correct,0);
                const ov=tq?pct(tc2,tq):null;
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                    {[
                      { l:"Overall Score", v:ov!==null?ov+"%":"—", c:mastery(ov, t).fg },
                      { l:"Blocks Active", v:terms.flatMap(t=>t.blocks).filter(b=>b.status!=="upcoming").length, c:"#f59e0b" },
                      { l:"Lectures", v:lectures.length, c:"#60a5fa" },
                      { l:"Questions Done", v:tq, c:"#a78bfa" },
                    ].map(({ l,v,c })=>(
                      <div key={l} style={CARD}>
                        <div style={{ fontFamily:MONO, color:t.text4, fontSize:11, letterSpacing:1.5, marginBottom:6 }}>{l.toUpperCase()}</div>
                        <div style={{ fontFamily:SERIF, color:c, fontSize:26, fontWeight:900 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {terms.length===0 ? (
                <div style={{ ...CARD, border:"1px dashed " + t.cardBorder, padding:80, textAlign:"center" }}>
                  <div style={{ fontSize:48, marginBottom:14 }}>🏥</div>
                  <p style={{ fontFamily:MONO, color:t.text5, fontSize:13 }}>Use the sidebar to add terms and blocks.</p>
                </div>
              ) : terms.map(term => (
                <div key={term.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:term.color }} />
                    <h2 style={{ fontFamily:SERIF, fontSize:18, fontWeight:700 }}>{term.name}</h2>
                    <div style={{ flex:1, height:1, background:t.border2 }} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
                    {term.blocks.map(block => {
                      const sc=bScore(block.id);
                      const m=mastery(sc);
                      const st=BLOCK_STATUS[block.status]||BLOCK_STATUS.upcoming;
                      const lc=lectures.filter(l=>l.blockId===block.id).length;
                      const isCur=block.id==="ftm2";
                      return (
                        <div key={block.id}
                          onClick={() => { setBlockId(block.id); setTermId(term.id); setView("block"); setTab("lectures"); }}
                          onMouseEnter={e=>{ e.currentTarget.style.borderColor=term.color+"50"; e.currentTarget.style.transform="translateY(-2px)"; }}
                          onMouseLeave={e=>{ e.currentTarget.style.borderColor=isCur?term.color+"40":term.color+"15"; e.currentTarget.style.transform="none"; }}
                          style={{ ...CARD, border:"1px solid "+(isCur?term.color+"40":term.color+"15"), cursor:"pointer", transition:"all 0.15s", position:"relative", boxShadow:isCur?"0 0 24px "+term.color+(isDark?"14":"26"):"none" }}>
                          {isCur && <div style={{ position:"absolute", top:-1, right:10, background:term.color, color:"#fff", fontFamily:MONO, fontSize:11, padding:"2px 8px", borderRadius:"0 0 6px 6px", letterSpacing:1 }}>CURRENT</div>}
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                            <div>
                              <div style={{ fontFamily:MONO, color:t.text2, fontSize:13, fontWeight:600 }}>{block.name}</div>
                              <div style={{ fontFamily:MONO, color:st.color, fontSize:11, marginTop:3 }}>{st.icon} {st.label.toUpperCase()}</div>
                            </div>
                            <Ring score={sc} size={46} tint={term.color} />
                          </div>
                          {sc!==null && <div style={{ height:2, background:t.border1, borderRadius:1, marginBottom:8 }}><div style={{ width:sc+"%", height:"100%", background:term.color, borderRadius:1 }} /></div>}
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <span style={{ fontFamily:MONO, color:t.text5, fontSize:12 }}>{lc} lecture{lc!==1?"s":""}</span>
                            <div style={{ display:"flex", gap:3 }} onClick={e=>e.stopPropagation()}>
                              {Object.entries(BLOCK_STATUS).map(([s,cfg])=>(
                                <button key={s} onClick={()=>setStatus(term.id,block.id,s)} style={{ background:block.status===s?cfg.color+"20":"none", border:"1px solid "+(block.status===s?cfg.color:t.border2), color:block.status===s?cfg.color:t.text4, padding:"2px 6px", borderRadius:4, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>{cfg.icon}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BLOCK VIEW */}
          {view==="block" && activeBlock && activeTerm && (
            <div style={{ padding:"28px 32px", display:"flex", flexDirection:"column", gap:22 }}>
              {/* Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:14 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:tc }} />
                    <span style={{ fontFamily:MONO, color:t.text3, fontSize:13 }}>{activeTerm.name}</span>
                    <span style={{ color:t.text4 }}>›</span>
                    <span style={{ fontFamily:MONO, color:(BLOCK_STATUS[activeBlock.status]||BLOCK_STATUS.upcoming).color, fontSize:11 }}>
                      {(BLOCK_STATUS[activeBlock.status]||BLOCK_STATUS.upcoming).icon} {(BLOCK_STATUS[activeBlock.status]||BLOCK_STATUS.upcoming).label.toUpperCase()}
                    </span>
                  </div>
                  <h1 style={{ fontFamily:SERIF, fontSize:28, fontWeight:900, letterSpacing:-0.5, color:t.text1 }}>{activeBlock.name}</h1>
                  <div style={{ display:"flex", gap:18, marginTop:6 }}>
                    {[["Lectures",blockLecs.length],["Sessions",sessions.filter(s=>s.blockId===blockId).length],["Questions",sessions.filter(s=>s.blockId===blockId).reduce((a,s)=>a+s.total,0)]].map(([l,v])=>(
                      <span key={l} style={{ fontFamily:MONO, color:t.text5, fontSize:11 }}><span style={{ color:t.text3, fontWeight:600 }}>{v}</span> {l}</span>
                    ))}
                  </div>
                </div>
                <Ring score={bScore(blockId)} size={80} tint={tc} />
              </div>

              {/* Block Exam Prep */}
              <div style={{ background:"linear-gradient(135deg,"+tc+"12 0%,"+t.cardBg+" 55%)", border:"1px solid "+tc+"30", borderRadius:16, padding:"20px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:20, flexWrap:"wrap", boxShadow:t.cardShadow }}>
                <div>
                  <div style={{ fontFamily:MONO, color:tc, fontSize:11, letterSpacing:2, marginBottom:6 }}>⚡ BLOCK EXAM PREP</div>
                  <div style={{ fontFamily:SERIF, color:t.text2, fontSize:16, fontWeight:700, marginBottom:4 }}>Comprehensive {activeBlock.name} Review</div>
                  <p style={{ fontFamily:MONO, color:t.text3, fontSize:11, lineHeight:1.6 }}>
                    {blockLecs.length>0 ? "Mixed vignettes from all " + blockLecs.length + " lecture" + (blockLecs.length!==1?"s":"") + (sessions.filter(s=>s.blockId===blockId).length>0?" · weak topics weighted higher":"") : "Upload lectures first."}
                  </p>
                </div>
                <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                  <Btn onClick={startBlock} color={tc} disabled={!blockLecs.length} style={{ padding:"12px 28px", fontSize:14, borderRadius:10 }}>Start Exam →</Btn>
                </div>
              </div>

              {/* Upload */}
              <div
                onDragOver={e=>{ e.preventDefault(); setDrag(true); }}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{ e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files,blockId,termId); }}
                style={{ background:drag?t.rowHover:t.cardBg, border:"1px "+(drag?"solid "+tc:"dashed "+t.border1), borderRadius:12, padding:"16px 20px", transition:"all 0.2s", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div style={{ flex:1 }}>
                  <span style={{ fontFamily:MONO, color:t.text5, fontSize:12 }}>Upload to <span style={{ color:tc, fontWeight:600 }}>{activeBlock.name}</span></span>
                  <span style={{ fontFamily:MONO, color:t.text5, fontSize:11, marginLeft:10 }}>PDF or .txt — drag & drop or click</span>
                </div>
                <label style={{ background:t.border1, border:"1px dashed " + t.text5, color:t.text1, padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600 }}>
                  {uploading ? "Analyzing…" : "+ Upload Files"}
                  <input type="file" accept=".pdf,.txt,.md" multiple onChange={e=>handleFiles(e.target.files,blockId,termId)} style={{ display:"none" }} />
                </label>
                {blockLecs.length > 0 && (
                  <button type="button" onClick={clearBlockLectures} style={{ background:"none", border:"1px solid " + t.text4, color:t.text3, padding:"6px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Clear All</button>
                )}
                {uploading && <div style={{ width:"100%", height:2, background:t.border1, borderRadius:1, overflow:"hidden" }}><div style={{ height:"100%", width:"65%", background:"linear-gradient(90deg,"+tc+",#8b5cf6)", borderRadius:1 }} /></div>}
                {upMsg && <div style={{ width:"100%", fontFamily:MONO, color:upMsg.startsWith("✓")?"#10b981":upMsg.startsWith("✗")||upMsg.startsWith("⚠")?"#ef4444":"#60a5fa", fontSize:11 }}>{upMsg}</div>}
              </div>

              {/* Tabs */}
              <div style={{ display:"flex", borderBottom:"1px solid " + t.border2 }}>
                {[["lectures","Lectures ("+blockLecs.length+")"],["heatmap","Heatmap"],["analysis","AI Analysis"]].map(([tKey,label])=>(
                  <button
                    key={tKey}
                    onClick={()=>setTab(tKey)}
                    style={{
                      background:"none",
                      border:"none",
                      borderBottom:"2px solid "+(tab===tKey?tc:"transparent"),
                      color: tab===tKey ? t.text1 : t.text4,
                      padding:"9px 20px",
                      cursor:"pointer",
                      fontFamily:MONO,
                      fontSize:12,
                      marginBottom:-1,
                      transition:"color 0.12s",
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Lectures */}
              {tab==="lectures" && (blockLecs.length===0 ? (
                <div style={{ ...CARD, border:"1px dashed " + t.border2, padding:70, textAlign:"center" }}>
                  <div style={{ fontSize:38, marginBottom:14 }}>📄</div>
                  <p style={{ fontFamily:MONO, color:t.text5, fontSize:13 }}>Upload your first lecture for {activeBlock.name}.</p>
                  <p style={{ fontFamily:MONO, color:t.border1, fontSize:11, marginTop:8 }}>AI auto-detects subject, subtopics, and key terms.</p>
                </div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:14 }}>
                  {blockLecs.map((lec,li) => (
                    <LecCard key={lec.id} lec={lec} sessions={sessions} accent={PALETTE[li%PALETTE.length]} tint={tc} onStudy={startTopic} onDelete={delLec} onUpdateLec={updateLec} />
                  ))}
                </div>
              ))}

              {/* Heatmap */}
              {tab==="heatmap" && <Heatmap lectures={blockLecs} sessions={sessions} onStudy={startTopic} />}

              {/* Analysis */}
              {tab==="analysis" && (
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <p style={{ fontFamily:MONO, color:t.text4, fontSize:12 }}>AI study plan based on your block performance.</p>
                    <Btn onClick={runAnalysis} color={tc} disabled={aLoading}>{aLoading?"Analyzing…":"↺ Run Analysis"}</Btn>
                  </div>
                    {analyses[blockId] ? (
                    <div style={{ background:t.rowExpanded, border:"1px solid " + t.border1, borderRadius:14, padding:28 }}>
                      <pre style={{ fontFamily:"Lora, Georgia, serif", color:t.text2, lineHeight:1.95, fontSize:14, whiteSpace:"pre-wrap" }}>{analyses[blockId]}</pre>
                    </div>
                  ) : (
                    <div style={{ ...CARD, border:"1px dashed " + t.border2, padding:50, textAlign:"center" }}>
                      <p style={{ fontFamily:MONO, color:t.text4, fontSize:12 }}>Complete sessions, then run analysis for a personalized study plan.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {view==="block" && !activeBlock && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}>
              <p style={{ fontFamily:MONO, color:t.text4, fontSize:13 }}>Select a block from the sidebar.</p>
            </div>
          )}

          {/* ANALYTICS */}
          {view==="analytics" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:24 }}>
              <h1 style={{ fontFamily:SERIF, fontSize:30, fontWeight:900, letterSpacing:-1, color:t.text1 }}>Global <span style={{ color:"#8b5cf6" }}>Analytics</span></h1>
              {sessions.length===0 ? (
                <div style={{ ...CARD, border:"1px dashed " + t.border2, padding:60, textAlign:"center" }}>
                  <p style={{ fontFamily:MONO, color:t.text5, fontSize:13 }}>Complete sessions to see analytics.</p>
                </div>
              ) : terms.map(term => (
                <div key={term.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ width:9, height:9, borderRadius:"50%", background:term.color }} />
                    <h2 style={{ fontFamily:SERIF, fontSize:18, fontWeight:700 }}>{term.name}</h2>
                    <div style={{ flex:1, height:1, background:t.border2 }} />
                  </div>
                  {term.blocks.filter(b=>sessions.some(s=>s.blockId===b.id)).map(block => {
                    const bs=sessions.filter(s=>s.blockId===block.id);
                    const sc=bScore(block.id);
                    const m=mastery(sc, t);
                    const sub={};
                    bs.forEach(s=>{ if(!sub[s.subtopic]) sub[s.subtopic]={c:0,t:0,subject:s.subject}; sub[s.subtopic].c+=s.correct; sub[s.subtopic].t+=s.total; });
                    return (
                      <div key={block.id} style={{ ...CARD, border:"1px solid "+term.color+"15", marginBottom:14 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
                          <span style={{ fontFamily:MONO, color:t.text2, fontWeight:600, fontSize:14 }}>{block.name}</span>
                          <span style={{ fontFamily:MONO, color:m.fg, fontWeight:700, fontSize:16 }}>{sc!==null?sc+"%":"—"}</span>
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))", gap:8, marginBottom:14 }}>
                          {Object.entries(sub).sort((a,b)=>pct(a[1].c,a[1].t)-pct(b[1].c,b[1].t)).map(([s,v])=>{
                            const p=pct(v.c,v.t);
                            const sm=mastery(p, t);
                            return (
                              <div key={s} style={{ background:sm.bg, border:"1px solid "+sm.border, borderRadius:9, padding:"9px 13px" }}>
                                <div style={{ fontFamily:MONO, color:t.text4, fontSize:11, marginBottom:3 }}>{v.subject}</div>
                                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                                  <span style={{ fontFamily:MONO, color:t.text5, fontSize:11 }}>{s}</span>
                                  <span style={{ fontFamily:MONO, color:sm.fg, fontWeight:700, fontSize:14 }}>{p}%</span>
                                </div>
                                <div style={{ height:3, background:t.border1, borderRadius:2 }}><div style={{ width:p+"%", height:"100%", background:sm.fg, borderRadius:2 }} /></div>
                                <div style={{ fontFamily:MONO, color:t.text5, fontSize:11, marginTop:4 }}>{v.c}/{v.t} correct</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ borderTop:"1px solid " + t.border2, paddingTop:12 }}>
                          <div style={{ fontFamily:MONO, color:t.text4, fontSize:11, letterSpacing:2, marginBottom:8 }}>RECENT SESSIONS</div>
                          {[...bs].reverse().slice(0,5).map((s,i)=>{
                            const p=pct(s.correct,s.total);
                            const sm=mastery(p, t);
                            return (
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid " + t.border2 }}>
                                <span style={{ fontFamily:MONO, color:t.text3, fontSize:11 }}>{s.subtopic}</span>
                                <div style={{ display:"flex", gap:16 }}>
                                  <span style={{ fontFamily:MONO, color:t.text4, fontSize:12 }}>{new Date(s.date).toLocaleDateString()}</span>
                                  <span style={{ fontFamily:MONO, color:sm.fg, fontWeight:700, fontSize:14 }}>{s.correct}/{s.total} ({p}%)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
    </ThemeContext.Provider>
  );
}

