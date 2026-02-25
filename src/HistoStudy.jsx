import { useState, useEffect } from "react";

const MONO = "'DM Mono','Courier New',monospace";
const SERIF = "'Playfair Display',Georgia,serif";

export const TISSUE_COLORS = {
  Nervous: "#a78bfa",
  Muscle: "#ef4444",
  Connective: "#f59e0b",
  Epithelial: "#10b981",
  Cardiovascular: "#3b82f6",
  Lymphoid: "#ec4899",
  Other: "#6b7280",
};

const TISSUE_ICONS = {
  Nervous: "🧠",
  Muscle: "💪",
  Connective: "🦴",
  Epithelial: "🫁",
  Cardiovascular: "❤️",
  Lymphoid: "🛡",
  Other: "🔬",
  __review__: "📌",
};

export function detectTissueType(topic) {
  if (!topic) return "Other";
  const t = topic.toLowerCase();
  if (t.includes("nervous") || t.includes("neuron") || t.includes("brain") ||
      t.includes("cerebr") || t.includes("cerebell") || t.includes("spinal")) return "Nervous";
  if (t.includes("muscle") || t.includes("cardiac") || t.includes("skeletal") ||
      t.includes("smooth")) return "Muscle";
  if (t.includes("connective") || t.includes("collagen") || t.includes("fibro") ||
      t.includes("bone") || t.includes("cartilage")) return "Connective";
  if (t.includes("epithelial") || t.includes("gland") || t.includes("skin") ||
      t.includes("mucosa")) return "Epithelial";
  if (t.includes("heart") || t.includes("vessel") || t.includes("blood") ||
      t.includes("cardiovasc")) return "Cardiovascular";
  if (t.includes("lymph") || t.includes("spleen") || t.includes("thymus") ||
      t.includes("immune")) return "Lymphoid";
  return "Other";
}

function extractStructures(question) {
  if (question.structures?.length) return question.structures;
  const text = (question.topic || "") + " " + (question.stem || "");
  const words = text.match(/[A-Z][a-z]+ (?:cell|layer|fiber|tissue|duct|node|cortex|medulla|lobe|zone)/g) || [];
  const unique = [...new Set(words)].slice(0, 6);
  if (unique.length === 0) {
    const caps = text.match(/\b[A-Z][a-z]{3,}\b/g) || [];
    return [...new Set(caps)].slice(0, 5);
  }
  return unique;
}

async function identifyHistoSlide(base64, filename) {
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
  if (!GEMINI_KEY) return {};

  const prompt =
    "You are a medical histology expert. Analyze this histological slide image.\n\n" +
    "Return ONLY valid JSON with no markdown:\n" +
    "{\n" +
    '  "tissueType": "Nervous|Muscle|Connective|Epithelial|Cardiovascular|Lymphoid|Other",\n' +
    '  "topic": "Specific lecture topic e.g. Histology of Nervous Tissue — Cerebral Cortex",\n' +
    '  "questionPrompt": "A specific question about this slide without naming the tissue. E.g. \'What type of fiber is shown here, and what staining technique was used?\' or \'Identify the connective tissue fiber type visible in this silver-stained section.\'",\n' +
    '  "blindTopic": "Vague category only e.g. \'Connective Tissue Fiber\' not \'Reticular Fiber\'",\n' +
    '  "structures": ["structure1", "structure2", "structure3"],\n' +
    '  "explanation": "2-3 sentence description of what is shown and key identifying features",\n' +
    '  "choices": ["correct tissue/structure name", "distractor 1", "distractor 2", "distractor 3"],\n' +
    '  "correct": "A",\n' +
    '  "stain": "H&E|PAS|Masson Trichrome|Silver|Other",\n' +
    '  "keyFeatures": ["identifying feature 1", "identifying feature 2"],\n' +
    '  "clinicalRelevance": "one sentence clinical connection"\n' +
    "}\n\n" +
    "For choices: put the correct answer as the first item (will be labeled A), add 3 plausible distractors.\n" +
    "For structures: list the most visible/important labeled or identifiable structures.\n" +
    "For stain: identify the staining technique used if possible.\n" +
    "For questionPrompt: ask what to identify without giving away the answer (no tissue/structure name).\n" +
    "For blindTopic: use a vague category (e.g. Connective Tissue Fiber, Nervous Tissue) not the specific name.";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "image/png", data: base64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.2 },
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
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1) return {};
    return JSON.parse(text.slice(first, last + 1));
  } catch (e) {
    console.warn("Histo identification failed:", e.message);
    return {};
  }
}

async function loadPDFJS() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return;
  }
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
}

