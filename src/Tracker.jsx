import { useState, useEffect, useRef } from "react";
import { useTheme } from "./theme";

// ── Storage ───────────────────────────────────────────────
function sGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function sSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Constants ─────────────────────────────────────────────
const MONO  = "'DM Mono','Courier New',monospace";
const SERIF = "'Playfair Display',Georgia,serif";

const BLOCKS = ["FTM 1","FTM 2","MSK","CPR 1","CPR 2"];
const BLOCK_COLORS = {
  "FTM 1":"#ef4444","FTM 2":"#f59e0b",
  "MSK":"#10b981","CPR 1":"#3b82f6","CPR 2":"#a78bfa"
};

// Confidence scale — drives how often a subject should be reviewed
const CONFIDENCE = [
  { value:1, label:"No Clue",    color:"#ef4444", bg:"#150404", border:"#450a0a", reviewDays:1  },
  { value:2, label:"Struggling", color:"#f97316", bg:"#160800", border:"#431407", reviewDays:2  },
  { value:3, label:"Shaky",      color:"#f59e0b", bg:"#160e00", border:"#451a03", reviewDays:3  },
  { value:4, label:"Getting It", color:"#84cc16", bg:"#0c1400", border:"#1a2e05", reviewDays:5  },
  { value:5, label:"Solid",      color:"#10b981", bg:"#021710", border:"#064e3b", reviewDays:7  },
  { value:6, label:"Mastered",   color:"#06b6d4", bg:"#021419", border:"#0e4f5e", reviewDays:14 },
];

const STEPS = [
  { key:"preRead",    label:"Pre-Read",     icon:"📖", color:"#60a5fa" },
  { key:"lecture",    label:"Lecture",      icon:"🎓", color:"#f59e0b" },
  { key:"postReview", label:"Post-Review",  icon:"📝", color:"#a78bfa" },
  { key:"anki",       label:"Anki Cards",   icon:"🃏", color:"#10b981" },
];

// ── Helpers ───────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function getConf(val) { return CONFIDENCE.find(c => c.value === val) || CONFIDENCE[0]; }

function getUrgency(confidence, lastStudied) {
  if (!confidence) return "none";
  const days = daysSince(lastStudied);
  const threshold = getConf(confidence).reviewDays;
  if (days === null) return confidence <= 2 ? "critical" : "none";
  const ratio = days / threshold;
  if (ratio >= 2)   return "critical";
  if (ratio >= 1.2) return "overdue";
  if (ratio >= 0.8) return "soon";
  return "ok";
}

const URG = {
  critical: { color:"#ef4444", bg:"#150404", border:"#450a0a", label:"REVIEW NOW",  glow:"0 0 14px #ef444430" },
  overdue:  { color:"#f97316", bg:"#130800", border:"#431407", label:"OVERDUE",      glow:"0 0 8px #f9731620"  },
  soon:     { color:"#f59e0b", bg:"#160e00", border:"#451a03", label:"SOON",         glow:"none"               },
  ok:       { color:"#10b981", bg:"transparent", border:"transparent", label:"OK",   glow:"none"               },
  none:     { color:"#374151", bg:"transparent", border:"transparent", label:"",     glow:"none"               },
};

function makeRow(o = {}) {
  return {
    block:"FTM 2", subject:"", topic:"",
    lectureDate:"", lastStudied:"", ankiDate:"",
    preRead:false, lecture:false, postReview:false, anki:false,
    confidence:null, scores:[], notes:"", ...o,
    id: o.id || uid(),
  };
}

const SAMPLE = [
  makeRow({ id:"s1", block:"FTM 2", subject:"Physiology",   topic:"Cardiac Cycle",          lectureDate:"2025-02-03", lastStudied:"2025-02-10", lecture:true, preRead:true,  confidence:3 }),
  makeRow({ id:"s2", block:"FTM 2", subject:"Physiology",   topic:"Renal Filtration",        lectureDate:"2025-02-05", lastStudied:"2025-02-08", lecture:true,               confidence:2 }),
  makeRow({ id:"s3", block:"FTM 2", subject:"Pharmacology", topic:"Autonomic Pharmacology",  lectureDate:"2025-02-07", lastStudied:"2025-02-12", lecture:true, postReview:true, confidence:4 }),
  makeRow({ id:"s4", block:"MSK",   subject:"Anatomy",      topic:"Upper Limb",              lectureDate:"2025-02-10", lastStudied:"2025-02-20", lecture:true, preRead:true, postReview:true, confidence:5 }),
];

// ─────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────

function Check({ checked, onClick, color }) {
  return (
    <div onClick={onClick} style={{
      width:24, height:24, borderRadius:6,
      border:"1.5px solid "+(checked ? color : "#1a2a3a"),
      background: checked ? color+"28" : "transparent",
      display:"flex", alignItems:"center", justifyContent:"center",
      cursor:"pointer", transition:"all 0.15s", margin:"0 auto", flexShrink:0,
    }}>
      {checked && <span style={{ color, fontSize:12, fontWeight:700, lineHeight:1 }}>✓</span>}
    </div>
  );
}

