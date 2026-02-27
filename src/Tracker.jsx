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

        {/* Topic — inline edit + AUTO badge if synced from session */}
        <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
          <EditCell value={row.topic} onChange={v=>upd(row.id,{topic:v})} placeholder="Lecture / topic…" />
          {(row.reps > 0 && row.lecture && !row.lectureDate) && (
            <span style={{ fontFamily:MONO, fontSize:12, fontWeight:700, color:T.blue, background:T.blueBg, padding:"2px 5px", borderRadius:4, flexShrink:0 }}>AUTO</span>
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
  const [flashLastStudiedRowId, setFlashLastStudiedRowId] = useState(null);
  const timerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const { T: t, isDark } = useTheme();

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

  if (!ready) return (
    <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:60 }}>
      <div style={{ width:36,height:36,border:"3px solid "+t.border1,borderTopColor:t.red,borderRadius:"50%",animation:"rxt-spin 0.85s linear infinite" }}/>
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
            {["All",...BLOCKS].map(b=>(
              <button key={b} onClick={()=>setFilter(b)} style={{
                background:filter===b?(BLOCK_COLORS[b]||t.text4)+"22":"none",
                border:"1px solid "+(filter===b?(BLOCK_COLORS[b]||t.text4):t.border1),
                color:filter===b?(BLOCK_COLORS[b]||t.text1):t.text3,
                padding:"3px 10px",borderRadius:20,cursor:"pointer",fontFamily:MONO,fontSize:13 }}>{b}</button>
            ))}
          </div>

          {/* Urgency filter */}
          <div style={{ display:"flex", gap:3 }}>
            {[["All","All",t.text4],["critical","🔴 Critical",t.red],["overdue","🟠 Overdue",t.amber],["soon","🟡 Soon",t.amber],["ok","✅ OK",t.green]].map(([v,l,c])=>(
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
          {critCount>0 && <div style={{ background:isDark?t.redBg:t.redBg,border:"1px solid "+(isDark?t.red:t.red),borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>🔴</span><span style={{ fontFamily:MONO,color:t.red,fontSize:13,fontWeight:700 }}>{critCount} critical</span></div>}
          {ovdCount>0  && <div style={{ background:isDark?t.amberBg:t.amberBg,border:"1px solid "+(isDark?t.amber:t.amber),borderRadius:6,padding:"3px 10px",display:"flex",gap:4,alignItems:"center" }}><span style={{ fontSize:16 }}>🟠</span><span style={{ fontFamily:MONO,color:t.amber,fontSize:13,fontWeight:700 }}>{ovdCount} overdue</span></div>}
          {[["Rows",rows.length],["Done",rows.filter(r=>r.preRead&&r.lecture&&r.postReview&&r.anki).length]].map(([l,v])=>(
            <div key={l} style={{ background:t.cardBg,borderRadius:6,padding:"3px 10px",display:"flex",gap:5,alignItems:"center", border:"1px solid "+t.border1 }}>
              <span style={{ color:t.text4,fontSize:13 }}>{l}</span>
              <span style={{ color:t.text1,fontSize:13,fontWeight:600 }}>{v}</span>
            </div>
          ))}
          <button onClick={()=>setShowAdd(true)} style={{ background:t.red,border:"none",color:t.text1,padding:"6px 14px",borderRadius:7,cursor:"pointer",fontFamily:MONO,fontSize:13,fontWeight:700 }}>+ Add Row</button>
          {saveMsg&&<span style={{ fontSize:13,color:saveMsg==="saved"?t.green:t.amber }}>{saveMsg==="saving"?"⟳ Saving…":"✓ Saved"}</span>}
        </div>
      </div>

      {/* ── TRACKER TABLE ──────────────────────────────── */}
      {tab==="tracker" && (
        <div style={{ flex:1, overflowX:"auto", overflowY:"auto" }}>
          <div style={{ minWidth:1300 }}>

            {/* Stats bar */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:12, padding:"10px 16px", borderBottom:"1px solid "+t.border2, background:t.cardBg, alignItems:"center", fontFamily:MONO, fontSize:13 }}>
              <span style={{ color:t.text4 }}>Total sessions:</span>
              <span style={{ color:t.text1, fontWeight:600 }}>{totalSessions}</span>
              <span style={{ color:t.text4, marginLeft:8 }}>Overall avg:</span>
              <span style={{ color:overallAvgScore!==null?(overallAvgScore>=70?t.green:overallAvgScore>=60?t.amber:t.red):t.text2, fontWeight:600 }}>{overallAvgScore!==null?overallAvgScore+"%":"—"}</span>
              {mostPracticedSubject && (
                <>
                  <span style={{ color:t.text4, marginLeft:8 }}>Most practiced:</span>
                  <span style={{ color:t.text1, fontWeight:600 }}>{mostPracticedSubject}</span>
                </>
              )}
              {mostImproved && mostImproved.diff > 0 && (
                <>
                  <span style={{ color:t.text4, marginLeft:8 }}>Most improved:</span>
                  <span style={{ color:t.green, fontWeight:600 }}>{mostImproved.row.topic} (+{mostImproved.diff}%)</span>
                </>
              )}
              {needingAttention.length > 0 && (
                <>
                  <span style={{ color:t.text4, marginLeft:8 }}>Needs attention:</span>
                  <span style={{ color:t.red, fontWeight:600 }}>{needingAttention.map(r=>r.topic||r.subject).filter(Boolean).slice(0,5).join(", ")}{needingAttention.length>5?" …":""}</span>
                </>
              )}
            </div>

            {/* Column headers */}
            <div style={{ display:"grid", gridTemplateColumns:GRID, gap:6, padding:"7px 16px",
              borderBottom:"1px solid "+t.border2, background:t.subnavBg, position:"sticky", top:0, zIndex:50, alignItems:"center" }}>
              {COL_HEADS.map((h,i)=>(
                <div key={i} title={COL_TIPS[i]}
                  style={{ fontSize:(i>=7&&i<=10)?16:11,fontWeight:(i>=7&&i<=10)?undefined:600,color:t.text5,letterSpacing:1,textAlign:(i>=7&&i<=10)?"center":"left",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{h}</div>
              ))}
            </div>

              {visible.length===0 && (
              <div style={{ padding:"70px 0",textAlign:"center" }}>
                <div style={{ fontSize:38,marginBottom:12 }}>📋</div>
                <p style={{ color:t.text5,fontSize:15 }}>No rows found. Adjust filters or add a new row.</p>
              </div>
            )}

            {/* Flat (urgency/confidence/score sort) */}
            {sortBy!=="block" && visible.map((row,i)=>(
              <TrackerRow key={row.id} row={row} upd={upd} delRow={delRow} addScore={addScore} clrScore={clrScore} expanded={expanded} setExpanded={setExpanded} flashLastStudied={flashLastStudiedRowId===row.id} index={i} isDark={isDark} />
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
                    <span style={{ color:bc,fontSize:13,fontWeight:700,letterSpacing:1 }}>{block.toUpperCase()}</span>
                    {bCrit>0&&<span style={{ fontFamily:MONO,color:t.red,background:t.redBg,border:"1px solid "+t.red,fontSize:13,padding:"1px 7px",borderRadius:3 }}>🔴 {bCrit} critical</span>}
                    <div style={{ flex:1,height:1,background:bc+"18" }}/>
                    {bAvg!==null&&<span style={{ fontFamily:MONO,color:t.text3,fontSize:13 }}>avg <span style={{ color:t.text1,fontWeight:600 }}>{bAvg}%</span></span>}
                  </div>
                  {Object.entries(subjects).map(([subj,subRows])=>(
                    <div key={subj}>
                      <div style={{ display:"grid",gridTemplateColumns:GRID,gap:6,padding:"6px 16px",background:t.tableHeader,borderBottom:"1px solid " + t.border2,alignItems:"center" }}>
                        <div/><div style={{ color:bc,fontSize:13 }}>{block}</div>
                        <div style={{ color:t.text2,fontSize:13,fontWeight:600 }}>{subj}</div>
                        <div style={{ color:t.text5,fontSize:13 }}>
                          {subRows.length} lecture{subRows.length!==1?"s":""}
                          {avg(subRows.flatMap(r=>r.scores))!==null?" · "+avg(subRows.flatMap(r=>r.scores))+"%":""}
                        </div>
                        <div/><div/><div/>
                        {STEPS.map(s=>{ const d=subRows.filter(r=>r[s.key]).length; return <div key={s.key} style={{ textAlign:"center",color:d===subRows.length?t.green:t.text4,fontSize:13 }}>{d}/{subRows.length}</div>; })}
                        <div/><div/><div/><div/>
                      </div>
                      {subRows.map(row=>(
                        <TrackerRow key={row.id} row={row} upd={upd} delRow={delRow} addScore={addScore} clrScore={clrScore} expanded={expanded} setExpanded={setExpanded} flashLastStudied={flashLastStudiedRowId===row.id} index={visible.findIndex(r=>r.id===row.id)} isDark={isDark} />
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
            Grade <span style={{ color:t.red }}>Analytics</span>
          </h2>
          <Analytics rows={rows} />
        </div>
      )}

      {showAdd && <AddModal onAdd={addRow} onClose={()=>setShowAdd(false)} />}
    </div>
  );
}
