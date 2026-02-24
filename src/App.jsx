import { useState, useEffect, useRef } from "react";

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
// CLAUDE API
// ─────────────────────────────────────────────
async function claude(prompt, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens || 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const d = await res.json();
  return (d.content || []).map(b => b.text || "").join("");
}

function safeJSON(raw) {
  return JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
}

async function detectMeta(text) {
  try {
    const raw = await claude(
      "Medical education expert. Analyze this M1/M2 lecture text and return ONLY valid JSON, no markdown:\n" +
      '{"subject":"e.g. Cardiovascular","subtopics":["A","B","C","D"],"keyTerms":["t1","t2","t3","t4","t5"],"lectureTitle":"Title"}\n\n' +
      "TEXT:\n" + text.slice(0, 5000)
    );
    return safeJSON(raw);
  } catch {
    return { subject: "Medicine", subtopics: ["Core Concepts"], keyTerms: [], lectureTitle: "Uploaded Lecture" };
  }
}

async function genTopicVignettes(subject, subtopic, fullText, count, keyTerms) {
  const raw = await claude(
    "Step 1 USMLE vignette writer for M1/M2. Generate exactly " + count + " clinical vignettes.\n" +
    "Subject: " + subject + " | Subtopic: " + subtopic + "\n" +
    "Key terms: " + (keyTerms || []).join(", ") + "\n\n" +
    "LECTURE MATERIAL:\n" + fullText.slice(0, 9000) + "\n\n" +
    "Rules: realistic patient scenario, test lecture concepts, 4 choices A-D, one correct, full explanation with mechanism + First Aid ref, vary difficulty.\n" +
    'Return ONLY valid JSON: {"vignettes":[{"id":"v1","difficulty":"medium","stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"..."}]}',
    5000
  );
  const data = safeJSON(raw);
  return (data.vignettes || []).slice(0, count);
}

async function genBlockVignettes(blockLecs, count, weakSubs) {
  const combined = blockLecs
    .map(l => "=== " + l.lectureTitle + " [" + l.subject + "] ===\n" + l.fullText)
    .join("\n\n")
    .slice(0, 10000);
  const weakHint = weakSubs.length
    ? "\nIMPORTANT — include at least one question per weak area: " + weakSubs.join(", ")
    : "";
  const raw = await claude(
    "Step 1 USMLE comprehensive block exam writer for M1/M2. Generate exactly " + count + " mixed vignettes spanning DIFFERENT topics.\n\n" +
    "BLOCK MATERIAL:\n" + combined + weakHint + "\n\n" +
    'Return ONLY valid JSON: {"vignettes":[{"id":"v1","difficulty":"medium","topic":"label","stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"..."}]}',
    6000
  );
  const data = safeJSON(raw);
  return (data.vignettes || []).slice(0, count);
}

async function genAnalysis(blockSessions, blockLecs) {
  if (!blockSessions.length) return "Complete at least one session first.";
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
  return claude(
    "Medical advisor for M1/M2 student.\nBlock covers: " + topics + "\n\nPerformance (weakest first):\n" + lines + "\n\n" +
    "Provide:\n## Weak Areas (<70%) — score, 2-3 tactics (First Aid, Pathoma, Sketchy)\n## Moderate Areas (60-79%) — brief tips\n## Strengths — connections to weak areas\n## High-Yield Pearl — clinical connection\nMax 350 words.",
    1000
  );
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);

function getScore(sessions, fn) {
  const rel = sessions.filter(fn);
  if (!rel.length) return null;
  const c = rel.reduce((a, s) => a + s.correct, 0);
  const t = rel.reduce((a, s) => a + s.total, 0);
  return t ? Math.round((c / t) * 100) : null;
}

function mastery(p) {
  if (p === null) return { fg: "#4b5563", bg: "#0d1829", border: "#1a2a3a", label: "Untested" };
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

const THEMES = {
  dark: {
    pageBg: "#06090f",
    text: "#f1f5f9",
    mutedText: "#374151",
    navBg: "#06090ff5",
    navBorder: "#0d1829",
    sidebarBg: "#060c17",
    sidebarBorder: "#0d1829",
    cardBg: "#09111e",
    cardBorder: "#0f1e30",
    inputBg: "#080f1c",
    inputBorder: "#1a2a3a",
    scrollbarTrack: "#06090f",
    scrollbarThumb: "#1a2a3a",
  },
  light: {
    pageBg: "#f5f5f5",
    text: "#0f172a",
    mutedText: "#6b7280",
    navBg: "#ffffffdd",
    navBorder: "#e5e7eb",
    sidebarBg: "#f9fafb",
    sidebarBorder: "#e5e7eb",
    cardBg: "#ffffff",
    cardBorder: "#e5e7eb",
    inputBg: "#ffffff",
    inputBorder: "#d1d5db",
    scrollbarTrack: "#f3f4f6",
    scrollbarThumb: "#cbd5e1",
  },
};

// ─────────────────────────────────────────────
// SMALL UI PIECES
// ─────────────────────────────────────────────
const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";

function Spinner({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:18, padding:"70px 40px" }}>
      <div style={{ width:44, height:44, border:"3px solid #1a2a3a", borderTopColor:"#ef4444", borderRadius:"50%", animation:"rxt-spin 0.85s linear infinite" }} />
      {msg && <p style={{ fontFamily:MONO, color:"#6b7280", fontSize:12, textAlign:"center", maxWidth:320, lineHeight:1.7 }}>{msg}</p>}
    </div>
  );
}