function DaysBadge({ lastStudied, confidence }) {
  const { theme } = useTheme();
  const days = daysSince(lastStudied);
  const urg  = getUrgency(confidence, lastStudied);
  const u    = URG[urg];
  if (days === null) return <span style={{ fontFamily:MONO, color:theme.textGhost, fontSize:10 }}>—</span>;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
      <span style={{ fontFamily:MONO, color:u.color, fontSize:13, fontWeight:700, lineHeight:1, textShadow:u.glow }}>{days}d</span>
      {u.label && <span style={{ fontFamily:MONO, color:u.color, fontSize:8, letterSpacing:1, background:u.color+"18", padding:"1px 5px", borderRadius:3 }}>{u.label}</span>}
    </div>
  );
}

function ScoreCell({ scores, onAdd, onClear }) {
  const [val, setVal] = useState("");
  const { theme } = useTheme();
  const submit = () => {
    const n = Number(val);
    if (!val || isNaN(n) || n < 0 || n > 100) return;
    onAdd(n); setVal("");
  };
  const a = avg(scores);
  const col = a===null?theme.textFaint:a>=80?"#10b981":a>=70?"#f59e0b":a>=60?"#fb923c":"#ef4444";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      {a !== null && (
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontFamily:MONO, color:col, fontSize:12, fontWeight:700 }}>{a}%</span>
          <span style={{ fontFamily:MONO, color:col, background:col+"18", fontSize:8, padding:"1px 5px", borderRadius:3 }}>×{scores.length}</span>
          <button onClick={onClear} style={{ background:"none", border:"none", color:"#1f2937", cursor:"pointer", fontSize:9 }} title="Clear">✕</button>
        </div>
      )}
      <div style={{ display:"flex", gap:3 }}>
        <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="%" type="number" min={0} max={100}
          style={{ width:44, background:theme.inputBg, border:"1px solid "+theme.borderSubtle, color:theme.textPrimary, padding:"3px 5px", borderRadius:4, fontFamily:MONO, fontSize:10, outline:"none" }} />
        <button onClick={submit} style={{ background:theme.borderSubtle, border:"none", color:"#60a5fa", padding:"3px 7px", borderRadius:4, cursor:"pointer", fontFamily:MONO, fontSize:10 }}>+</button>
      </div>
    </div>
  );
}

// Inline-editable text cell
function EditCell({ value, onChange, placeholder, type }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value || "");
  const ref = useRef();
  const { theme } = useTheme();
  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const commit = () => { setEditing(false); if (draft !== (value||"")) onChange(draft); };

  if (type === "date") {
    return (
      <input type="date" value={value || ""} onChange={e=>onChange(e.target.value)}
        style={{ background:"transparent", border:"none", color:value?theme.textSecondary:theme.textGhost, fontFamily:MONO, fontSize:10, outline:"none", cursor:"pointer", width:"100%" }} />
    );
  }
  return editing ? (
    <input ref={ref} value={draft} onChange={e=>setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(); if(e.key==="Escape"){ setDraft(value||""); setEditing(false); } }}
      style={{ background:theme.inputBg, border:"1px solid #3b82f6", color:theme.textPrimary, fontFamily:MONO, fontSize:11, padding:"2px 6px", borderRadius:4, outline:"none", width:"100%" }} />
  ) : (
    <div onClick={() => setEditing(true)}
      title="Click to edit"
      style={{ color:value?theme.textSecondary:theme.textGhost, fontFamily:MONO, fontSize:11, cursor:"text", padding:"2px 4px", borderRadius:4,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", transition:"background 0.1s" }}
      onMouseEnter={e=>e.currentTarget.style.background=theme.rowHover}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      {value || placeholder || "—"}
    </div>
  );
}

// Confidence dropdown picker
function ConfPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { theme } = useTheme();
  const conf = value ? getConf(value) : null;
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div onClick={() => setOpen(p=>!p)} style={{
        display:"flex", alignItems:"center", gap:5, cursor:"pointer", padding:"3px 8px",
        borderRadius:6, border:"1px solid "+(conf?conf.color+"40":theme.borderSubtle),
        background:conf?conf.bg:"transparent", transition:"all 0.15s", whiteSpace:"nowrap", userSelect:"none",
      }}>
        {conf
          ? <><div style={{ width:7, height:7, borderRadius:"50%", background:conf.color, flexShrink:0 }}/><span style={{ fontFamily:MONO, color:conf.color, fontSize:10, fontWeight:600 }}>{conf.label}</span></>
          : <span style={{ fontFamily:MONO, color:theme.textGhost, fontSize:10 }}>Rate confidence</span>}
        <span style={{ color:theme.textFaint, fontSize:9, marginLeft:2 }}>▾</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:600, background:theme.cardBg,
          border:"1px solid "+theme.borderSubtle, borderRadius:10, padding:6, minWidth:185, boxShadow:"0 12px 40px #000c" }}>
          {CONFIDENCE.map(c => (
            <div key={c.value} onClick={()=>{ onChange(c.value); setOpen(false); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:7, cursor:"pointer",
                background:value===c.value?c.bg:"transparent", border:"1px solid "+(value===c.value?c.color+"40":"transparent"), marginBottom:2, transition:"all 0.1s" }}
              onMouseEnter={e=>{ if(value!==c.value) e.currentTarget.style.background=theme.rowHover; }}
              onMouseLeave={e=>{ if(value!==c.value) e.currentTarget.style.background="transparent"; }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:c.color, flexShrink:0 }}/>
              <span style={{ fontFamily:MONO, color:c.color, fontSize:11, fontWeight:600, flex:1 }}>{c.label}</span>
              <span style={{ fontFamily:MONO, color:theme.textFaint, fontSize:9 }}>/{c.reviewDays}d</span>
            </div>
          ))}
          {value && <div onClick={()=>{ onChange(null); setOpen(false); }}
            style={{ padding:"5px 10px", cursor:"pointer", fontFamily:MONO, color:theme.textFaint, fontSize:10, textAlign:"center", marginTop:2 }}>clear</div>}
        </div>
      )}
    </div>
  );
}