function HistoUpload({ onAdd, termColor, onJobStart, onJobProgress, onJobDone, onJobError }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const tc = termColor || "#a78bfa";
  const useJobs = typeof onJobStart === "function";

  const handleImageUpload = async (file, jobId) => {
    try {
      if (jobId) onJobProgress?.(jobId, "Identifying...");
      const base64 = await new Promise((res) => {
        const reader = new FileReader();
        reader.onload = (e) => res(e.target.result.split(",")[1]);
        reader.readAsDataURL(file);
      });
      const identified = await identifyHistoSlide(base64, file.name);
      const choiceArr = identified.choices || [];
      const newSlide = {
        id: "histo_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
        num: 0,
        type: "image",
        imageQuestion: true,
        subject: "Histology",
        topic: identified.topic || "Histology — " + file.name.replace(/\.[^.]+$/, ""),
        questionPrompt: identified.questionPrompt || null,
        blindTopic: identified.blindTopic || null,
        stem: "Identify the tissue type and labeled structures in this histological slide.",
        questionPageImage: base64,
        answerPageImage: null,
        choices: {
          A: choiceArr[0] || "(See image)",
          B: choiceArr[1] || "(See image)",
          C: choiceArr[2] || "(See image)",
          D: choiceArr[3] || "(See image)",
        },
        correct: identified.correct || "A",
        explanation: identified.explanation || null,
        difficulty: "medium",
        manualUpload: true,
        tissueType: identified.tissueType || "Other",
        structures: identified.structures || [],
        stain: identified.stain,
        keyFeatures: identified.keyFeatures || [],
        clinicalRelevance: identified.clinicalRelevance,
        filename: file.name,
        uploadedAt: new Date().toISOString(),
      };
      onAdd(newSlide);
      if (jobId) onJobDone?.(jobId, 1);
    } catch (e) {
      if (jobId) onJobError?.(jobId, e.message || String(e));
    }
  };

  const handlePDFUpload = async (file, jobId) => {
    try {
      await loadPDFJS();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const OPS = window.pdfjsLib.OPS || {};
      let slidesFound = 0;

      for (let i = 1; i <= pdf.numPages; i++) {
        const progressMsg = "📄 Page " + i + " of " + pdf.numPages + "...";
        if (jobId) onJobProgress?.(jobId, progressMsg);
        else setMsg(progressMsg);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        const base64 = canvas.toDataURL("image/png").split(",")[1];

        const content = await page.getTextContent();
        const text = content.items.map((x) => x.str).join(" ").trim();
        let imgCount = 0;
        try {
          const ops = await page.getOperatorList();
          imgCount = (ops.fnArray || []).filter(
            (fn) => fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject
          ).length;
        } catch (_) {}
        if (imgCount >= 1 && text.length < 500) {
          const identified = await identifyHistoSlide(base64, file.name + " p." + i);
          if (
            (identified.tissueType && identified.tissueType !== "Other") ||
            (identified.structures?.length > 0)
          ) {
            const slide = {
              id: "histo_" + Date.now() + "_" + i,
              num: i,
              type: "image",
              imageQuestion: true,
              subject: "Histology",
              topic: identified.topic || "Histology — " + file.name,
              questionPrompt: identified.questionPrompt || null,
              blindTopic: identified.blindTopic || null,
              stem: "Identify the tissue type and structures in this slide.",
              questionPageImage: base64,
              answerPageImage: null,
              choices: {
                A: identified.choices?.[0] || "(See image)",
                B: identified.choices?.[1] || "(See image)",
                C: identified.choices?.[2] || "(See image)",
                D: identified.choices?.[3] || "(See image)",
              },
              correct: identified.correct || "A",
              explanation: identified.explanation || null,
              difficulty: "medium",
              manualUpload: true,
              tissueType: identified.tissueType || "Other",
              structures: identified.structures || [],
              stain: identified.stain || null,
              keyFeatures: identified.keyFeatures || [],
              clinicalRelevance: identified.clinicalRelevance || null,
              filename: file.name,
              uploadedAt: new Date().toISOString(),
            };
            onAdd(slide);
            slidesFound++;
            if (jobId) onJobProgress?.(jobId, "🔬 Found " + slidesFound + " histology slide(s) so far...");
            else setMsg("🔬 Found " + slidesFound + " histology slide(s) so far...");
          }
        }
      }
      if (jobId) onJobDone?.(jobId, slidesFound);
      else setMsg("✓ Extracted " + slidesFound + " histology slides from " + file.name);
    } catch (e) {
      if (jobId) onJobError?.(jobId, e.message || String(e));
      else setMsg("✗ " + (e.message || String(e)));
    }
  };

  const handleFiles = (files) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    if (!useJobs) setUploading(true);
    for (const file of fileList) {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const jobId = useJobs ? onJobStart?.(file.name) : null;
        if (useJobs && jobId) {
          handlePDFUpload(file, jobId);
        } else {
          (async () => {
            await handlePDFUpload(file, null);
            if (!useJobs) setUploading(false);
            if (!useJobs) setTimeout(() => setMsg(""), 4000);
          })();
        }
      } else if (file.type.startsWith("image/")) {
        const jobId = useJobs ? onJobStart?.(file.name) : null;
        if (useJobs && jobId) {
          handleImageUpload(file, jobId);
        } else {
          (async () => {
            setMsg("🔬 Identifying " + file.name + "...");
            await handleImageUpload(file, null);
            setUploading(false);
            setTimeout(() => setMsg(""), 4000);
          })();
        }
      }
    }
    if (useJobs) return;
    if (fileList.every((f) => f.type?.startsWith("image/"))) return;
    if (fileList.every((f) => f.type === "application/pdf" || f.name?.toLowerCase().endsWith(".pdf"))) {
      setUploading(false);
      setTimeout(() => setMsg(""), 4000);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      style={{
        border: "2px dashed " + (dragging ? tc : "#1a2a3a"),
        borderRadius: 12,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 16,
        background: dragging ? tc + "08" : "transparent",
        transition: "all 0.2s",
      }}
    >
      <div style={{ fontSize: 28, flexShrink: 0 }}>🔬</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: MONO, color: "#c4cdd6", fontSize: 12, fontWeight: 600, marginBottom: 3 }}>
          Add your own histology slides
        </div>
        <div style={{ fontFamily: MONO, color: "#374151", fontSize: 10 }}>
          Drop images or PDFs · JPG, PNG, PDF · AI identifies tissue type automatically
        </div>
        {!useJobs && msg && (
          <div style={{ fontFamily: MONO, color: "#f59e0b", fontSize: 10, marginTop: 6 }}>{msg}</div>
        )}
      </div>
      <label
        style={{
          background: !useJobs && uploading ? "#1a2a3a" : tc,
          border: "none",
          color: "#fff",
          padding: "8px 18px",
          borderRadius: 8,
          cursor: !useJobs && uploading ? "not-allowed" : "pointer",
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          transition: "background 0.15s",
        }}
      >
        {!useJobs && uploading ? "⟳ Processing..." : "Upload Slides"}
        <input
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: "none" }}
          disabled={!useJobs && uploading}
        />
      </label>
    </div>
  );
}

