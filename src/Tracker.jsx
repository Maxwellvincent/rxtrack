import React, { useState, useEffect, useRef } from "react";
import { useTheme, getScoreColor, getUrgencyColor, URGENCY_LABELS } from "./theme";

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

const checkColors = ["#60a5fa", "#f59e0b", "#a78bfa", "#6b7280"];

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
  const { T } = useTheme();
  return (
    <div onClick={onClick} style={{
      width:24, height:24, borderRadius:6,
      border:"1.5px solid "+(checked ? color : T.border1),
      background: checked ? color+"28" : "transparent",
      display:"flex", alignItems:"center", justifyContent:"center",
      cursor:"pointer", transition:"all 0.15s", margin:"0 auto", flexShrink:0,
    }}>
      {checked && <span style={{ color, fontSize:14, fontWeight:700, lineHeight:1 }}>✓</span>}
    </div>
  );
}

function DaysBadge({ lastStudied, confidence }) {
  const { T, isDark } = useTheme();
  const days = daysSince(lastStudied);
  const urg  = getUrgency(confidence, lastStudied);
  const u    = URG[urg];
  if (days === null) return <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>—</span>;
  const pillBg = u.label ? (isDark ? u.color+"18" : u.color+"26") : "transparent";
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
      <span style={{ fontFamily:MONO, color:u.color, fontSize:17, fontWeight:700, lineHeight:1, textShadow:u.glow }}>{days}d</span>
      {u.label && <span style={{ fontFamily:MONO, color:u.color, fontSize:13, letterSpacing:1, background:pillBg, padding:"1px 5px", borderRadius:3 }}>{u.label}</span>}
    </div>
  );
}

function ScoreCell({ scores, onAdd, onClear }) {
  const [val, setVal] = useState("");
  const { T, isDark } = useTheme();
  const submit = () => {
    const n = Number(val);
    if (!val || isNaN(n) || n < 0 || n > 100) return;
    onAdd(n); setVal("");
  };
  const a = avg(scores);
  const col = a===null?T.text4:a>=80?T.green:a>=70?T.amber:a>=60?T.amber:T.red;
  const badgeBg = isDark ? col+"18" : col+"26";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      {a !== null && (
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontFamily:MONO, color:col, fontSize:16, fontWeight:700 }}>{a}%</span>
          <span style={{ fontFamily:MONO, color:col, background:badgeBg, fontSize:13, padding:"1px 5px", borderRadius:3 }}>×{scores.length}</span>
          <button onClick={onClear} style={{ background:"none", border:"none", color:T.text4, cursor:"pointer", fontSize:13 }} title="Clear">✕</button>
        </div>
      )}
      <div style={{ display:"flex", gap:3 }}>
        <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="%" type="number" min={0} max={100}
          style={{ width:44, background:T.inputBg, border:"1px solid "+T.border1, color:T.text1, padding:"3px 5px", borderRadius:4, fontFamily:MONO, fontSize:14, outline:"none" }} />
        <button onClick={submit} style={{ background:T.border1, border:"none", color:T.blue, padding:"3px 7px", borderRadius:4, cursor:"pointer", fontFamily:MONO, fontSize:13 }}>+</button>
      </div>
    </div>
  );
}

// Shared date input style (calendar picker, theme-aware)
function dateInputStyle(T, isDark) {
  return {
    background: T.inputBg,
    border: "1px solid " + T.border1,
    color: T.text1,
    padding: "4px 8px",
    borderRadius: 6,
    fontFamily: MONO,
    fontSize: 13,
    outline: "none",
    cursor: "pointer",
    width: "100%",
    colorScheme: isDark ? "dark" : "light",
  };
}

// Inline-editable text cell
function EditCell({ value, onChange, placeholder, type }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value || "");
  const ref = useRef();
  const { T, isDark } = useTheme();
  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const commit = () => { setEditing(false); if (draft !== (value||"")) onChange(draft); };

  if (type === "date") {
    return (
      <input
        type="date"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        style={dateInputStyle(T, isDark)}
        title="Click to open calendar"
      />
    );
  }
  return editing ? (
    <input ref={ref} value={draft} onChange={e=>setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(); if(e.key==="Escape"){ setDraft(value||""); setEditing(false); } }}
      style={{ background:T.inputBg, border:"1px solid "+T.blue, color:T.text1, fontFamily:MONO, fontSize:13, padding:"2px 6px", borderRadius:4, outline:"none", width:"100%" }} />
  ) : (
    <div onClick={() => setEditing(true)}
      title="Click to edit"
      style={{ color:value?T.text2:T.text5, fontFamily:MONO, fontSize:13, cursor:"text", padding:"2px 4px", borderRadius:4,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", transition:"background 0.1s" }}
      onMouseEnter={e=>e.currentTarget.style.background=T.rowHover}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      {value || placeholder || "—"}
    </div>
  );
}

// Confidence dropdown picker
function ConfPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { T, isDark } = useTheme();
  const conf = value ? getConf(value) : null;
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const triggerBg = conf ? (isDark ? conf.bg : conf.color+"26") : "transparent";
  const triggerBorder = conf ? (isDark ? conf.color+"40" : conf.color) : T.border1;
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div onClick={() => setOpen(p=>!p)} style={{
        display:"flex", alignItems:"center", gap:5, cursor:"pointer", padding:"3px 8px",
        borderRadius:6, border:"1px solid "+(conf?(isDark?conf.color+"40":conf.color):T.border1),
        background:triggerBg, transition:"all 0.15s", whiteSpace:"nowrap", userSelect:"none",
      }}>
        {conf
          ? <><div style={{ width:10, height:10, borderRadius:"50%", background:conf.color, flexShrink:0 }}/><span style={{ fontFamily:MONO, color:conf.color, fontSize:13, fontWeight:600 }}>{conf.label}</span></>
          : <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>Rate confidence</span>}
        <span style={{ color:T.text4, fontSize:13, marginLeft:2 }}>▾</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:600, background:T.pickerBg||T.cardBg,
          border:"1px solid "+(T.pickerBorder||T.border1), borderRadius:10, padding:6, minWidth:185, boxShadow:"0 12px 40px #000c" }}>
          {CONFIDENCE.map(c => (
            <div key={c.value} onClick={()=>{ onChange(c.value); setOpen(false); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:7, cursor:"pointer",
                background:value===c.value?(isDark?c.bg:c.color+"26"):"transparent", border:"1px solid "+(value===c.value?c.color+(isDark?"40":""):"transparent"), marginBottom:2, transition:"all 0.1s" }}
              onMouseEnter={e=>{ if(value!==c.value) e.currentTarget.style.background=T.pickerHover||T.rowHover; }}
              onMouseLeave={e=>{ if(value!==c.value) e.currentTarget.style.background="transparent"; }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:c.color, flexShrink:0 }}/>
              <span style={{ fontFamily:MONO, color:c.color, fontSize:13, fontWeight:600, flex:1 }}>{c.label}</span>
              <span style={{ fontFamily:MONO, color:T.text4, fontSize:13 }}>/{c.reviewDays}d</span>
            </div>
          ))}
          {value && <div onClick={()=>{ onChange(null); setOpen(false); }}
            style={{ padding:"5px 10px", cursor:"pointer", fontFamily:MONO, color:T.text4, fontSize:13, textAlign:"center", marginTop:2 }}>clear</div>}
        </div>
      )}
    </div>
  );
}