// Add Row Modal
function AddModal({ onAdd, onClose }) {
  const [row, setRow] = useState({ block:"FTM 2", subject:"", topic:"", lectureDate:"", lastStudied:"", ankiDate:"", confidence:null });
  const set = (k,v) => setRow(p=>({...p,[k]:v}));
  const INP = { background:"#080f1c", border:"1px solid #1a2a3a", color:"#f1f5f9", padding:"8px 11px", borderRadius:7, fontFamily:MONO, fontSize:12, outline:"none", width:"100%" };
  const submit = () => {
    if (!row.subject.trim() || !row.topic.trim()) return;
    onAdd(makeRow({ ...row, subject:row.subject.trim(), topic:row.topic.trim() }));
    onClose();
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"#000000c0", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{ background:"#09111e", border:"1px solid #1a2a3a", borderRadius:18, padding:30, width:500, display:"flex", flexDirection:"column", gap:18 }}>
        <div style={{ fontFamily:SERIF, fontSize:20, fontWeight:700 }}>Add Lecture / Topic</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div style={{ gridColumn:"1/-1" }}>
            <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:1.5, marginBottom:5 }}>BLOCK</div>
            <select value={row.block} onChange={e=>set("block",e.target.value)} style={{...INP,cursor:"pointer"}}>
              {BLOCKS.map(b=><option key={b}>{b}</option>)}
            </select>
          </div>
          {[["subject","SUBJECT / COURSE","e.g. Physiology"],["topic","LECTURE / TOPIC","e.g. Cardiac Cycle"]].map(([k,l,ph])=>(
            <div key={k}>
              <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:1.5, marginBottom:5 }}>{l}</div>
              <input style={INP} placeholder={ph} value={row[k]} onChange={e=>set(k,e.target.value)} autoFocus={k==="subject"} onKeyDown={e=>k==="topic"&&e.key==="Enter"&&submit()} />
            </div>
          ))}
          {[["lectureDate","LECTURE DATE"],["lastStudied","LAST STUDIED"],["ankiDate","ANKI CARD RELEASE"]].map(([k,l])=>(
            <div key={k}>
              <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:1.5, marginBottom:5 }}>{l}</div>
              <input type="date" value={row[k]} onChange={e=>set(k,e.target.value)} style={INP} />
            </div>
          ))}
          <div>
            <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:1.5, marginBottom:5 }}>CONFIDENCE LEVEL</div>
            <ConfPicker value={row.confidence} onChange={v=>set("confidence",v)} />
          </div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ background:"#1a2a3a", border:"none", color:"#9ca3af", padding:"9px 20px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:12 }}>Cancel</button>
          <button onClick={submit} style={{ background:"#ef4444", border:"none", color:"#fff", padding:"9px 24px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:13, fontWeight:700 }}>Add Row</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ANALYTICS PANEL
// ─────────────────────────────────────────────────────────
function Analytics({ rows }) {
  const allScores = rows.flatMap(r=>r.scores);
  const overall   = avg(allScores);
  const acol      = p => p===null?"#374151":p>=80?"#10b981":p>=70?"#f59e0b":p>=60?"#fb923c":"#ef4444";

  const needsReview = rows
    .filter(r => ["critical","overdue"].includes(getUrgency(r.confidence,r.lastStudied)))
    .sort((a,b)=>{ const o={critical:0,overdue:1}; return o[getUrgency(a.confidence,a.lastStudied)]-o[getUrgency(b.confidence,b.lastStudied)]; });

  const byConf = {};
  CONFIDENCE.forEach(c=>{ byConf[c.value]={count:0,scores:[]}; });
  rows.forEach(r=>{ if(r.confidence&&byConf[r.confidence]){ byConf[r.confidence].count++; byConf[r.confidence].scores.push(...r.scores); } });

  const bySubject = {};
  rows.forEach(r=>{
    if(!bySubject[r.subject]) bySubject[r.subject]={scores:[],count:0,conf:[]};
    bySubject[r.subject].scores.push(...r.scores);
    bySubject[r.subject].count++;
    if(r.confidence) bySubject[r.subject].conf.push(r.confidence);
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:28 }}>
      {/* Summary cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[
          { l:"Overall Score",   v:overall!==null?overall+"%":"—",       c:acol(overall) },
          { l:"Topics Tracked",  v:rows.length,                           c:"#60a5fa"     },
          { l:"Need Review Now", v:needsReview.length,                    c:needsReview.length>0?"#ef4444":"#10b981" },
          { l:"Fully Complete",  v:rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length, c:"#10b981" },
        ].map(({l,v,c})=>(
          <div key={l} style={{ background:"#09111e", border:"1px solid #0f1e30", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:1.5, marginBottom:6 }}>{l.toUpperCase()}</div>
            <div style={{ fontFamily:SERIF, color:c, fontSize:30, fontWeight:900, lineHeight:1 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Review queue */}
      {needsReview.length > 0 && (
        <div>
          <div style={{ fontFamily:MONO, color:"#ef4444", fontSize:9, letterSpacing:2, marginBottom:12 }}>🔴 REVIEW QUEUE — NEEDS ATTENTION NOW</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {needsReview.map(r=>{
              const urg=getUrgency(r.confidence,r.lastStudied), u=URG[urg], conf=r.confidence?getConf(r.confidence):null, days=daysSince(r.lastStudied);
              return (
                <div key={r.id} style={{ background:u.bg, border:"1px solid "+u.border, borderRadius:10, padding:"12px 18px",
                  display:"flex", alignItems:"center", gap:16, boxShadow:urg==="critical"?u.glow:"none" }}>
                  <div style={{ width:3, height:36, background:u.color, borderRadius:2, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:MONO, color:"#e2e8f0", fontSize:12, fontWeight:600 }}>{r.topic}</div>
                    <div style={{ fontFamily:MONO, color:"#4b5563", fontSize:10 }}>{r.block} · {r.subject}</div>
                  </div>
                  {conf && <div style={{ display:"flex", alignItems:"center", gap:5, background:conf.bg, border:"1px solid "+conf.border, borderRadius:6, padding:"4px 10px", flexShrink:0 }}>
                    <div style={{ width:6,height:6,borderRadius:"50%",background:conf.color }}/><span style={{ fontFamily:MONO,color:conf.color,fontSize:10 }}>{conf.label}</span>
                  </div>}
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontFamily:MONO, color:u.color, fontSize:16, fontWeight:700 }}>{days!==null?days+"d ago":"Never studied"}</div>
                    <div style={{ fontFamily:MONO, color:u.color, background:u.color+"18", fontSize:8, padding:"2px 7px", borderRadius:3, letterSpacing:1, marginTop:2 }}>{u.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confidence breakdown */}
      <div>
        <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:2, marginBottom:12 }}>CONFIDENCE BREAKDOWN</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {CONFIDENCE.map(c=>{
            const d=byConf[c.value]; if(!d||d.count===0) return null;
            const a=avg(d.scores);
            return (
              <div key={c.value} style={{ background:c.bg, border:"1px solid "+c.border, borderRadius:10, padding:"13px 16px", minWidth:140 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{ width:8,height:8,borderRadius:"50%",background:c.color }}/><span style={{ fontFamily:MONO,color:c.color,fontSize:11,fontWeight:600 }}>{c.label}</span>
                </div>
                <div style={{ fontFamily:SERIF, color:c.color, fontSize:26, fontWeight:900 }}>{d.count}</div>
                <div style={{ fontFamily:MONO, color:"#374151", fontSize:9 }}>topic{d.count!==1?"s":""}{a!==null?" · "+a+"%":""}</div>
                <div style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:9, marginTop:3 }}>review every {c.reviewDays}d</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By subject */}
      <div>
        <div style={{ fontFamily:MONO, color:"#374151", fontSize:9, letterSpacing:2, marginBottom:12 }}>BY SUBJECT — WEAKEST FIRST</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:10 }}>
          {Object.entries(bySubject).sort((a,b)=>(avg(a[1].scores)??101)-(avg(b[1].scores)??101)).map(([subj,d])=>{
            const a=avg(d.scores), col=acol(a);
            const avgConf=d.conf.length?Math.round(d.conf.reduce((s,v)=>s+v,0)/d.conf.length):null;
            const confData=avgConf?getConf(Math.round(avgConf)):null;
            return (
              <div key={subj} style={{ background:"#09111e", border:"1px solid "+(confData?confData.color+"25":"#0f1e30"), borderRadius:10, padding:"13px 16px" }}>
                <div style={{ fontFamily:MONO, color:"#c4cdd6", fontSize:12, fontWeight:600, marginBottom:8 }}>{subj}</div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontFamily:SERIF, color:col, fontSize:24, fontWeight:900 }}>{a!==null?a+"%":"—"}</span>
                  {confData && <div style={{ display:"flex", alignItems:"center", gap:4, background:confData.bg, border:"1px solid "+confData.border, borderRadius:5, padding:"3px 8px" }}>
                    <div style={{ width:6,height:6,borderRadius:"50%",background:confData.color }}/><span style={{ fontFamily:MONO,color:confData.color,fontSize:9 }}>{confData.label}</span>
                  </div>}
                </div>
                {a!==null && <div style={{ height:3,background:"#1a2a3a",borderRadius:2,marginBottom:8 }}><div style={{ width:a+"%",height:"100%",background:col,borderRadius:2 }}/></div>}
                <div style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:9 }}>{d.count} lecture{d.count!==1?"s":""} · {d.scores.length} scores</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SINGLE TABLE ROW
// ─────────────────────────────────────────────────────────
const GRID = "20px 58px 110px 1fr 92px 92px 58px 26px 26px 26px 26px 92px 160px 112px 20px";

function TrackerRow({ row, upd, delRow, addScore, clrScore, expanded, setExpanded }) {
  const bc      = BLOCK_COLORS[row.block] || "#374151";
  const allDone = row.preRead && row.lecture && row.postReview && row.anki;
  const urg     = getUrgency(row.confidence, row.lastStudied);
  const u       = URG[urg];
  const isOpen  = expanded[row.id];
  const conf    = row.confidence ? getConf(row.confidence) : null;

  const rowBg     = urg==="critical" ? u.bg : urg==="overdue" ? u.bg : allDone ? "#021710" : "transparent";
  const leftBorder= urg==="critical" ? "#ef4444" : urg==="overdue" ? "#f97316" : "transparent";

  return (
    <div style={{ borderBottom:"1px solid #08111e" }}>
      <div
        style={{ display:"grid", gridTemplateColumns:GRID, gap:6, padding:"9px 16px", alignItems:"center",
          background:rowBg, borderLeft:"3px solid "+leftBorder, transition:"background 0.2s",
          boxShadow:urg==="critical"?u.glow:urg==="overdue"?u.glow:"none" }}
        onMouseEnter={e=>{ if(urg==="none"&&!allDone) e.currentTarget.style.background="#09111e"; }}
        onMouseLeave={e=>{ e.currentTarget.style.background=rowBg; }}>

        {/* Expand toggle */}
        <button onClick={()=>setExpanded(p=>({...p,[row.id]:!p[row.id]}))}
          style={{ background:"none", border:"none", color:"#2d3d4f", cursor:"pointer", fontSize:10, padding:0, lineHeight:1, textAlign:"center" }}>
          {isOpen?"▾":"▸"}
        </button>

        {/* Block selector */}
        <select value={row.block} onChange={e=>upd(row.id,{block:e.target.value})}
          style={{ background:"transparent", border:"none", color:bc, fontFamily:MONO, fontSize:10, cursor:"pointer", outline:"none", width:"100%" }}>
          {BLOCKS.map(b=><option key={b} style={{ background:"#09111e", color:BLOCK_COLORS[b]||"#f1f5f9" }}>{b}</option>)}
        </select>

        {/* Subject — inline edit */}
        <EditCell value={row.subject} onChange={v=>upd(row.id,{subject:v})} placeholder="Subject…" />

        {/* Topic — inline edit */}
        <EditCell value={row.topic} onChange={v=>upd(row.id,{topic:v})} placeholder="Lecture / topic…" />

        {/* Lecture date */}
        <EditCell value={row.lectureDate} onChange={v=>upd(row.id,{lectureDate:v})} type="date" />

        {/* Last studied */}
        <EditCell value={row.lastStudied} onChange={v=>upd(row.id,{lastStudied:v})} type="date" />

        {/* Days since */}
        <DaysBadge lastStudied={row.lastStudied} confidence={row.confidence} />

        {/* Step checkboxes */}
        {STEPS.map(s=>(
          <Check key={s.key} checked={row[s.key]} onClick={()=>upd(row.id,{[s.key]:!row[s.key]})} color={s.color} />
        ))}

        {/* Anki date */}
        <EditCell value={row.ankiDate} onChange={v=>upd(row.id,{ankiDate:v})} type="date" />

        {/* Confidence picker */}
        <ConfPicker value={row.confidence} onChange={v=>upd(row.id,{confidence:v})} />

        {/* Score input */}
        <ScoreCell scores={row.scores} onAdd={sc=>addScore(row.id,sc)} onClear={()=>clrScore(row.id)} />

        {/* Delete */}
        <button onClick={()=>delRow(row.id)}
          style={{ background:"none", border:"none", color:"#1a2a3a", cursor:"pointer", fontSize:11, padding:2 }}
          onMouseEnter={e=>e.currentTarget.style.color="#ef4444"}
          onMouseLeave={e=>e.currentTarget.style.color="#1a2a3a"}>✕</button>
      </div>

      {/* Expanded section */}
      {isOpen && (
        <div style={{ padding:"10px 16px 14px 46px", background:"#060c17", borderTop:"1px solid #0a1422" }}>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:10, alignItems:"center" }}>
            {conf && (
              <div style={{ display:"flex", alignItems:"center", gap:8, background:conf.bg, border:"1px solid "+conf.border, borderRadius:8, padding:"6px 14px" }}>
                <div style={{ width:8,height:8,borderRadius:"50%",background:conf.color }}/>
                <span style={{ fontFamily:MONO, color:conf.color, fontSize:11, fontWeight:600 }}>{conf.label}</span>
                <span style={{ fontFamily:MONO, color:"#374151", fontSize:10 }}>· review every {conf.reviewDays} days</span>
              </div>
            )}
            {row.scores.length > 0 && (
              <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:9 }}>Score log:</span>
                {row.scores.map((sc,i)=>{ const c=sc>=80?"#10b981":sc>=70?"#f59e0b":sc>=60?"#fb923c":"#ef4444"; return <span key={i} style={{ fontFamily:MONO,color:c,background:c+"18",fontSize:10,padding:"1px 7px",borderRadius:4 }}>{sc}%</span>; })}
              </div>
            )}
          </div>
          <div style={{ fontFamily:MONO, color:"#2d3d4f", fontSize:9, letterSpacing:1.5, marginBottom:5 }}>NOTES / HIGH-YIELD POINTS</div>
          <textarea value={row.notes} onChange={e=>upd(row.id,{notes:e.target.value})}
            placeholder="Mnemonics, First Aid pages, weak areas, connections to revisit…" rows={2}
            style={{ width:"100%", maxWidth:740, background:"#080f1c", border:"1px solid #1a2a3a", color:"#c4cdd6",
              padding:"8px 12px", borderRadius:8, fontFamily:MONO, fontSize:11, outline:"none", lineHeight:1.6, resize:"vertical" }} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────
export default function Tracker() {
  const [rows,      setRows]      = useState([]);
  const [ready,     setReady]     = useState(false);
  const [tab,       setTab]       = useState("tracker");
  const [filter,    setFilter]    = useState("All");
  const [urgFilter, setUrgFilter] = useState("All");
  const [search,    setSearch]    = useState("");
  const [sortBy,    setSortBy]    = useState("block");
  const [showAdd,   setShowAdd]   = useState(false);
  const [saveMsg,   setSaveMsg]   = useState("");
  const [expanded,  setExpanded]  = useState({});
  const timerRef = useRef(null);
  const { theme: t } = useTheme();

  // Load
  useEffect(() => {
    const saved = sGet("rxt-tracker-v2");
    setRows(saved || SAMPLE);
    setReady(true);
  }, []);

  // Save (debounced)
  const persist = (nr) => {
    setSaveMsg("saving");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { sSet("rxt-tracker-v2",nr); setSaveMsg("saved"); setTimeout(()=>setSaveMsg(""),2000); }, 500);
  };

  const upd      = (id,patch) => setRows(p=>{ const n=p.map(r=>r.id===id?{...r,...patch}:r); persist(n); return n; });
  const addRow   = row        => setRows(p=>{ const n=[...p,row]; persist(n); return n; });
  const delRow   = id         => setRows(p=>{ const n=p.filter(r=>r.id!==id); persist(n); return n; });
  const addScore = (id,sc)    => setRows(p=>{ const n=p.map(r=>r.id===id?{...r,scores:[...r.scores,sc]}:r); persist(n); return n; });
  const clrScore = id         => setRows(p=>{ const n=p.map(r=>r.id===id?{...r,scores:[]}:r); persist(n); return n; });

  // Filter
  let visible = rows.filter(r => {
    if (filter!=="All" && r.block!==filter) return false;
    if (urgFilter!=="All" && getUrgency(r.confidence,r.lastStudied)!==urgFilter) return false;
    if (search) { const q=search.toLowerCase(); if(!r.subject.toLowerCase().includes(q)&&!r.topic.toLowerCase().includes(q)) return false; }
    return true;
  });

  // Sort
  const ORD = { critical:0, overdue:1, soon:2, ok:3, none:4 };
  if (sortBy==="urgency")    visible=[...visible].sort((a,b)=>ORD[getUrgency(a.confidence,a.lastStudied)]-ORD[getUrgency(b.confidence,b.lastStudied)]);
  if (sortBy==="confidence") visible=[...visible].sort((a,b)=>(a.confidence||99)-(b.confidence||99));
  if (sortBy==="score")      visible=[...visible].sort((a,b)=>(avg(a.scores)??101)-(avg(b.scores)??101));

  // Group for block view
  const grouped = {};
  if (sortBy==="block") {
    visible.forEach(r=>{
      if(!grouped[r.block]) grouped[r.block]={};
      if(!grouped[r.block][r.subject]) grouped[r.block][r.subject]=[];
      grouped[r.block][r.subject].push(r);
    });
  }

  const critCount = rows.filter(r=>getUrgency(r.confidence,r.lastStudied)==="critical").length;
  const ovdCount  = rows.filter(r=>getUrgency(r.confidence,r.lastStudied)==="overdue").length;

  const COL_HEADS = ["","Block","Subject","Lecture / Topic","Lecture Date","Last Studied","Days Ago","📖","🎓","📝","🃏","Anki Date","Confidence","Score",""];
  const COL_TIPS  = ["","","","","Lecture date","Last date studied","Days since last study","Pre-Read","Attended Lecture","Post-Lecture Review","Anki Cards Released","Anki card release date","Confidence level (drives review frequency)","Practice question score",""];

  if (!ready) return (
    <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:60 }}>
      <div style={{ width:36,height:36,border:"3px solid "+t.borderSubtle,borderTopColor:"#ef4444",borderRadius:"50%",animation:"rxt-spin 0.85s linear infinite" }}/>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, fontFamily:MONO, background:t.appBg, color:t.textPrimary }}>

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div style={{ padding:"10px 18px", borderBottom:"1px solid "+t.borderFaint, background:t.subnavBg,
        display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", flexShrink:0 }}>

        {/* Tab toggles */}
        <div style={{ display:"flex", gap:2 }}>
          {[["tracker","📋 Tracker"],["analytics","📊 Analytics"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{ background:tab===v?t.rowHover:"none",border:"none",
              color:tab===v?t.textPrimary:t.textMuted,padding:"5px 13px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:11 }}>{l}</button>
          ))}
        </div>

        {tab==="tracker" && <>
          {/* Block filters */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {["All",...BLOCKS].map(b=>(
              <button key={b} onClick={()=>setFilter(b)} style={{
                background:filter===b?(BLOCK_COLORS[b]||t.textFaint)+"22":"none",
                border:"1px solid "+(filter===b?(BLOCK_COLORS[b]||t.textFaint):t.borderSubtle),
                color:filter===b?(BLOCK_COLORS[b]||t.textPrimary):t.textMuted,
                padding:"3px 10px",borderRadius:20,cursor:"pointer",fontFamily:MONO,fontSize:10 }}>{b}</button>
            ))}
          </div>

          {/* Urgency filter */}
          <div style={{ display:"flex", gap:3 }}>
            {[["All","All",t.textFaint],["critical","🔴 Critical","#ef4444"],["overdue","🟠 Overdue","#f97316"],["soon","🟡 Soon","#f59e0b"],["ok","✅ OK","#10b981"]].map(([v,l,c])=>(
              <button key={v} onClick={()=>setUrgFilter(v)} style={{
                background:urgFilter===v?c+"22":"none",border:"1px solid "+(urgFilter===v?c:t.borderSubtle),
                color:urgFilter===v?c:t.textMuted,padding:"3px 9px",borderRadius:6,cursor:"pointer",fontFamily:MONO,fontSize:10 }}>{l}</button>
            ))}
          </div>

          {/* Sort */}
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ background:t.cardBg,border:"1px solid "+t.borderSubtle,color:t.textGhost,padding:"4px 10px",borderRadius:7,fontFamily:MONO,fontSize:10,outline:"none",cursor:"pointer" }}>
            {[["block","Sort: Block"],["urgency","Sort: Urgency ↑"],["confidence","Sort: Confidence ↑"],["score","Sort: Score ↑"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>

          {/* Search */}
          <div style={{ display:"flex",alignItems:"center",gap:5,background:t.cardBg,border:"1px solid "+t.borderSubtle,borderRadius:7,padding:"4px 9px" }}>
            <span style={{ color:t.textFaint,fontSize:11 }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
              style={{ background:"none",border:"none",color:t.textPrimary,fontFamily:MONO,fontSize:11,outline:"none",width:120 }} />
            {search&&<button onClick={()=>setSearch("")} style={{ background:"none",border:"none",color:t.textFaint,cursor:"pointer",fontSize:10 }}>✕</button>}
          </div>
        </>}

        {/* Right side */}
        <div style={{ marginLeft:"auto", display:"flex", gap:7, alignItems:"center" }}>
          {critCount>0 && <div style={{ background:"#150404",border:"1px solid #450a0a",borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:10 }}>🔴</span><span style={{ fontFamily:MONO,color:"#ef4444",fontSize:10,fontWeight:700 }}>{critCount} critical</span></div>}
          {ovdCount>0  && <div style={{ background:"#130800",border:"1px solid #431407",borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:10 }}>🟠</span><span style={{ fontFamily:MONO,color:"#f97316",fontSize:10,fontWeight:700 }}>{ovdCount} overdue</span></div>}
          {[["Rows",rows.length],["Done",rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length]].map(([l,v])=>(
            <div key={l} style={{ background:t.cardBg,borderRadius:6,padding:"3px 10px",display:"flex",gap:5,alignItems:"center", border:"1px solid "+t.borderSubtle }}>
              <span style={{ color:t.textFaint,fontSize:9 }}>{l}</span>
              <span style={{ color:t.textPrimary,fontSize:11,fontWeight:600 }}>{v}</span>
            </div>
          ))}
          <button onClick={()=>setShowAdd(true)} style={{ background:"#ef4444",border:"none",color:"#fff",padding:"6px 14px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:11,fontWeight:700 }}>+ Add Row</button>
          {saveMsg&&<span style={{ fontSize:10,color:saveMsg==="saved"?"#10b981":"#f59e0b" }}>{saveMsg==="saving"?"⟳ Saving…":"✓ Saved"}</span>}
        </div>
      </div>

      {/* ── TRACKER TABLE ──────────────────────────────── */}
      {tab==="tracker" && (
        <div style={{ flex:1, overflowX:"auto", overflowY:"auto" }}>
          <div style={{ minWidth:1300 }}>

            {/* Column headers */}
            <div style={{ display:"grid", gridTemplateColumns:GRID, gap:6, padding:"7px 16px",
              borderBottom:"1px solid "+t.borderFaint, background:t.subnavBg, position:"sticky", top:0, zIndex:50, alignItems:"center" }}>
              {COL_HEADS.map((h,i)=>(
                <div key={i} title={COL_TIPS[i]}
                  style={{ fontSize:9,color:t.textGhost,letterSpacing:1,textAlign:(i>=7&&i<=10)?"center":"left",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{h}</div>
              ))}
            </div>

              {visible.length===0 && (
              <div style={{ padding:"70px 0",textAlign:"center" }}>
                <div style={{ fontSize:38,marginBottom:12 }}>📋</div>
                <p style={{ color:t.textGhost,fontSize:13 }}>No rows found. Adjust filters or add a new row.</p>
              </div>
            )}

            {/* Flat (urgency/confidence/score sort) */}
            {sortBy!=="block" && visible.map(row=>(
              <TrackerRow key={row.id} row={row} upd={upd} delRow={delRow} addScore={addScore} clrScore={clrScore} expanded={expanded} setExpanded={setExpanded} />
            ))}

            {/* Grouped by block → subject */}
            {sortBy==="block" && Object.entries(grouped).map(([block,subjects])=>{
              const bc=BLOCK_COLORS[block]||"#374151";
              const bAvg=avg(rows.filter(r=>r.block===block).flatMap(r=>r.scores));
              const bCrit=rows.filter(r=>r.block===block&&getUrgency(r.confidence,r.lastStudied)==="critical").length;
              return (
                <div key={block}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,padding:"13px 16px 5px",borderBottom:"1px solid "+bc+"25" }}>
                    <div style={{ width:3,height:13,background:bc,borderRadius:2 }}/>
                    <span style={{ color:bc,fontSize:10,fontWeight:700,letterSpacing:1 }}>{block.toUpperCase()}</span>
                    {bCrit>0&&<span style={{ fontFamily:MONO,color:"#ef4444",background:"#150404",border:"1px solid #450a0a",fontSize:8,padding:"1px 7px",borderRadius:3 }}>🔴 {bCrit} critical</span>}
                    <div style={{ flex:1,height:1,background:bc+"18" }}/>
                    {bAvg!==null&&<span style={{ fontFamily:MONO,color:"#6b7280",fontSize:10 }}>avg <span style={{ color:"#f1f5f9",fontWeight:600 }}>{bAvg}%</span></span>}
                  </div>
                  {Object.entries(subjects).map(([subj,subRows])=>(
                    <div key={subj}>
                      <div style={{ display:"grid",gridTemplateColumns:GRID,gap:6,padding:"6px 16px",background:"#080d18",borderBottom:"1px solid #0a1422",alignItems:"center" }}>
                        <div/><div style={{ color:bc,fontSize:9 }}>{block}</div>
                        <div style={{ color:"#c4cdd6",fontSize:11,fontWeight:600 }}>{subj}</div>
                        <div style={{ color:"#2d3d4f",fontSize:10 }}>
                          {subRows.length} lecture{subRows.length!==1?"s":""}
                          {avg(subRows.flatMap(r=>r.scores))!==null?" · "+avg(subRows.flatMap(r=>r.scores))+"%":""}
                        </div>
                        <div/><div/><div/>
                        {STEPS.map(s=>{ const d=subRows.filter(r=>r[s.key]).length; return <div key={s.key} style={{ textAlign:"center",color:d===subRows.length?"#10b981":"#1f2937",fontSize:9 }}>{d}/{subRows.length}</div>; })}
                        <div/><div/><div/><div/>
                      </div>
                      {subRows.map(row=>(
                        <TrackerRow key={row.id} row={row} upd={upd} delRow={delRow} addScore={addScore} clrScore={clrScore} expanded={expanded} setExpanded={setExpanded} />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ANALYTICS ────────────────────────────────── */}
      {tab==="analytics" && (
        <div style={{ flex:1, padding:"24px 20px", overflowY:"auto" }}>
          <h2 style={{ fontFamily:SERIF, fontSize:24, fontWeight:900, letterSpacing:-0.5, marginBottom:20 }}>
            Grade <span style={{ color:"#ef4444" }}>Analytics</span>
          </h2>
          <Analytics rows={rows} />
        </div>
      )}

      {showAdd && <AddModal onAdd={addRow} onClose={()=>setShowAdd(false)} />}
    </div>
  );
}