function Ring({ score, size, tint }) {
  size = size || 60;
  tint = tint || "#ef4444";
  const m = mastery(score);
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const fill = score !== null ? (score / 100) * circ : 0;
  return (
    <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} style={{ flexShrink:0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a2a3a" strokeWidth={5} />
      {score !== null && (
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={m.fg}
          strokeWidth={5} strokeDasharray={fill + " " + circ}
          strokeLinecap="round" transform={"rotate(-90 " + size/2 + " " + size/2 + ")"} />
      )}
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
        fill={score !== null ? m.fg : "#374151"}
        fontSize={score !== null ? (size > 70 ? 14 : 11) : 9}
        fontFamily={MONO} fontWeight="700">
        {score !== null ? score + "%" : "—"}
      </text>
    </svg>
  );
}

function Btn({ children, onClick, color, disabled, style }) {
  color = color || "#374151";
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        background: disabled ? "#1a2a3a" : color,
        border: "none", color: disabled ? "#374151" : "#fff",
        padding: "10px 22px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: MONO, fontSize: 13, fontWeight: 600,
        opacity: disabled ? 0.6 : 1, ...style,
      }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// VIGNETTE SESSION
// ─────────────────────────────────────────────
function Session({ cfg, onDone, onBack }) {
  const [vigs, setVigs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [idx, setIdx]         = useState(0);
  const [sel, setSel]         = useState(null);
  const [shown, setShown]     = useState(false);
  const [results, setResults] = useState([]);
  const [done, setDone]       = useState(false);
  const tc = cfg.termColor || "#ef4444";

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
          list = await genBlockVignettes(cfg.blockLectures, cfg.qCount, weak);
        } else {
          list = await genTopicVignettes(cfg.subject, cfg.subtopic, cfg.lecture.fullText, cfg.qCount, cfg.lecture.keyTerms);
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
    const nr = [...results, { ok, topic: vigs[idx].topic || cfg.subtopic || "Review" }];
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
    <div style={{ textAlign:"center", padding:60 }}>
      <p style={{ fontFamily:MONO, color:"#ef4444", fontSize:13, marginBottom:24 }}>⚠ {error}</p>
      <Btn onClick={onBack} color="#1a2a3a">← Back</Btn>
    </div>
  );

  if (done) {
    const score = pct(results.filter(r => r.ok).length, results.length);
    const m = mastery(score);
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:24, padding:"70px 40px" }}>
        <div style={{ fontFamily:SERIF, fontSize:22, color:"#6b7280" }}>Session Complete</div>
        <Ring score={score} size={130} tint={tc} />
        <p style={{ fontFamily:MONO, color:"#6b7280", fontSize:12 }}>{results.filter(r=>r.ok).length} / {results.length} correct</p>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap", justifyContent:"center", maxWidth:420 }}>
          {results.map((r, i) => (
            <div key={i} style={{ width:38, height:38, borderRadius:9, background:r.ok?"#021710":"#150404", border:"2px solid " + (r.ok?"#10b981":"#ef4444"), display:"flex", alignItems:"center", justifyContent:"center", color:r.ok?"#10b981":"#ef4444", fontSize:15 }}>
              {r.ok ? "✓" : "✗"}
            </div>
          ))}
        </div>
        <Btn onClick={onBack} color={tc} style={{ padding:"12px 32px", fontSize:14 }}>← Back to Block</Btn>
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
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontFamily:MONO, fontSize:11 }}>← Exit</button>
        <div style={{ flex:1, height:4, background:"#0f1e30", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:(idx/vigs.length*100)+"%", background:tc, borderRadius:2, transition:"width 0.4s" }} />
        </div>
        <span style={{ fontFamily:MONO, color:"#374151", fontSize:11 }}>{idx+1}/{vigs.length}</span>
      </div>

      {/* Difficulty + topic */}
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontFamily:MONO, background:dc+"18", color:dc, fontSize:9, padding:"3px 10px", borderRadius:20, letterSpacing:1.5, border:"1px solid " + dc+"30" }}>
          {(v.difficulty||"MEDIUM").toUpperCase()}
        </span>
        {v.topic && <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:11 }}>{v.topic}</span>}
      </div>

      {/* Stem */}
      <div style={{ background:"#080f1c", border:"1px solid #0f1e30", borderRadius:16, padding:28 }}>
        <p style={{ fontFamily:SERIF, color:"#e2e8f0", lineHeight:1.95, fontSize:15, margin:0 }}>{v.stem}</p>
      </div>

      {/* Choices */}
      <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
        {CHOICES.map(ch => {
          let bg="#080f1c", border="#0f1e30", color="#8a9bb0";
          if (shown) {
            if (ch === v.correct)        { bg="#021710"; border="#10b981"; color="#6ee7b7"; }
            else if (ch === sel)         { bg="#150404"; border="#ef4444"; color="#fca5a5"; }
          } else if (sel === ch) {
            bg="#091830"; border=tc; color="#93c5fd";
          }
          return (
            <div key={ch}
              onClick={() => !shown && setSel(ch)}
              style={{ background:bg, border:"1px solid "+border, borderRadius:11, padding:"14px 18px", cursor:shown?"default":"pointer", display:"flex", gap:13, color, fontFamily:MONO, fontSize:13, lineHeight:1.65, transition:"background 0.1s, border-color 0.1s" }}>
              <span style={{ fontWeight:700, minWidth:22 }}>{ch}.</span>
              <span style={{ flex:1 }}>{v.choices[ch]}</span>
              {shown && ch===v.correct && <span style={{ color:"#10b981" }}>✓</span>}
              {shown && ch===sel && ch!==v.correct && <span style={{ color:"#ef4444" }}>✗</span>}
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      {shown && (
        <div style={{ background:"#050c18", border:"1px solid #0f2040", borderRadius:14, padding:24 }}>
          <div style={{ fontFamily:MONO, color:"#3b82f6", fontSize:9, letterSpacing:3, marginBottom:12 }}>EXPLANATION</div>
          <p style={{ fontFamily:SERIF, color:"#cbd5e1", lineHeight:1.95, fontSize:14, margin:0 }}>{v.explanation}</p>
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
// LECTURE CARD
// ─────────────────────────────────────────────
function LecCard({ lec, sessions, accent, tint, onStudy, onDelete }) {
  const lecSess = sessions.filter(s => s.lectureId === lec.id);
  const overall = lecSess.length
    ? pct(lecSess.reduce((a,s)=>a+s.correct,0), lecSess.reduce((a,s)=>a+s.total,0))
    : null;

  return (
    <div style={{ background:"#09111e", border:"1px solid "+accent+"22", borderRadius:14, padding:18, display:"flex", flexDirection:"column", gap:12, position:"relative" }}>
      <button onClick={() => onDelete(lec.id)} style={{ position:"absolute", top:12, right:12, background:"none", border:"none", color:"#1f2937", cursor:"pointer", fontSize:12 }}>✕</button>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", paddingRight:20 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:SERIF, color:accent, fontWeight:700, fontSize:14, marginBottom:2 }}>{lec.subject}</div>
          <div style={{ fontFamily:MONO, color:"#c4cdd6", fontSize:12 }}>{lec.lectureTitle}</div>
          <div style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:10, marginTop:2 }}>{lec.filename}</div>
        </div>
        <Ring score={overall} size={52} tint={tint} />
      </div>

      {overall !== null && (
        <div style={{ height:3, background:"#1a2a3a", borderRadius:2 }}>
          <div style={{ width:overall+"%", height:"100%", background:accent, borderRadius:2, transition:"width 1s" }} />
        </div>
      )}

      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
        {(lec.keyTerms||[]).slice(0,5).map(t => (
          <span key={t} style={{ fontFamily:MONO, background:"#0d1829", color:"#374151", fontSize:9, padding:"2px 8px", borderRadius:20 }}>{t}</span>
        ))}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {(lec.subtopics||[]).map(sub => {
          const sp = getScore(sessions, s => s.lectureId===lec.id && s.subtopic===sub);
          const m = mastery(sp);
          return (
            <div key={sub}
              onClick={() => onStudy(lec, sub)}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:m.bg, border:"1px solid "+m.border, borderRadius:8, padding:"8px 12px", cursor:"pointer", transition:"padding-left 0.1s, border-color 0.1s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=m.fg; e.currentTarget.style.paddingLeft="16px"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=m.border; e.currentTarget.style.paddingLeft="12px"; }}>
              <span style={{ fontFamily:MONO, color:"#b0bec5", fontSize:12 }}>{sub}</span>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontFamily:MONO, color:m.fg, fontWeight:700, fontSize:12 }}>{sp!==null ? sp+"%" : "—"}</span>
                <span style={{ color:accent, fontSize:9 }}>▶</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HEATMAP
// ─────────────────────────────────────────────
function Heatmap({ lectures, sessions, onStudy }) {
  if (!lectures.length) return (
    <div style={{ background:"#09111e", border:"1px dashed #0f1e30", borderRadius:14, padding:50, textAlign:"center" }}>
      <p style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:12 }}>Upload lectures to see the heatmap.</p>
    </div>
  );
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {lectures.map((lec, li) => {
        const overall = getScore(sessions, s => s.lectureId===lec.id);
        const m = mastery(overall);
        const ac = PALETTE[li % PALETTE.length];
        return (
          <div key={lec.id} style={{ background:"#09111e", border:"1px solid "+ac+"18", borderRadius:12, padding:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div>
                <span style={{ fontFamily:MONO, color:ac, fontSize:12, fontWeight:600 }}>{lec.lectureTitle}</span>
                <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:10, marginLeft:8 }}>{lec.subject}</span>
              </div>
              <span style={{ fontFamily:MONO, color:m.fg, fontWeight:700, fontSize:14 }}>{overall!==null ? overall+"%" : "—"}</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px,1fr))", gap:6 }}>
              {(lec.subtopics||[]).map(sub => {
                const sp = getScore(sessions, s => s.lectureId===lec.id && s.subtopic===sub);
                const sm = mastery(sp);
                return (
                  <div key={sub}
                    onClick={() => onStudy(lec, sub)}
                    style={{ background:sm.bg, border:"1px solid "+sm.border, borderRadius:7, padding:"7px 11px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color 0.1s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=sm.fg; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=sm.border; }}>
                    <span style={{ fontFamily:MONO, color:"#94a3b8", fontSize:11 }}>{sub}</span>
                    <span style={{ fontFamily:MONO, color:sm.fg, fontWeight:700, fontSize:11, flexShrink:0, marginLeft:6 }}>{sp!==null ? sp+"%" : "—"}</span>
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
  const [qCount,  setQCount]  = useState(8);

  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg]         = useState("");
  const [aLoading, setALoading]   = useState(false);
  const [sidebar, setSidebar]     = useState(true);
  const [drag, setDrag]           = useState(false);

  const [newTermName,  setNewTermName]  = useState("");
  const [newBlockName, setNewBlockName] = useState("");
  const [showNewTerm,  setShowNewTerm]  = useState(false);
  const [showNewBlk,   setShowNewBlk]  = useState(null);

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
  const delLec = (id) => {
    sDel("rxt-lec-"+id);
    setLecs(p => p.filter(l => l.id !== id));
  };

  const t = THEMES[theme] || THEMES.dark;

  // ── Upload ─────────────────────────────────
  const handleFiles = async (files, bid, tid) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        setUpMsg("Reading " + file.name + "…");
        let text = (file.name.toLowerCase().endsWith(".pdf") || file.type==="application/pdf")
          ? await readPDF(file)
          : await file.text();
        if (!text.trim()) { setUpMsg("⚠ No text in " + file.name); continue; }
        setUpMsg("AI analyzing…");
        const meta = await detectMeta(text);
        const lec = { id:uid(), blockId:bid, termId:tid, filename:file.name, uploadedAt:new Date().toISOString(), fullText:text.slice(0,12000), ...meta };
        setLecs(p => [...p.filter(l => !(l.blockId===bid && l.filename===file.name)), lec]);
        setUpMsg("✓ Added: " + meta.lectureTitle);
      } catch (e) {
        setUpMsg("✗ " + file.name + ": " + e.message);
      }
    }
    setUploading(false);
    setTimeout(() => setUpMsg(""), 6000);
  };

  // ── Study ──────────────────────────────────
  const startTopic = (lec, sub) => {
    setStudyCfg({ mode:"lecture", lecture:lec, subject:lec.subject, subtopic:sub, qCount, blockId:lec.blockId, sessions, termColor:tc });
    setView("study");
  };
  const startBlock = () => {
    if (!blockLecs.length) return;
    setStudyCfg({ mode:"block", blockLectures:blockLecs, qCount, blockId, sessions, termColor:tc });
    setView("study");
  };
  const onSessionDone = ({ correct, total, date }) => {
    const base = { id:uid(), blockId, termId, correct, total, date };
    if (studyCfg.mode === "lecture") {
      setSessions(p => [...p, { ...base, lectureId:studyCfg.lecture.id, subject:studyCfg.subject, subtopic:studyCfg.subtopic }]);
    } else {
      setSessions(p => [...p, { ...base, lectureId:null, subject:"Block Exam", subtopic:"Comprehensive" }]);
    }
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
  if (!ready) return (
    <div style={{ minHeight:"100vh", background:t.pageBg, color:t.text, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Spinner msg="Loading RxTrack…" />
    </div>
  );

  const INPUT = { background:t.inputBg, border:"1px solid "+t.inputBorder, color:t.text, padding:"7px 12px", borderRadius:7, fontFamily:MONO, fontSize:12, outline:"none", width:"100%" };
  const CARD  = { background:t.cardBg, border:"1px solid "+t.cardBorder, borderRadius:14, padding:20 };

  return (
    <div style={{ minHeight:"100vh", background:t.pageBg, color:t.text, display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
        @keyframes rxt-spin { to { transform:rotate(360deg); } }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:${t.scrollbarTrack}; }
        ::-webkit-scrollbar-thumb { background:${t.scrollbarThumb}; border-radius:2px; }
        input[type=range] { -webkit-appearance:none; height:4px; background:${isDark ? "#1a2a3a" : "#e5e7eb"}; border-radius:2px; outline:none; cursor:pointer; width:100%; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:#ef4444; cursor:pointer; }
      `}</style>

      {/* NAV */}
      <nav style={{ height:52, borderBottom:"1px solid "+t.navBorder, display:"flex", alignItems:"center", padding:"0 20px", gap:12, position:"sticky", top:0, background:t.navBg, backdropFilter:"blur(14px)", zIndex:300, flexShrink:0 }}>
        <button onClick={() => setSidebar(p=>!p)} style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:18, padding:"0 4px" }}>☰</button>

        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="#ef4444" strokeWidth="1.5"/>
            <path d="M10 4v6.2l3.2 1.8" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontFamily:SERIF, fontWeight:900, fontSize:16 }}>Rx<span style={{ color:"#ef4444" }}>Track</span></span>
        </div>

        {(view==="block"||view==="study") && activeTerm && activeBlock && (
          <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:4 }}>
            <span style={{ color:"#1f2937" }}>›</span>
            <button onClick={() => setView("overview")} style={{ background:"none", border:"none", color:"#4b5563", cursor:"pointer", fontFamily:MONO, fontSize:11 }}>{activeTerm.name}</button>
            <span style={{ color:"#1f2937" }}>›</span>
            <span style={{ fontFamily:MONO, color:tc, fontSize:11, fontWeight:600 }}>{activeBlock.name}</span>
            {view==="study" && <><span style={{ color:"#1f2937" }}>›</span><span style={{ fontFamily:MONO, color:"#4b5563", fontSize:11 }}>Session</span></>}
          </div>
        )}

        {saveMsg && (
          <span style={{ fontFamily:MONO, fontSize:10, color:saveMsg==="saved"?"#10b981":"#f59e0b", marginLeft:8 }}>
            {saveMsg==="saving" ? "⟳ Saving…" : "✓ Saved"}
          </span>
        )}

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          {[["overview","Overview"],["analytics","Analytics"]].map(([v,l]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: view===v ? (isDark ? "#0d1829" : "#e5e7eb") : "none",
                border:"none",
                color: view===v ? t.text : t.mutedText,
                padding:"5px 14px",
                borderRadius:7,
                cursor:"pointer",
                fontFamily:MONO,
                fontSize:12,
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
              fontSize:10,
              color:t.mutedText,
            }}>
            {isDark ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>
      </nav>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* SIDEBAR */}
        {sidebar && (
          <aside style={{ width:228, borderRight:"1px solid "+t.sidebarBorder, background:t.sidebarBg, display:"flex", flexDirection:"column", position:"sticky", top:52, height:"calc(100vh - 52px)", overflowY:"auto", flexShrink:0 }}>
            <div style={{ padding:"13px 14px 9px", borderBottom:"1px solid #0d1829" }}>
              <div style={{ fontFamily:MONO, color:"#1f2937", fontSize:9, letterSpacing:2.5 }}>TERMS & BLOCKS</div>
            </div>

            {terms.map(term => (
              <div key={term.id}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px 5px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:term.color, flexShrink:0 }} />
                    <span style={{ fontFamily:MONO, color:isDark ? "#c4cdd6" : "#111827", fontSize:12, fontWeight:600 }}>{term.name}</span>
                  </div>
                  <div style={{ display:"flex", gap:3 }}>
                    <button onClick={() => setShowNewBlk(showNewBlk===term.id ? null : term.id)} style={{ background:"none", border:"none", color:"#2d3d4f", cursor:"pointer", fontSize:16, lineHeight:1, padding:2 }}>+</button>
                    <button onClick={() => delTerm(term.id)} style={{ background:"none", border:"none", color:"#1a2a3a", cursor:"pointer", fontSize:11, lineHeight:1, padding:2 }}>✕</button>
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
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background="#0d1829"; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background="transparent"; }}
                      style={{ padding:"7px 14px 7px 22px", cursor:"pointer", background:isActive?term.color+"18":"transparent", borderLeft:"2px solid "+(isActive?term.color:"transparent"), display:"flex", alignItems:"center", justifyContent:"space-between", transition:"background 0.1s", gap:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
                        <span style={{ color:st.color, fontSize:9, flexShrink:0 }}>{st.icon}</span>
                        <span style={{ fontFamily:MONO, color:isActive ? t.text : t.mutedText, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{block.name}</span>
                        {lc>0 && <span style={{ fontFamily:MONO, color:"#1f2937", fontSize:9, flexShrink:0 }}>{lc}</span>}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                        {sc!==null && <span style={{ fontFamily:MONO, color:mastery(sc).fg, fontSize:10, fontWeight:700 }}>{sc}%</span>}
                        <button onClick={e=>{ e.stopPropagation(); delBlock(term.id, block.id); }} style={{ background:"none", border:"none", color:"#0d1829", cursor:"pointer", fontSize:9, padding:1 }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{ padding:"12px 14px", borderTop:"1px solid #0d1829", marginTop:8 }}>
              {showNewTerm ? (
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  <input style={INPUT} placeholder="e.g. Term 2" value={newTermName} onChange={e=>setNewTermName(e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Enter") addTerm(); if(e.key==="Escape"){ setShowNewTerm(false); setNewTermName(""); } }} autoFocus />
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={addTerm} style={{ background:"#3b82f6", border:"none", color:"#fff", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600, flex:1 }}>Add</button>
                    <button onClick={() => { setShowNewTerm(false); setNewTermName(""); }} style={{ background:"#1a2a3a", border:"none", color:"#fff", padding:"6px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600 }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNewTerm(true)} style={{ background:"none", border:"1px dashed #1a2a3a", color:"#2d3d4f", padding:"7px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, width:"100%" }}>+ Add Term</button>
              )}
            </div>

            <div style={{ padding:"10px 14px 16px", marginTop:"auto", borderTop:"1px solid #0d1829" }}>
              {[["Questions answered",sessions.reduce((a,s)=>a+s.total,0)],["Sessions",sessions.length],["Lectures",lectures.length]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ fontFamily:MONO, color:"#1f2937", fontSize:9 }}>{l}</span>
                  <span style={{ fontFamily:MONO, color:"#374151", fontSize:10, fontWeight:600 }}>{v}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* MAIN */}
        <main style={{ flex:1, overflowY:"auto", maxHeight:"calc(100vh - 52px)" }}>

          {/* STUDY */}
          {view==="study" && studyCfg && (
            <div style={{ padding:"32px 36px" }}>
              <Session cfg={studyCfg} onDone={onSessionDone} onBack={() => { setView("block"); setStudyCfg(null); }} />
            </div>
          )}

          {/* OVERVIEW */}
          {view==="overview" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:26 }}>
              <div>
                <h1 style={{ fontFamily:SERIF, fontSize:30, fontWeight:900, letterSpacing:-1 }}>Study <span style={{ color:"#ef4444" }}>Overview</span></h1>
                <p style={{ fontFamily:MONO, color:"#1f2937", fontSize:9, marginTop:5, letterSpacing:2 }}>PRE-CLINICAL · M1/M2 · STEP 1</p>
              </div>
              {(() => {
                const tq=sessions.reduce((a,s)=>a+s.total,0);
                const tc2=sessions.reduce((a,s)=>a+s.correct,0);
                const ov=tq?pct(tc2,tq):null;
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                    {[
                      { l:"Overall Score", v:ov!==null?ov+"%":"—", c:mastery(ov).fg },
                      { l:"Blocks Active", v:terms.flatMap(t=>t.blocks).filter(b=>b.status!=="upcoming").length, c:"#f59e0b" },
                      { l:"Lectures", v:lectures.length, c:"#60a5fa" },
                      { l:"Questions Done", v:tq, c:"#a78bfa" },
                    ].map(({ l,v,c })=>(
                      <div key={l} style={CARD}>
                        <div style={{ fontFamily:MONO, color:"#1f2937", fontSize:9, letterSpacing:1.5, marginBottom:6 }}>{l.toUpperCase()}</div>
                        <div style={{ fontFamily:SERIF, color:c, fontSize:26, fontWeight:900 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {terms.length===0 ? (
                <div style={{ ...CARD, border:"1px dashed #0f1e30", padding:80, textAlign:"center" }}>
                  <div style={{ fontSize:48, marginBottom:14 }}>🏥</div>
                  <p style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:13 }}>Use the sidebar to add terms and blocks.</p>
                </div>
              ) : terms.map(term => (
                <div key={term.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:term.color }} />
                    <h2 style={{ fontFamily:SERIF, fontSize:18, fontWeight:700 }}>{term.name}</h2>
                    <div style={{ flex:1, height:1, background:"#0d1829" }} />
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
                          style={{ ...CARD, border:"1px solid "+(isCur?term.color+"40":term.color+"15"), cursor:"pointer", transition:"all 0.15s", position:"relative", boxShadow:isCur?"0 0 24px "+term.color+"14":"none" }}>
                          {isCur && <div style={{ position:"absolute", top:-1, right:10, background:term.color, color:"#fff", fontFamily:MONO, fontSize:8, padding:"2px 8px", borderRadius:"0 0 6px 6px", letterSpacing:1 }}>CURRENT</div>}
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                            <div>
                              <div style={{ fontFamily:MONO, color:isDark ? "#e2e8f0" : "#111827", fontSize:13, fontWeight:600 }}>{block.name}</div>
                              <div style={{ fontFamily:MONO, color:st.color, fontSize:9, marginTop:3 }}>{st.icon} {st.label.toUpperCase()}</div>
                            </div>
                            <Ring score={sc} size={46} tint={term.color} />
                          </div>
                          {sc!==null && <div style={{ height:2, background:"#1a2a3a", borderRadius:1, marginBottom:8 }}><div style={{ width:sc+"%", height:"100%", background:term.color, borderRadius:1 }} /></div>}
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:10 }}>{lc} lecture{lc!==1?"s":""}</span>
                            <div style={{ display:"flex", gap:3 }} onClick={e=>e.stopPropagation()}>
                              {Object.entries(BLOCK_STATUS).map(([s,cfg])=>(
                                <button key={s} onClick={()=>setStatus(term.id,block.id,s)} style={{ background:block.status===s?cfg.color+"20":"none", border:"1px solid "+(block.status===s?cfg.color:"#0d1829"), color:block.status===s?cfg.color:"#1f2937", padding:"2px 6px", borderRadius:4, cursor:"pointer", fontFamily:MONO, fontSize:8 }}>{cfg.icon}</button>
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
                    <span style={{ fontFamily:MONO, color:"#4b5563", fontSize:10 }}>{activeTerm.name}</span>
                    <span style={{ color:"#1f2937" }}>›</span>
                    <span style={{ fontFamily:MONO, color:(BLOCK_STATUS[activeBlock.status]||BLOCK_STATUS.upcoming).color, fontSize:9 }}>
                      {(BLOCK_STATUS[activeBlock.status]||BLOCK_STATUS.upcoming).icon} {(BLOCK_STATUS[activeBlock.status]||BLOCK_STATUS.upcoming).label.toUpperCase()}
                    </span>
                  </div>
                  <h1 style={{ fontFamily:SERIF, fontSize:28, fontWeight:900, letterSpacing:-0.5, color:t.text }}>{activeBlock.name}</h1>
                  <div style={{ display:"flex", gap:18, marginTop:6 }}>
                    {[["Lectures",blockLecs.length],["Sessions",sessions.filter(s=>s.blockId===blockId).length],["Questions",sessions.filter(s=>s.blockId===blockId).reduce((a,s)=>a+s.total,0)]].map(([l,v])=>(
                      <span key={l} style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:11 }}><span style={{ color:"#6b7280", fontWeight:600 }}>{v}</span> {l}</span>
                    ))}
                  </div>
                </div>
                <Ring score={bScore(blockId)} size={80} tint={tc} />
              </div>

              {/* Block Exam Prep */}
              <div style={{ background:"linear-gradient(135deg,"+tc+"12 0%,#09111e 55%)", border:"1px solid "+tc+"30", borderRadius:16, padding:"20px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:20, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontFamily:MONO, color:tc, fontSize:9, letterSpacing:2, marginBottom:6 }}>⚡ BLOCK EXAM PREP</div>
                  <div style={{ fontFamily:SERIF, color:isDark ? "#e2e8f0" : "#111827", fontSize:16, fontWeight:700, marginBottom:4 }}>Comprehensive {activeBlock.name} Review</div>
                  <p style={{ fontFamily:MONO, color:"#4b5563", fontSize:11, lineHeight:1.6 }}>
                    {blockLecs.length>0 ? "Mixed vignettes from all " + blockLecs.length + " lecture" + (blockLecs.length!==1?"s":"") + (sessions.filter(s=>s.blockId===blockId).length>0?" · weak topics weighted higher":"") : "Upload lectures first."}
                  </p>
                </div>
                <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontFamily:MONO, color:"#374151", fontSize:10 }}>Questions</span>
                      <span style={{ fontFamily:MONO, color:tc, fontSize:13, fontWeight:700 }}>{qCount}</span>
                    </div>
                    <input type="range" min={1} max={20} value={qCount} onChange={e=>setQCount(Number(e.target.value))} style={{ width:140 }} />
                    <div style={{ fontFamily:MONO, color:"#1f2937", fontSize:9, textAlign:"center" }}>
                      {qCount<=4?"Quick drill":qCount<=8?"Standard":qCount<=13?"Deep dive":"Full block"}
                    </div>
                  </div>
                  <Btn onClick={startBlock} color={tc} disabled={!blockLecs.length} style={{ padding:"12px 28px", fontSize:14, borderRadius:10 }}>Start Exam →</Btn>
                </div>
              </div>

              {/* Upload */}
              <div
                onDragOver={e=>{ e.preventDefault(); setDrag(true); }}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{ e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files,blockId,termId); }}
                style={{ background:drag?"#0d1a2a":"#09111e", border:"1px "+(drag?"solid "+tc:"dashed #1a2a3a"), borderRadius:12, padding:"16px 20px", transition:"all 0.2s", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div style={{ flex:1 }}>
                  <span style={{ fontFamily:MONO, color:"#8a9bb0", fontSize:12 }}>Upload to <span style={{ color:tc, fontWeight:600 }}>{activeBlock.name}</span></span>
                  <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:11, marginLeft:10 }}>PDF or .txt — drag & drop or click</span>
                </div>
                <label style={{ background:"#1a2a3a", border:"1px dashed #2d3d4f", color:"#fff", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600 }}>
                  {uploading ? "Analyzing…" : "+ Upload Files"}
                  <input type="file" accept=".pdf,.txt,.md" multiple onChange={e=>handleFiles(e.target.files,blockId,termId)} style={{ display:"none" }} />
                </label>
                {uploading && <div style={{ width:"100%", height:2, background:"#1a2a3a", borderRadius:1, overflow:"hidden" }}><div style={{ height:"100%", width:"65%", background:"linear-gradient(90deg,"+tc+",#8b5cf6)", borderRadius:1 }} /></div>}
                {upMsg && <div style={{ width:"100%", fontFamily:MONO, color:upMsg.startsWith("✓")?"#10b981":upMsg.startsWith("✗")||upMsg.startsWith("⚠")?"#ef4444":"#60a5fa", fontSize:11 }}>{upMsg}</div>}
              </div>

              {/* Topic Q count */}
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 16px", background:"#09111e", border:"1px solid #0d1829", borderRadius:10 }}>
                <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:11, whiteSpace:"nowrap" }}>Topic session size:</span>
                <input type="range" min={1} max={20} value={qCount} onChange={e=>setQCount(Number(e.target.value))} style={{ flex:1, maxWidth:180 }} />
                <span style={{ fontFamily:MONO, color:tc, fontWeight:700, fontSize:15, minWidth:28 }}>{qCount}</span>
              </div>

              {/* Tabs */}
              <div style={{ display:"flex", borderBottom:"1px solid #0d1829" }}>
                {[["lectures","Lectures ("+blockLecs.length+")"],["heatmap","Heatmap"],["analysis","AI Analysis"]].map(([tKey,label])=>(
                  <button
                    key={tKey}
                    onClick={()=>setTab(tKey)}
                    style={{
                      background:"none",
                      border:"none",
                      borderBottom:"2px solid "+(tab===tKey?tc:"transparent"),
                      color: tab===tKey ? t.text : t.mutedText,
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
                <div style={{ ...CARD, border:"1px dashed #0d1829", padding:70, textAlign:"center" }}>
                  <div style={{ fontSize:38, marginBottom:14 }}>📄</div>
                  <p style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:13 }}>Upload your first lecture for {activeBlock.name}.</p>
                  <p style={{ fontFamily:MONO, color:"#1a2a3a", fontSize:11, marginTop:8 }}>AI auto-detects subject, subtopics, and key terms.</p>
                </div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:14 }}>
                  {blockLecs.map((lec,li) => (
                    <LecCard key={lec.id} lec={lec} sessions={sessions} accent={PALETTE[li%PALETTE.length]} tint={tc} onStudy={startTopic} onDelete={delLec} />
                  ))}
                </div>
              ))}

              {/* Heatmap */}
              {tab==="heatmap" && <Heatmap lectures={blockLecs} sessions={sessions} onStudy={startTopic} />}

              {/* Analysis */}
              {tab==="analysis" && (
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <p style={{ fontFamily:MONO, color:t.mutedText, fontSize:12 }}>AI study plan based on your block performance.</p>
                    <Btn onClick={runAnalysis} color={tc} disabled={aLoading}>{aLoading?"Analyzing…":"↺ Run Analysis"}</Btn>
                  </div>
                    {analyses[blockId] ? (
                    <div style={{ background:isDark ? "#050c18" : "#f9fafb", border:"1px solid "+(isDark ? "#0f2040" : "#e5e7eb"), borderRadius:14, padding:28 }}>
                      <pre style={{ fontFamily:"Lora, Georgia, serif", color:isDark ? "#cbd5e1" : "#111827", lineHeight:1.95, fontSize:14, whiteSpace:"pre-wrap" }}>{analyses[blockId]}</pre>
                    </div>
                  ) : (
                    <div style={{ ...CARD, border:"1px dashed #0d1829", padding:50, textAlign:"center" }}>
                      <p style={{ fontFamily:MONO, color:"#1f2937", fontSize:12 }}>Complete sessions, then run analysis for a personalized study plan.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {view==="block" && !activeBlock && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}>
              <p style={{ fontFamily:MONO, color:"#1f2937", fontSize:13 }}>Select a block from the sidebar.</p>
            </div>
          )}

          {/* ANALYTICS */}
          {view==="analytics" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:24 }}>
              <h1 style={{ fontFamily:SERIF, fontSize:30, fontWeight:900, letterSpacing:-1, color:t.text }}>Global <span style={{ color:"#8b5cf6" }}>Analytics</span></h1>
              {sessions.length===0 ? (
                <div style={{ ...CARD, border:"1px dashed #0d1829", padding:60, textAlign:"center" }}>
                  <p style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:13 }}>Complete sessions to see analytics.</p>
                </div>
              ) : terms.map(term => (
                <div key={term.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ width:9, height:9, borderRadius:"50%", background:term.color }} />
                    <h2 style={{ fontFamily:SERIF, fontSize:18, fontWeight:700 }}>{term.name}</h2>
                    <div style={{ flex:1, height:1, background:"#0d1829" }} />
                  </div>
                  {term.blocks.filter(b=>sessions.some(s=>s.blockId===b.id)).map(block => {
                    const bs=sessions.filter(s=>s.blockId===block.id);
                    const sc=bScore(block.id);
                    const m=mastery(sc);
                    const sub={};
                    bs.forEach(s=>{ if(!sub[s.subtopic]) sub[s.subtopic]={c:0,t:0,subject:s.subject}; sub[s.subtopic].c+=s.correct; sub[s.subtopic].t+=s.total; });
                    return (
                      <div key={block.id} style={{ ...CARD, border:"1px solid "+term.color+"15", marginBottom:14 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
                          <span style={{ fontFamily:MONO, color:isDark ? "#e2e8f0" : "#111827", fontWeight:600, fontSize:14 }}>{block.name}</span>
                          <span style={{ fontFamily:MONO, color:m.fg, fontWeight:700, fontSize:16 }}>{sc!==null?sc+"%":"—"}</span>
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))", gap:8, marginBottom:14 }}>
                          {Object.entries(sub).sort((a,b)=>pct(a[1].c,a[1].t)-pct(b[1].c,b[1].t)).map(([s,v])=>{
                            const p=pct(v.c,v.t);
                            const sm=mastery(p);
                            return (
                              <div key={s} style={{ background:sm.bg, border:"1px solid "+sm.border, borderRadius:9, padding:"9px 13px" }}>
                                <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, marginBottom:3 }}>{v.subject}</div>
                                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                                  <span style={{ fontFamily:MONO, color:"#94a3b8", fontSize:11 }}>{s}</span>
                                  <span style={{ fontFamily:MONO, color:sm.fg, fontWeight:700, fontSize:12 }}>{p}%</span>
                                </div>
                                <div style={{ height:3, background:"#1a2a3a", borderRadius:2 }}><div style={{ width:p+"%", height:"100%", background:sm.fg, borderRadius:2 }} /></div>
                                <div style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:9, marginTop:4 }}>{v.c}/{v.t} correct</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ borderTop:"1px solid #0d1829", paddingTop:12 }}>
                          <div style={{ fontFamily:MONO, color:"#1f2937", fontSize:9, letterSpacing:2, marginBottom:8 }}>RECENT SESSIONS</div>
                          {[...bs].reverse().slice(0,5).map((s,i)=>{
                            const p=pct(s.correct,s.total);
                            const sm=mastery(p);
                            return (
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #0a1120" }}>
                                <span style={{ fontFamily:MONO, color:"#6b7280", fontSize:11 }}>{s.subtopic}</span>
                                <div style={{ display:"flex", gap:16 }}>
                                  <span style={{ fontFamily:MONO, color:"#1f2937", fontSize:10 }}>{new Date(s.date).toLocaleDateString()}</span>
                                  <span style={{ fontFamily:MONO, color:sm.fg, fontWeight:700, fontSize:11 }}>{s.correct}/{s.total} ({p}%)</span>
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
  );
}