// Add Row Modal
function AddModal({ onAdd, onClose }) {
  const { T, isDark } = useTheme();
  const [row, setRow] = useState({ block:"FTM 2", subject:"", topic:"", lectureDate:"", lastStudied:"", ankiDate:"", confidence:null });
  const set = (k,v) => setRow(p=>({...p,[k]:v}));
  const INP = { background:T.inputBg, border:"1px solid "+T.border1, color:T.text1, padding:"8px 11px", borderRadius:7, fontFamily:MONO, fontSize:14, outline:"none", width:"100%" };
  const canSubmit = row.subject.trim().length > 0 && row.topic.trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onAdd(makeRow({ ...row, subject:row.subject.trim(), topic:row.topic.trim() }));
    onClose();
  };
  const optionalHint = { fontFamily: MONO, color: T.text4, fontSize: 13, marginTop: 3 };
  return (
    <div style={{ position:"fixed", inset:0, background:T.overlayBg, display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div style={{ background:T.cardBg, border:"1px solid "+T.border1, borderRadius:18, padding:30, width:500, display:"flex", flexDirection:"column", gap:18, boxShadow:T.cardShadow }}>
        <div style={{ fontFamily:SERIF, fontSize:22, fontWeight:700, color:T.text1 }}>Add Lecture / Topic</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div style={{ gridColumn:"1/-1" }}>
            <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>BLOCK</div>
            <select value={row.block} onChange={e=>set("block",e.target.value)} style={{...INP,cursor:"pointer"}}>
              {BLOCKS.map(b=><option key={b}>{b}</option>)}
            </select>
          </div>
          {[["subject","SUBJECT / COURSE","e.g. Physiology"],["topic","LECTURE / TOPIC","e.g. Cardiac Cycle"]].map(([k,l,ph])=>(
            <div key={k}>
              <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>{l}</div>
              <input style={INP} placeholder={ph} value={row[k]} onChange={e=>set(k,e.target.value)} autoFocus={k==="subject"} onKeyDown={e=>k==="topic"&&e.key==="Enter"&&canSubmit&&submit()} />
            </div>
          ))}
          {[["lectureDate","LECTURE DATE"],["lastStudied","LAST STUDIED"],["ankiDate","ANKI CARD RELEASE"]].map(([k,l])=>(
            <div key={k}>
              <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>{l}</div>
              <input type="date" value={row[k]} onChange={e=>set(k,e.target.value)} style={dateInputStyle(T, isDark)} title="Click to open calendar" />
              <div style={optionalHint}>optional</div>
            </div>
          ))}
          <div>
            <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:5 }}>CONFIDENCE LEVEL</div>
            <ConfPicker value={row.confidence} onChange={v=>set("confidence",v)} />
            <div style={optionalHint}>optional</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ background:T.border1, border:"none", color:T.text5, padding:"9px 20px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:14 }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} style={{ background:canSubmit?T.red:T.border1, border:"none", color:canSubmit?T.text1:T.text5, padding:"9px 24px", borderRadius:8, cursor:canSubmit?"pointer":"not-allowed", fontFamily:MONO, fontSize:15, fontWeight:700, opacity:canSubmit?1:0.7 }}>Add Row</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ANALYTICS PANEL
// ─────────────────────────────────────────────────────────
function Analytics({ rows }) {
  const { T, isDark } = useTheme();
  const allScores = rows.flatMap(r=>r.scores);
  const overall   = avg(allScores);
  const acol      = p => p===null?T.text4:p>=80?T.green:p>=70?T.amber:p>=60?T.amber:T.red;

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
          { l:"Topics Tracked",  v:rows.length,                           c:T.blue     },
          { l:"Need Review Now", v:needsReview.length,                    c:needsReview.length>0?T.red:T.green },
          { l:"Fully Complete",  v:rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length, c:T.green },
        ].map(({l,v,c})=>(
          <div key={l} style={{ background:T.cardBg, border:"1px solid "+T.border1, borderRadius:12, padding:"16px 18px", boxShadow:T.shadowSm }}>
            <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:1.5, marginBottom:6 }}>{l.toUpperCase()}</div>
            <div style={{ fontFamily:SERIF, color:c, fontSize:30, fontWeight:900, lineHeight:1 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Review queue */}
      {needsReview.length > 0 && (
        <div>
          <div style={{ fontFamily:MONO, color:T.red, fontSize:13, letterSpacing:2, marginBottom:12 }}>🔴 REVIEW QUEUE — NEEDS ATTENTION NOW</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {needsReview.map(r=>{
              const urg=getUrgency(r.confidence,r.lastStudied), u=URG[urg], conf=r.confidence?getConf(r.confidence):null, days=daysSince(r.lastStudied);
              const cardBg = (urg==="critical"||urg==="overdue") && !isDark ? (urg==="critical"?T.redBg:T.amberBg) : u.bg;
              const cardGlow = urg==="critical" && (isDark ? u.glow : "0 0 14px "+T.red+"26") || (urg==="overdue" && (isDark ? u.glow : "0 0 8px "+T.amber+"26")) || "none";
              return (
                <div key={r.id} style={{ background:cardBg, border:"1px solid "+u.border, borderRadius:10, padding:"12px 18px",
                  display:"flex", alignItems:"center", gap:16, boxShadow:cardGlow }}>
                  <div style={{ width:3, height:36, background:u.color, borderRadius:2, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:MONO, color:T.text2, fontSize:14, fontWeight:600 }}>{r.topic}</div>
                    <div style={{ fontFamily:MONO, color:T.text3, fontSize:14 }}>{r.block} · {r.subject}</div>
                  </div>
                  {conf && <div style={{ display:"flex", alignItems:"center", gap:5, background:isDark?conf.bg:conf.color+"26", border:"1px solid "+conf.color, borderRadius:6, padding:"4px 10px", flexShrink:0 }}>
                    <div style={{ width:10,height:10,borderRadius:"50%",background:conf.color }}/><span style={{ fontFamily:MONO,color:conf.color,fontSize:13 }}>{conf.label}</span>
                  </div>}
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontFamily:MONO, color:u.color, fontSize:18, fontWeight:700 }}>{days!==null?days+"d ago":"Never studied"}</div>
                    <div style={{ fontFamily:MONO, color:u.color, background:isDark?u.color+"18":u.color+"26", fontSize:13, padding:"2px 7px", borderRadius:3, letterSpacing:1, marginTop:2 }}>{u.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confidence breakdown */}
      <div>
        <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:2, marginBottom:12 }}>CONFIDENCE BREAKDOWN</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {CONFIDENCE.map(c=>{
            const d=byConf[c.value]; if(!d||d.count===0) return null;
            const a=avg(d.scores);
            return (
              <div key={c.value} style={{ background:c.bg, border:"1px solid "+c.border, borderRadius:10, padding:"13px 16px", minWidth:140 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{ width:10,height:10,borderRadius:"50%",background:c.color }}/><span style={{ fontFamily:MONO,color:c.color,fontSize:13,fontWeight:600 }}>{c.label}</span>
                </div>
                <div style={{ fontFamily:SERIF, color:c.color, fontSize:26, fontWeight:900 }}>{d.count}</div>
                <div style={{ fontFamily:MONO, color:T.text4, fontSize:13 }}>topic{d.count!==1?"s":""}{a!==null?" · "+a+"%":""}</div>
                <div style={{ fontFamily:MONO, color:T.text5, fontSize:13, marginTop:3 }}>review every {c.reviewDays}d</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By subject */}
      <div>
        <div style={{ fontFamily:MONO, color:T.text4, fontSize:13, letterSpacing:2, marginBottom:12 }}>BY SUBJECT — WEAKEST FIRST</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:10 }}>
          {Object.entries(bySubject).sort((a,b)=>(avg(a[1].scores)??101)-(avg(b[1].scores)??101)).map(([subj,d])=>{
            const a=avg(d.scores), col=acol(a);
            const avgConf=d.conf.length?Math.round(d.conf.reduce((s,v)=>s+v,0)/d.conf.length):null;
            const confData=avgConf?getConf(Math.round(avgConf)):null;
            return (
              <div key={subj} style={{ background:T.cardBg, border:"1px solid "+(confData?confData.color+"25":T.border1), borderRadius:10, padding:"13px 16px", boxShadow:T.shadowSm }}>
                <div style={{ fontFamily:MONO, color:T.text2, fontSize:14, fontWeight:600, marginBottom:8 }}>{subj}</div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontFamily:SERIF, color:col, fontSize:24, fontWeight:900 }}>{a!==null?a+"%":"—"}</span>
                  {confData && <div style={{ display:"flex", alignItems:"center", gap:4, background:confData.bg, border:"1px solid "+confData.border, borderRadius:5, padding:"3px 8px" }}>
                    <div style={{ width:10,height:10,borderRadius:"50%",background:confData.color }}/><span style={{ fontFamily:MONO,color:confData.color,fontSize:13 }}>{confData.label}</span>
                  </div>}
                </div>
                {a!==null && <div style={{ height:3,background:T.border1,borderRadius:2,marginBottom:8 }}><div style={{ width:a+"%",height:"100%",background:col,borderRadius:2 }}/></div>}
                <div style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>{d.count} lecture{d.count!==1?"s":""} · {d.scores.length} scores</div>
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
const GRID = "20px 58px 110px 1fr 92px 92px 58px 26px 26px 26px 26px 92px 112px 70px 160px 20px";

function TrackerRow({ row, upd, delRow, addScore, clrScore, expanded, setExpanded, flashLastStudied, index, isDark }) {
  const { T } = useTheme();
  const bc      = BLOCK_COLORS[row.block] || T.text4;
  const allDone = row.preRead && row.lecture && row.postReview && row.anki;
  const urg     = getUrgency(row.confidence, row.lastStudied);
  const u       = URG[urg];
  const isOpen  = expanded[row.id];
  const conf    = row.confidence ? getConf(row.confidence) : null;
  const todayStr = () => new Date().toISOString().split("T")[0];

  const rowIndex = index != null ? index : 0;
  const rowBg = urg==="critical" ? (isDark?u.bg:T.redBg) : urg==="overdue" ? (isDark?u.bg:T.amberBg) : allDone ? (isDark?T.greenBg:T.greenBg) : (isDark?"transparent":(rowIndex%2===0?T.hoverBg:T.cardBg));
  const leftBorder= urg==="critical" ? T.red : urg==="overdue" ? T.amber : "transparent";
  const rowGlow = (urg==="critical"||urg==="overdue") ? (isDark ? u.glow : (urg==="critical" ? "0 0 14px #ef444426" : "0 0 8px #f9731626")) : "none";

  return (
    <div style={{ borderBottom:"1px solid " + T.border2 }}>
      <div
        style={{ display:"grid", gridTemplateColumns:GRID, gap:6, padding:"9px 16px", alignItems:"center",
          background:rowBg, borderLeft:"3px solid "+leftBorder, transition:"background 0.2s",
          boxShadow:rowGlow }}
        onMouseEnter={e=>{ if(urg==="none"&&!allDone) e.currentTarget.style.background=T.rowHover; }}
        onMouseLeave={e=>{ e.currentTarget.style.background=rowBg; }}>

        {/* Expand toggle */}
        <button onClick={()=>setExpanded(p=>({...p,[row.id]:!p[row.id]}))}
          style={{ background:"none", border:"none", color:T.text5, cursor:"pointer", fontSize:13, padding:0, lineHeight:1, textAlign:"center" }}>
          {isOpen?"▾":"▸"}
        </button>

        {/* Block selector */}
        <select value={row.block} onChange={e=>upd(row.id,{block:e.target.value})}
          style={{ background:"transparent", border:"none", color:bc, fontFamily:MONO, fontSize:13, cursor:"pointer", outline:"none", width:"100%" }}>
          {BLOCKS.map(b=><option key={b} style={{ background:T.cardBg, color:BLOCK_COLORS[b]||T.text1 }}>{b}</option>)}
        </select>

        {/* Subject — inline edit */}
        <EditCell value={row.subject} onChange={v=>upd(row.id,{subject:v})} placeholder="Subject…" />

        {/* Topic — inline edit + AUTO badge if synced from session or auto-generated */}
        <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
        <EditCell value={row.topic} onChange={v=>upd(row.id,{topic:v})} placeholder="Lecture / topic…" />
          {(row.autoGenerated || (row.reps > 0 && row.lecture && !row.lectureDate)) && (
            <span style={{ fontFamily:MONO, fontSize:8, color:T.blue, background:T.blue+"18", padding:"1px 5px", borderRadius:3, border:"1px solid "+T.blue+"40", flexShrink:0 }}>AUTO</span>
          )}
        </div>

        {/* Lecture date */}
        <EditCell value={row.lectureDate} onChange={v=>upd(row.id,{lectureDate:v})} type="date" />

        {/* Last studied */}
        <div style={{ transition:"background 0.3s ease", background:flashLastStudied?T.greenBg:"transparent", borderRadius:6 }}>
        <EditCell value={row.lastStudied} onChange={v=>upd(row.id,{lastStudied:v})} type="date" />
        </div>

        {/* Days since */}
        <DaysBadge lastStudied={row.lastStudied} confidence={row.confidence} />

        {/* Step checkboxes — ticking any = studied today */}
        {STEPS.map(s=>(
          <Check key={s.key} checked={row[s.key]} onClick={()=>upd(row.id,{[s.key]:!row[s.key],lastStudied:todayStr()})} color={s.color} />
        ))}

        {/* Anki date */}
        <EditCell value={row.ankiDate} onChange={v=>upd(row.id,{ankiDate:v})} type="date" />

        {/* Confidence picker */}
        <ConfPicker value={row.confidence} onChange={v=>upd(row.id,{confidence:v})} />

        {/* Sessions */}
        <div style={{ fontFamily:MONO, fontSize:13, color:T.text2 }}>{(row.reps||0) ? (row.reps||0) + " session" + ((row.reps||0)!==1?"s":"") : "—"}</div>

        {/* Score input */}
        <ScoreCell scores={row.scores} onAdd={sc=>addScore(row.id,sc)} onClear={()=>clrScore(row.id)} />

        {/* Delete */}
        <button onClick={()=>delRow(row.id)}
          style={{ background:"none", border:"none", color:T.border1, cursor:"pointer", fontSize:13, padding:2 }}
          onMouseEnter={e=>e.currentTarget.style.color=T.red}
          onMouseLeave={e=>e.currentTarget.style.color=T.border1}>✕</button>
      </div>

      {/* Expanded section */}
      {isOpen && (
        <div style={{ padding:"10px 16px 14px 46px", background:T.sidebarBg, borderTop:"1px solid " + T.border2 }}>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:10, alignItems:"center" }}>
            {conf && (
              <div style={{ display:"flex", alignItems:"center", gap:8, background:isDark?conf.bg:conf.color+"26", border:"1px solid "+conf.color, borderRadius:8, padding:"6px 14px" }}>
                <div style={{ width:10,height:10,borderRadius:"50%",background:conf.color }}/>
                <span style={{ fontFamily:MONO, color:conf.color, fontSize:13, fontWeight:600 }}>{conf.label}</span>
                <span style={{ fontFamily:MONO, color:T.text4, fontSize:13 }}>· review every {conf.reviewDays} days</span>
              </div>
            )}
            {row.scores.length > 0 && (
              <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>Score log:</span>
                {row.scores.map((sc,i)=>{ const c=sc>=80?T.green:sc>=70?T.amber:sc>=60?T.amber:T.red; return <span key={i} style={{ fontFamily:MONO,color:c,background:isDark?c+"18":c+"26",fontSize:16,fontWeight:700,padding:"1px 7px",borderRadius:4 }}>{sc}%</span>; })}
              </div>
            )}
            {row.scores.length > 1 && (
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontFamily:MONO, color:T.text5, fontSize:13 }}>Trend:</span>
                <div style={{ display:"flex", gap:2 }}>
                  {row.scores.map((sc,i)=>(
                    <span key={i} style={{ width:8, height:8, borderRadius:2, background: sc>=70?T.green:sc>=60?T.amber:T.red, flexShrink:0 }} title={sc+"%"} />
                  ))}
          </div>
              </div>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <div style={{ fontFamily:MONO, color:T.text5, fontSize:13, letterSpacing:1.5 }}>NOTES / HIGH-YIELD POINTS</div>
            <button type="button" onClick={()=>upd(row.id,{lastStudied:todayStr()})}
              style={{ fontFamily:MONO, fontSize:13, color:T.green, background:T.greenBg, border:"1px solid "+T.greenBorder, borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>
              Mark Studied Today
            </button>
          </div>
          <textarea value={row.notes} onChange={e=>upd(row.id,{notes:e.target.value})}
            placeholder="Mnemonics, First Aid pages, weak areas, connections to revisit…" rows={2}
            style={{ width:"100%", maxWidth:740, background:T.inputBg, border:"1px solid " + T.border1, color:T.text2,
              padding:"8px 12px", borderRadius:8, fontFamily:MONO, fontSize:13, outline:"none", lineHeight:1.6, resize:"vertical" }} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────
function deduplicateTrackerRows(rows) {
  const seen = {};
  const merged = [];
  rows.forEach((row) => {
    const key = row.lectureId || (row.topic || "").toLowerCase().trim() || row.id;
    if (seen[key] !== undefined) {
      const existing = merged[seen[key]];
      const combinedScores = [...(existing.scores || []), ...(row.scores || [])].filter((s) => s != null && s !== "");
      merged[seen[key]] = {
        ...existing,
        lastStudied: [existing.lastStudied, row.lastStudied].filter(Boolean).sort().slice(-1)[0] || existing.lastStudied,
        reps: (existing.reps || 0) + (row.reps || 0),
        scores: combinedScores,
        confidence: row.confidence ?? existing.confidence,
        ankiDate: row.ankiDate || existing.ankiDate,
        lectureDate: row.lectureDate || existing.lectureDate,
        preRead: existing.preRead || row.preRead,
        lecture: existing.lecture || row.lecture,
        postReview: existing.postReview || row.postReview,
        anki: existing.anki || row.anki,
      };
    } else {
      seen[key] = merged.length;
      merged.push({ ...row });
    }
  });
  return merged;
}

export default function Tracker({
  blocks = {},
  lecs = [],
  performanceHistory = {},
  resolveTopicLabel,
  getBlockObjectives = () => [],
  computeWeakAreas = () => [],
  activeBlock = null,
  termColor,
  onStudyWeak,
  examDates = {},
  buildStudySchedule = () => null,
  generateDailySchedule = () => null,
  makeTopicKey,
  lecTypeBadge,
  onOpenBlockSchedule,
  saveExamDate,
  startObjectiveQuiz,
  handleDeepLearnStart,
  setAnkiLogTarget,
  LEVEL_COLORS = {},
  LEVEL_BG = {},
  updateBlock,
  onStartScheduleSession,
  trackerRows: trackerRowsProp,
  setTrackerRows: setTrackerRowsProp,
}) {
  const [internalRows, setInternalRows] = useState([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("tracker");
  const [filter, setFilter] = useState("All");
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [urgFilter, setUrgFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("block");
  const [showAdd, setShowAdd] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [expanded, setExpanded] = useState({});
  const [flashLastStudiedRowId, setFlashLastStudiedRowId] = useState(null);
  const [showStudyLog, setShowStudyLog] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [openStudyLogGroups, setOpenStudyLogGroups] = useState(() => ({}));
  const toggleRow = (rowKey) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };
  const timerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const { T: t, isDark } = useTheme();

  const isControlled = trackerRowsProp !== undefined && setTrackerRowsProp != null;
  const rows = isControlled ? trackerRowsProp : internalRows;
  const setRows = isControlled ? setTrackerRowsProp : setInternalRows;

  // Load (when uncontrolled)
  useEffect(() => {
    if (isControlled) {
      setReady(true);
      return;
    }
    const saved = sGet("rxt-tracker-v2");
    const loaded = saved || SAMPLE;
    const deduped = deduplicateTrackerRows(loaded);
    if (deduped.length !== loaded.length) {
      setInternalRows(deduped);
      try {
        sSet("rxt-tracker-v2", deduped);
      } catch {}
    } else {
      setInternalRows(loaded);
    }
    setReady(true);
  }, []);

  // When navigating to Tracker from a block, select that block's tab
  useEffect(() => {
    if (activeBlock?.name) {
      setFilter(activeBlock.name);
    }
  }, [activeBlock?.id]);

  // Save (debounced when uncontrolled; parent persists when controlled)
  const persist = (nr) => {
    setSaveMsg("saving");
    clearTimeout(timerRef.current);
    if (isControlled) {
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }
    timerRef.current = setTimeout(() => { sSet("rxt-tracker-v2", nr); setSaveMsg("saved"); setTimeout(() => setSaveMsg(""), 2000); }, 500);
  };

  const todayStr = () => new Date().toISOString().split("T")[0];
  const triggerFlash = (id) => {
    setFlashLastStudiedRowId(id);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashLastStudiedRowId(null), 1500);
  };
  const upd = (id, patch) => {
    setRows(p => { const n = p.map(r => r.id === id ? { ...r, ...patch } : r); persist(n); return n; });
    if (patch.lastStudied !== undefined) triggerFlash(id);
  };
  const addRow   = row        => setRows(p=>{ const n=[...p,row]; persist(n); return n; });
  const delRow   = id         => setRows(p=>{ const n=p.filter(r=>r.id!==id); persist(n); return n; });
  const addScore = (id, sc)   => {
    const today = todayStr();
    setRows(p=>{ const n=p.map(r=>r.id===id?{...r,scores:[...r.scores,sc],lastStudied:today}:r); persist(n); return n; });
    triggerFlash(id);
  };
  const clrScore = id         => setRows(p=>{ const n=p.map(r=>r.id===id?{...r,scores:[]}:r); persist(n); return n; });

  // Filter
  let visible = rows.filter(r => {
    if (filter!=="All" && r.block!==filter) return false;
    if (urgFilter!=="All" && getUrgency(r.confidence,r.lastStudied)!==urgFilter) return false;
    if (search) { const q=search.toLowerCase(); if(!(r.subject||"").toLowerCase().includes(q)&&!(r.topic||"").toLowerCase().includes(q)) return false; }
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

  const COL_HEADS = ["","Block","Subject","Lecture / Topic","Lecture Date","Last Studied","Days Ago","📖","🎓","📝","🃏","Anki Date","Confidence","Sessions","Score",""];
  const COL_TIPS  = ["","","","","Lecture date","Last date studied","Days since last study","Pre-Read","Attended Lecture","Post-Lecture Review","Anki Cards Released","Anki card release date","Confidence level (drives review frequency)","Number of practice sessions","Practice question score",""];

  const totalSessions = rows.reduce((a,r)=>a+(r.reps||0),0);
  const overallAvgScore = avg(rows.flatMap(r=>r.scores||[]));
  const repsBySubject = {};
  rows.forEach(r=>{ const s=r.subject||"Unknown"; repsBySubject[s]=(repsBySubject[s]||0)+(r.reps||0); });
  const mostPracticedSubject = Object.keys(repsBySubject).length ? Object.entries(repsBySubject).sort((a,b)=>b[1]-a[1])[0][0] : null;
  const withImprovement = rows.filter(r=>(r.scores||[]).length>=2).map(r=>{ const s=r.scores; return { row:r, diff: s[s.length-1]-s[0] }; });
  const mostImproved = withImprovement.length ? withImprovement.sort((a,b)=>b.diff-a.diff)[0] : null;
  const needingAttention = rows.filter(r=>{ const s=r.scores||[]; return s.length>=2 && s[s.length-1]<65 && s[s.length-2]<65; });

  const blocksArray = Object.values(blocks || {});
  const visibleBlocks = blocksArray.filter(block => {
    if (filter === "All") return true;
    const name = (block.name || "").trim();
    const id = block.id || "";
    const filterNorm = (filter || "").toLowerCase().replace(/\s/g, "");
    const nameNorm = name.toLowerCase().replace(/\s/g, "");
    return (
      block.name === filter ||
      block.id === filter ||
      (nameNorm && nameNorm === filterNorm)
    );
  });
  const allBlockLecs = blocksArray.flatMap(b => (lecs || []).filter(l => l.blockId === b.id));

  const makeKey = makeTopicKey || ((lectureId, blockId) => (lectureId ? `${lectureId}__${blockId}` : `block__${blockId}`));
  const getLecPerf = (lec, blockId) => {
    const key = makeKey(lec.id, blockId);
    if (performanceHistory[key]) return performanceHistory[key];
    const fallbackKey = Object.keys(performanceHistory || {}).find(k => k.startsWith(lec.id + "__"));
    if (fallbackKey) return performanceHistory[fallbackKey];
    return null;
  };

  const globalStudyLog = Object.entries(performanceHistory || {})
    .flatMap(([key, perf]) => {
      const lecId = key.split("__")[0];
      const sessions = (perf.sessions || []).filter(
        s => !s.lectureId || s.lectureId === lecId
      );
      return sessions.map(s => {
        const label = resolveTopicLabel
          ? resolveTopicLabel(key, s, s.blockId)
          : (() => {
              const lec = allBlockLecs.find(l => key.startsWith(l.id));
              return lec?.lectureTitle || (key.includes("block__") ? "Block Exam" : key);
            })();
        return {
          ...s,
          key,
          label,
        };
      });
    })
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  if (!ready) return (
    <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:60 }}>
      <div style={{ width:36,height:36,border:"3px solid "+t.border1,borderTopColor:t.statusBad,borderRadius:"50%",animation:"rxt-spin 0.85s linear infinite" }}/>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, fontFamily:MONO, background:t.appBg, color:t.text1 }}>

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div style={{ padding:"10px 18px", borderBottom:"1px solid "+t.border2, background:t.subnavBg,
        display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", flexShrink:0 }}>

        {/* Tab toggles */}
        <div style={{ display:"flex", gap:2 }}>
          {[["tracker","📋 Tracker"],["analytics","📊 Analytics"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{ background:tab===v?t.rowHover:"none",border:"none",
              color:tab===v?t.text1:t.text3,padding:"5px 13px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:15 }}>{l}</button>
          ))}
        </div>

        {tab==="tracker" && <>
          {/* Block filters */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {[
              { key: "All", name: "All" },
              ...Object.values(blocks || {}).filter(b => b?.name).map(b => ({ key: b.id, name: b.name })),
            ].map(({ key: tabKey, name }) => {
              const isSelected = filter === name;
              const block = Object.values(blocks || {}).find(b => b.name === name);
              const tcBtn = termColor || block?.termColor || (BLOCK_COLORS[name] || t.text4);
              return (
                <button
                  key={tabKey}
                  onClick={() => setFilter(name)}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 20,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 400,
                    border: "1px solid " + (isSelected ? tcBtn : t.border1),
                    background: isSelected ? tcBtn + "18" : t.inputBg,
                    color: isSelected ? tcBtn : t.text3,
                    transition: "all 0.15s",
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>

          {/* Urgency filter */}
          <div style={{ display:"flex", gap:3 }}>
            {[["All","All",t.text4],["critical","⚠ Critical",getUrgencyColor(t,"critical")],["overdue","⏰ Overdue",getUrgencyColor(t,"overdue")],["soon","⏱ Soon",getUrgencyColor(t,"soon")],["ok","✓ OK",getUrgencyColor(t,"ok")]].map(([v,l,c])=>(
              <button key={v} onClick={()=>setUrgFilter(v)} style={{
                background:urgFilter===v?c+"22":"none",border:"1px solid "+(urgFilter===v?c:t.border1),
                color:urgFilter===v?c:t.text3,padding:"3px 9px",borderRadius:6,cursor:"pointer",fontFamily:MONO,fontSize:13 }}>{l}</button>
            ))}
          </div>

          {/* Sort */}
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ background:t.cardBg,border:"1px solid "+t.border1,color:t.text5,padding:"4px 10px",borderRadius:7,fontFamily:MONO,fontSize:13,outline:"none",cursor:"pointer" }}>
            {[["block","Sort: Block"],["urgency","Sort: Urgency ↑"],["confidence","Sort: Confidence ↑"],["score","Sort: Score ↑"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>

          {/* Search */}
          <div style={{ display:"flex",alignItems:"center",gap:5,background:t.cardBg,border:"1px solid "+t.border1,borderRadius:7,padding:"4px 9px" }}>
            <span style={{ color:t.text4,fontSize:13 }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
              style={{ background:"none",border:"none",color:t.text1,fontFamily:MONO,fontSize:13,outline:"none",width:120 }} />
            {search&&<button onClick={()=>setSearch("")} style={{ background:"none",border:"none",color:t.text4,cursor:"pointer",fontSize:13 }}>✕</button>}
          </div>
        </>}

        {/* Right side */}
        <div style={{ marginLeft:"auto", display:"flex", gap:7, alignItems:"center" }}>
          {critCount>0 && <div style={{ background:t.statusBadBg,border:"1px solid "+t.statusBad,borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>⚠</span><span style={{ fontFamily:MONO,color:t.statusBad,fontSize:13,fontWeight:700 }}>{critCount} critical</span></div>}
          {ovdCount>0  && <div style={{ background:t.statusBadBg,border:"1px solid "+t.statusBad,borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>⏰</span><span style={{ fontFamily:MONO,color:t.statusBad,fontSize:13,fontWeight:700 }}>{ovdCount} overdue</span></div>}
          {[["Rows",rows.length],["Done",rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length]].map(([l,v])=>(
            <div key={l} style={{ background:t.cardBg,borderRadius:6,padding:"3px 10px",display:"flex",gap:5,alignItems:"center", border:"1px solid "+t.border1 }}>
              <span style={{ color:t.text4,fontSize:13 }}>{l}</span>
              <span style={{ color:t.text1,fontSize:13,fontWeight:600 }}>{v}</span>
            </div>
          ))}
          <button onClick={()=>setShowAdd(true)} style={{ background:t.statusBad,border:"none",color:t.text1,padding:"6px 14px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:13,fontWeight:700 }}>+ Add Row</button>
          {saveMsg&&<span style={{ fontSize:13,color:saveMsg==="saved"?t.statusGood:t.statusWarn }}>{saveMsg==="saving"?"⟳ Saving…":"✓ Saved"}</span>}
        </div>
      </div>

      {/* ── TRACKER TABLE ──────────────────────────────── */}
      {tab==="tracker" && (
        <div style={{ flex:1, overflowX:"auto", overflowY:"auto" }}>
          <div style={{ minWidth:1300 }}>

            {/* 📅 Schedule — Exam countdown + smart daily study scheduler */}
            {(() => {
              const blockId =
                filter !== "All"
                  ? (Object.values(blocks || {}).find((b) => b.name === filter || b.id === filter)?.id)
                  : activeBlock?.id;
              const block = blockId
                ? Object.values(blocks || {}).find((b) => b.id === blockId)
                : Object.values(blocks || {})[0];
              const bid = block?.id || blockId;
              if (!bid) return null;

              const examDate = examDates[bid] || "";
              const result = examDate && generateDailySchedule ? generateDailySchedule(bid, examDate) : null;
              const daysLeft = result?.daysLeft ?? 0;
              const schedule = result?.schedule ?? [];

              const countdownColor =
                daysLeft <= 7 ? t.statusBad : daysLeft <= 14 ? t.statusWarn : t.statusGood;
              const tc = termColor || block?.termColor || t.red;
              const T = t;

              return (
                <div style={{ marginBottom: 28, padding: "0 16px 0" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1.5 }}>
                      📅 EXAM SCHEDULE
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
                        Exam date:
                      </span>
                      <input
                        type="date"
                        value={examDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => saveExamDate && saveExamDate(bid, e.target.value)}
                        style={{
                          background: T.inputBg,
                          border: "1px solid " + T.border1,
                          borderRadius: 7,
                          padding: "6px 10px",
                          color: T.text1,
                          fontFamily: MONO,
                          fontSize: 12,
                        }}
                      />
                    </div>

                    {daysLeft > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 14px",
                          borderRadius: 20,
                          background: countdownColor + "15",
                          border: "1px solid " + countdownColor + "40",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            color: countdownColor,
                            fontSize: 18,
                            fontWeight: 900,
                          }}
                        >
                          {daysLeft}
                        </span>
                        <span style={{ fontFamily: MONO, color: countdownColor, fontSize: 11 }}>
                          days until exam
                        </span>
                      </div>
                    )}
                  </div>

                  {result?.needsBlockStart && updateBlock && (
                    <div
                      style={{
                        background: T.statusProgressBg,
                        border: "1px solid " + T.statusProgressBorder,
                        borderRadius: 10,
                        padding: "14px 16px",
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.statusProgress,
                          fontSize: 10,
                          letterSpacing: 1.5,
                          marginBottom: 6,
                        }}
                      >
                        ◑ SET BLOCK START DATE TO ENABLE SCHEDULING
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.text2,
                          fontSize: 11,
                          marginBottom: 10,
                        }}
                      >
                        Your lectures have weeks and days assigned. Set the
                        block start date above so the scheduler can calculate
                        exact lecture dates automatically.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            color: T.text3,
                            fontSize: 11,
                          }}
                        >
                          Block start date:
                        </span>
                        <input
                          type="date"
                          value={
                            (block && block.startDate) || ""
                          }
                          onChange={(e) =>
                            updateBlock(bid, { startDate: e.target.value })
                          }
                          style={{
                            background: T.inputBg,
                            border: "1px solid " + T.statusProgress,
                            borderRadius: 7,
                            padding: "6px 10px",
                            color: T.text1,
                            fontFamily: MONO,
                            fontSize: 12,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {!examDate && (
                    <div
                      style={{
                        fontFamily: MONO,
                        color: T.text3,
                        fontSize: 11,
                        padding: 14,
                        borderRadius: 8,
                        background: T.inputBg,
                        border: "1px solid " + T.border1,
                        textAlign: "center",
                      }}
                    >
                      Set your exam date above to generate a personalized study schedule
                    </div>
                  )}

                  {result?.undated?.length > 0 && (
                    <div
                      style={{
                        background: T.statusWarnBg,
                        border: "1px solid " + T.statusWarnBorder,
                        borderRadius: 10,
                        padding: "14px 16px",
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
                        △ {result.undated.length} LECTURES NEED A DATE TO BE
                        SCHEDULED
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          color: T.text2,
                          fontSize: 11,
                          marginBottom: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        These lectures have no date assigned — go to the block
                        overview and set a lecture date on each one so the
                        scheduler knows when they were or will be taught.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        {result.undated.slice(0, 5).map((ls) => (
                          <div
                            key={ls.lec.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 7,
                              background: T.cardBg,
                              border: "1px solid " + T.border1,
                            }}
                          >
                            {lecTypeBadge &&
                              lecTypeBadge(ls.lec.lectureType || "LEC")}
                            <span
                              style={{
                                fontFamily: MONO,
                                color: T.text2,
                                fontSize: 11,
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {ls.lec.lectureTitle || ls.lec.fileName}
                            </span>
                            <span
                              style={{
                                fontFamily: MONO,
                                color: T.statusWarn,
                                fontSize: 10,
                              }}
                            >
                              ○ No date set
                            </span>
                          </div>
                        ))}
                        {result.undated.length > 5 && (
                          <div
                            style={{
                              fontFamily: MONO,
                              color: T.text3,
                              fontSize: 10,
                              padding: "4px 10px",
                            }}
                          >
                            + {result.undated.length - 5} more...
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {schedule.length > 0 &&
                    schedule.map((day) => (
                      <div key={day.dateStr} style={{ marginBottom: 16 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: MONO,
                              fontWeight: 900,
                              fontSize: day.daysFromNow === 0 ? 14 : 12,
                              color: day.daysFromNow === 0 ? tc : T.text2,
                            }}
                          >
                            {day.dayLabel}
                          </div>
                          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                            {day.dateStr}
                          </div>
                          <div
                            style={{
                              flex: 1,
                              height: 1,
                              background: day.daysFromNow === 0 ? tc + "40" : T.border2,
                            }}
                          />
                          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                            ~
                            {day.tasks.reduce(
                              (s, task) =>
                                s +
                                (task.recommendedSessions || []).reduce(
                                  (ss, r) => ss + (r.duration || 0),
                                  0
                                ),
                              0
                            )}{" "}
                            min
                          </div>
                        </div>

                        {day.tasks.map((task) => (
                          <div
                            key={task.lec.id}
                            style={{
                              background: T.cardBg,
                              border:
                                "1px solid " +
                                (task.struggling > 0
                                  ? T.statusBadBorder
                                  : task.sessions === 0
                                    ? T.statusWarnBorder
                                    : T.border1),
                              borderRadius: 10,
                              padding: "12px 14px",
                              marginBottom: 8,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 8,
                              }}
                            >
                              {lecTypeBadge &&
                                lecTypeBadge(task.lec.lectureType || "LEC")}
                              <span
                                style={{
                                  fontFamily: MONO,
                                  color: T.text1,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  flex: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {task.lec.lectureTitle || task.lec.fileName}
                              </span>
                              {task.struggling > 0 && (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    fontSize: 9,
                                    color: T.statusBad,
                                    fontWeight: 700,
                                  }}
                                >
                                  ⚠ {task.struggling} struggling
                                </span>
                              )}
                              {task.sessions === 0 && (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    fontSize: 9,
                                    color: T.statusWarn,
                                    fontWeight: 700,
                                  }}
                                >
                                  ○ Not started
                                </span>
                              )}
                              {task.matchReason === "scheduled-day" && (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    fontSize: 8,
                                    color: tc,
                                    background: tc + "18",
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                    border: "1px solid " + tc + "30",
                                  }}
                                >
                                  TODAY'S LECTURE
                                </span>
                              )}
                              {task.matchReason === "spaced-rep-due" && (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    fontSize: 8,
                                    color: T.statusProgress,
                                    background: T.statusProgressBg,
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                  }}
                                >
                                  ⏱ DUE TODAY
                                </span>
                              )}
                              {task.matchReason === "urgency" && (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    fontSize: 8,
                                    color: T.statusWarn,
                                    background: T.statusWarnBg,
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                  }}
                                >
                                  △ WEAK
                                </span>
                              )}
                              {task.avgBloom >= 4 && LEVEL_COLORS && LEVEL_BG && (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    fontSize: 9,
                                    color: LEVEL_COLORS[Math.round(task.avgBloom)],
                                    background: LEVEL_BG[Math.round(task.avgBloom)],
                                    padding: "1px 6px",
                                    borderRadius: 3,
                                    border:
                                      "1px solid " +
                                      (LEVEL_COLORS[Math.round(task.avgBloom)] || "") +
                                      "30",
                                  }}
                                >
                                  L{Math.round(task.avgBloom)} avg
                                </span>
                              )}
                            </div>

                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              {(task.recommendedSessions || []).map((rec, ri) => (
                                <div
                                  key={ri}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "8px 10px",
                                    borderRadius: 7,
                                    background: T.inputBg,
                                    border: "1px solid " + T.border1,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: T.text1,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      flex: 1,
                                    }}
                                  >
                                    {rec.label}
                                  </span>
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: T.text3,
                                      fontSize: 10,
                                    }}
                                  >
                                    {rec.reason}
                                  </span>
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: T.text3,
                                      fontSize: 10,
                                      flexShrink: 0,
                                    }}
                                  >
                                    ~{rec.duration}m
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (rec.type === "deepLearn" && handleDeepLearnStart) {
                                        handleDeepLearnStart({
                                          selectedTopics: [
                                            {
                                              id: task.lec.id + "_full",
                                              label: task.lec.lectureTitle,
                                              lecId: task.lec.id,
                                              weak: false,
                                            },
                                          ],
                                          blockId: bid,
                                        });
                                      } else if (rec.type === "quiz" && startObjectiveQuiz) {
                                        const objs =
                                          (getBlockObjectives(bid) || []).filter(
                                            (o) => o.linkedLecId === task.lec.id
                                          );
                                        const weakObjs =
                                          task.struggling > 0
                                            ? objs.filter(
                                                (o) =>
                                                  o.status === "struggling" ||
                                                  o.status === "untested"
                                              )
                                            : objs;
                                        startObjectiveQuiz(
                                          weakObjs,
                                          task.lec.lectureTitle || task.lec.fileName,
                                          bid,
                                          { lectureId: task.lec.id }
                                        );
                                      } else if (rec.type === "anki" && setAnkiLogTarget) {
                                        setAnkiLogTarget(task.lec);
                                      }
                                    }}
                                    style={{
                                      background: tc,
                                      border: "none",
                                      color: "#fff",
                                      padding: "5px 12px",
                                      borderRadius: 6,
                                      cursor: "pointer",
                                      fontFamily: MONO,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      flexShrink: 0,
                                    }}
                                  >
                                    Start →
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}

                  {result?.upcoming?.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 10,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: MONO,
                            color: T.text3,
                            fontSize: 9,
                            letterSpacing: 1.5,
                          }}
                        >
                          UPCOMING
                        </div>
                        <div
                          style={{ flex: 1, height: 1, background: T.border2 }}
                        />
                      </div>
                      {result.upcoming.map((ls) => (
                        <div
                          key={ls.lec.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 14px",
                            borderRadius: 8,
                            marginBottom: 6,
                            opacity: 0.65,
                            background: T.inputBg,
                            border: "1px solid " + T.border1,
                          }}
                        >
                          {lecTypeBadge &&
                            lecTypeBadge(ls.lec.lectureType || "LEC")}
                          <span
                            style={{
                              fontFamily: MONO,
                              color: T.text2,
                              fontSize: 11,
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {ls.lec.lectureTitle || ls.lec.fileName}
                          </span>
                          <span
                            style={{
                              fontFamily: MONO,
                              color: T.text3,
                              fontSize: 10,
                              flexShrink: 0,
                            }}
                          >
                            {ls.daysUntilAvailable === 0
                              ? "Today"
                              : ls.daysUntilAvailable === 1
                                ? "Tomorrow"
                                : `in ${ls.daysUntilAvailable}d`}
                            {" · "}
                            {ls.availableDate.toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {examDate && daysLeft >= 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 16px",
                        borderRadius: 10,
                        background: T.statusBadBg,
                        border: "2px solid " + T.statusBadBorder,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>🎯</span>
                      <div>
                        <div
                          style={{
                            fontFamily: SERIF,
                            color: T.statusBad,
                            fontSize: 14,
                            fontWeight: 900,
                          }}
                        >
                          EXAM DAY
                        </div>
                        <div
                          style={{
                            fontFamily: MONO,
                            color: T.text3,
                            fontSize: 11,
                          }}
                        >
                          {new Date(examDate).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {process.env.NODE_ENV === "development" && (
              <details style={{ marginBottom: 12, padding: "0 16px" }}>
                <summary style={{ fontFamily: MONO, color: t.text3,
                  fontSize: 10, cursor: "pointer" }}>
                  🔍 Debug: Performance Keys ({Object.keys(performanceHistory || {}).length})
                </summary>
                <div style={{ fontFamily: MONO, fontSize: 9, color: t.text3,
                  padding: 8, background: t.inputBg, borderRadius: 6,
                  maxHeight: 200, overflowY: "auto" }}>
                  {Object.entries(performanceHistory || {}).map(([k, v]) => (
                    <div key={k}>
                      <strong>{k}</strong> — {v.sessions?.length || 0} sessions,
                      last: {v.lastStudied ? new Date(v.lastStudied).toLocaleDateString() : "never"},
                      score: {v.lastScore ?? "—"}%
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Block Overview Cards */}
            {visibleBlocks.length > 0 && (
              <div style={{ padding:"12px 16px 4px" }}>
                {visibleBlocks.map(block => {
                  const blockObjs  = getBlockObjectives(block.id) || [];
                  const blockLecs  = (lecs || []).filter(l => l.blockId === block.id);
                  const isCurrent  = activeBlock && block.id === activeBlock.id;
                  const tc = termColor || block.termColor || t.red;

              return (
                    <div
                      key={block.id}
                      style={{
                        background:t.cardBg,
                        border:"1px solid "+(isCurrent?tc:t.border1),
                        borderRadius:14,
                        padding:"20px 24px",
                        marginBottom:16,
                      }}
                    >
                      {/* Block header */}
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                        <div>
                          <div style={{ fontFamily:SERIF, color:t.text1, fontSize:18, fontWeight:900 }}>
                            {block.name}
                  </div>
                          <div style={{ fontFamily:MONO, color:t.text3, fontSize:11, marginTop:2 }}>
                            {blockLecs.length} lectures · {blockObjs.length} objectives
                        </div>
                      </div>
                        <div style={{ textAlign:"right" }}>
                          {block.status === "completed" && (
                            <span
                              style={{
                                fontFamily:MONO,
                                color:t.statusGood,
                                fontSize:11,
                                background:t.statusGoodBg,
                                padding:"4px 10px",
                                borderRadius:6,
                                border:"1px solid "+t.statusGoodBorder,
                              }}
                            >
                              ✓ Complete
                            </span>
                          )}
                          {isCurrent && block.status !== "completed" && (
                            <span
                              style={{
                                fontFamily:MONO,
                                color:tc,
                                fontSize:11,
                                background:tc+"18",
                                padding:"4px 10px",
                                borderRadius:6,
                              }}
                            >
                              Current
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Main tracker table: one row per lecture */}
                      {(() => {
                        const urgencyColor = {
                          overdue: t.statusBad,
                          soon: t.statusWarn,
                          weak: t.statusWarn,
                          untouched: t.text3,
                          ok: t.statusGood,
                        };
                        const urgencyLabel = {
                          overdue: "● Overdue",
                          soon: "● Due Soon",
                          weak: "● Weak",
                          untouched: "○ Not Started",
                          ok: "✓ OK",
                        };

                        const seenLecIds = new Set();
                        const tableRows = blockLecs
                          .filter(lec => {
                            if (seenLecIds.has(lec.id)) return false;
                            seenLecIds.add(lec.id);
                            return true;
                          })
                          .map(lec => {
                          const perfEntry = getLecPerf(lec, block.id);
                          const rawSessions = perfEntry?.sessions || [];
                          const lecSessions = rawSessions.filter(
                            s => !s.lectureId || s.lectureId === lec.id
                          );
                          const lastSession = lecSessions.slice(-1)[0] || null;
                          const lastStudied = perfEntry?.lastStudied
                            ? new Date(perfEntry.lastStudied)
                            : (lastSession && lastSession.date ? new Date(lastSession.date) : null);
                          const postMCQ = perfEntry?.postMCQScore ?? perfEntry?.lastScore ?? lastSession?.score ?? null;
                          const preSAQ = perfEntry?.preSAQScore ?? null;
                          const confidence = perfEntry?.confidenceLevel ?? null;
                          const nextReview = perfEntry?.nextReview ? new Date(perfEntry.nextReview) : null;
                          const daysUntil = nextReview
                            ? Math.ceil((nextReview - new Date()) / (1000 * 60 * 60 * 24))
                            : null;
                          const sessionCount = lecSessions.length;
                          const firstStudied = perfEntry?.firstStudied ? new Date(perfEntry.firstStudied) : null;

                          const lecObjs = blockObjs.filter(o =>
                            String(o.lectureNumber) === String(lec.lectureNumber) ||
                            o.linkedLecId === lec.id
                          );
                          const rowMastered = lecObjs.filter(o => o.status === "mastered").length;
                          const rowStruggling = lecObjs.filter(o => o.status === "struggling").length;
                          const rowTotal = lecObjs.length;

                          const urgency = !lastStudied
                            ? "untouched"
                            : daysUntil !== null && daysUntil <= 0
                              ? "overdue"
                              : daysUntil !== null && daysUntil <= 3
                                ? "soon"
                                : postMCQ !== null && postMCQ < 60
                                  ? "weak"
                                  : "ok";

                          return {
                            lec,
                            perfEntry,
                            lecSessions,
                            lastStudied,
                            firstStudied,
                            nextReview,
                            daysUntil,
                            preSAQ,
                            postMCQ,
                            confidence,
                            sessionCount,
                            mastered: rowMastered,
                            struggling: rowStruggling,
                            total: rowTotal,
                            urgency,
                          };
                        });

                        const untestedGroups = (computeWeakAreas ? (computeWeakAreas(block.id) || []) : [])
                          .filter(area =>
                            !blockLecs.some(l =>
                              area.activity === ("Lec" + (l.lectureNumber || "")) ||
                              area.lectureTitle === l.lectureTitle
                            )
                          );

                        return (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                              <colgroup>
                                <col style={{ width: 28 }} />
                                <col style={{ width: "35%" }} />
                                <col style={{ width: 100 }} />
                                <col style={{ width: 110 }} />
                                <col style={{ width: 80 }} />
                                <col style={{ width: 100 }} />
                                <col style={{ width: 110 }} />
                                <col style={{ width: 70 }} />
                              </colgroup>
                              <thead>
                                <tr style={{ borderBottom: "2px solid " + t.border1 }}>
                                  {["", "Lecture", "Status", "First Studied", "Last Score", "Confidence", "Next Review", "Sessions"].map(col => (
                                    <th
                                      key={col || "chevron"}
                                      style={{
                                        fontFamily: MONO,
                                        color: t.text3,
                                        fontSize: 10,
                                        letterSpacing: 1,
                                        textAlign: ["", "Last Score", "Confidence", "Sessions"].includes(col) ? "center" : "left",
                                        padding: "8px 8px",
                                        fontWeight: 600,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                      }}
                                    >
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tableRows.map(row => {
                                  const rowKey = block.id + "_" + row.lec.id;
                                  const expanded = expandedRows.has(rowKey);
                                  const sessionsByType = {
                                    deepLearn: row.lecSessions.filter(s => (s.sessionType || "").toLowerCase() === "deeplearn"),
                                    flashcards: row.lecSessions.filter(s => (s.sessionType || "").toLowerCase() === "flashcards"),
                                    quiz: row.lecSessions.filter(s => {
                                      const st = (s.sessionType || "").toLowerCase();
                                      return st === "quiz" || st === "objectivequiz";
                                    }),
                                    blockExam: row.lecSessions.filter(s => (s.sessionType || "").toLowerCase() === "blockexam"),
                                    anki: row.lecSessions.filter(s => (s.sessionType || "").toLowerCase() === "anki"),
                                    other: row.lecSessions.filter(s => !["deeplearn", "flashcards", "quiz", "objectivequiz", "blockexam", "anki"].includes((s.sessionType || "").toLowerCase())),
                                  };
                                  const typeLabels = {
                                    deepLearn: { icon: "🧠", label: "Deep Learn" },
                                    flashcards: { icon: "🃏", label: "Flashcards" },
                                    quiz: { icon: "✅", label: "Quiz" },
                                    blockExam: { icon: "📝", label: "Block Exam" },
                                    anki: { icon: "📇", label: "Anki" },
                                    other: { icon: "📖", label: "Other" },
                                  };
                                  const bestScore = row.lecSessions.length ? Math.max(...row.lecSessions.map(s => s.score || 0)) : null;
                                  const lastScore = row.lecSessions.slice(-1)[0]?.score ?? null;
                                  const totalSessions = row.lecSessions.length;

                                  return (
                                    <React.Fragment key={row.lec.id}>
                                      <tr
                                        onClick={() => totalSessions > 0 && toggleRow(rowKey)}
                                        style={{
                                          borderBottom: "1px solid " + t.border2,
                                          cursor: totalSessions > 0 ? "pointer" : "default",
                                          background: expanded ? t.inputBg : "transparent",
                                          transition: "background 0.15s",
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = t.hoverBg)}
                                        onMouseLeave={e => (e.currentTarget.style.background = expanded ? t.inputBg : "transparent")}
                                      >
                                        <td style={{ padding: "12px 8px", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          {totalSessions > 0 && (
                                            <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10, transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", display: "inline-block" }}>▶</span>
                                          )}
                                        </td>
                                        <td style={{ padding: "12px 8px", overflow: "hidden" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                            {lecTypeBadge ? lecTypeBadge(row.lec.lectureType || "LEC") : <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{row.lec.lectureType || "LEC"}</span>}
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                              <div style={{ fontFamily: MONO, color: t.text1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {(() => {
                                                  const title = (row.lec.lectureTitle || "").trim();
                                                  const fileName = (row.lec.fileName || row.lec.filename || "").replace(/\.pdf$/i, "").trim();
                                                  if (title && title.toLowerCase() !== fileName.toLowerCase()) return title;
                                                  return title || fileName;
                                                })()}
                                              </div>
                                              <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {(row.lec.lectureType || "LEC") + (row.lec.lectureNumber ?? "")}
                                                {row.total > 0 && ` · ${row.mastered}/${row.total} obj`}
                                                {row.struggling > 0 && ` · ⚠${row.struggling}`}
                                                {" "}
                                                {Object.entries(sessionsByType).map(([type, sessions]) =>
                                                  sessions.length > 0 ? typeLabels[type].icon : null
                                                ).filter(Boolean).join(" ")}
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                        <td style={{ padding: "12px 8px", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: urgencyColor[row.urgency] }}>{urgencyLabel[row.urgency]}</span>
                                        </td>
                                        <td style={{ padding: "12px 8px", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          <div style={{ fontFamily: MONO, color: t.text2, fontSize: 12 }}>
                                            {row.firstStudied ? row.firstStudied.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : <span style={{ color: t.text3 }}>—</span>}
                                          </div>
                                          {row.lastStudied && row.firstStudied && row.lastStudied.getTime() !== row.firstStudied.getTime() && (
                                            <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>Last: {row.lastStudied.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                                          )}
                                        </td>
                                        <td style={{ padding: "12px 8px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          {lastScore != null ? (
                                            <div>
                                              <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 900, color: getScoreColor(t, lastScore ?? 0) }}>{lastScore}%</div>
                                              {bestScore !== lastScore && bestScore != null && <div style={{ fontFamily: MONO, color: t.statusGood, fontSize: 9 }}>best {bestScore}%</div>}
                                            </div>
                                          ) : <span style={{ color: t.text3, fontSize: 12 }}>—</span>}
                                        </td>
                                        <td style={{ padding: "12px 8px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          <span style={{ fontFamily: MONO, fontSize: 12, color: row.confidence === "High" ? t.statusGood : row.confidence === "Medium" ? t.statusWarn : row.confidence === "Low" ? t.statusBad : t.text3 }}>
                                            {row.confidence === "High" ? "💪 High" : row.confidence === "Medium" ? "😐 Medium" : row.confidence === "Low" ? "😰 Low" : "—"}
                                          </span>
                                        </td>
                                        <td style={{ padding: "12px 8px", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          {row.nextReview ? (
                                            <span>
                                              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: getUrgencyColor(t, row.daysUntil <= 0 ? "overdue" : row.daysUntil <= 3 ? "soon" : "ok") }}>
                                                {row.daysUntil <= 0 ? "Today" : row.daysUntil === 1 ? "Tomorrow" : "In " + row.daysUntil + "d"}
                                                <div style={{ fontFamily: MONO, color: t.text3, fontSize: 9, fontWeight: 400 }}>{row.nextReview.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                                              </span>
                                              {!isCurrent && row.daysUntil > 7 && (
                                                <span style={{ fontFamily: MONO, fontSize: 9, color: t.statusProgress, background: t.statusProgressBg, padding: "2px 6px", borderRadius: 3, border: "1px solid " + t.statusProgressBg, marginLeft: 6, display: "inline-block", marginTop: 4 }}>
                                                  🔄 Review in {row.daysUntil}d
                                                </span>
                                              )}
                                            </span>
                                          ) : <span style={{ fontFamily: MONO, color: t.text3, fontSize: 11 }}>Not scheduled</span>}
                                        </td>
                                        <td style={{ padding: "12px 8px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>
                                          <span style={{ fontFamily: MONO, color: t.text2, fontSize: 13, fontWeight: 700 }}>{totalSessions || <span style={{ color: t.text3 }}>0</span>}</span>
                                        </td>
                                      </tr>
                                      {expanded && totalSessions > 0 && (
                                        <tr>
                                          <td colSpan={8} style={{ padding: 0 }}>
                                            <div style={{ background: t.inputBg, borderBottom: "1px solid " + t.border1, padding: "12px 16px 12px 40px" }}>
                                              {Object.entries(sessionsByType).map(([type, sessions]) => {
                                                if (!sessions.length) return null;
                                                const { icon, label } = typeLabels[type];
                                                const typeAvg = Math.round(sessions.reduce((a, s) => a + (s.score || 0), 0) / sessions.length);
                                                return (
                                                  <div key={type} style={{ marginBottom: 10 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                                                      <span style={{ fontSize: 13 }}>{icon}</span>
                                                      <span style={{ fontFamily: MONO, color: t.text2, fontSize: 11, fontWeight: 700 }}>{label}</span>
                                                      <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>{sessions.length} session{sessions.length !== 1 ? "s" : ""} · avg {typeAvg}%</span>
                                                    </div>
                                                    {[...sessions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).map((s, si) => (
                                                      <div key={si} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 10px", borderRadius: 7, marginBottom: 3, background: t.cardBg, border: "1px solid " + t.border2, overflow: "hidden" }}>
                                                        <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10, minWidth: 80, flexShrink: 0 }}>{s.date ? new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</div>
                                                        <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 900, minWidth: 40, flexShrink: 0, color: getScoreColor(t, s.score ?? 0) }}>{s.score != null ? s.score + "%" : "—"}</div>
                                                        <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.questionCount ? s.questionCount + " questions" : s.cardCount ? s.cardCount + " cards" : ""}{s.difficulty ? " · " + s.difficulty : ""}</div>
                                                        {s.sessionType === "anki" && (
                                                          <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10, display: "flex", gap: 10, flexShrink: 0, whiteSpace: "nowrap" }}>
                                                            {s.newCards > 0 && <span>+{s.newCards} new</span>}
                                                            {s.reviewCards > 0 && <span>{s.reviewCards} reviews</span>}
                                                            {s.retention && <span>{s.retention}% retention</span>}
                                                            {s.timeSpent && <span>{s.timeSpent} min</span>}
                                                            {s.notes && <span style={{ color: t.text2, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>"{s.notes}"</span>}
                                                          </div>
                                                        )}
                                                        {s.preSAQScore != null && <div style={{ fontFamily: MONO, fontSize: 10, color: t.text3, flexShrink: 0 }}>SAQ {s.preSAQScore}% → MCQ {s.postMCQScore}%</div>}
                                                        {s.confidenceLevel && <div style={{ fontFamily: MONO, fontSize: 10, color: s.confidenceLevel === "High" ? t.statusGood : s.confidenceLevel === "Medium" ? t.statusWarn : t.statusBad, flexShrink: 0 }}>{s.confidenceLevel === "High" ? "💪" : s.confidenceLevel === "Medium" ? "😐" : "😰"} {s.confidenceLevel}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}

                                {untestedGroups.slice(0, 3).map(area => (
                                  <tr
                                    key={area.activity}
                                    style={{ borderBottom: "1px solid " + t.border2, opacity: 0.7 }}
                                  >
                                    <td style={{ padding: "12px 12px" }}>
                                      <div style={{ fontFamily: MONO, color: t.text2, fontSize: 13 }}>
                                        {area.lectureTitle || area.activity}
                                      </div>
                                      <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>
                                        No lecture uploaded · {(area.untested ?? 0)} untested objectives
                                      </div>
                                    </td>
                                    <td style={{ padding: "12px 12px" }}>
                                      <span style={{ fontFamily: MONO, color: t.text3, fontSize: 11 }}>
                                        ○ No lecture
                                      </span>
                                    </td>
                                    <td colSpan={6} style={{ padding: "12px 12px" }}>
                                      <span style={{ fontFamily: MONO, color: t.text3, fontSize: 11 }}>
                                        Upload lecture to start tracking
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {tableRows.length === 0 && untestedGroups.length === 0 && (
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "32px 0",
                                  fontFamily: MONO,
                                  color: t.text3,
                                  fontSize: 13,
                                }}
                              >
                                No lectures uploaded yet for this block.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Study log across all blocks — behind toggle */}
            {globalStudyLog.length > 0 && (
              <div style={{ marginTop: 8, marginLeft: 16, marginRight: 16, marginBottom: 12 }}>
                <button
                  onClick={() => setShowStudyLog(prev => !prev)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: MONO,
                    color: t.text3,
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      transform: showStudyLog ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                      display: "inline-block",
                    }}
                  >
                    ▶
                  </span>
                  {showStudyLog ? "Hide" : "Show"} Recent Study Activity
                </button>
                {showStudyLog && (
                  <div
                    style={{
                      background: t.cardBg,
                      border: "1px solid " + t.border1,
                      borderRadius: 14,
                      padding: "20px 24px",
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: MONO,
                        color: t.text3,
                        fontSize: 9,
                        letterSpacing: 1.5,
                        marginBottom: 14,
                      }}
                    >
                      RECENT STUDY ACTIVITY
                    </div>
                    {globalStudyLog.map((entry, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "9px 0",
                          borderBottom: "1px solid " + t.border2,
                        }}
                      >
                        <div
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: getScoreColor(t, entry.score ?? 0),
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: MONO, color: t.text1, fontSize: 13 }}>
                            {entry.label}
                          </div>
                          <div style={{ fontFamily: MONO, color: t.text3, fontSize: 10, marginTop: 1 }}>
                            {new Date(entry.date).toLocaleDateString("en-US",
                              { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            {entry.questionCount ? ` · ${entry.questionCount}q` : ""}
                            {entry.difficulty ? ` · ${entry.difficulty}` : ""}
                          </div>
                        </div>
                        <div
                          style={{
                            fontFamily: MONO,
                            fontWeight: 900,
                            fontSize: 16,
                            color: getScoreColor(t, entry.score ?? 0),
                          }}
                        >
                          {Math.round(entry.score)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── DIVIDER ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px", padding: "0 16px" }}>
              <div style={{ flex: 1, height: 1, background: t.border1 }} />
              <div style={{ fontFamily: MONO, color: t.text3, fontSize: 9, letterSpacing: 1.5 }}>MANUAL STUDY LOG</div>
              <div style={{ flex: 1, height: 1, background: t.border1 }} />
            </div>

            {/* ── Manual Study Log: two-level grouped table ── */}
            <div style={{ padding: "0 16px 24px" }}>
              {visible.length === 0 && (
                <div style={{ padding: "70px 0", textAlign: "center" }}>
                  <div style={{ fontSize: 38, marginBottom: 12 }}>📋</div>
                  <p style={{ color: t.text5, fontSize: 15 }}>No rows found. Adjust filters or add a new row.</p>
                </div>
              )}
              {visible.length > 0 &&
                (() => {
                  const blockRows = filter === "All" ? visible : visible.filter((r) => r.block === filter);
                  const groups = {};
                  blockRows.forEach((row) => {
                    const key = row.lectureId || row.topic || row.id;
                    if (!groups[key]) {
                      groups[key] = {
                        key,
                        lectureId: row.lectureId,
                        block: row.block,
                        subject: row.subject,
                        topic: row.topic,
                        rows: [],
                      };
                    }
                    groups[key].rows.push(row);
                  });
                  const tc = termColor || t.red;
                  const checkIcons = ["📚", "🎓", "✏️", "👻"];
                  return (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: 24 }} />
                        <col style={{ width: 70 }} />
                        <col style={{ width: 100 }} />
                        <col style={{ width: "30%" }} />
                        <col style={{ width: 80 }} />
                        <col style={{ width: 100 }} />
                        <col style={{ width: 60 }} />
                        <col style={{ width: 28 }} />
                        <col style={{ width: 28 }} />
                        <col style={{ width: 28 }} />
                        <col style={{ width: 28 }} />
                        <col style={{ width: 100 }} />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 60 }} />
                        <col style={{ width: 60 }} />
                        <col style={{ width: 24 }} />
                      </colgroup>
                      <thead>
                        <tr style={{ borderBottom: "2px solid " + t.border1 }}>
                          {COL_HEADS.map((h, i) => (
                            <th
                              key={i}
                              title={COL_TIPS[i]}
                              style={{
                                fontFamily: MONO,
                                fontSize: 11,
                                fontWeight: 600,
                                color: t.text5,
                                letterSpacing: 1,
                                textAlign: [0, 7, 8, 9, 10, 12, 13].includes(i) ? "center" : "left",
                                padding: "8px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(groups).map((group) => {
                          const open = openStudyLogGroups[group.key] !== false;
                          const allChecks = group.rows.map((r) => [
                            r.preRead,
                            r.lecture,
                            r.postReview,
                            r.anki,
                          ]);
                          const mergedChecks = [0, 1, 2, 3].map((i) => allChecks.some((c) => c[i]));
                          const lastStudied = group.rows
                            .map((r) => r.lastStudied)
                            .filter(Boolean)
                            .sort()
                            .slice(-1)[0];
                          const allScores = group.rows.flatMap((r) => r.scores || []).filter((s) => typeof s === "number");
                          const bestScore = allScores.length ? Math.max(...allScores) : null;
                          const confidence = group.rows.find((r) => r.confidence)?.confidence ?? null;
                          const confLabel = confidence ? getConf(confidence).label : null;
                          const sessionCount = group.rows.length;
                          const daysAgo = lastStudied
                            ? Math.floor(
                                (new Date() - new Date(lastStudied)) / (1000 * 60 * 60 * 24)
                              )
                            : null;
                          return (
                            <React.Fragment key={group.key}>
                              <tr
                                onClick={() =>
                                  setOpenStudyLogGroups((p) => ({ ...p, [group.key]: !(p[group.key] !== false) }))
                                }
                                style={{
                                  cursor: "pointer",
                                  background: open ? tc + "08" : t.cardBg,
                                  borderBottom: "1px solid " + t.border1,
                                  transition: "background 0.15s",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = tc + "10")}
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = open ? tc + "08" : t.cardBg)
                                }
                              >
                                <td style={{ padding: "12px 8px", width: 24 }}>
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: tc,
                                      fontSize: 11,
                                      display: "inline-block",
                                      transform: open ? "rotate(90deg)" : "rotate(0deg)",
                                      transition: "transform 0.2s",
                                    }}
                                  >
                                    ▶
                                  </span>
                                </td>
                                <td style={{ padding: "12px 8px" }}>
                                  <span style={{ fontFamily: MONO, color: tc, fontSize: 11, fontWeight: 900 }}>
                                    {group.block}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 8px", overflow: "hidden" }}>
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: t.text3,
                                      fontSize: 11,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      display: "block",
                                    }}
                                  >
                                    {group.subject}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 8px", overflow: "hidden" }}>
                                  <div
                                    title={group.topic}
                                    style={{
                                      fontFamily: MONO,
                                      color: t.text1,
                                      fontSize: 13,
                                      fontWeight: 700,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {group.topic}
                                  </div>
                                  <div
                                    style={{
                                      fontFamily: MONO,
                                      color: t.text3,
                                      fontSize: 10,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {sessionCount} session{sessionCount !== 1 ? "s" : ""}
                                    {bestScore ? ` · best ${bestScore}%` : ""}
                                  </div>
                                </td>
                                <td style={{ padding: "12px 8px" }} />
                                <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                                  <span style={{ fontFamily: MONO, color: t.text2, fontSize: 12 }}>
                                    {lastStudied || "—"}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 8px", textAlign: "center" }}>
                                  {daysAgo !== null && (
                                    <div
                                      style={{
                                        fontFamily: MONO,
                                        fontWeight: 700,
                                        fontSize: 12,
                                        color:
                                          daysAgo <= 1 ? t.statusGood : daysAgo <= 3 ? t.statusWarn : t.statusBad,
                                      }}
                                    >
                                      {daysAgo}d
                                    </div>
                                  )}
                                </td>
                                {[0, 1, 2, 3].map((i) => (
                                  <td key={i} style={{ padding: "12px 8px", textAlign: "center" }}>
                                    <div
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 5,
                                        margin: "0 auto",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 11,
                                        background: mergedChecks[i]
                                          ? checkColors[i] + "20"
                                          : t.inputBg,
                                        border:
                                          "1px solid " +
                                          (mergedChecks[i] ? checkColors[i] : t.border1),
                                      }}
                                    >
                                      {mergedChecks[i] ? (
                                        <span style={{ color: checkColors[i], fontSize: 12 }}>✓</span>
                                      ) : (
                                        <span style={{ color: t.text3, fontSize: 10 }}>
                                          {checkIcons[i]}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                ))}
                                <td style={{ padding: "12px 8px" }}>
                                  <span style={{ fontFamily: MONO, color: t.text3, fontSize: 11 }}>
                                    {group.rows.find((r) => r.ankiDate)?.ankiDate || "—"}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 8px" }}>
                                  {confLabel && (
                                    <span
                                      style={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        color:
                                          confidence >= 5
                                            ? t.statusGood
                                            : confidence >= 3
                                              ? t.statusWarn
                                              : t.statusBad,
                                      }}
                                    >
                                      {confidence >= 5 ? "💪" : confidence >= 3 ? "😐" : "😰"} {confLabel}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "12px 8px", textAlign: "center" }}>
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      color: t.text2,
                                      fontSize: 13,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {sessionCount}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 8px" }}>
                                  {bestScore != null && (
                                    <span
                                      style={{
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        fontWeight: 900,
                                        color:
                                          bestScore >= 80
                                            ? t.statusGood
                                            : bestScore >= 60
                                              ? t.statusWarn
                                              : t.statusBad,
                                      }}
                                    >
                                      {bestScore}%
                                    </span>
                                  )}
                                </td>
                                <td />
                              </tr>
                              {open &&
                                group.rows.map((row) => {
                                  const rowChecks = [
                                    row.preRead,
                                    row.lecture,
                                    row.postReview,
                                    row.anki,
                                  ];
                                  const lastScore =
                                    row.scores && row.scores.length
                                      ? row.scores[row.scores.length - 1]
                                      : null;
                                  return (
                                    <tr
                                      key={row.id}
                                      style={{
                                        background: t.inputBg + "80",
                                        borderBottom: "1px solid " + t.border2,
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = t.hoverBg)}
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.background = t.inputBg + "80")
                                      }
                                    >
                                      <td
                                        style={{
                                          padding: "8px 8px",
                                          borderLeft: "3px solid " + tc + "30",
                                        }}
                                      />
                                      <td style={{ padding: "8px 8px" }}>
                                        <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>
                                          {row.block}
                                        </span>
                                      </td>
                                      <td style={{ padding: "8px 8px" }}>
                                        <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>
                                          {row.subject}
                                        </span>
                                      </td>
                                      <td style={{ padding: "8px 8px 8px 20px", overflow: "hidden" }}>
                                        <div
                                          title={
                                            row.sessionType === "anki"
                                              ? "📇 Anki"
                                              : row.sessionType === "deepLearn"
                                                ? "🧠 Deep Learn"
                                                : row.sessionType === "quiz"
                                                  ? "✅ Quiz"
                                                  : row.sessionType === "blockExam"
                                                    ? "📝 Block Exam"
                                                    : row.topic || "Session"
                                          }
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            minWidth: 0,
                                          }}
                                        >
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              color: t.text3,
                                              fontSize: 10,
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              whiteSpace: "nowrap",
                                              minWidth: 0,
                                            }}
                                          >
                                            {row.sessionType === "anki"
                                              ? "📇 Anki"
                                              : row.sessionType === "deepLearn"
                                                ? "🧠 Deep Learn"
                                                : row.sessionType === "quiz"
                                                  ? "✅ Quiz"
                                                  : row.sessionType === "blockExam"
                                                    ? "📝 Block Exam"
                                                    : row.topic || "Session"}
                                          </span>
                                          {row.autoGenerated && (
                                            <span
                                              style={{
                                                fontFamily: MONO,
                                                fontSize: 8,
                                                color: tc,
                                                background: tc + "18",
                                                padding: "1px 5px",
                                                borderRadius: 3,
                                                border: "1px solid " + tc + "40",
                                              }}
                                            >
                                              AUTO
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ padding: "8px 8px" }}>
                                        <input
                                          type="date"
                                          value={row.lectureDate || ""}
                                          onChange={(e) => upd(row.id, { lectureDate: e.target.value })}
                                          style={{
                                            background: t.inputBg,
                                            border: "1px solid " + t.border1,
                                            borderRadius: 6,
                                            padding: "3px 7px",
                                            color: t.text1,
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            width: "100%",
                                            boxSizing: "border-box",
                                          }}
                                        />
                                      </td>
                                      <td style={{ padding: "8px 8px" }}>
                                        <input
                                          type="date"
                                          value={row.lastStudied || ""}
                                          onChange={(e) => upd(row.id, { lastStudied: e.target.value })}
                                          style={{
                                            background: t.inputBg,
                                            border: "1px solid " + t.border1,
                                            borderRadius: 6,
                                            padding: "3px 7px",
                                            color: t.text1,
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            width: "100%",
                                            boxSizing: "border-box",
                                          }}
                                        />
                                      </td>
                                      <td style={{ padding: "8px 8px", textAlign: "center" }}>
                                        {row.lastStudied &&
                                          (() => {
                                            const d = Math.floor(
                                              (new Date() - new Date(row.lastStudied)) /
                                                (1000 * 60 * 60 * 24)
                                            );
                                            return (
                                              <span
                                                style={{
                                                  fontFamily: MONO,
                                                  fontSize: 11,
                                                  fontWeight: 700,
                                                  color:
                                                    d <= 1 ? t.statusGood : d <= 3 ? t.statusWarn : t.statusBad,
                                                }}
                                              >
                                                {d}d
                                              </span>
                                            );
                                          })()}
                                      </td>
                                      {[0, 1, 2, 3].map((i) => (
                                        <td
                                          key={i}
                                          style={{ padding: "8px 8px", textAlign: "center" }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const next = [...rowChecks];
                                              next[i] = !next[i];
                                              upd(row.id, {
                                                preRead: next[0],
                                                lecture: next[1],
                                                postReview: next[2],
                                                anki: next[3],
                                              });
                                            }}
                                            style={{
                                              width: 24,
                                              height: 24,
                                              borderRadius: 5,
                                              margin: "0 auto",
                                              display: "flex",
                                              border:
                                                "1px solid " +
                                                (rowChecks[i] ? checkColors[i] : t.border1),
                                              background: rowChecks[i]
                                                ? checkColors[i] + "20"
                                                : t.inputBg,
                                              cursor: "pointer",
                                              fontSize: 11,
                                              alignItems: "center",
                                              justifyContent: "center",
                                            }}
                                          >
                                            {rowChecks[i] ? (
                                              <span
                                                style={{
                                                  color: checkColors[i],
                                                  fontSize: 11,
                                                }}
                                              >
                                                ✓
                                              </span>
                                            ) : (
                                              <span
                                                style={{ color: t.text3, fontSize: 9 }}
                                              >
                                                {checkIcons[i]}
                                              </span>
                                            )}
                                          </button>
                                        </td>
                                      ))}
                                      <td style={{ padding: "8px 8px" }}>
                                        <input
                                          type="date"
                                          value={row.ankiDate || ""}
                                          onChange={(e) => upd(row.id, { ankiDate: e.target.value })}
                                          style={{
                                            background: t.inputBg,
                                            border: "1px solid " + t.border1,
                                            borderRadius: 6,
                                            padding: "3px 7px",
                                            color: t.text1,
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            width: "100%",
                                            boxSizing: "border-box",
                                          }}
                                        />
                                      </td>
                                      <td style={{ padding: "8px 8px" }}>
                                        <ConfPicker
                                          value={row.confidence}
                                          onChange={(v) => upd(row.id, { confidence: v })}
                                        />
                                      </td>
                                      <td style={{ padding: "8px 8px", textAlign: "center" }}>
                                        <span
                                          style={{
                                            fontFamily: MONO,
                                            color: t.text2,
                                            fontSize: 12,
                                            fontWeight: 700,
                                          }}
                                        >
                                          ×{row.reps || 1}
                                        </span>
                                      </td>
                                      <td style={{ padding: "8px 8px" }}>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 3,
                                          }}
                                        >
                                          <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={
                                              row.scores?.length
                                                ? row.scores[row.scores.length - 1]
                                                : ""
                                            }
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              const num = v === "" ? null : Number(v);
                                              if (num !== null && !isNaN(num) && num >= 0 && num <= 100) {
                                                const prev = row.scores || [];
                                                upd(row.id, {
                                                  scores:
                                                    prev.length > 0
                                                      ? [...prev.slice(0, -1), num]
                                                      : [num],
                                                });
                                              } else if (v === "") {
                                                upd(row.id, {
                                                  scores: (row.scores || []).slice(0, -1),
                                                });
                                              }
                                            }}
                                            placeholder="—"
                                            style={{
                                              background: "none",
                                              border: "none",
                                              color:
                                                lastScore != null
                                                  ? getScoreColor(t, lastScore)
                                                  : t.text3,
                                              fontFamily: MONO,
                                              fontSize: 12,
                                              fontWeight: 900,
                                              width: 36,
                                              outline: "none",
                                            }}
                                          />
                                          {lastScore != null && (
                                            <span
                                              style={{
                                                fontFamily: MONO,
                                                color: t.text3,
                                                fontSize: 10,
                                              }}
                                            >
                                              %
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ padding: "8px 8px", textAlign: "center" }}>
                                        <button
                                          type="button"
                                          onClick={() => delRow(row.id)}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            color: t.text3,
                                            cursor: "pointer",
                                            fontSize: 13,
                                          }}
                                          onMouseEnter={(e) =>
                                            (e.currentTarget.style.color = t.statusBad)
                                          }
                                          onMouseLeave={(e) =>
                                            (e.currentTarget.style.color = t.text3)
                                          }
                                        >
                                          ✕
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
            </div>

          </div>
        </div>
      )}

      {/* ── ANALYTICS ────────────────────────────────── */}
      {tab==="analytics" && (
        <div style={{ flex:1, padding:"24px 20px", overflowY:"auto" }}>
          <h2 style={{ fontFamily:SERIF, fontSize:24, fontWeight:900, letterSpacing:-0.5, marginBottom:20 }}>
            Grade <span style={{ color:t.statusBad }}>Analytics</span>
          </h2>
          <Analytics rows={rows} />
        </div>
      )}

      {showAdd && <AddModal onAdd={addRow} onClose={()=>setShowAdd(false)} />}
    </div>
  );
}