function TissueStudyView({ tissue, slides, color, confidences, bookmarks, onConf, onBookmark, onDelete, onBack, termColor }) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [quizMode, setQuizMode] = useState(false);
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }";
    document.head.appendChild(style);
    return () => {
      if (document.head.contains(style)) document.head.removeChild(style);
    };
  }, []);

  if (slides.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ fontFamily: MONO, color: "#374151" }}>No slides for this tissue type yet.</p>
        <button
          type="button"
          onClick={onBack}
          style={{
            marginTop: 16,
            background: "none",
            border: "1px solid #1a2a3a",
            color: "#6b7280",
            padding: "8px 20px",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  const slide = slides[idx];
  const conf = confidences[slide?.id] || 0;
  const isBookmarked = bookmarks.includes(slide?.id);
  const isManualBlind = slide?.manualUpload;
  const rawQuestion = slide?.questionPageImage;
  const rawAnswer = slide?.answerPageImage;
  const questionSrc =
    rawQuestion != null
      ? String(rawQuestion).startsWith("data:")
        ? rawQuestion
        : "data:image/png;base64," + rawQuestion
      : "";
  const answerSrc =
    rawAnswer != null
      ? String(rawAnswer).startsWith("data:")
        ? rawAnswer
        : "data:image/png;base64," + rawAnswer
      : questionSrc;
  const imgSrc = revealed && rawAnswer ? answerSrc : questionSrc;

  const goNext = () => {
    setIdx((i) => Math.min(slides.length - 1, i + 1));
    setRevealed(false);
  };
  const goPrev = () => {
    setIdx((i) => Math.max(0, i - 1));
    setRevealed(false);
  };

  const tissueLabel = tissue === "__review__" ? "Review Queue" : tissue;
  const displayColor = tissue === "__review__" ? "#ef4444" : color;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #0d1829",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "#374151",
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          ← All Tissues
        </button>
        <div style={{ width: 1, height: 16, background: "#1a2a3a" }} />
        <span style={{ fontFamily: SERIF, color: displayColor, fontSize: 15, fontWeight: 900 }}>
          {TISSUE_ICONS[tissue] || "🔬"} {tissueLabel}
        </span>
        <span style={{ fontFamily: MONO, color: "#374151", fontSize: 11 }}>
          {idx + 1} / {slides.length}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[
            ["study", "📖 Study"],
            ["quiz", "🧪 Quiz"],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setQuizMode(v === "quiz");
                setRevealed(false);
              }}
              style={{
                background: (quizMode ? v === "quiz" : v === "study") ? displayColor + "22" : "none",
                border:
                  "1px solid " + ((quizMode ? v === "quiz" : v === "study") ? displayColor : "#1a2a3a"),
                color: (quizMode ? v === "quiz" : v === "study") ? displayColor : "#4b5563",
                padding: "5px 12px",
                borderRadius: 7,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 10,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => slide && onBookmark(slide.id)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: isBookmarked ? "#f59e0b" : "#1a2a3a",
            transition: "color 0.15s",
          }}
        >
          {isBookmarked ? "★" : "☆"}
        </button>
      </div>

      <div style={{ height: 2, background: "#0d1829", flexShrink: 0 }}>
        <div
          style={{
            width: ((idx + 1) / slides.length) * 100 + "%",
            height: "100%",
            background: displayColor,
            transition: "width 0.3s",
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {!quizMode && slide && (
          <>
            {/* Header / prompt: blind for manual until revealed */}
            {isManualBlind ? (
              !revealed ? (
                <>
                  <div
                    style={{
                      fontFamily: MONO,
                      color: displayColor,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      marginBottom: 8,
                    }}
                  >
                    {(slide.blindTopic || detectTissueType(slide.topic)).toUpperCase()} — IDENTIFY THIS SLIDE
                  </div>
                  {slide.questionPrompt && (
                    <p
                      style={{
                        fontFamily: SERIF,
                        color: "#c4cdd6",
                        fontSize: 13,
                        marginBottom: 12,
                        marginTop: 0,
                        lineHeight: 1.5,
                      }}
                    >
                      {slide.questionPrompt}
                    </p>
                  )}
                </>
              ) : (
                <div
                  style={{
                    fontFamily: MONO,
                    color: displayColor,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    marginBottom: 12,
                    animation: "fadeIn 0.4s ease",
                  }}
                >
                  ✓ {(slide.topic || "").toUpperCase()}
                </div>
              )
            ) : (
              <div
                style={{
                  fontFamily: MONO,
                  color: displayColor,
                  fontSize: 10,
                  letterSpacing: 1.5,
                  marginBottom: 12,
                }}
              >
                {(slide.topic || "").toUpperCase()}
              </div>
            )}

            <div
              style={{
                background: "#0d1829",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid #1a2a3a",
                marginBottom: 16,
                cursor: "pointer",
                position: "relative",
              }}
              onClick={() => setRevealed((r) => !r)}
            >
              <img
                src={imgSrc}
                alt="Histology slide"
                style={{ width: "100%", display: "block" }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 10,
                  right: 10,
                  background: "#000000b0",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontFamily: MONO,
                  color: "#f1f5f9",
                  fontSize: 10,
                }}
              >
                {isManualBlind && !revealed
                  ? "👆 Tap image to reveal tissue identity"
                  : revealed
                    ? "👁 Answer"
                    : "👆 Tap to reveal answer"}
              </div>
            </div>

            {revealed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {slide.structures?.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontFamily: MONO,
                        color: "#374151",
                        fontSize: 9,
                        letterSpacing: 1.5,
                        marginBottom: 6,
                      }}
                    >
                      LABELED STRUCTURES
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {slide.structures.map((s, i) => (
                        <span
                          key={i}
                          style={{
                            fontFamily: MONO,
                            color: displayColor,
                            background: displayColor + "18",
                            border: "1px solid " + displayColor + "40",
                            fontSize: 10,
                            padding: "2px 10px",
                            borderRadius: 4,
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {slide.explanation && (
                  <div
                    style={{
                      background: "#080f1c",
                      borderRadius: 10,
                      padding: "14px 16px",
                      border: "1px solid " + displayColor + "20",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: MONO,
                        color: displayColor,
                        fontSize: 9,
                        letterSpacing: 1.5,
                        marginBottom: 6,
                      }}
                    >
                      EXPLANATION
                    </div>
                    <p
                      style={{
                        fontFamily: MONO,
                        color: "#c4cdd6",
                        fontSize: 12,
                        lineHeight: 1.7,
                        margin: 0,
                      }}
                    >
                      {slide.explanation}
                    </p>
                  </div>
                )}
                {slide.stain && (
                  <span
                    style={{
                      fontFamily: MONO,
                      color: "#6b7280",
                      fontSize: 10,
                      background: "#1a2a3a",
                      padding: "3px 10px",
                      borderRadius: 4,
                      alignSelf: "flex-start",
                    }}
                  >
                    Stain: {slide.stain}
                  </span>
                )}
                {slide.clinicalRelevance && (
                  <p
                    style={{
                      fontFamily: MONO,
                      color: "#60a5fa",
                      fontSize: 11,
                      fontStyle: "italic",
                      margin: 0,
                    }}
                  >
                    💡 {slide.clinicalRelevance}
                  </p>
                )}
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <span style={{ fontFamily: MONO, color: "#374151", fontSize: 10 }}>Confidence:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onConf(slide.id, n)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 20,
                      color: conf >= n ? "#f59e0b" : "#1a2a3a",
                      transition: "color 0.1s",
                      padding: "0 2px",
                    }}
                  >
                    ★
                  </button>
                ))}
                {conf > 0 && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      color: conf >= 4 ? "#10b981" : conf >= 3 ? "#f59e0b" : "#ef4444",
                    }}
                  >
                    {conf >= 4 ? "Mastered" : conf >= 3 ? "Getting it" : "Needs review"}
                  </span>
                )}
                {slide.manualUpload && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Remove this slide?")) onDelete(slide.id);
                    }}
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      color: "#1a2a3a",
                      cursor: "pointer",
                      fontSize: 12,
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#1a2a3a")}
                  >
                    ✕
                  </button>
                )}
            </div>
          </>
        )}

        {quizMode && (
          <HistoQuiz
            questions={slides}
            startIdx={idx}
            onDone={() => setQuizMode(false)}
            termColor={displayColor}
          />
        )}
      </div>

      {!quizMode && (
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #0d1829",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={goPrev}
            disabled={idx === 0}
            style={{
              background: "#0d1829",
              border: "1px solid #1a2a3a",
              color: idx === 0 ? "#1a2a3a" : "#f1f5f9",
              padding: "9px 22px",
              borderRadius: 9,
              cursor: idx === 0 ? "not-allowed" : "pointer",
              fontFamily: MONO,
              fontSize: 12,
            }}
          >
            ← Prev
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            {slides.slice(0, Math.min(slides.length, 15)).map((_, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setIdx(i);
                  setRevealed(false);
                }}
                style={{
                  width: i === idx ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  cursor: "pointer",
                  background:
                    i === idx ? displayColor : (confidences[slides[i]?.id] || 0) >= 4 ? "#10b981" : "#1a2a3a",
                  transition: "all 0.2s",
                }}
              />
            ))}
            {slides.length > 15 && (
              <span style={{ fontFamily: MONO, color: "#374151", fontSize: 9, alignSelf: "center" }}>
                +{slides.length - 15}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={idx === slides.length - 1}
            style={{
              background: idx === slides.length - 1 ? "#0d1829" : displayColor,
              border: "none",
              color: "#fff",
              padding: "9px 22px",
              borderRadius: 9,
              cursor: idx === slides.length - 1 ? "not-allowed" : "pointer",
              fontFamily: MONO,
              fontSize: 12,
              opacity: idx === slides.length - 1 ? 0.3 : 1,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoCard({ question, onConfidence, onBookmark, bookmarked, onDelete }) {
  const [flipped, setFlipped] = useState(false);
  const [conf, setConf] = useState(null);
  const tissueType = detectTissueType(question.topic);
  const tc = TISSUE_COLORS[tissueType] || "#6b7280";

  return (
    <div style={{
      background: "#09111e",
      border: "1px solid #0f1e30",
      borderRadius: 16,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid #0f1e30",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: tc, flexShrink: 0 }} />
        <span style={{ fontFamily: MONO, color: tc, fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>
          {(question.tissueType || tissueType).toUpperCase()}
        </span>
        {question.manualUpload && (
          <span style={{ fontFamily: MONO, color: "#a78bfa", background: "#a78bfa18", border: "1px solid #a78bfa40", fontSize: 8, padding: "1px 6px", borderRadius: 3, letterSpacing: 1 }}>
            UPLOADED
          </span>
        )}
        <span style={{ fontFamily: MONO, color: "#6b7280", fontSize: 10, marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
          {question.topic?.slice(0, 50)}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onBookmark(question.id); }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: bookmarked ? "#f59e0b" : "#374151",
            transition: "color 0.15s",
            flexShrink: 0,
          }}
        >
          {bookmarked ? "★" : "☆"}
        </button>
      </div>

      {/* Image area — flip */}
      <div
        style={{ position: "relative", cursor: "pointer", minHeight: 280 }}
        onClick={() => setFlipped((f) => !f)}
      >
        <img
          src={(flipped && question.answerPageImage) ? ("data:image/png;base64," + question.answerPageImage) : (question.questionPageImage?.startsWith("data:") ? question.questionPageImage : "data:image/png;base64," + question.questionPageImage)}
          alt={flipped ? "Answer" : "Question"}
          style={{ width: "100%", display: "block", minHeight: 280, objectFit: "contain", background: "#0d1829", transition: "opacity 0.3s", opacity: 1 }}
        />
        <div style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          background: "#000000a0",
          borderRadius: 6,
          padding: "4px 10px",
          fontFamily: MONO,
          color: "#f1f5f9",
          fontSize: 10,
        }}>
          {flipped ? "👁 Answer" : "👆 Tap to reveal"}
        </div>
        {flipped && (
          <div style={{
            position: "absolute",
            top: 10,
            left: 10,
            background: "#10b98190",
            borderRadius: 6,
            padding: "3px 10px",
            fontFamily: MONO,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
          }}>
            ✓ ANSWER
          </div>
        )}
      </div>

      {/* Structure labels */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #0f1e30" }}>
        <div style={{ fontFamily: MONO, color: "#374151", fontSize: 9, letterSpacing: 1.5, marginBottom: 8 }}>
          LABELED STRUCTURES
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {extractStructures(question).map((s, i) => (
            <span
              key={i}
              style={{
                fontFamily: MONO,
                color: tc,
                background: tc + "18",
                border: "1px solid " + tc + "40",
                fontSize: 10,
                padding: "2px 9px",
                borderRadius: 4,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Confidence rating */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid #0f1e30",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontFamily: MONO, color: "#374151", fontSize: 10 }}>Confidence:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => { setConf(n); onConfidence(question.id, n); }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: (conf || 0) >= n ? "#f59e0b" : "#1a2a3a",
              transition: "color 0.1s",
              padding: "0 2px",
            }}
          >
            ★
          </button>
        ))}
        {conf != null && (
          <span style={{
            fontFamily: MONO,
            fontSize: 9,
            color: conf >= 4 ? "#10b981" : conf >= 3 ? "#f59e0b" : "#ef4444",
          }}>
            {conf >= 4 ? "Mastered" : conf >= 3 ? "Getting it" : "Needs review"}
          </span>
        )}
      </div>

      {question.manualUpload && (
        <div style={{ padding: "8px 16px", borderTop: "1px solid #0f1e30", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {question.stain && (
            <span style={{ fontFamily: MONO, color: "#6b7280", background: "#1a2a3a", fontSize: 9, padding: "2px 8px", borderRadius: 4 }}>
              {question.stain}
            </span>
          )}
          {question.keyFeatures?.map((f, i) => (
            <span key={i} style={{ fontFamily: MONO, color: "#374151", fontSize: 9, background: "#0d1829", padding: "2px 8px", borderRadius: 4 }}>
              {f}
            </span>
          ))}
          {question.clinicalRelevance && (
            <span style={{ fontFamily: MONO, color: "#60a5fa", fontSize: 9, marginLeft: "auto", fontStyle: "italic" }}>
              {question.clinicalRelevance}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete?.(question.id); }}
            title="Remove this slide"
            style={{ background: "none", border: "none", color: "#1a2a3a", cursor: "pointer", fontSize: 12, marginLeft: 4, padding: 2, transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#1a2a3a")}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function getChoices(question, allQs) {
  const correct =
    question.topic?.split("–")[1]?.trim() ||
    question.topic?.split(":")[1]?.trim() ||
    detectTissueType(question.topic);
  const others = allQs
    .filter((q2) => q2.id !== question.id)
    .map((q2) => detectTissueType(q2.topic))
    .filter((v, i, a) => a.indexOf(v) === i && v !== correct)
    .slice(0, 3);
  const fill = ["Nervous", "Muscle", "Connective", "Epithelial", "Cardiovascular", "Lymphoid", "Other"];
  while (others.length < 3) {
    const extra = fill.find((f) => f !== correct && !others.includes(f));
    others.push(extra || "Other");
  }
  const choices = [correct, ...others].sort(() => Math.random() - 0.5);
  return { choices, correct };
}

export function HistoQuiz({ questions, startIdx = 0, onDone, termColor }) {
  const [qIdx, setQIdx] = useState(startIdx);
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState(false);
  const [hintUsed, setHintUsed] = useState({});
  const [showHint, setShowHint] = useState(false);
  const tc = termColor || "#a78bfa";

  if (!questions.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: MONO, color: "#6b7280" }}>
        No slides in this quiz.
      </div>
    );
  }

  const q = questions[qIdx];
  const { choices, correct } = getChoices(q, questions);

  const selectAnswer = (choice) => {
    if (revealed) return;
    setAnswers((prev) => ({ ...prev, [q.id]: choice }));
    setRevealed(true);
  };

  const isRight = answers[q.id] === correct;
  const correctSoFar = questions.slice(0, qIdx + 1).filter((q2) => answers[q2.id] === (q2.topic?.split(":")[1]?.trim() || detectTissueType(q2.topic))).length;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px" }}>
      {/* Progress */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontFamily: MONO, color: "#6b7280", fontSize: 11 }}>
          Slide {qIdx + 1} of {questions.length}
        </span>
        <span style={{ fontFamily: MONO, color: tc, fontSize: 11 }}>
          {correctSoFar} correct
        </span>
      </div>
      <div style={{ height: 3, background: "#1a2a3a", borderRadius: 2, marginBottom: 24 }}>
        <div style={{
          width: ((qIdx + 1) / questions.length) * 100 + "%",
          height: "100%",
          background: tc,
          borderRadius: 2,
          transition: "width 0.3s",
        }} />
      </div>

      {/* Slide image */}
      <div style={{
        background: "#0d1829",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid #1a2a3a",
        marginBottom: 20,
        position: "relative",
      }}>
        <img
          src={"data:image/png;base64," + (showHint && q.answerPageImage ? q.answerPageImage : q.questionPageImage)}
          alt="Histology slide"
          style={{ width: "100%", display: "block" }}
        />
        {!revealed && (
          <div style={{ position: "absolute", bottom: 12, right: 12 }}>
            <button
              type="button"
              onClick={() => {
                setHintUsed((p) => ({ ...p, [q.id]: true }));
                setShowHint(true);
                setTimeout(() => setShowHint(false), 2500);
              }}
              style={{
                background: "#000000b0",
                border: "1px solid #374151",
                color: "#f59e0b",
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 10,
              }}
            >
              💡 Show Labels (−1pt)
            </button>
          </div>
        )}
      </div>

      <p style={{
        fontFamily: SERIF,
        color: "#e2e8f0",
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 16,
        textAlign: "center",
      }}>
        {q.questionPrompt || "Identify this tissue type or structure"}
      </p>

      {/* Choices */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {choices.map((choice) => {
          const isSelected = answers[q.id] === choice;
          const isCorrectChoice = choice === correct;
          let bg = "#0d1829";
          let border = "#1a2a3a";
          let color = "#c4cdd6";
          if (revealed) {
            if (isCorrectChoice) { bg = "#10b98118"; border = "#10b981"; color = "#10b981"; }
            else if (isSelected) { bg = "#ef444418"; border = "#ef4444"; color = "#ef4444"; }
          } else if (isSelected) { bg = tc + "18"; border = tc; color = tc; }

          return (
            <div
              key={choice}
              onClick={() => selectAnswer(choice)}
              style={{
                padding: "13px 18px",
                borderRadius: 10,
                border: "1px solid " + border,
                background: bg,
                cursor: revealed ? "default" : "pointer",
                fontFamily: MONO,
                color,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 10,
                transition: "all 0.15s",
              }}
            >
              {revealed && isCorrectChoice && <span>✓</span>}
              {revealed && isSelected && !isCorrectChoice && <span>✗</span>}
              {choice}
            </div>
          );
        })}
      </div>

      {revealed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            background: isRight ? "#021710" : "#150404",
            border: "1px solid " + (isRight ? "#10b98140" : "#ef444440"),
            borderRadius: 10,
            padding: "12px 16px",
            fontFamily: MONO,
            color: isRight ? "#10b981" : "#ef4444",
            fontSize: 12,
          }}>
            {isRight ? "✓ Correct! " : "✗ Incorrect — "}
            {hintUsed[q.id] ? "Hint used (−1pt)" : ""}
          </div>

          {q.answerPageImage && (
            <div>
              <div style={{ fontFamily: MONO, color: "#10b981", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>
                ANNOTATED ANSWER
              </div>
              <img
                src={"data:image/png;base64," + q.answerPageImage}
                alt="Annotated answer"
                style={{ width: "100%", borderRadius: 12, border: "1px solid #10b98130" }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setRevealed(false);
              setShowHint(false);
              if (qIdx < questions.length - 1) setQIdx((i) => i + 1);
              else onDone(answers);
            }}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "12px 0",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            {qIdx < questions.length - 1 ? "Next Slide →" : "Finish Quiz ✓"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function HistoStudy({ questions, profile, onBack, termColor, parsingCallbacks }) {
  const [activeTissue, setActiveTissue] = useState(null);
  const [manualSlides, setManualSlides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-histo-manual") || "[]");
    } catch {
      return [];
    }
  });
  const [confidences, setConfidences] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-histo-conf") || "{}");
    } catch {
      return {};
    }
  });
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-histo-bookmarks") || "[]");
    } catch {
      return [];
    }
  });
  const tc = termColor || "#a78bfa";
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const allSlides = [
    ...(questions || []).filter((q) => q && (q.imageQuestion || q.type === "image")),
    ...manualSlides,
  ];

  const addManualSlide = (slide) => {
    const updated = [...manualSlides, slide];
    setManualSlides(updated);
    localStorage.setItem("rxt-histo-manual", JSON.stringify(updated));
  };
  const removeManualSlide = (id) => {
    const updated = manualSlides.filter((s) => s.id !== id);
    setManualSlides(updated);
    localStorage.setItem("rxt-histo-manual", JSON.stringify(updated));
  };
  const setConf = (id, val) => {
    const updated = { ...confidences, [id]: val };
    setConfidences(updated);
    localStorage.setItem("rxt-histo-conf", JSON.stringify(updated));
  };
  const toggleBookmark = (id) => {
    const updated = bookmarks.includes(id) ? bookmarks.filter((b) => b !== id) : [...bookmarks, id];
    setBookmarks(updated);
    localStorage.setItem("rxt-histo-bookmarks", JSON.stringify(updated));
  };

  const TISSUE_TYPES = ["Nervous", "Muscle", "Connective", "Epithelial", "Cardiovascular", "Lymphoid", "Other"];
  const byTissue = {};
  for (const t of TISSUE_TYPES) {
    byTissue[t] = allSlides.filter((s) => (s.tissueType || detectTissueType(s.topic)) === t);
  }

  if (activeTissue) {
    const slides =
      activeTissue === "__review__"
        ? allSlides.filter((s) => (confidences[s.id] || 0) > 0 && (confidences[s.id] || 0) < 3)
        : byTissue[activeTissue] || [];
    const color = activeTissue === "__review__" ? "#ef4444" : (TISSUE_COLORS[activeTissue] || "#6b7280");
    return (
      <TissueStudyView
        tissue={activeTissue}
        slides={slides}
        color={color}
        confidences={confidences}
        bookmarks={bookmarks}
        onConf={setConf}
        onBookmark={toggleBookmark}
        onDelete={removeManualSlide}
        onBack={() => setActiveTissue(null)}
        termColor={tc}
      />
    );
  }

  const needReview = allSlides.filter((s) => (confidences[s.id] || 0) > 0 && (confidences[s.id] || 0) < 3).length;
  const mastered = allSlides.filter((s) => (confidences[s.id] || 0) >= 4).length;
  const bookmarked = allSlides.filter((s) => bookmarks.includes(s.id)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", gap: 8, padding: "14px 20px 0", flexWrap: "wrap" }}>
        {[
          ["Total Slides", allSlides.length, "#6b7280"],
          ["Need Review", needReview, "#ef4444"],
          ["Mastered", mastered, "#10b981"],
          ["Bookmarked", bookmarked, "#f59e0b"],
        ].map(([l, v, c]) => (
          <div
            key={l}
            style={{
              background: "#0d1829",
              borderRadius: 7,
              padding: "5px 12px",
              display: "flex",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: MONO, color: c, fontSize: 12, fontWeight: 700 }}>{v}</span>
            <span style={{ fontFamily: MONO, color: "#374151", fontSize: 9 }}>{l}</span>
          </div>
        ))}
        {needReview > 0 && (
          <button
            type="button"
            onClick={() => setActiveTissue("__review__")}
            style={{
              background: "#ef444418",
              border: "1px solid #ef444440",
              color: "#ef4444",
              padding: "5px 12px",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 10,
              marginLeft: "auto",
            }}
          >
            📌 Review Queue ({needReview})
          </button>
        )}
      </div>

      <div style={{ padding: "12px 20px" }}>
        <HistoUpload
          onAdd={addManualSlide}
          termColor={tc}
          onJobStart={parsingCallbacks?.addJob}
          onJobProgress={parsingCallbacks?.progress}
          onJobDone={parsingCallbacks?.complete}
          onJobError={parsingCallbacks?.fail}
        />
      </div>

      <div
        style={{
          padding: "0 20px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
          gap: 12,
        }}
      >
        {TISSUE_TYPES.map((tissue) => {
          const slides = byTissue[tissue] || [];
          if (slides.length === 0) return null;
          const color = TISSUE_COLORS[tissue];
          const reviewed = slides.filter((s) => (confidences[s.id] || 0) > 0).length;
          const mastCount = slides.filter((s) => (confidences[s.id] || 0) >= 4).length;
          const needCount = slides.filter((s) => (confidences[s.id] || 0) > 0 && (confidences[s.id] || 0) < 3).length;
          const pct = slides.length > 0 ? Math.round((reviewed / slides.length) * 100) : 0;

          return (
            <div
              key={tissue}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTissue(tissue)}
              onKeyDown={(e) => e.key === "Enter" && setActiveTissue(tissue)}
              style={{
                background: "#09111e",
                border: "1px solid " + color + "30",
                borderRadius: 14,
                padding: "20px 18px",
                cursor: "pointer",
                transition: "all 0.18s",
                position: "relative",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = color;
                e.currentTarget.style.background = color + "0d";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = color + "30";
                e.currentTarget.style.background = "#09111e";
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: color,
                  borderRadius: "14px 14px 0 0",
                }}
              />
              <div
                style={{
                  fontFamily: SERIF,
                  color: color,
                  fontSize: 16,
                  fontWeight: 900,
                  marginBottom: 4,
                  marginTop: 4,
                }}
              >
                {TISSUE_ICONS[tissue]} {tissue}
              </div>
              <div style={{ fontFamily: MONO, color: "#6b7280", fontSize: 10, marginBottom: 14 }}>
                {slides.length} slide{slides.length !== 1 ? "s" : ""}
              </div>
              <div style={{ height: 3, background: "#1a2a3a", borderRadius: 2, marginBottom: 8 }}>
                <div
                  style={{
                    width: pct + "%",
                    height: "100%",
                    background: color,
                    borderRadius: 2,
                    transition: "width 0.4s",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {mastCount > 0 && (
                  <span style={{ fontFamily: MONO, color: "#10b981", fontSize: 9 }}>✓ {mastCount} mastered</span>
                )}
                {needCount > 0 && (
                  <span style={{ fontFamily: MONO, color: "#ef4444", fontSize: 9 }}>⚠ {needCount} review</span>
                )}
                {reviewed === 0 && (
                  <span style={{ fontFamily: MONO, color: "#374151", fontSize: 9 }}>Not started</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
