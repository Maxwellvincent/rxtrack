import { useState, useCallback, useEffect, Fragment } from "react";
import {
  loadProfile,
  recordAnswer,
  buildSystemPrompt,
} from "./learningModel";
import { useTheme } from "./theme";
import { parseExamPDF } from "./examParser";
import HistoStudy from "./HistoStudy";

const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
// Fallback when theme not in scope; prefer T.red from useTheme() where available
const ACCENT = "#ef4444";

const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);

async function extractPDFText(file) {
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        res();
      };
      s.onerror = () => rej(new Error("PDF.js failed to load"));
      document.head.appendChild(s);
    });
  } else {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= Math.min(pdf.numPages, 100); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += "\n[Page " + i + "]\n" + content.items.map((x) => x.str).join(" ");
  }

  return fullText.trim();
}

async function parseQuestionsWithAI(rawText, filename) {
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
  if (!GEMINI_KEY) throw new Error("No API key configured");

  const chunk = rawText.slice(0, 12000);

  const prompt =
    "You are parsing a medical school exam or question bank PDF.\n" +
    "Extract every question you find in this text.\n\n" +
    "Return ONLY valid JSON, no markdown, no extra text:\n" +
    "{\"questions\":[{" +
    "\"stem\":\"full question text ending with a question mark\"," +
    "\"choices\":{\"A\":\"...\",\"B\":\"...\",\"C\":\"...\",\"D\":\"...\"}," +
    "\"correct\":\"A\"," +
    "\"explanation\":\"explanation if present in source or null\"," +
    "\"topic\":\"best guess at medical topic\"," +
    "\"subtopic\":\"specific subtopic\"," +
    "\"difficulty\":\"easy or medium or hard\"," +
    "\"type\":\"clinicalVignette or mechanismBased or pharmacology or laboratory\"" +
    "}]}\n\n" +
    "Rules:\n" +
    "- Only extract questions that actually exist in the text\n" +
    "- Do not invent or generate new questions\n" +
    "- If answer choices are not labeled A/B/C/D in the source, label them yourself\n" +
    "- If correct answer is not shown, set correct to null\n" +
    "- If explanation is not in the source, set explanation to null\n" +
    "- difficulty: judge based on complexity of the question\n" +
    "- type: clinicalVignette if it has a patient scenario, mechanismBased if it asks about mechanisms, pharmacology if about drugs, laboratory if about lab values\n\n" +
    "TEXT FROM " + filename + ":\n" + chunk;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 12000, temperature: 0.1 },
        safetySettings: [
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        ],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error("API " + res.status + " — " + err);
  }

  const d = await res.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Empty response from AI");

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function QuestionBankCard({ filename, questions, onPractice, onPracticeWeak, onDelete, profile }) {
  const { T } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const total = questions.length;
  const clinical = questions.filter((q) => q.type === "clinicalVignette" || q.type === "clinical").length;
  const mechanism = questions.filter((q) => q.type === "mechanismBased").length;
  const pharma = questions.filter((q) => q.type === "pharmacology").length;
  const image = questions.filter((q) => q.imageQuestion).length;
  const hasAnswer = questions.filter((q) => q.correct).length;
  const noAnswer = total - hasAnswer;

  const topics = [...new Set(questions.map((q) => q.topic).filter(Boolean))].slice(0, 6);
  const allTopics = [...new Set(questions.map((q) => q.topic).filter(Boolean))];

  return (
    <div
      style={{
        background: T.cardBg,
        border: "1px solid " + T.border2,
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 28, flexShrink: 0 }}>📋</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: MONO,
              color: T.text1,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, color: T.blue, fontSize: 10 }}>{total} questions</span>
            {image > 0 && (
              <span style={{ fontFamily: MONO, color: T.purple, fontSize: 10 }}>· {image} histology slides</span>
            )}
            {noAnswer > 0 && (
              <span style={{ fontFamily: MONO, color: T.amber, fontSize: 10 }}>· {noAnswer} missing answer keys</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onPractice(questions)}
            style={{
              background: T.red,
              border: "none",
              color: T.text1,
              padding: "7px 14px",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ▶ Practice
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            style={{
              background: T.pillBg,
              border: "none",
              color: T.pillText,
              padding: "7px 10px",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
            }}
          >
            {expanded ? "▲" : "▾"}
          </button>
          <button
            type="button"
            onClick={() => onDelete(filename)}
            style={{
              background: "none",
              border: "1px solid " + T.border1,
              color: T.text4,
              padding: "7px 10px",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = T.red;
              e.currentTarget.style.color = T.red;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = T.border1;
              e.currentTarget.style.color = T.text4;
            }}
          >
            🗑
          </button>
        </div>
      </div>
      <div style={{ padding: "0 20px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { label: "Clinical", count: clinical, color: "#3b82f6" },
          { label: "Mechanism", count: mechanism, color: "#a78bfa" },
          { label: "Pharma", count: pharma, color: "#f59e0b" },
          { label: "Histology", count: image, color: "#10b981" },
        ]
          .filter((t) => t.count > 0)
          .map((t) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: t.color + "18",
                border: "1px solid " + t.color + "30",
                borderRadius: 6,
                padding: "3px 10px",
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.color }} />
              <span style={{ fontFamily: MONO, color: t.color, fontSize: 10 }}>
                {t.count} {t.label}
              </span>
            </div>
          ))}
      </div>
      {expanded && (
        <div
          style={{
            borderTop: "1px solid #0f1e30",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9, letterSpacing: 1.5, marginBottom: 8 }}>
              TOPICS COVERED
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {topics.map((t, i) => (
                <span
                  key={i}
                  style={{
                    fontFamily: MONO,
                    color: "#9ca3af",
                    background: "#0d1829",
                    border: "1px solid #1a2a3a",
                    fontSize: 10,
                    padding: "3px 10px",
                    borderRadius: 5,
                  }}
                >
                  {t.length > 45 ? t.slice(0, 45) + "…" : t}
                </span>
              ))}
              {topics.length < allTopics.length && (
                <span style={{ fontFamily: MONO, color: "#374151", fontSize: 10, padding: "3px 6px" }}>
                  +{allTopics.length - topics.length} more
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9, letterSpacing: 1.5, marginBottom: 8 }}>
              PRACTICE OPTIONS
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => onPractice(questions)}
                style={{
                  background: "#ef444418",
                  border: "1px solid #ef444440",
                  color: "#ef4444",
                  padding: "7px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 11,
                }}
              >
                ▶ All {total} Questions
              </button>
              <button
                type="button"
                onClick={() => onPracticeWeak(questions)}
                style={{
                  background: "#f59e0b18",
                  border: "1px solid #f59e0b40",
                  color: "#f59e0b",
                  padding: "7px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 11,
                }}
              >
                📌 Weak Topics Only
              </button>
              {image > 0 && (
                <button
                  type="button"
                  onClick={() => onPractice(questions.filter((q) => q.imageQuestion))}
                  style={{
                    background: "#10b98118",
                    border: "1px solid #10b98140",
                    color: "#10b981",
                    padding: "7px 16px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 11,
                  }}
                >
                  🔬 Histology Only
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onPractice(questions.filter((q) => q.type === "clinicalVignette" || q.type === "clinical"))
                }
                style={{
                  background: "#3b82f618",
                  border: "1px solid #3b82f640",
                  color: "#3b82f6",
                  padding: "7px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 11,
                }}
              >
                🏥 Clinical Only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  const { T } = useTheme();
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        cursor: "pointer",
        fontFamily: MONO,
        fontSize: 12,
        color: T.text1,
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          border: "none",
          background: checked ? ACCENT : T.border1,
          cursor: "pointer",
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 20 : 2,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </button>
    </label>
  );
}

