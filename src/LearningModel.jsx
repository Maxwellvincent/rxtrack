import { useState, useCallback } from "react";
import {
  loadProfile,
  recordAnswer,
  buildSystemPrompt,
} from "./learningModel";
import { parseExamPDF } from "./examParser";

const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const BG = "#06090f";
const CARD_BG = "#09111e";
const BORDER = "#0f1e30";
const ACCENT = "#ef4444";
const TEXT = "#f1f5f9";
const MUTED = "#6b7280";
const FAINT = "#374151";
const INPUT_BG = "#080f1c";

const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);

function Toggle({ label, checked, onChange }) {
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
        color: TEXT,
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
          background: checked ? ACCENT : "#1a2a3a",
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
        <div style={{ fontFamily: SERIF, fontSize: 22, color: MUTED }}>
          Session Complete
        </div>
        <div
          style={{
            width: 130,
            height: 130,
            borderRadius: "50%",
            background: "#1a2a3a",
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
        <p style={{ fontFamily: MONO, color: MUTED, fontSize: 12 }}>
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
            color: FAINT,
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
            background: BORDER,
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
        <span style={{ fontFamily: MONO, color: FAINT, fontSize: 11 }}>
          {idx + 1}/{vignettes.length}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            fontFamily: MONO,
            background: dc + "18",
            color: dc,
            fontSize: 9,
            padding: "3px 10px",
            borderRadius: 20,
            letterSpacing: 1.5,
          }}
        >
          {(v.difficulty || "medium").toUpperCase()}
        </span>
        {(v.topic || v.subtopic) && (
          <span style={{ fontFamily: MONO, color: "#2d3d4f", fontSize: 11 }}>
            {[v.topic, v.subtopic].filter(Boolean).join(" — ")}
          </span>
        )}
      </div>

      <div
        style={{
          background: INPUT_BG,
          border: "1px solid " + BORDER,
          borderRadius: 16,
          padding: 28,
        }}
      >
        <p
          style={{
            fontFamily: SERIF,
            color: "#e2e8f0",
            lineHeight: 1.95,
            fontSize: 15,
            margin: 0,
          }}
        >
          {v.stem}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {CHOICES.map((ch) => {
          let bg = INPUT_BG,
            border = BORDER,
            color = "#8a9bb0";
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
              <span style={{ fontWeight: 700, minWidth: 22 }}>{ch}.</span>
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
            background: "#050c18",
            border: "1px solid #0f2040",
            borderRadius: 14,
            padding: 24,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              color: "#3b82f6",
              fontSize: 9,
              letterSpacing: 3,
              marginBottom: 12,
            }}
          >
            EXPLANATION
          </div>
          <p
            style={{
              fontFamily: SERIF,
              color: "#cbd5e1",
              lineHeight: 1.95,
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
              background: sel ? tc : "#1a2a3a",
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
  const profile = profileProp || loadProfile();
  const [tab, setTab] = useState("profile");
  const [filterType, setFilterType] = useState("all");
  const [filterDifficulty, setFilterDifficulty] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [practiceSubject, setPracticeSubject] = useState("");
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
  const bankQuestions = (profile.uploadedExamPatterns || []).flatMap((p) =>
    (p.questions || []).map((q) => ({ ...q, _examTitle: p.examTitle }))
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

  const handleFileUpload = async (files) => {
    const file = files && files[0];
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Please upload a PDF file.");
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      const result = await parseExamPDF(file);
      const newPattern = { examTitle: result.examTitle, questions: result.questions || [] };
      const nextPatterns = [...(profile.uploadedExamPatterns || []), newPattern];
      const nextProfile = { ...profile, uploadedExamPatterns: nextPatterns };
      onProfileUpdate(nextProfile);
    } catch (e) {
      setUploadError(e.message || "Parse failed");
    } finally {
      setUploading(false);
    }
  };

  const startPractice = async () => {
    setSessionError("");
    setSessionVignettes(null);
    if (practiceMode === "fromBank") {
      const fromBank = bankForPractice.slice(0, practiceCount);
      const shuffled = [...fromBank].sort(() => Math.random() - 0.5);
      const vignettes = shuffled.map((q, i) => ({
        id: "b" + i,
        stem: q.stem,
        choices: q.choices || {},
        correct: q.correct,
        explanation: q.explanation,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty || "medium",
        type: q.type,
      }));
      setSessionVignettes(vignettes);
      return;
    }
    if (practiceMode === "mixed") {
      const bankCount = Math.min(Math.floor(practiceCount / 2), bankForPractice.length);
      const aiCount = practiceCount - bankCount;
      const fromBank = [...bankForPractice].sort(() => Math.random() - 0.5).slice(0, bankCount).map((q, i) => ({
        id: "b" + i,
        stem: q.stem,
        choices: q.choices || {},
        correct: q.correct,
        explanation: q.explanation,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty || "medium",
        type: q.type,
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
    color: tab === t ? TEXT : MUTED,
    padding: "10px 18px",
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: 12,
    marginBottom: -1,
  });

  return (
    <div style={{ background: BG, color: TEXT, minHeight: "100%", fontFamily: MONO }}>
      <div style={{ display: "flex", borderBottom: "1px solid " + BORDER, padding: "0 20px" }}>
        <button style={navStyle("profile")} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button style={navStyle("questionBank")} onClick={() => setTab("questionBank")}>
          Question Bank
        </button>
        <button style={navStyle("practice")} onClick={() => setTab("practice")}>
          Practice
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
                background: CARD_BG,
                border: "1px solid " + BORDER,
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontFamily: MONO, color: FAINT, fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>
                OVERALL
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, color: TEXT }}>
                    {overallAccuracy !== null ? overallAccuracy + "%" : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: MUTED }}>Accuracy</div>
                </div>
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, color: TEXT }}>
                    {totalQuestions}
                  </div>
                  <div style={{ fontSize: 11, color: MUTED }}>Questions answered</div>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontFamily: MONO, color: FAINT, fontSize: 9, letterSpacing: 2, marginBottom: 10 }}>
                WEAK TOPICS (&lt;65%)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {weakTopics.length === 0 ? (
                  <span style={{ color: MUTED, fontSize: 12 }}>None yet</span>
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
                        fontSize: 11,
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
              <div style={{ fontFamily: MONO, color: FAINT, fontSize: 9, letterSpacing: 2, marginBottom: 10 }}>
                STRONG TOPICS (≥80%)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {strongTopics.length === 0 ? (
                  <span style={{ color: MUTED, fontSize: 12 }}>None yet</span>
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
                        fontSize: 11,
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
                background: CARD_BG,
                border: "1px solid " + BORDER,
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontFamily: MONO, color: FAINT, fontSize: 9, letterSpacing: 2, marginBottom: 14 }}>
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFileUpload(e.dataTransfer.files);
              }}
              style={{
                background: CARD_BG,
                border: "2px dashed " + BORDER,
                borderRadius: 12,
                padding: 32,
                textAlign: "center",
              }}
            >
              <input
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                id="lm-pdf-upload"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              <label
                htmlFor="lm-pdf-upload"
                style={{ cursor: "pointer", fontFamily: MONO, color: MUTED, fontSize: 12 }}
              >
                {uploading ? "Parsing PDF…" : "Drag & drop a PDF or click to upload"}
              </label>
              {uploadError && (
                <div style={{ marginTop: 8, color: ACCENT, fontSize: 11 }}>{uploadError}</div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: MUTED, fontSize: 11 }}>Type:</span>
              {["all", "clinicalVignette", "mechanismBased", "pharmacology", "laboratory"].map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    background: filterType === t ? ACCENT + "22" : "none",
                    border: "1px solid " + (filterType === t ? ACCENT : BORDER),
                    color: filterType === t ? ACCENT : MUTED,
                    padding: "4px 12px",
                    borderRadius: 20,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 10,
                  }}
                >
                  {t === "all" ? "All" : t}
                </button>
              ))}
              <span style={{ color: MUTED, fontSize: 11, marginLeft: 12 }}>Difficulty:</span>
              {["all", "easy", "medium", "hard"].map((d) => (
                <button
                  key={d}
                  onClick={() => setFilterDifficulty(d)}
                  style={{
                    background: filterDifficulty === d ? ACCENT + "22" : "none",
                    border: "1px solid " + (filterDifficulty === d ? ACCENT : BORDER),
                    color: filterDifficulty === d ? ACCENT : MUTED,
                    padding: "4px 12px",
                    borderRadius: 20,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 10,
                  }}
                >
                  {d === "all" ? "All" : d}
                </button>
              ))}
            </div>

            <div
              style={{
                background: CARD_BG,
                border: "1px solid " + BORDER,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: INPUT_BG, borderBottom: "1px solid " + BORDER }}>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: FAINT }}>Topic</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: FAINT }}>Type</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: FAINT }}>Difficulty</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: FAINT }}>Stem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBank.slice(0, 100).map((q, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid " + BORDER }}>
                      <td style={{ padding: "8px 14px", color: TEXT }}>
                        {[q.topic, q.subtopic].filter(Boolean).join(" — ") || "—"}
                      </td>
                      <td style={{ padding: "8px 14px" }}>
                        <span
                          style={{
                            background: "#1a2a3a",
                            color: "#94a3b8",
                            padding: "2px 8px",
                            borderRadius: 6,
                            fontSize: 9,
                          }}
                        >
                          {q.type || "—"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 14px" }}>
                        <span
                          style={{
                            background:
                              (q.difficulty || "") === "hard"
                                ? "#150404"
                                : (q.difficulty || "") === "easy"
                                ? "#021710"
                                : "#160e00",
                            color:
                              (q.difficulty || "") === "hard"
                                ? ACCENT
                                : (q.difficulty || "") === "easy"
                                ? "#10b981"
                                : "#f59e0b",
                            padding: "2px 8px",
                            borderRadius: 6,
                            fontSize: 9,
                          }}
                        >
                          {q.difficulty || "—"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 14px", color: MUTED, maxWidth: 400 }}>
                        {(q.stem || "").slice(0, 80)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredBank.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: MUTED }}>
                  No questions. Upload a PDF exam to get started.
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  setTab("practice");
                  setPracticeMode("fromBank");
                  setPracticeWeakOnly(true);
                }}
                disabled={bankForPractice.length === 0}
                style={{
                  background: weakTopicKeys.size && bankForPractice.length ? ACCENT : "#1a2a3a",
                  border: "none",
                  color: "#fff",
                  padding: "10px 20px",
                  borderRadius: 8,
                  cursor: bankForPractice.length ? "pointer" : "not-allowed",
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Practice Weak Topics Only
              </button>
              <button
                onClick={() => {
                  setTab("practice");
                  setPracticeMode("fromBank");
                  setPracticeWeakOnly(false);
                }}
                disabled={filteredBank.length === 0}
                style={{
                  background: filteredBank.length ? "#10b981" : "#1a2a3a",
                  border: "none",
                  color: "#fff",
                  padding: "10px 20px",
                  borderRadius: 8,
                  cursor: filteredBank.length ? "pointer" : "not-allowed",
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Practice All
              </button>
            </div>
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
                <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: ACCENT }}>
                  Practice
                </h2>
                <div
                  style={{
                    background: CARD_BG,
                    border: "1px solid " + BORDER,
                    borderRadius: 14,
                    padding: 24,
                    maxWidth: 520,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div>
                    <label style={{ fontFamily: MONO, color: MUTED, fontSize: 10, display: "block", marginBottom: 6 }}>
                      Subject
                    </label>
                    <select
                      value={practiceSubject || (subjectsFromLectures[0] ?? "General")}
                      onChange={(e) => setPracticeSubject(e.target.value)}
                      style={{
                        width: "100%",
                        background: INPUT_BG,
                        border: "1px solid " + BORDER,
                        color: TEXT,
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
                    <label style={{ fontFamily: MONO, color: MUTED, fontSize: 10, display: "block", marginBottom: 6 }}>
                      Mode
                    </label>
                    <select
                      value={practiceMode}
                      onChange={(e) => setPracticeMode(e.target.value)}
                      style={{
                        width: "100%",
                        background: INPUT_BG,
                        border: "1px solid " + BORDER,
                        color: TEXT,
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
                    <label style={{ fontFamily: MONO, color: MUTED, fontSize: 10, display: "block", marginBottom: 6 }}>
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
                      background: sessionLoading ? "#1a2a3a" : ACCENT,
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
      </div>
    </div>
  );
}