function LearningSession({
  vignettes,
  termColor,
  onDone,
  onBack,
  profile,
  onProfileUpdate,
}) {
  const { T } = useTheme();
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState(null);
  const [shown, setShown] = useState(false);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(false);

  const v = vignettes[idx];
  const tc = termColor || ACCENT;

  const handleNext = useCallback(() => {
    const ok = sel === v.correct;
    const topic = v.topic || v.subject || "Review";
    const subtopic = v.subtopic || "";
    const qType = v.type || "clinicalVignette";
    const nextProfile = recordAnswer(profile, topic, subtopic, ok, qType);
    onProfileUpdate(nextProfile);

    const nr = [...results, { ok, topic, subtopic }];
    if (idx + 1 >= vignettes.length) {
      onDone({ correct: nr.filter((r) => r.ok).length, total: nr.length, date: new Date().toISOString() });
      setResults(nr);
      setDone(true);
    } else {
      setResults(nr);
      setIdx((i) => i + 1);
      setSel(null);
      setShown(false);
    }
  }, [sel, v, idx, results, vignettes.length, profile, onProfileUpdate, onDone]);

  if (done) {
    const score = pct(results.filter((r) => r.ok).length, results.length);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          padding: "70px 40px",
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 22, color: T.text3 }}>
          Session Complete
        </div>
        <div
          style={{
            width: 130,
            height: 130,
            borderRadius: "50%",
            background: T.border1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: 28,
            color: score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : ACCENT,
          }}
        >
          {score}%
        </div>
        <p style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>
          {results.filter((r) => r.ok).length} / {results.length} correct
        </p>
        <button
          onClick={onBack}
          style={{
            background: tc,
            border: "none",
            color: "#fff",
            padding: "12px 32px",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  const CHOICES = ["A", "B", "C", "D"];
  const dColor = { easy: "#10b981", medium: "#f59e0b", hard: ACCENT };
  const dc = dColor[v.difficulty] || "#f59e0b";

  return (
    <div
      style={{
        maxWidth: 840,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: T.text4,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          ← Exit
        </button>
        <div
          style={{
            flex: 1,
            height: 4,
            background: T.cardBorder,
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: (idx / vignettes.length) * 100 + "%",
              background: tc,
              borderRadius: 2,
              transition: "width 0.4s",
            }}
          />
        </div>
        <span style={{ fontFamily: MONO, color: T.text4, fontSize: 11 }}>
          {idx + 1}/{vignettes.length}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            fontFamily: MONO,
            background: dc + "18",
            color: dc,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 20,
            letterSpacing: 1.5,
          }}
        >
          {(v.difficulty || "medium").toUpperCase()}
        </span>
        {(v.topic || v.subtopic) && (
          <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
            {[v.topic, v.subtopic].filter(Boolean).join(" — ")}
          </span>
        )}
      </div>

      <div
        style={{
          background: T.inputBg,
          border: "1px solid " + T.border1,
          borderRadius: 16,
          padding: 28,
        }}
      >
        {v.imageQuestion ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {v.questionPageImage && (
              <div style={{ background: "#0d1829", borderRadius: 12, overflow: "hidden", border: "1px solid #1a2a3a" }}>
                <img
                  src={"data:image/png;base64," + v.questionPageImage}
                  alt="Histology question slide"
                  style={{ width: "100%", display: "block", borderRadius: 12 }}
                />
              </div>
            )}
            <p style={{ fontFamily: MONO, color: T.text3, fontSize: 11, margin: 0 }}>
              🔬 Identify the structures or select the correct answer based on the histological slide above.
            </p>
            {shown && v.answerPageImage && (
              <div>
                <div style={{ fontFamily: MONO, color: "#10b981", fontSize: 11, marginBottom: 8, letterSpacing: 1 }}>
                  ✓ ANSWER — ANNOTATED SLIDE
                </div>
                <div style={{ background: "#021710", borderRadius: 12, overflow: "hidden", border: "1px solid #10b98130" }}>
                  <img
                    src={"data:image/png;base64," + v.answerPageImage}
                    alt="Histology answer slide"
                    style={{ width: "100%", display: "block", borderRadius: 12 }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontFamily: SERIF, color: T.text1, lineHeight: 1.8, fontSize: 14, margin: 0 }}>
            {v.stem}
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {CHOICES.map((ch) => {
          let bg = T.cardBg,
            border = T.border1,
            color = T.text2;
          if (shown) {
            if (ch === v.correct) {
              bg = "#021710";
              border = "#10b981";
              color = "#6ee7b7";
            } else if (ch === sel) {
              bg = "#150404";
              border = ACCENT;
              color = "#fca5a5";
            }
          } else if (sel === ch) {
            bg = "#091830";
            border = tc;
            color = "#93c5fd";
          }
          return (
            <div
              key={ch}
              onClick={() => !shown && setSel(ch)}
              style={{
                background: bg,
                border: "1px solid " + border,
                borderRadius: 11,
                padding: "14px 18px",
                cursor: shown ? "default" : "pointer",
                display: "flex",
                gap: 13,
                color,
                fontFamily: MONO,
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              <span style={{ fontWeight: 700, minWidth: 22, color: shown || sel === ch ? color : T.text3 }}>{ch}.</span>
              <span style={{ flex: 1 }}>{v.choices[ch]}</span>
              {shown && ch === v.correct && <span style={{ color: "#10b981" }}>✓</span>}
              {shown && ch === sel && ch !== v.correct && (
                <span style={{ color: ACCENT }}>✗</span>
              )}
            </div>
          );
        })}
      </div>

      {shown && (
        <div
          style={{
            background: "#09111e",
            border: "1px solid #0f2040",
            borderRadius: 14,
            padding: 24,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              color: "#3b82f6",
              fontSize: 11,
              letterSpacing: 3,
              marginBottom: 12,
            }}
          >
            EXPLANATION
          </div>
          <p
            style={{
              fontFamily: SERIF,
              color: "#f1f5f9",
              lineHeight: 1.8,
              fontSize: 14,
              margin: 0,
            }}
          >
            {v.explanation}
          </p>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        {!shown ? (
          <button
            onClick={() => setShown(true)}
            disabled={!sel}
            style={{
              background: sel ? tc : T.border1,
              border: "none",
              color: "#fff",
              padding: "10px 22px",
              borderRadius: 8,
              cursor: sel ? "pointer" : "not-allowed",
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              opacity: sel ? 1 : 0.6,
            }}
          >
            Reveal Answer
          </button>
        ) : (
          <button
            onClick={handleNext}
            style={{
              background: "#10b981",
              border: "none",
              color: "#fff",
              padding: "10px 22px",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {idx + 1 >= vignettes.length ? "Finish ✓" : "Next →"}
          </button>
        )}
      </div>
    </div>
  );
}

async function generateVignettesWithClaude(profile, subject, subtopic, count) {
  const systemPrompt = buildSystemPrompt(profile, subject, subtopic, "lecture");
  const userPrompt =
    `Generate exactly ${count} USMLE Step 1-style clinical vignette questions for the subject "${subject}"${subtopic ? `, subtopic "${subtopic}"` : ""}. ` +
    `Return ONLY valid JSON with no markdown: {"vignettes":[{"id":"v1","difficulty":"medium","stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","topic":"...","subtopic":"..."}]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const d = await res.json();
  const raw = (d.content || []).map((b) => b.text || "").join("");
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const data = JSON.parse(cleaned);
  const list = Array.isArray(data.vignettes) ? data.vignettes : [];
  return list.slice(0, count).map((v, i) => ({ ...v, id: v.id || "v" + (i + 1) }));
}

export default function LearningModel({ profile: profileProp, onProfileUpdate, sessions = [], lectures = [] }) {
  const { T } = useTheme();
  const profile = profileProp || loadProfile();
  const [tab, setTab] = useState("profile");
  const [filterType, setFilterType] = useState("all");
  const [filterDifficulty, setFilterDifficulty] = useState("all");
  const [parsingJobs, setParsingJobs] = useState([]);
  const [questionBanksByFile, setQuestionBanksByFile] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    } catch {
      return {};
    }
  });
  const [practiceSubject, setPracticeSubject] = useState("");
  // File refs for re-parse (only available for files uploaded this session)
  const [fileRefs, setFileRefs] = useState({});

  // Migrate legacy profile.uploadedExamPatterns into questionBanksByFile once
  useEffect(() => {
    const raw = profile.uploadedExamPatterns || [];
    if (raw.length === 0) return;
    const banks = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    if (Object.keys(banks).length > 0) return;
    const next = { ...banks };
    raw.forEach((p) => {
      if (p && Array.isArray(p.questions)) {
        const key = p.fileName || p.examTitle || "Imported";
        next[key] = p.questions;
      }
    });
    if (Object.keys(next).length > Object.keys(banks).length) {
      localStorage.setItem("rxt-question-banks", JSON.stringify(next));
      setQuestionBanksByFile(next);
    }
  }, [profile.uploadedExamPatterns]);
  const [practiceMode, setPracticeMode] = useState("aiGenerated");
  const [practiceCount, setPracticeCount] = useState(10);
  const [practiceWeakOnly, setPracticeWeakOnly] = useState(false);
  const [sessionVignettes, setSessionVignettes] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const prefs = profile.preferences || {};
  const setPref = (key, value) => {
    const next = { ...profile, preferences: { ...prefs, [key]: value } };
    onProfileUpdate(next);
  };

  const totalCorrect = sessions.reduce((a, s) => a + s.correct, 0);
  const totalQuestions = sessions.reduce((a, s) => a + s.total, 0);
  const overallAccuracy = pct(totalCorrect, totalQuestions);

  const topicStats = {};
  sessions.forEach((s) => {
    const key = [s.subject, s.subtopic].filter(Boolean).join(" — ") || "Other";
    if (!topicStats[key]) topicStats[key] = { c: 0, t: 0 };
    topicStats[key].c += s.correct;
    topicStats[key].t += s.total;
  });
  const weakTopics = Object.entries(topicStats).filter(([, v]) => v.t > 0 && pct(v.c, v.t) < 65);
  const strongTopics = Object.entries(topicStats).filter(([, v]) => v.t > 0 && pct(v.c, v.t) >= 80);

  const subjectsFromLectures = [...new Set(lectures.map((l) => l.subject).filter(Boolean))];
  const bankQuestions = Object.entries(questionBanksByFile).flatMap(([filename, qs]) =>
    (qs || []).map((q) => ({ ...q, _examTitle: filename }))
  );

  const filteredBank = bankQuestions.filter((q) => {
    if (filterType !== "all" && (q.type || "") !== filterType) return false;
    if (filterDifficulty !== "all" && (q.difficulty || "") !== filterDifficulty) return false;
    return true;
  });

  const weakTopicKeys = new Set(weakTopics.map(([k]) => k));
  const bankForPractice = practiceWeakOnly
    ? filteredBank.filter((q) => {
        const key = [q.topic, q.subtopic].filter(Boolean).join(" — ") || "Other";
        return weakTopicKeys.has(key);
      })
    : filteredBank;

  const formatLabel = (format) => {
    const labels = { grid: "Grid/table", slidedeck: "Slide deck", standard: "Standard" };
    return labels[format] || format;
  };

  const onFileParsed = (filename, questions) => {
    setQuestionBanksByFile((prev) => {
      const updated = { ...prev, [filename]: questions };
      localStorage.setItem("rxt-question-banks", JSON.stringify(updated));
      return updated;
    });
  };

  const addParsingJob = (filename) => {
    const jobId = Date.now() + "_" + filename;
    setParsingJobs((prev) => [
      ...prev,
      { id: jobId, filename, status: "parsing", progress: "Starting...", questionCount: 0 },
    ]);
    return jobId;
  };
  const updateJobProgress = (jobId, progress) => {
    setParsingJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, progress } : j)));
  };
  const completeJob = (jobId, questionCount) => {
    setParsingJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "done", progress: "✓ Complete", questionCount } : j))
    );
  };
  const failJob = (jobId, message) => {
    setParsingJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "error", progress: "✗ " + message } : j))
    );
  };

  const handleExamUpload = (files) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const jobId = addParsingJob(file.name);

      if (isPdf) {
        setFileRefs((prev) => ({ ...prev, [file.name]: file }));
        parseExamPDF(file, (msg) => updateJobProgress(jobId, msg))
          .then((result) => {
            if (result?.questions?.length > 0) {
              onFileParsed(file.name, result.questions);
              completeJob(jobId, result.questions.length);
              const imageCount = result.questions.filter((q) => q.imageQuestion).length;
              if (imageCount > 0) setTab("histology");
            } else {
              completeJob(jobId, 0);
              updateJobProgress(jobId, "⚠ No questions found");
            }
          })
          .catch((err) => failJob(jobId, err.message || String(err)));
      } else {
        updateJobProgress(jobId, "Reading file...");
        file
          .text()
          .then((text) => {
            if (!text || text.trim().length < 50) {
              failJob(jobId, "File appears empty");
              return;
            }
            updateJobProgress(jobId, "🧠 AI parsing...");
            return parseQuestionsWithAI(text, file.name);
          })
          .then((result) => {
            if (!result) return;
            if (result?.questions?.length > 0) {
              onFileParsed(file.name, result.questions);
              completeJob(jobId, result.questions.length);
            } else {
              completeJob(jobId, 0);
              updateJobProgress(jobId, "⚠ No questions found");
            }
          })
          .catch((err) => failJob(jobId, err.message || String(err)));
      }
    }
  };

  const handleReparse = (fileName) => {
    const file = fileRefs[fileName];
    if (!file) return;
    const jobId = addParsingJob(fileName);
    parseExamPDF(file, (msg) => updateJobProgress(jobId, msg))
      .then((result) => {
        if (result?.questions?.length > 0) {
          onFileParsed(fileName, result.questions);
          completeJob(jobId, result.questions.length);
        } else {
          completeJob(jobId, 0);
          updateJobProgress(jobId, "⚠ No questions found");
        }
      })
      .catch((e) => failJob(jobId, e.message || String(e)));
  };

  const startPractice = async () => {
    setSessionError("");
    setSessionVignettes(null);
    if (practiceMode === "fromBank") {
      const fromBank = bankForPractice.slice(0, practiceCount);
      const shuffled = [...fromBank].sort(() => Math.random() - 0.5);
      const vignettes = shuffled.map((q, i) => ({
        id: q.id || "b" + i,
        stem: q.stem,
        choices: q.choices || {},
        correct: q.correct,
        explanation: q.explanation,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty || "medium",
        type: q.type,
        imageQuestion: q.imageQuestion,
        questionPageImage: q.questionPageImage,
        answerPageImage: q.answerPageImage,
      }));
      setSessionVignettes(vignettes);
      return;
    }
    if (practiceMode === "mixed") {
      const bankCount = Math.min(Math.floor(practiceCount / 2), bankForPractice.length);
      const aiCount = practiceCount - bankCount;
      const fromBank = [...bankForPractice].sort(() => Math.random() - 0.5).slice(0, bankCount).map((q, i) => ({
        id: q.id || "b" + i,
        stem: q.stem,
        choices: q.choices || {},
        correct: q.correct,
        explanation: q.explanation,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty || "medium",
        type: q.type,
        imageQuestion: q.imageQuestion,
        questionPageImage: q.questionPageImage,
        answerPageImage: q.answerPageImage,
      }));
      setSessionLoading(true);
      try {
        const subject = practiceSubject || subjectsFromLectures[0] || "General";
        const fromAi = aiCount > 0 ? await generateVignettesWithClaude(profile, subject, "", aiCount) : [];
        const combined = [...fromBank, ...fromAi].sort(() => Math.random() - 0.5);
        setSessionVignettes(combined);
      } catch (e) {
        setSessionError(e.message || "Generation failed");
        if (fromBank.length > 0) setSessionVignettes(fromBank);
      } finally {
        setSessionLoading(false);
      }
      return;
    }
    setSessionLoading(true);
    try {
      const subject = practiceSubject || subjectsFromLectures[0] || "General";
      const vignettes = await generateVignettesWithClaude(profile, subject, "", practiceCount);
      setSessionVignettes(vignettes);
    } catch (e) {
      setSessionError(e.message || "Generation failed");
    } finally {
      setSessionLoading(false);
    }
  };

  const navStyle = (t) => ({
    background: "none",
    border: "none",
    borderBottom: tab === t ? "2px solid " + ACCENT : "2px solid transparent",
    color: tab === t ? T.text1 : T.text3,
    padding: "10px 18px",
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: 12,
    marginBottom: -1,
  });

  const histoCount = Object.values(questionBanksByFile)
    .flat()
    .filter((q) => q && q.imageQuestion).length;

  return (
    <div style={{ background: T.appBg, color: T.text1, minHeight: "100%", fontFamily: MONO }}>
      {parsingJobs.length > 0 && (
        <div style={{ borderBottom: "1px solid #0d1829", background: "#07090e" }}>
          {parsingJobs.map((job) => (
            <div
              key={job.id}
              style={{
                padding: "8px 20px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {job.status === "parsing" ? (
                <div
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid #1a2a3a",
                    borderTopColor: "#ef4444",
                    borderRadius: "50%",
                    animation: "rxt-spin 0.8s linear infinite",
                    flexShrink: 0,
                  }}
                />
              ) : job.status === "done" ? (
                <span style={{ color: "#10b981", fontSize: 14 }}>✓</span>
              ) : (
                <span style={{ color: "#ef4444", fontSize: 14 }}>✗</span>
              )}
              <span
                style={{
                  fontFamily: MONO,
                  color: "#c4cdd6",
                  fontSize: 11,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 200,
                }}
              >
                {job.filename}
              </span>
              <span style={{ fontFamily: MONO, color: "#374151", fontSize: 10, flex: 1 }}>{job.progress}</span>
              {job.status === "done" && (
                <span style={{ fontFamily: MONO, color: "#10b981", fontSize: 10 }}>{job.questionCount} questions</span>
              )}
              {job.status !== "parsing" && (
                <button
                  type="button"
                  onClick={() => setParsingJobs((prev) => prev.filter((j) => j.id !== job.id))}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#374151",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "0 2px",
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes rxt-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", borderBottom: "1px solid " + T.cardBorder, padding: "0 20px" }}>
        <button style={navStyle("profile")} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button style={navStyle("questionBank")} onClick={() => setTab("questionBank")}>
          Question Bank
        </button>
        <button style={navStyle("practice")} onClick={() => setTab("practice")}>
          Practice
        </button>
        <button style={navStyle("histology")} onClick={() => setTab("histology")}>
          {"🔬 Histology" + (histoCount > 0 ? " (" + histoCount + ")" : "")}
        </button>
      </div>

      <div style={{ padding: "28px 32px" }}>
        {tab === "profile" && (
          <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 24 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: ACCENT }}>
              Learning Profile
            </h2>
            <div
              style={{
                background: T.cardBg,
                border: "1px solid " + T.cardBorder,
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>
                OVERALL
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, color: T.text1 }}>
                    {overallAccuracy !== null ? overallAccuracy + "%" : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: T.text3 }}>Accuracy</div>
                </div>
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, color: T.text1 }}>
                    {totalQuestions}
                  </div>
                  <div style={{ fontSize: 11, color: T.text3 }}>Questions answered</div>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, letterSpacing: 2, marginBottom: 10 }}>
                WEAK TOPICS (&lt;65%)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {weakTopics.length === 0 ? (
                  <span style={{ color: T.text3, fontSize: 12 }}>None yet</span>
                ) : (
                  weakTopics.map(([key, v]) => (
                    <span
                      key={key}
                      style={{
                        background: "#150404",
                        border: "1px solid #450a0a",
                        color: ACCENT,
                        padding: "6px 12px",
                        borderRadius: 20,
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: MONO,
                      }}
                    >
                      {key} · {pct(v.c, v.t)}%
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, letterSpacing: 2, marginBottom: 10 }}>
                STRONG TOPICS (≥80%)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {strongTopics.length === 0 ? (
                  <span style={{ color: T.text3, fontSize: 12 }}>None yet</span>
                ) : (
                  strongTopics.map(([key, v]) => (
                    <span
                      key={key}
                      style={{
                        background: "#021710",
                        border: "1px solid #064e3b",
                        color: "#10b981",
                        padding: "6px 12px",
                        borderRadius: 20,
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: MONO,
                      }}
                    >
                      {key} · {pct(v.c, v.t)}%
                    </span>
                  ))
                )}
              </div>
            </div>

            <div
              style={{
                background: T.cardBg,
                border: "1px solid " + T.cardBorder,
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>
                STYLE PREFERENCES
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Toggle
                  label="Long stems"
                  checked={!!prefs.longStems}
                  onChange={(v) => setPref("longStems", v)}
                />
                <Toggle
                  label="Hard distractors"
                  checked={!!prefs.hardDistractors}
                  onChange={(v) => setPref("hardDistractors", v)}
                />
                <Toggle
                  label="Include lab values"
                  checked={!!prefs.includeLabValues}
                  onChange={(v) => setPref("includeLabValues", v)}
                />
                <Toggle
                  label="First Aid references"
                  checked={!!prefs.firstAidRefs}
                  onChange={(v) => setPref("firstAidRefs", v)}
                />
                <Toggle
                  label="Explain wrong answers"
                  checked={!!prefs.explainWrongAnswers}
                  onChange={(v) => setPref("explainWrongAnswers", v)}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "questionBank" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: ACCENT }}>
              Question Bank
            </h2>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = "#ef4444";
              }}
              onDragLeave={(e) => {
                e.currentTarget.style.borderColor = "#1a2a3a";
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = "#1a2a3a";
                handleExamUpload(e.dataTransfer.files);
              }}
              style={{
                border: "2px dashed #1a2a3a",
                borderRadius: 14,
                padding: "40px 20px",
                textAlign: "center",
                transition: "border-color 0.2s",
                cursor: "pointer",
                background: T.cardBg,
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <p style={{ fontFamily: MONO, color: T.text3, fontSize: 13, marginBottom: 8 }}>
                Drop your instructor question bank PDFs here
              </p>
              <p style={{ fontFamily: MONO, color: T.text5 || "#374151", fontSize: 11, marginBottom: 16 }}>
                The AI will extract all questions and learn your instructor's style
              </p>
              <label
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  padding: "8px 20px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Select PDF Files
                <input
                  type="file"
                  accept=".pdf,.txt"
                  multiple
                  onChange={(e) => handleExamUpload(e.target.files)}
                  style={{ display: "none" }}
                />
              </label>
            </div>

            {Object.entries(questionBanksByFile).map(([filename, questions]) => (
              <QuestionBankCard
                key={filename}
                filename={filename}
                questions={questions || []}
                profile={profile}
                onPractice={(qs) => {
                  const vignettes = (qs || []).map((q, i) => ({
                    id: q.id || "bank-" + i,
                    stem: q.stem,
                    choices: q.choices || {},
                    correct: q.correct,
                    explanation: q.explanation,
                    topic: q.topic,
                    subtopic: q.subtopic,
                    difficulty: q.difficulty || "medium",
                    type: q.type,
                    imageQuestion: q.imageQuestion,
                    questionPageImage: q.questionPageImage,
                    answerPageImage: q.answerPageImage,
                  }));
                  setSessionVignettes(vignettes);
                  setTab("practice");
                }}
                onPracticeWeak={(qs) => {
                  const weak = (qs || []).filter((q) => {
                    const key = [q.topic, q.subtopic].filter(Boolean).join(" — ") || "Other";
                    return weakTopicKeys.has(key);
                  });
                  const toUse = weak.length > 0 ? weak : qs || [];
                  const vignettes = toUse.map((q, i) => ({
                    id: q.id || "weak-" + i,
                    stem: q.stem,
                    choices: q.choices || {},
                    correct: q.correct,
                    explanation: q.explanation,
                    topic: q.topic,
                    subtopic: q.subtopic,
                    difficulty: q.difficulty || "medium",
                    type: q.type,
                    imageQuestion: q.imageQuestion,
                    questionPageImage: q.questionPageImage,
                    answerPageImage: q.answerPageImage,
                  }));
                  setSessionVignettes(vignettes);
                  setTab("practice");
                }}
                onDelete={(fname) => {
                  if (!window.confirm("Remove " + fname + " from your question bank?")) return;
                  const updated = { ...questionBanksByFile };
                  delete updated[fname];
                  setQuestionBanksByFile(updated);
                  localStorage.setItem("rxt-question-banks", JSON.stringify(updated));
                }}
              />
            ))}

            {Object.keys(questionBanksByFile).length === 0 && (
              <div style={{ textAlign: "center", padding: "50px 0" }}>
                <div style={{ fontSize: 42, marginBottom: 12 }}>📭</div>
                <p style={{ fontFamily: MONO, color: "#374151", fontSize: 13 }}>No question banks uploaded yet</p>
                <p style={{ fontFamily: MONO, color: "#2d3d4f", fontSize: 11 }}>Upload a PDF above to get started</p>
              </div>
            )}
          </div>
        )}

        {tab === "practice" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {sessionVignettes ? (
              <LearningSession
                vignettes={sessionVignettes}
                termColor={ACCENT}
                profile={profile}
                onProfileUpdate={onProfileUpdate}
                onDone={() => setSessionVignettes(null)}
                onBack={() => setSessionVignettes(null)}
              />
            ) : (
              <>
                {typeof window !== "undefined" && (() => {
                  const savedMissed = JSON.parse(localStorage.getItem("rxt-missed-questions") || "[]");
                  return savedMissed.length > 0 ? (
                    <div
                      style={{
                        background: T.cardBg,
                        border: "1px solid " + T.cardBorder,
                        borderRadius: 14,
                        padding: 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: MONO, color: T.text4, fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>
                          MISSED QUESTIONS BANK
                        </div>
                        <p style={{ fontFamily: MONO, color: T.text2, fontSize: 13, margin: 0 }}>
                          {savedMissed.length} saved missed question{savedMissed.length !== 1 ? "s" : ""} from past sessions
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const vignettes = savedMissed.map((q, i) => ({
                            id: q.id || "missed-" + i,
                            stem: q.stem,
                            choices: q.choices || {},
                            correct: q.correct,
                            explanation: q.explanation,
                            topic: q.topic || q.subject,
                            subtopic: q.subtopic,
                            difficulty: q.difficulty || "medium",
                            type: q.type,
                            imageQuestion: q.imageQuestion,
                            questionPageImage: q.questionPageImage,
                            answerPageImage: q.answerPageImage,
                          }));
                          setSessionVignettes(vignettes);
                        }}
                        style={{
                          background: ACCENT,
                          border: "none",
                          color: "#fff",
                          padding: "10px 20px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontFamily: MONO,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        Re-Practice Missed
                      </button>
                    </div>
                  ) : null;
                })()}
                <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: ACCENT }}>
                  Practice
                </h2>
                <div
                  style={{
                    background: T.cardBg,
                    border: "1px solid " + T.cardBorder,
                    borderRadius: 14,
                    padding: 24,
                    maxWidth: 520,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div>
                    <label style={{ fontFamily: MONO, color: T.text3, fontSize: 11, display: "block", marginBottom: 6 }}>
                      Subject
                    </label>
                    <select
                      value={practiceSubject || (subjectsFromLectures[0] ?? "General")}
                      onChange={(e) => setPracticeSubject(e.target.value)}
                      style={{
                        width: "100%",
                        background: T.inputBg,
                        border: "1px solid " + T.cardBorder,
                        color: T.text1,
                        padding: "8px 12px",
                        borderRadius: 8,
                        fontFamily: MONO,
                        fontSize: 12,
                      }}
                    >
                      {subjectsFromLectures.length > 0 ? (
                        subjectsFromLectures.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))
                      ) : null}
                      <option value="General">General</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontFamily: MONO, color: T.text3, fontSize: 11, display: "block", marginBottom: 6 }}>
                      Mode
                    </label>
                    <select
                      value={practiceMode}
                      onChange={(e) => setPracticeMode(e.target.value)}
                      style={{
                        width: "100%",
                        background: T.inputBg,
                        border: "1px solid " + T.cardBorder,
                        color: T.text1,
                        padding: "8px 12px",
                        borderRadius: 8,
                        fontFamily: MONO,
                        fontSize: 12,
                      }}
                    >
                      <option value="aiGenerated">AI Generated</option>
                      <option value="fromBank">From Question Bank</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontFamily: MONO, color: T.text3, fontSize: 11, display: "block", marginBottom: 6 }}>
                      Question count: {practiceCount}
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={40}
                      value={practiceCount}
                      onChange={(e) => setPracticeCount(Number(e.target.value))}
                      style={{ width: "100%", accentColor: ACCENT }}
                    />
                  </div>
                  {(practiceMode === "fromBank" || practiceMode === "mixed") && (
                    <Toggle
                      label="Weak topics only"
                      checked={practiceWeakOnly}
                      onChange={setPracticeWeakOnly}
                    />
                  )}
                  {sessionError && (
                    <div style={{ color: ACCENT, fontSize: 12 }}>{sessionError}</div>
                  )}
                  <button
                    onClick={startPractice}
                    disabled={
                      sessionLoading ||
                      (practiceMode === "fromBank" && bankForPractice.length === 0)
                    }
                    style={{
                      background: sessionLoading ? T.border1 : ACCENT,
                      border: "none",
                      color: "#fff",
                      padding: "12px 24px",
                      borderRadius: 8,
                      cursor: sessionLoading ? "not-allowed" : "pointer",
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {sessionLoading ? "Generating…" : "Generate Session →"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "histology" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 400 }}>
            <HistoStudy
              questions={(Object.values(questionBanksByFile).flat() || []).filter((q) => q && q.imageQuestion)}
              profile={profile}
              termColor={ACCENT}
              onBack={() => setTab("questionBank")}
              parsingCallbacks={{
                addJob: addParsingJob,
                progress: updateJobProgress,
                complete: completeJob,
                fail: failJob,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
