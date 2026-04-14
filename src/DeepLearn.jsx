import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useTheme, getScoreColor } from "./theme";
import { LEVEL_NAMES, LEVEL_COLORS, LEVEL_BG } from "./bloomsTaxonomy";
import { callAI, callAIJSON } from "./aiClient";
import { LECTURE_MARKDOWN_CONTEXT_FOR_AI, LECTURE_MARKDOWN_SYSTEM_INSTRUCTION } from "./aiPromptSnippets";
import { getLecText } from "./lectureText";
import {
  DL_PHASE_ORDER,
  DEEP_LEARN_PHASES,
  migrateDeepLearnPhase,
  normalizeSectionUnderstood,
  normalizeNumericIndexRecord,
  deepLearnPhaseNumber,
  migrateSavedDeepLearnSessionsMap,
} from "./deepLearnPhaseUtils";
import {
  dedupeMcqQuestionChoices,
  mcqResultCountsTowardCorrectScore,
  MCQ_DISTINCT_OPTIONS_RULE,
  MCQ_LAB_NORMAL_RANGES_RULE,
  MCQ_OPTION_UNIQUENESS_CRITICAL,
} from "./mcqUtils";
import { renderAnnotatableStemNodes } from "./stemAnnotationUtils";
import {
  computeDifficultyTier,
  computeDifficultyLabel,
  buildDifficultyInstruction,
  updateSessionStreak,
} from "./difficultyEngine";

const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

function objectivePlainText(o) {
  return String(o?.objective || o?.text || "").trim();
}

function appendStudentNoteToLine(line, o) {
  const notes = o?.personalNotes != null ? String(o.personalNotes).trim() : "";
  if (!notes) return line;
  return `${line}\n  [Student note: ${notes}]`;
}

function formatObjectiveLinesBullet(objectives) {
  const lines = [];
  for (const o of objectives || []) {
    const text = objectivePlainText(o);
    if (!text) continue;
    lines.push(appendStudentNoteToLine(`- ${text}`, o));
  }
  return lines.join("\n");
}

function formatObjectiveLinesNumbered(objectives, max) {
  const lines = [];
  let n = 0;
  const cap = max != null ? max : 999;
  for (const o of objectives || []) {
    if (lines.length >= cap) break;
    const text = objectivePlainText(o);
    if (!text) continue;
    n++;
    lines.push(appendStudentNoteToLine(`${n}. ${text}`, o));
  }
  return lines.join("\n");
}

// Completion activity logger (rxt-completion) for deep learn sessions
function dlGetNextSaturday(fromDate) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const delta = (6 - day + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}
function dlComputeReviewDates(completedDate, confidenceRating, examDate) {
  const base = new Date(completedDate);
  base.setHours(0, 0, 0, 0);
  const exam = examDate ? new Date(examDate) : null;
  if (exam) exam.setHours(0, 0, 0, 0);
  const addDays = (d, days) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const firstIntervalDays = confidenceRating === "good" ? 2 : confidenceRating === "okay" ? 1 : 0;
  const first = addDays(base, firstIntervalDays);
  const saturdaySweep = dlGetNextSaturday(first);
  const oneWeek = addDays(base, 7);
  const twoWeeks = addDays(base, 14);
  const oneMonth = addDays(base, 30);
  const dates = [first, saturdaySweep, oneWeek, twoWeeks, oneMonth];
  if (exam) {
    let m = new Date(oneMonth);
    m.setHours(0, 0, 0, 0);
    while (m <= exam) {
      dates.push(new Date(m));
      m.setMonth(m.getMonth() + 1);
      m.setHours(0, 0, 0, 0);
    }
  }
  const uniq = new Map();
  dates.forEach((d) => {
    if (!d || Number.isNaN(d.getTime())) return;
    if (exam && d > exam) return;
    uniq.set(d.toISOString().slice(0, 10), d);
  });
  return Array.from(uniq.values()).sort((a, b) => a.getTime() - b.getTime());
}
function dlLogDeepLearnActivityToCompletion(lectureId, blockId, confidenceLevel) {
  try {
    if (!lectureId || !blockId) return;
    const date = new Date().toISOString().slice(0, 10);
    const key = `${lectureId}__${blockId}`;
    const store = JSON.parse(localStorage.getItem("rxt-completion") || "{}");
    const existing = store[key] || null;
    const conf =
      confidenceLevel === "High" ? "good" : confidenceLevel === "Low" ? "struggling" : "okay";
    const activity = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : ("act_" + Date.now()),
      date,
      activityType: "deep_learn",
      confidenceRating: conf,
      durationMinutes: null,
      note: null,
    };
    const activityLog = [activity, ...(Array.isArray(existing?.activityLog) ? existing.activityLog : [])];
    const firstCompletedDate = existing?.firstCompletedDate || date;
    const lastActivityDate = date;
    const lastConfidence = conf;
    const reviewDates = dlComputeReviewDates(lastActivityDate, lastConfidence, null).map((d) => d.toISOString().slice(0, 10));
    store[key] = {
      lectureId,
      blockId,
      ankiInRotation: !!existing?.ankiInRotation,
      firstCompletedDate,
      lastActivityDate,
      lastConfidence,
      reviewDates,
      activityLog,
    };
    localStorage.setItem("rxt-completion", JSON.stringify(store));
  } catch (e) {
    console.warn("dlLogDeepLearnActivityToCompletion failed:", e);
  }
}

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

function buildSessionContext(lec, blockId, blockObjs) {
  try {
    const perf = (() => {
      try {
        const stored = JSON.parse(localStorage.getItem("rxt-performance") || "{}");
        return stored[`${lec?.id}__${blockId}`] || null;
      } catch {
        return null;
      }
    })();

    const lecObjs = (blockObjs || []).filter((o) => o?.linkedLecId === lec?.id);

    // Starred objectives — professor-designated mastery requirements (highest priority)
    const starredObjs = lecObjs.filter((o) => o?.starred === true);

    // Weak objectives — struggling or inprogress, sorted worst first
    const weakObjs = lecObjs
      .filter((o) => o?.status === "struggling" || o?.status === "inprogress")
      .sort((a, b) => {
        const order = { struggling: 0, inprogress: 1 };
        return (order[a?.status] || 1) - (order[b?.status] || 1);
      })
      .slice(0, 8);

    // Untested objectives — never seen
    const untestedObjs = lecObjs.filter((o) => !o?.status || o?.status === "untested").slice(0, 5);

    // High bloom objectives
    const highBloom = lecObjs
      .filter((o) => (o?.bloom_level || 1) >= 4)
      .map((o) => o?.objective || o?.text || "")
      .filter(Boolean)
      .slice(0, 4);

    // Build the context string
    const lines = [];

    // Session history
    if (perf && perf.sessions > 0) {
      lines.push(`SESSION HISTORY:`);
      lines.push(`- Total sessions: ${perf.sessions}`);
      lines.push(`- Last score: ${perf.score}%`);
      if (perf.score < 50) {
        lines.push(`- Performance level: WEAK — student is struggling`);
      } else if (perf.score < 70) {
        lines.push(`- Performance level: DEVELOPING — needs reinforcement`);
      } else {
        lines.push(`- Performance level: STRONG — ready for harder questions`);
      }
      if (perf.confidenceLevel) {
        const confLabel = perf.confidenceLevel >= 4 ? "high" : perf.confidenceLevel >= 3 ? "medium" : "low";
        lines.push(`- Student confidence: ${confLabel}`);
      }
    } else {
      lines.push(`SESSION HISTORY: First session — no prior performance data`);
    }

    // ── STARRED (mastery-required) objectives — always surface these first ───
    if (starredObjs.length > 0) {
      lines.push(`\n⭐ MASTERY-REQUIRED OBJECTIVES (professor-designated — MUST be tested every session):`);
      lines.push(`These are the highest-priority objectives for this lecture. Always include at least one`);
      lines.push(`question directly testing a starred objective, regardless of difficulty tier.`);
      starredObjs.slice(0, 10).forEach((o) => {
        const text = o?.objective || o?.text || "";
        const status = o?.status ? ` [${o.status.toUpperCase()}]` : "";
        if (text) lines.push(appendStudentNoteToLine(`- ⭐${status} ${text}`, o));
      });
    }

    // Weak objectives
    if (weakObjs.length > 0) {
      lines.push(`\nWEAK OBJECTIVES (prioritize these):`);
      weakObjs.forEach((o) => {
        const status = o?.status === "struggling" ? "STRUGGLING" : "IN PROGRESS";
        const text = o?.objective || o?.text || "";
        if (text) lines.push(appendStudentNoteToLine(`- [${status}] ${text}`, o));
      });
    }

    // Untested objectives (first session only or if many untested)
    if (untestedObjs.length > 0 && (!perf || perf.sessions <= 1)) {
      lines.push(`\nKEY UNTESTED OBJECTIVES (ensure coverage):`);
      untestedObjs.forEach((o) => {
        const text = o?.objective || o?.text || "";
        if (text) lines.push(appendStudentNoteToLine(`- ${text}`, o));
      });
    }

    // High bloom objectives
    if (highBloom.length > 0) {
      lines.push(`\nHIGH-ORDER OBJECTIVES (Bloom's 4-6, exam-critical):`);
      highBloom.forEach((t) => {
        if (t) lines.push(`- ${t}`);
      });
    }

    // Adaptive difficulty tier — injected so all AI phases share the same calibration
    const tierInfo = computeDifficultyTier(perf);
    lines.push(`\nADAPTIVE DIFFICULTY TIER: ${tierInfo.label.toUpperCase()}`);
    lines.push(`Bloom's target: ${tierInfo.bloomMix}`);
    lines.push(`Question style: ${tierInfo.questionStyle}`);

    return lines.join("\n");
  } catch (e) {
    return "";
  }
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

/** Read-only perf lookup mirroring App.jsx getLecPerf (exact key + lecId__ prefix). */
function readLecPerf(lec, bid, performanceHistory, makeTopicKey) {
  if (!lec?.id || !bid) return null;
  const exactKey = makeTopicKey ? makeTopicKey(lec.id, bid) : `${lec.id}__${bid}`;
  if (performanceHistory?.[exactKey]) return performanceHistory[exactKey];
  const byId = Object.keys(performanceHistory || {}).find((k) => k.startsWith(lec.id + "__"));
  return byId ? performanceHistory[byId] : null;
}

function getWeakObjCount(lecId, blockObjs) {
  return (blockObjs || []).filter(
    (o) => o.linkedLecId === lecId && (o.status === "struggling" || o.status === "inprogress")
  ).length;
}

function getStrugglingObjCount(lecId, blockObjs) {
  return (blockObjs || []).filter((o) => o.linkedLecId === lecId && o.status === "struggling").length;
}

function lecHasSlideContent(lec) {
  const c = getLecText(lec) || lec?.text || "";
  return String(c).trim().length > 0;
}

/** Cross-lecture: merge objectives, content, and perf for 2–3 lectures (readLecPerf / linkedLecId unchanged). */
function buildCrossLectureContext(selectedLecs, blockId, blockObjs, performanceHistory, makeTopicKey) {
  const lecs = (selectedLecs || []).filter(Boolean);
  const allObjs = lecs.flatMap((lec) => (blockObjs || []).filter((o) => o.linkedLecId === lec.id));
  const combinedContent = lecs
    .map((lec) => {
      const title = `${lec.lectureType || "LEC"} ${lec.lectureNumber ?? ""} — ${lec.lectureTitle || lec.title || lec.fileName || ""}`.trim();
      const content = getLecText(lec) || lec.text || "";
      return `=== ${title} ===\n${content}`;
    })
    .join("\n\n");
  const weakObjs = allObjs
    .filter((o) => o.status === "struggling" || o.status === "inprogress")
    .sort((a, b) => {
      const order = { struggling: 0, inprogress: 1 };
      return (order[a.status] || 1) - (order[b.status] || 1);
    });
  const perfContext = lecs.map((lec) => {
    const perf = readLecPerf(lec, blockId, performanceHistory, makeTopicKey);
    const sessionsArr = Array.isArray(perf?.sessions) ? perf.sessions : [];
    const lastS = sessionsArr.length ? sessionsArr[sessionsArr.length - 1] : null;
    const sessCount =
      typeof perf?.sessions === "number" && !Number.isNaN(perf.sessions)
        ? perf.sessions
        : sessionsArr.length;
    return {
      lec,
      sessions: sessCount,
      score: perf?.lastScore ?? perf?.score ?? (lastS?.score != null ? lastS.score : null),
      lastConfidence: perf?.confidenceLevel ?? lastS?.confidenceLevel ?? null,
    };
  });
  const scored = perfContext.filter((p) => p.score != null && Number.isFinite(Number(p.score)));
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((s, p) => s + Number(p.score), 0) / scored.length)
      : null;
  return {
    lecs,
    allObjs,
    weakObjs,
    combinedContent,
    perfContext,
    avgScore,
    totalObjs: allObjs.length,
    weakCount: weakObjs.length,
  };
}

function buildCrossLectureSystemPrompt(crossCtx) {
  if (!crossCtx?.lecs?.length) return "";
  const lecList = crossCtx.lecs
    .map((l) => `- ${l.lectureType || "LEC"} ${l.lectureNumber ?? ""}: ${l.lectureTitle || l.title || l.fileName || ""}`)
    .join("\n");
  const weakList = crossCtx.weakObjs
    .slice(0, 10)
    .map((o) => {
      const lec = crossCtx.lecs.find((l) => l.id === o.linkedLecId);
      const lecLabel = lec ? `${lec.lectureType || "LEC"}${lec.lectureNumber ?? ""}` : "?";
      const base = `- [${(o.status || "UNTESTED").toUpperCase()}][${lecLabel}] ${o.objective || o.text || ""}`;
      return appendStudentNoteToLine(base, o);
    })
    .join("\n");
  const perfSummary = crossCtx.perfContext
    .map((p) => {
      const sc = p.score != null && Number.isFinite(Number(p.score)) ? `${p.score}% (${p.sessions} sessions)` : "not yet studied";
      return `- ${p.lec.lectureType || "LEC"}${p.lec.lectureNumber ?? ""}: ${sc}`;
    })
    .join("\n");
  return `
This is a CROSS-LECTURE Deep Learn session combining multiple
related lectures. The student is studying these together because
the exam will test them in an integrated way.

LECTURES IN THIS SESSION:
${lecList}

PERFORMANCE HISTORY:
${perfSummary}

WEAK OBJECTIVES ACROSS ALL LECTURES:
${weakList || "None identified yet"}

CROSS-LECTURE INSTRUCTION:
- Draw connections between the lectures wherever possible
- Clinical vignettes should require knowledge from 2+ lectures to solve
- Questions should integrate concepts across the selected lectures
- Do not treat these as isolated topics — the student needs to see
  how they connect clinically
- Weight harder questions toward the weakest lecture in the set
`.trim();
}

function dlUid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "act_" + Date.now();
}

/** Mirrors App syncQuizToTracker for cross-lecture completion (local only). */
function dlSyncQuizToTrackerLocal(lec, bid, score) {
  try {
    const completionKey = "rxt-completion";
    const stored = JSON.parse(localStorage.getItem(completionKey) || "{}");
    const key = `${lec.id}__${bid}`;
    const existing = stored[key] || {
      lectureId: lec.id,
      blockId: bid,
      ankiInRotation: false,
      firstCompletedDate: new Date().toISOString(),
      lastActivityDate: null,
      lastConfidence: null,
      reviewDates: [],
      activityLog: [],
    };
    const confidence = score >= 75 ? "good" : score >= 50 ? "okay" : "struggling";
    const now = new Date().toISOString();
    const activityEntry = {
      id: dlUid(),
      date: now,
      activityType: "questions",
      confidenceRating: confidence,
      durationMinutes: null,
      note: `Cross Deep Learn — ${score}% · ${lec.lectureType || "LEC"} ${lec.lectureNumber ?? ""}`,
    };
    const updatedLog = [activityEntry, ...(existing.activityLog || [])];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const intervals =
      confidence === "good" ? [2, 7, 14, 30] : confidence === "okay" ? [1, 5, 10, 21] : [0, 2, 5, 10];
    const reviewDates = intervals.map((d) => {
      const r = new Date(today);
      r.setDate(r.getDate() + d);
      return r.toISOString();
    });
    stored[key] = {
      ...existing,
      lastActivityDate: now,
      lastConfidence: confidence,
      firstCompletedDate: existing.firstCompletedDate || now,
      reviewDates,
      activityLog: updatedLog,
    };
    localStorage.setItem(completionKey, JSON.stringify(stored));
  } catch (e) {
    console.error("dlSyncQuizToTrackerLocal failed:", e);
  }
}

/** Mirrors App updateAllLecObjectivesFromScore for one lecture; call per lec in cross session. */
function dlUpdateAllLecObjectivesFromScore(lecId, bid, overallScore) {
  try {
    const key = "rxt-block-objectives";
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    const blockObjs = stored[bid] || [];
    let changed = false;
    blockObjs.forEach((obj, idx) => {
      if (obj.linkedLecId !== lecId) return;
      if (obj.status === "mastered" && overallScore < 50) return;
      let newStatus;
      if (overallScore >= 80) newStatus = "mastered";
      else if (overallScore >= 55) newStatus = "inprogress";
      else newStatus = "struggling";
      blockObjs[idx] = {
        ...obj,
        status: newStatus,
        lastQuizzed: new Date().toISOString(),
        lastQuizScore: overallScore,
      };
      changed = true;
    });
    if (changed) {
      stored[bid] = blockObjs;
      localStorage.setItem(key, JSON.stringify(stored));
    }
    return changed;
  } catch (e) {
    console.error("dlUpdateAllLecObjectivesFromScore failed:", e);
    return false;
  }
}

function finalizeCrossSession(crossCtx, sessionResults, blockId, makeTopicKey, mcqResults) {
  if (!crossCtx?.lecs?.length || !blockId) return;
  const perfKey = "rxt-performance";
  const storedPerf = JSON.parse(localStorage.getItem(perfKey) || "{}");
  const correct = (mcqResults || []).filter((r) => mcqResultCountsTowardCorrectScore(r)).length;
  const total = (mcqResults || []).length;
  const score =
    sessionResults?.score != null
      ? sessionResults.score
      : total > 0
        ? Math.round((correct / total) * 100)
        : 0;
  const now = new Date().toISOString();
  const crossIds = crossCtx.lecs.map((l) => l.id);

  crossCtx.lecs.forEach((lec) => {
    const topicKey = makeTopicKey ? makeTopicKey(lec.id, blockId) : `${lec.id}__${blockId}`;
    const existing = storedPerf[topicKey] || { sessions: [] };
    const existingSessions = Array.isArray(existing.sessions) ? existing.sessions : [];
    const sessionRecord = {
      score,
      date: now,
      startedAt: now,
      completedAt: now,
      questionCount: total,
      difficulty: computeDifficultyLabel(storedPerf[topicKey] || null),
      sessionType: "cross_lecture",
      lectureId: lec.id,
      blockId,
      topicKey,
      lectureType: lec.lectureType ?? null,
      lectureNumber: lec.lectureNumber ?? null,
      lectureName: lec.lectureTitle || lec.fileName || null,
      preSAQScore: sessionResults?.preSAQScore ?? null,
      postMCQScore: sessionResults?.postMCQScore ?? score,
      confidenceLevel: sessionResults?.confidenceLevel ?? null,
      crossLectureIds: crossIds,
    };
    storedPerf[topicKey] = {
      ...existing,
      sessions: [...existingSessions, sessionRecord].slice(-50),
      lastStudied: now,
      firstStudied: existing.firstStudied || now,
      lastScore: score,
      lectureId: lec.id,
      blockId,
      lectureType: sessionRecord.lectureType ?? existing.lectureType,
      lectureNumber: sessionRecord.lectureNumber ?? existing.lectureNumber,
      lectureName: sessionRecord.lectureName ?? existing.lectureName,
      confidenceLevel: sessionRecord.confidenceLevel ?? existing.confidenceLevel,
    };
    dlSyncQuizToTrackerLocal(lec, blockId, score);
    dlLogDeepLearnActivityToCompletion(lec.id, blockId, sessionResults?.confidenceLevel);
    dlUpdateAllLecObjectivesFromScore(lec.id, blockId, score);
  });

  try {
    localStorage.setItem(perfKey, JSON.stringify(storedPerf));
  } catch (e) {
    console.warn("finalizeCrossSession perf write failed:", e);
  }
  window.dispatchEvent(new CustomEvent("rxt-completion-updated"));
  window.dispatchEvent(new CustomEvent("rxt-objectives-updated"));
}

function crossLectureTitleLine(lecs) {
  const parts = (lecs || []).map((l) => `${l.lectureType || "LEC"} ${l.lectureNumber ?? ""}`.trim());
  return `Cross-lecture: ${parts.join(" + ")}`;
}

function dlLecturePillColorFromLec(l) {
  const u = String(l?.lectureType || "LEC").toUpperCase();
  if (u.startsWith("DLA")) return "#6366f1";
  if (u.startsWith("LEC")) return "#60a5fa";
  if (u.startsWith("SG")) return "#a78bfa";
  if (u.startsWith("TBL")) return "#f59e0b";
  return "#64748b";
}

const DL_TYPE_ORDER = { DLA: 0, LEC: 1, SG: 2, TBL: 3 };

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
    return { mode: "biochemistry", label: "Biochemistry & Pathways", icon: "⚗️", recommended: ["deepLearn", "flashcards", "mcq"], avoid: [], reason: "Biochemistry pathways need step-by-step mechanism work, spaced recall, and application questions.", color: "#f59e0b" };
  }
  if (/\bphys|physiol|homeosta|pressure|volume|flow|cardiac|respirat|renal|filtrat|hormonal|feedback|regulation/i.test(allText)) {
    return { mode: "physiology", label: "Physiology", icon: "❤️", recommended: ["deepLearn", "mcq"], avoid: [], reason: "Physiology needs clinical reasoning and mechanism-based deep learning.", color: "#ef4444" };
  }
  if (/\bpath|disease|disorder|syndrome|lesion|tumor|inflam|necrosis|infarct|diagnosis/i.test(allText)) {
    return { mode: "pathology", label: "Pathology", icon: "🧬", recommended: ["deepLearn", "mcq", "flashcards"], avoid: [], reason: "Pathology combines mechanisms with clinical presentations — Deep Learn is ideal.", color: "#f97316" };
  }
  return { mode: "clinical", label: "Clinical Sciences", icon: "🏥", recommended: ["deepLearn", "mcq"], avoid: [], reason: "Mixed clinical content works well with Deep Learn and MCQ practice.", color: "#60a5fa" };
}

// ── Deep Learn Config (unified lecture list + mode filter) ───────────────────
function DeepLearnConfig({
  blockId,
  lecs,
  blockObjectives,
  questionBanksByFile,
  buildQuestionContext,
  detectStudyMode: detectStudyModeProp,
  performanceHistory = {},
  makeTopicKey,
  onStart,
  T,
  tc,
  preselectLecId = null,
}) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const detectStudyModeFn = detectStudyModeProp || detectStudyMode;

  const topicPool = useMemo(() => {
    const topics = [];
    (lecs || []).forEach((lec) => {
      topics.push({
        id: lec.id + "_full",
        label: lec.lectureTitle || lec.fileName || "Lecture " + (lec.lectureNumber || ""),
        sublabel: (lec.lectureType || "Lec") + (lec.lectureNumber || ""),
        source: "lecture",
        lecId: lec.id,
        weak: false,
      });
    });
    return topics;
  }, [lecs]);

  const [selected, setSelected] = useState(() => {
    const firstLec = topicPool.find((t) => t.source === "lecture");
    return firstLec ? [firstLec.id] : [];
  });
  const [sessionType, setSessionType] = useState("deep");
  const didInitSelectionRef = useRef(false);
  useEffect(() => {
    if (!topicPool.length) return;
    if (preselectLecId) {
      const tid = preselectLecId + "_full";
      if (topicPool.some((t) => t.id === tid)) {
        didInitSelectionRef.current = true;
        queueMicrotask(() => setSelected([tid]));
        return;
      }
    }
    if (didInitSelectionRef.current) return;
    didInitSelectionRef.current = true;
    queueMicrotask(() =>
      setSelected((prev) => {
        if (prev.length > 0) return prev;
        const firstLec = topicPool.find((t) => t.source === "lecture");
        return firstLec ? [firstLec.id] : [];
      })
    );
  }, [topicPool, preselectLecId]);

  const toggleTopic = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedTopics = topicPool.filter((t) => selected.includes(t.id));

  const visibleLectures = useMemo(() => {
    const blockLecs = [...(lecs || [])];
    const scoreFor = (lec) => {
      const perf = readLecPerf(lec, blockId, performanceHistory, makeTopicKey);
      const n = perf?.lastScore ?? perf?.sessions?.slice(-1)[0]?.score;
      return Number.isFinite(n) ? n : 0;
    };
    const sessCount = (lec) => {
      const perf = readLecPerf(lec, blockId, performanceHistory, makeTopicKey);
      return perf?.sessions?.length ?? 0;
    };

    if (sessionType === "weak") {
      const filtered = blockLecs.filter((lec) => {
        const w = getWeakObjCount(lec.id, blockObjectives);
        const perf = readLecPerf(lec, blockId, performanceHistory, makeTopicKey);
        const sc = scoreFor(lec);
        const nSess = sessCount(lec);
        return w > 0 || sc < 70 || nSess === 0;
      });
      return filtered.sort(
        (a, b) => getWeakObjCount(b.id, blockObjectives) - getWeakObjCount(a.id, blockObjectives)
      );
    }

    if (sessionType === "deep") {
      return blockLecs.sort((a, b) => {
        const ta = String(a.lectureType || "LEC").toUpperCase();
        const tb = String(b.lectureType || "LEC").toUpperCase();
        const oa = DL_TYPE_ORDER[ta] ?? 99;
        const ob = DL_TYPE_ORDER[tb] ?? 99;
        if (oa !== ob) return oa - ob;
        const na = parseInt(String(a.lectureNumber ?? 0), 10) || 0;
        const nb = parseInt(String(b.lectureNumber ?? 0), 10) || 0;
        return na - nb;
      });
    }

    // mixed — urgency: struggling count, low score, untested (0 sessions), then good
    return blockLecs.sort((a, b) => {
      const sa = getStrugglingObjCount(a.id, blockObjectives);
      const sb = getStrugglingObjCount(b.id, blockObjectives);
      if (sa !== sb) return sb - sa;
      const sca = scoreFor(a);
      const scb = scoreFor(b);
      if (sca !== scb) return sca - scb;
      const na = sessCount(a);
      const nb = sessCount(b);
      if (na !== nb) return na - nb;
      return (a.lectureTitle || "").localeCompare(b.lectureTitle || "");
    });
  }, [lecs, blockId, blockObjectives, performanceHistory, makeTopicKey, sessionType]);

  const visibleTopicIds = useMemo(
    () => new Set(visibleLectures.map((l) => l.id + "_full")),
    [visibleLectures]
  );

  const selectedInView = selected.filter((id) => visibleTopicIds.has(id)).length;

  const aiContext = useMemo(() => {
    if (!buildQuestionContext || !blockId) return null;
    const first = selectedTopics[0] || topicPool[0];
    return buildQuestionContext(blockId, first?.lecId ?? null, questionBanksByFile || {}, "deeplearn");
  }, [buildQuestionContext, blockId, selectedTopics, topicPool, questionBanksByFile]);

  const styleGuideCount = aiContext?.relevantQs?.length ?? 0;

  const slidesOkForSelection = useMemo(() => {
    if (!selectedTopics.length) return null;
    return selectedTopics.every((t) => {
      const lec = lecs.find((l) => l.id === t.lecId);
      return lec && lecHasSlideContent(lec);
    });
  }, [selectedTopics, lecs]);

  const targetedObjectiveCount = useMemo(() => {
    const ids = new Set(selectedTopics.map((t) => t.lecId).filter(Boolean));
    return (blockObjectives || []).filter((o) => ids.has(o.linkedLecId)).length;
  }, [selectedTopics, blockObjectives]);

  const selectedLec = lecs.find((l) => l.id === selectedTopics[0]?.lecId);
  const studyMode = selectedLec
    ? detectStudyModeFn(selectedLec, (blockObjectives || []).filter((o) => o.linkedLecId === selectedLec.id))
    : null;
  const deepLearnWarning = studyMode?.avoid?.includes("deepLearn");

  const sectionLabel =
    sessionType === "weak"
      ? { text: "△ WEAK LECTURES", color: "#633806" }
      : sessionType === "deep"
        ? { text: "LECTURES", color: T.text3 }
        : { text: "ALL TOPICS", color: T.text3 };

  const nSel = selected.length;
  const startLabel =
    nSel === 0 ? "Select a lecture to begin" : nSel === 1 ? "Start Deep Learn →" : `Start Deep Learn — ${nSel} lectures →`;

  const bloomChip = (() => {
    const selectedObjs = selectedTopics.flatMap((t) =>
      t.lecId ? (blockObjectives || []).filter((o) => o.linkedLecId === t.lecId) : []
    );
    if (!selectedObjs.length) return null;
    const avgBloom = Math.round(
      selectedObjs.reduce((s, o) => s + (o.bloom_level ?? 2), 0) / selectedObjs.length
    );
    const tip =
      avgBloom <= 2
        ? "Brain dump + Read-Recall will be most valuable."
        : avgBloom <= 4
          ? "Patient Case + Algorithm phases are key."
          : "Full sandwich — evaluation & synthesis.";
    const shortTip = tip.length > 56 ? tip.slice(0, 54) + "…" : tip;
    const levelName = LEVEL_NAMES[avgBloom] || "Understand";
    return `L${avgBloom} ${levelName} avg · ${shortTip}`;
  })();

  const dividerStyle = { height: 1, background: "var(--color-border-tertiary, " + T.border2 + ")", margin: "4px 0" };

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {nSel > 3 && (
        <div
          style={{
            background: T.statusWarnBg,
            border: "1px solid " + T.statusWarnBorder,
            borderRadius: 10,
            padding: "12px 14px",
            fontFamily: MONO,
            color: T.statusWarn,
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          Select 2–3 lectures for best results — too many reduces depth
        </div>
      )}
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

      <div style={dividerStyle} />

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: sectionLabel.color,
            }}
          >
            {sectionLabel.text}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: T.text2 }}>{selectedInView} selected</span>
            <button
              type="button"
              onClick={() => {
                setSelected((prev) => {
                  const add = visibleLectures.map((l) => l.id + "_full").filter((id) => !prev.includes(id));
                  return [...prev, ...add];
                });
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 11,
                color: T.text3,
              }}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelected([])}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 11,
                color: T.text3,
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {visibleLectures.map((lec) => {
            const tid = lec.id + "_full";
            const isSel = selected.includes(tid);
            const perf = readLecPerf(lec, blockId, performanceHistory, makeTopicKey);
            const nSess = perf?.sessions?.length ?? 0;
            const score = perf?.lastScore ?? perf?.sessions?.slice(-1)[0]?.score ?? 0;
            const hasScore = nSess > 0 && Number.isFinite(score);
            const weakN = getWeakObjCount(lec.id, blockObjectives);
            const strugN = getStrugglingObjCount(lec.id, blockObjectives);
            const barColor = !hasScore ? "transparent" : score >= 70 ? "#639922" : score >= 50 ? "#BA7517" : "#E24B4A";
            const fillW = hasScore ? Math.min(48, (score / 100) * 48) : 0;
            return (
              <div
                key={tid}
                role="button"
                tabIndex={0}
                onClick={() => toggleTopic(tid)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleTopic(tid);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 44,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                  background: isSel ? "#EEEDFE" : "var(--color-background-primary, " + T.cardBg + ")",
                  border: isSel ? "1.5px solid #7F77DD" : "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                  borderRadius: "var(--border-radius-md, 8px)",
                  cursor: "pointer",
                  marginBottom: 6,
                  transition: "border-color 0.12s ease",
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 4,
                    border: isSel ? "1.5px solid #7F77DD" : "1.5px solid var(--color-border-secondary, " + T.border1 + ")",
                    background: isSel ? "#7F77DD" : "var(--color-background-primary, " + T.cardBg + ")",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isSel ? <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>✓</span> : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: isSel ? "#3C3489" : "var(--color-text-primary, " + T.text1 + ")",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: MONO,
                    }}
                  >
                    {lec.lectureTitle || lec.fileName || "Lecture"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-tertiary, " + T.text3 + ")",
                      marginTop: 2,
                      fontFamily: MONO,
                    }}
                  >
                    {(lec.lectureType || "LEC")} {lec.lectureNumber ?? ""}
                    {lec.weekNumber != null ? ` · Week ${lec.weekNumber}` : ""}
                    {nSess > 0 ? ` · ${nSess} session${nSess !== 1 ? "s" : ""}` : " · First session"}
                  </div>
                </div>
                {weakN > 0 ? (
                  <div
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      padding: "2px 7px",
                      borderRadius: 20,
                      fontFamily: MONO,
                      fontWeight: 600,
                      background: strugN > 0 ? "#FCEBEB" : "#FAEEDA",
                      color: strugN > 0 ? "#A32D2D" : "#633806",
                    }}
                  >
                    △ {weakN} weak
                  </div>
                ) : null}
                <div
                  style={{
                    width: 48,
                    height: 4,
                    flexShrink: 0,
                    borderRadius: 2,
                    background: "var(--color-background-tertiary, " + T.border2 + ")",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ width: fillW, height: "100%", borderRadius: 2, background: barColor }} />
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    flexShrink: 0,
                    minWidth: 32,
                    textAlign: "right",
                    color: hasScore ? barColor : "var(--color-text-tertiary, " + T.text3 + ")",
                  }}
                >
                  {hasScore ? `${Math.round(score)}%` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={dividerStyle} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {styleGuideCount > 0 ? (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 20,
              background: "var(--color-background-secondary, " + T.inputBg + ")",
              border: "1px solid var(--color-border-secondary, " + T.border1 + ")",
              color: "var(--color-text-secondary, " + T.text2 + ")",
            }}
          >
            ✓ {styleGuideCount} questions as style guide
          </span>
        ) : null}
        {selectedTopics.length > 0 ? (
          slidesOkForSelection ? (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 20,
                background: "var(--color-background-secondary, " + T.inputBg + ")",
                border: "1px solid var(--color-border-secondary, " + T.border1 + ")",
                color: "var(--color-text-secondary, " + T.text2 + ")",
              }}
            >
              ✓ Lecture slides loaded
            </span>
          ) : (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 20,
                background: "#FCEBEB",
                color: "#A32D2D",
                border: "0.5px solid #F09595",
              }}
            >
              ✕ No lecture slides
            </span>
          )
        ) : null}
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 20,
            background: "var(--color-background-secondary, " + T.inputBg + ")",
            border: "1px solid var(--color-border-secondary, " + T.border1 + ")",
            color: "var(--color-text-secondary, " + T.text2 + ")",
          }}
        >
          ✓ {targetedObjectiveCount} objectives targeted
        </span>
        {bloomChip ? (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: "var(--border-radius-md, 8px)",
              background: "#E6F1FB",
              color: "#0C447C",
              border: "0.5px solid #85B7EB",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={bloomChip}
          >
            {bloomChip}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        disabled={selected.length === 0}
        onClick={() => onStart({ sessionType, selectedTopics, blockId })}
        style={{
          width: "100%",
          padding: 14,
          fontSize: 15,
          fontWeight: 500,
          fontFamily: SERIF,
          background: selected.length === 0 ? "var(--color-background-tertiary, " + T.border2 + ")" : "#E24B4A",
          color: selected.length === 0 ? "var(--color-text-tertiary, " + T.text3 + ")" : "#fff",
          border: "none",
          borderRadius: "var(--border-radius-md, 10px)",
          marginTop: 4,
          cursor: selected.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        {startLabel}
      </button>
    </div>
  );
}

async function generateSAQs(lectureContent, blockObjectives, lectureTitle, patientCaseText, lec, blockId, crossAugment = null) {
  const buildObjectiveFallbackQuestions = () => {
    const objs = (blockObjectives || []).slice(0, 3);
    return objs
      .map((obj) => {
        const text = String(obj.objective || obj.text || "").trim();
        const q =
          text.length > 5
            ? text
            : `Review a key learning objective for ${(lectureTitle || "this topic").slice(0, 48)}.`;
        return {
          q,
          keyPoints: "Think about the key mechanism and clinical significance",
          objectiveText: text,
          lectureTags: null,
          isFallback: true,
        };
      })
      .filter((item) => (item.q || "").length > 5);
  };

  try {
    const lecObjs = (blockObjectives || [])
      .slice(0, 5)
      .map((o) => {
        const t = (o.objective || o.text || "").slice(0, 60);
        if (t.length < 3) return null;
        return appendStudentNoteToLine(`- ${t}`, o);
      })
      .filter(Boolean)
      .join("\n");
    const sessionContext = buildSessionContext(lec, blockId, blockObjectives);
    const crossPre = crossAugment?.systemPrefix ? crossAugment.systemPrefix + "\n\n" : "";
    const qShape = crossAugment
      ? `{"q":[{"question":"<text>","lectureTags":["DLA5","LEC6"]},...]}

Each item may be a string OR an object with "question" and optional "lectureTags" (short labels like DLA5, LEC6).`
      : `{"q":["<question 1>","<question 2>","<question 3>"]}`;
    const systemPrompt =
      crossPre +
      `${LECTURE_MARKDOWN_SYSTEM_INSTRUCTION}

You are a medical school tutor. You MUST generate exactly 3 questions.
Respond ONLY with raw JSON, no markdown, no backticks, no extra text.
You MUST include exactly 3 items in the array — not 1, not 2, exactly 3:
${qShape}

${LECTURE_MARKDOWN_CONTEXT_FOR_AI}

---
STUDENT CONTEXT:
${sessionContext}
---`;
    const lectureSlice = (lectureContent || "").trim().slice(0, 4000);
    const userPrompt =
      `Lecture: ${(lectureTitle || "Medical Lecture").slice(0, 60)}
${lectureSlice ? `Lecture material (may include markdown):\n${lectureSlice}\n\n` : ""}Objectives:
${lecObjs || "Key concepts from the lecture."}

Instruction:
Generate questions weighted toward the weak and struggling objectives in the student context.
If any weak/struggling objectives exist, at least 2 of the 3 questions must directly address a weak or struggling objective.
Calibrate difficulty to the ADAPTIVE DIFFICULTY TIER shown in STUDENT CONTEXT — match the Bloom's distribution and question style specified there exactly.` +
      (crossAugment?.userSuffix ? "\n\n" + crossAugment.userSuffix : "");

    const jsonFallback = { q: [] };
    let parsed = await callAIJSON(systemPrompt, userPrompt, jsonFallback, 2000);
    if (Array.isArray(parsed)) parsed = { q: parsed };
    if (!parsed || typeof parsed !== "object") parsed = { q: [] };

    const rawQuestions = parsed?.q ?? parsed?.questions ?? [];
    const rawArray = Array.isArray(rawQuestions) ? rawQuestions : rawQuestions != null ? [rawQuestions] : [];
    console.log("generateSAQs raw result:", rawArray.length ? "ok" : "empty", "questions count:", rawArray.length);

    const objList = (blockObjectives || []).slice(0, 5);
    let questions = rawArray
      .map((qText, i) => ({
        q: typeof qText === "string" ? qText : (qText?.q ?? qText?.question ?? ""),
        keyPoints: typeof qText === "object" && qText != null
          ? (Array.isArray(qText.keyPoints) ? qText.keyPoints.join(", ") : (qText.keyPoints ?? qText.key_points ?? ""))
          : "",
        objectiveText: objList[i]?.objective || objList[i]?.text || "",
        lectureTags: Array.isArray(qText?.lectureTags) ? qText.lectureTags : qText?.lecture_tags || null,
        isFallback: !!qText?.isFallback,
      }))
      .filter((item) => (item.q || "").length > 5);

    if (!questions.length) {
      console.warn("SAQ generation failed — using fallback questions");
      questions = buildObjectiveFallbackQuestions();
    }
    console.log("setSaqs called with:", questions.length, "questions");
    return questions;
  } catch (err) {
    console.error("generateSAQs error:", err);
    return buildObjectiveFallbackQuestions();
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

async function generatePatientCase(lectureContent, objectives, lectureTitle, lec, blockId, crossAugment = null) {
  try {
    const sessionContext = buildSessionContext(lec, blockId, objectives);
    const crossPre = crossAugment?.systemPrefix ? crossAugment.systemPrefix + "\n\n" : "";
    const systemPrompt =
      crossPre +
      "You are a medical education expert. Create a specific, realistic clinical vignette. Return ONLY this JSON (no markdown): {\"case\": \"...\", \"focus\": \"...\"}" +
      `\n\n---\nSTUDENT CONTEXT:\n${sessionContext}\n---`;
    const user =
      `Lecture topic: ${lectureTitle || "Medical Lecture"}
Key objectives: ${(objectives || [])
        .slice(0, 3)
        .map((o) => {
          const t = o.objective || o.text || "";
          if (!t) return "";
          return appendStudentNoteToLine(t, o).replace(/\n/g, " ");
        })
        .filter(Boolean)
        .join("; ")}
Lecture content excerpt: ${(lectureContent || "").slice(0, 1500)}

Write a patient case scaled to the ADAPTIVE DIFFICULTY TIER in STUDENT CONTEXT:
- FOUNDATIONAL tier: 2-3 sentences, straightforward presentation, one clear finding
- DEVELOPING tier: 3-4 sentences, one mechanism to connect, mild complexity
- ADVANCED tier: 4-5 sentences, include vitals + one lab value, requires two-step reasoning
- EXAM tier: 5-6 sentences, vitals + labs + exam findings, third-order reasoning required

All tiers:
- Feature a SPECIFIC patient (age, sex, chief complaint)
- Symptoms/signs DIRECTLY tied to the anatomy or pathology in this lecture
- NOT generic — specific to ${lectureTitle || "this topic"}

Design the case to anchor the weak objectives listed in STUDENT CONTEXT. Use the vignette to build a clinical mental model around those struggling areas.

Return ONLY: {"case": "specific patient case here", "focus": "specific thing to look for"}` +
      (crossAugment?.userSuffix ? "\n\n" + crossAugment.userSuffix : "");
    const text = await callAI(systemPrompt, user, 1800);
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

function FirstPassWalkthrough(props) {
  const {
    lec,
    lectureContent,
    lecObjectives: lecObjectivesProp,
    blockId,
    lecId,
    lectureNumber,
    lectureType,
    mergedFrom,
    getBlockObjectives,
    T,
  } = props;

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

  const MONO = "'DM Mono','Courier New',monospace";
  console.log("Walkthrough — lectureContent length:", lectureContent?.length);
  console.log("Walkthrough — objectives for this section:", objectives?.length, objectives?.slice(0, 2).map((o) => o?.objective?.slice(0, 40)));

  const teachingMap = lec?.teachingMap;
  const mapSections = teachingMap?.sections || [];
  const useTeachingMap = mapSections.length > 0;
  const lectureText = (lectureContent || "").trim();

  if (objectives.length === 0 && !lectureContent?.trim() && !useTeachingMap) {
    return (
      <div style={{ padding: 16, background: "#fff8ee", border: "1px solid #f59e0b", borderRadius: 10 }}>
        <div style={{ fontFamily: MONO, color: "#d97706", fontWeight: 700, marginBottom: 8 }}>No objectives found for this lecture.</div>
        <div style={{ fontSize: 13, color: "#555" }}>Re-upload the PDF to extract objectives.</div>
      </div>
    );
  }

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

  return <FirstPassWalkthroughInner {...props} objectives={objectives} />;
}

function FirstPassWalkthroughInner({
  lec,
  lectureContent,
  objectives,
  blockId: _blockId,
  lecId: _lecId,
  lectureNumber: _lectureNumber,
  lectureType: _lectureType,
  mergedFrom: _mergedFrom,
  getBlockObjectives: _getBlockObjectives,
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
  const [sectionThought, setSectionThought] = useState("");
  const [showTakeaway, setShowTakeaway] = useState(false);
  const [sectionData, setSectionData] = useState(null);
  const [loading, setLoading] = useState(false);

  const teachingMap = lec?.teachingMap;
  const mapSections = teachingMap?.sections || [];
  const useTeachingMap = mapSections.length > 0;

  const allObjs = objectives?.length > 0 ? objectives : null;
  const contentChunks =
    !allObjs && lectureContent
      ? (() => {
          const sections = lectureContent
            .split(/\n(?=[A-Z][^a-z\n]{10,}|#{1,3}\s)/)
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
      sectionObjs.length > 0 ? formatObjectiveLinesBullet(sectionObjs) : "Key concepts from the lecture content below.";
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

    const systemPrompt = `${LECTURE_MARKDOWN_SYSTEM_INSTRUCTION}

You are an expert medical school tutor doing a first-pass teaching session.
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
${LECTURE_MARKDOWN_CONTEXT_FOR_AI}

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
  onAppendObjectiveNote,
  lec,
  lectureContent,
  performanceHistory,
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
  initialTeachingSection,
  initialSectionExplanation,
  initialSectionUnderstood,
  initialStructureSaqAttempts,
  initialRecallStep,
  crossCtx = null,
  skipIntroPrep = false,
  deeplinkObjectiveId = null,
}) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

  // Phase state machine
  // Phases: "prime" | "teach" | "patient" | "selftest" | "gaps" | "apply" | "summary"
  const [phase, setPhase] = useState(migrateDeepLearnPhase(initialPhase));
  const [prepComplete, setPrepComplete] = useState(() => Boolean(resuming || skipIntroPrep));
  useEffect(() => {
    if (resuming || prepComplete) return;
    if (typeof window === "undefined") return;

    const onKeyDown = (e) => {
      if (e.key !== "Enter") return;
      const el = typeof document !== "undefined" ? document.activeElement : null;
      const tag = el?.tagName ? String(el.tagName).toLowerCase() : "";
      const isEditable =
        tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || el?.isContentEditable;
      if (isEditable) return;

      e.preventDefault();
      setPrepComplete(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prepComplete, resuming]);
  const [loading, setLoading] = useState(false);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const [patientCase, setPatientCase] = useState(() => {
    if (initialPatientCase == null) return null;
    const e = extractCaseAndFocusFromRaw(initialPatientCase);
    return e.case ? e : null;
  });
  const [structureContent, setStructureContent] = useState(initialStructureContent ?? null);
  const [algorithm] = useState(initialAlgorithm ?? null);
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
  const [questionsError, setQuestionsError] = useState(null);
  const [mcqGenerationError, setMcqGenerationError] = useState(null);
  const [structureQuestionsError, setStructureQuestionsError] = useState(null);
  const [structureSaqQuestions, setStructureSaqQuestions] = useState(initialStructureSaqQuestions ?? []);
  const [structureSaqAnswers, setStructureSaqAnswers] = useState(initialStructureSaqAnswers ?? {});
  const [structureSaqEvals, setStructureSaqEvals] = useState(initialStructureSaqEvals ?? {});
  const [structureSaqAttempts, setStructureSaqAttempts] = useState(() =>
    normalizeNumericIndexRecord(initialStructureSaqAttempts)
  );
  const [structureSaqEvaluatingIdx, setStructureSaqEvaluatingIdx] = useState(null);
  const [recallAnswer, setRecallAnswer] = useState(initialRecallAnswer || "");
  const [recallFeedback, setRecallFeedback] = useState(initialRecallFeedback ?? null);
  const [recallStep, setRecallStep] = useState(() =>
    initialRecallStep === "recall" || initialRecallStep === "read" ? initialRecallStep : "read"
  );
  const [recallText, setRecallText] = useState("");
  const [recallResult, setRecallResult] = useState(null);
  const [algorithmText, setAlgorithmText] = useState(initialAlgorithmText || "");
  const [algorithmFeedback, setAlgorithmFeedback] = useState(initialAlgorithmFeedback ?? null);
  const [mcqSelected, setMcqSelected] = useState(null);
  const [mcqFeedback, setMcqFeedback] = useState(null);
  const [mcqResults, setMcqResults] = useState(initialMcqResults ?? []);
  const [sessionStreak, setSessionStreak] = useState(0);
  const [confidenceLevel, setConfidenceLevel] = useState(null);
  const [dlStemAnnotation, setDlStemAnnotation] = useState(null);
  const [dlStemToast, setDlStemToast] = useState(null);
  const dlStemContainerRef = useRef(null);
  const dlMcqStemContextRef = useRef("");

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

  const resolveMcqObjectiveIdForNotes = useMemo(() => {
    const q = mcqQuestions[currentMCQ];
    const candidates = [q?.objectiveId, deeplinkObjectiveId, resolvedObjectives?.[0]?.id].filter(Boolean);
    const objs = getBlockObjectives?.(blockId) || [];
    const ids = new Set(objs.map((o) => o.id));
    for (const c of candidates) {
      if (ids.has(c)) return c;
    }
    return null;
  }, [mcqQuestions, currentMCQ, deeplinkObjectiveId, resolvedObjectives, getBlockObjectives, blockId]);

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

  const [teachingSection, setTeachingSection] = useState(() =>
    typeof initialTeachingSection === "number" && initialTeachingSection >= 0 ? initialTeachingSection : 0
  );
  const [sectionExplanation, setSectionExplanation] = useState(() =>
    initialSectionExplanation != null && initialSectionExplanation !== "" ? String(initialSectionExplanation) : null
  );
  const [sectionUnderstood, setSectionUnderstood] = useState(() => normalizeSectionUnderstood(initialSectionUnderstood));
  const [loadingSection, setLoadingSection] = useState(false);

  useEffect(() => {
    const n = resolvedObjectives?.length ?? 0;
    if (n === 0) return;
    setTeachingSection((s) => (typeof s === "number" && s >= n ? n - 1 : s));
  }, [resolvedObjectives.length]);

  const deeplinkTeachAppliedRef = useRef(false);
  useEffect(() => {
    if (!deeplinkObjectiveId || resuming) return;
    if (phase !== "teach") return;
    if (deeplinkTeachAppliedRef.current) return;
    const list = resolvedObjectives || [];
    const idx = list.findIndex((o) => o.id === deeplinkObjectiveId);
    if (idx < 0) return;
    deeplinkTeachAppliedRef.current = true;
    setTeachingSection(idx);
    setSectionExplanation(null);
  }, [deeplinkObjectiveId, resuming, phase, resolvedObjectives]);

  useEffect(() => {
    if (!deeplinkObjectiveId || resuming || phase !== "teach") return;
    const list = resolvedObjectives || [];
    const idx = list.findIndex((o) => o.id === deeplinkObjectiveId);
    if (idx < 0 || teachingSection !== idx) return;
    const domId = `rxt-dl-teach-obj-${deeplinkObjectiveId}`;
    const timer = window.setTimeout(() => {
      document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(timer);
  }, [teachingSection, phase, deeplinkObjectiveId, resuming, resolvedObjectives]);

  const PHASE_ORDER = DL_PHASE_ORDER;

  const [visitedPhases, setVisitedPhases] = useState(() => {
    const migrated = migrateDeepLearnPhase(initialPhase);
    const idx = DL_PHASE_ORDER.indexOf(migrated);
    const upTo = idx >= 0 ? idx + 1 : 1;
    return new Set(DL_PHASE_ORDER.slice(0, upTo));
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

  // Debounced persist (~450ms) for all session fields; immediate flush when phase changes
  const dlSessionSnapshot = useMemo(
    () => ({
      sessionId,
      blockId,
      lecId: resolvedObjectives?.[0]?.linkedLecId ?? topic?.lecId,
      lectureTitle,
      topic: typeof topic === "object" ? topic?.label : topic,
      objectives: resolvedObjectives,
      lectureContent,
      isCrossLecture: (crossCtx?.lecs?.length || 0) >= 2,
      crossLectureIds: (crossCtx?.lecs || []).map((l) => l.id),
      phase,
      brainDump,
      brainDumpFeedback,
      saqAnswers,
      saqFeedback: saqEvals,
      saqQuestions,
      structureSaqQuestions,
      structureSaqAnswers,
      structureSaqEvals,
      structureSaqAttempts,
      patientCase,
      structureContent,
      algorithm,
      algorithmText,
      algorithmFeedback,
      recallPrompts,
      currentRecall,
      recallAnswer,
      recallFeedback,
      recallStep,
      mcqQuestions,
      mcqAnswers: {},
      mcqResults,
      preSAQScore,
      inputMode,
      handwriteDone,
      teachingSection,
      sectionExplanation,
      sectionUnderstood,
    }),
    [
      sessionId,
      blockId,
      resolvedObjectives,
      topic,
      lectureTitle,
      lectureContent,
      crossCtx,
      phase,
      brainDump,
      brainDumpFeedback,
      saqAnswers,
      saqEvals,
      saqQuestions,
      structureSaqQuestions,
      structureSaqAnswers,
      structureSaqEvals,
      structureSaqAttempts,
      patientCase,
      structureContent,
      algorithm,
      algorithmText,
      algorithmFeedback,
      recallPrompts,
      currentRecall,
      recallAnswer,
      recallFeedback,
      recallStep,
      mcqQuestions,
      mcqResults,
      preSAQScore,
      inputMode,
      handwriteDone,
      teachingSection,
      sectionExplanation,
      sectionUnderstood,
    ]
  );

  const dlSaveDebounceRef = useRef(null);
  const dlPrevPhaseSaveRef = useRef(null);

  useEffect(() => {
    if (!sessionId || !saveProgress || phase === "summary") return;
    if (dlSaveDebounceRef.current) clearTimeout(dlSaveDebounceRef.current);
    dlSaveDebounceRef.current = setTimeout(() => {
      dlSaveDebounceRef.current = null;
      saveProgress(sessionId, dlSessionSnapshot);
    }, 450);
    return () => {
      if (dlSaveDebounceRef.current) clearTimeout(dlSaveDebounceRef.current);
    };
  }, [sessionId, saveProgress, phase, dlSessionSnapshot]);

  useEffect(() => {
    if (!sessionId || !saveProgress) return;
    const prev = dlPrevPhaseSaveRef.current;
    dlPrevPhaseSaveRef.current = phase;
    if (prev == null || prev === phase) return;
    if (dlSaveDebounceRef.current) {
      clearTimeout(dlSaveDebounceRef.current);
      dlSaveDebounceRef.current = null;
    }
    saveProgress(sessionId, dlSessionSnapshot);
  }, [phase, sessionId, saveProgress, dlSessionSnapshot]);

  // First-pass fallback: skip "read" step and go straight to recall (student was taught earlier in session)
  useEffect(() => {
    if (phase === "selftest" && recallPrompts.length === 0) {
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

  const objList = formatObjectiveLinesNumbered(resolvedObjectives || [], 15);

  const isAnatomyContent = useMemo(() => {
    const subject = (resolvedObjectives || []).map((o) => o.objective || o.text || "").join(" ").toLowerCase();
    const text = ((lectureTitle || "") + " " + subject).toLowerCase();
    return /anatomy|histolog|morpholog|structural|vertebr|spinal|muscl|nerve|vessel|bone|joint/.test(text);
  }, [lectureTitle, resolvedObjectives]);

  const crossSystemPrefix = useMemo(
    () => (crossCtx?.lecs?.length >= 2 ? buildCrossLectureSystemPrompt(crossCtx) : ""),
    [crossCtx]
  );
  const isCrossLecture = crossSystemPrefix.length > 0;

  const loadStructureContentForGaps = useCallback(async () => {
    try {
      const crossHdr = isCrossLecture ? crossSystemPrefix + "\n\n" : "";
      const structBody = isCrossLecture
        ? `Create an integrated structural/functional breakdown across these lectures: ${(crossCtx.lecs || [])
            .map((l) => `${l.lectureType || "LEC"} ${l.lectureNumber ?? ""} — ${l.lectureTitle || l.fileName || ""}`)
            .join("; ")}.\n\n` +
          `Objectives:\n${objList}\n\n` +
          `Show how topics bridge across lectures (shared anatomy, pathways, clinical links). Follow: Patient Complaint → Organ → Architecture → Cell → Protein → Clinical Application, integrating across sources where relevant.\n\n` +
          `Return ONLY JSON:\n` +
          `{"levels":[{"level":"Patient Complaint","content":"...","whyItMatters":"..."},...],"keyMechanism":"..."}`
        : `Create a structural and functional breakdown for: ${lectureTitle}\n\n` +
          `Objectives:\n${objList}\n\n` +
          `Follow this hierarchy: Patient Complaint → Organ → Architecture → Cell → Protein → Clinical Application\n\n` +
          `For each level, explain the "Why?" — how does it connect to patient care?\n` +
          `Apply the "Make Me Care" test — only include facts that directly explain patient presentations.\n\n` +
          `Return ONLY JSON:\n` +
          `{"levels":[{"level":"Patient Complaint","content":"Patient presents with X because...","whyItMatters":"This matters clinically because..."},...],"keyMechanism":"The core mechanism connecting all levels is..."}`;
      const structResult = await geminiJSON(crossHdr + structBody, 2000);
      setStructureContent(structResult);
    } catch (err) {
      console.error("loadStructureContentForGaps failed:", err);
      setStructureContent({
        levels: [
          {
            level: "Overview",
            content: "Structure breakdown could not be generated. You can continue with the questions below.",
            whyItMatters: "Use the lecture objectives to guide your study.",
          },
        ],
        keyMechanism: "Proceed with the SAQs to reinforce the material.",
      });
    }
  }, [isCrossLecture, crossSystemPrefix, crossCtx, objList, lectureTitle]);

  useEffect(() => {
    if (phase !== "gaps") return;
    const skipStructureLoad = isFirstPass && isAnatomyContent && walkthroughObjectives.length > 0;
    if (skipStructureLoad) return;
    const hasStructure =
      (structureContent?.levels && structureContent.levels.length > 0) || !!structureContent?.keyMechanism;
    if (hasStructure) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadStructureContentForGaps();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    phase,
    isFirstPass,
    isAnatomyContent,
    walkthroughObjectives.length,
    structureContent?.levels?.length,
    structureContent?.keyMechanism,
    loadStructureContentForGaps,
  ]);

  const saqCrossAugment = useMemo(() => {
    if (!isCrossLecture) return null;
    return {
      systemPrefix: crossSystemPrefix,
      userSuffix:
        "Generate 3 short answer questions. Each question should integrate knowledge from 2 or more of the selected lectures. " +
        "Distribute questions across the lectures — do not focus all 3 on one lecture. " +
        "Label each question with which lectures it draws from (e.g. '[DLA5 + LEC6] Describe...') and use lectureTags where possible.",
    };
  }, [isCrossLecture, crossSystemPrefix]);

  const patientCaseCrossAugment = useMemo(() => {
    if (!isCrossLecture) return null;
    return {
      systemPrefix: crossSystemPrefix,
      userSuffix:
        "Generate a patient case that REQUIRES knowledge from at least 2 of the selected lectures to fully resolve. " +
        "The case should have a presentation that spans multiple topics. " +
        "Example: a patient with shoulder pain that requires understanding both shoulder anatomy AND thoracic outlet anatomy to diagnose correctly. " +
        "Make the case reveal connections between the lectures.",
    };
  }, [isCrossLecture, crossSystemPrefix]);

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
      if (typeof item === "string")
        return { question: item, keyPoints: [], objectiveText: "", lectureTags: null, isFallback: false };
      const question = item?.q ?? item?.question ?? "";
      const kp = item?.keyPoints;
      const keyPoints = Array.isArray(kp) ? kp : (typeof kp === "string" ? kp.split(/,\s*/).map((s) => s.trim()) : []);
      const objectiveText = item?.objectiveText ?? "";
      const lectureTags = item?.lectureTags || item?.lecture_tags || null;
      const isFallback = !!item?.isFallback;
      return { question, keyPoints, objectiveText, lectureTags, isFallback };
    });
  };

  async function runBrainDumpFollowupQuestions() {
    let questions = null;
    let attempts = 0;
    while (!questions && attempts < 2) {
      attempts += 1;
      try {
        const saqs = await generateSAQs(
          lectureContent,
          resolvedObjectives || [],
          lectureTitle,
          null,
          lec,
          blockId,
          saqCrossAugment || undefined
        );
        const next = normalizeSaqQuestions(saqs);
        if (Array.isArray(next) && next.length > 0) questions = next;
      } catch (err) {
        console.warn(`Question generation attempt ${attempts} failed:`, err?.message || err);
      }
    }
    if (!questions?.length) {
      setQuestionsError(
        "Questions could not be generated — tap Retry or continue to the next phase."
      );
      return false;
    }
    setQuestionsError(null);
    setSaqQuestions(questions);
    return true;
  }

  async function runStructureSaqQuestions(objectiveRowsOverride = null) {
    const objs =
      objectiveRowsOverride ??
      (usingManualObjectives && manualObjectives?.length ? manualObjectives : null) ??
      resolvedObjectives ??
      [];
    if (!Array.isArray(objs) || objs.length === 0) {
      setStructureQuestionsError("Add objectives or use manual entry to generate questions.");
      setStructureSaqQuestions([]);
      return false;
    }
    let questions = null;
    let attempts = 0;
    while (!questions && attempts < 2) {
      attempts += 1;
      try {
        const saqs = await generateSAQs(
          lectureContent,
          objs,
          lectureTitle,
          patientCase?.case ?? null,
          lec,
          blockId,
          saqCrossAugment || undefined
        );
        const normalized = normalizeSaqQuestions(saqs);
        if (normalized.length > 0) questions = normalized;
      } catch (err) {
        console.warn(`Structure question generation attempt ${attempts} failed:`, err?.message || err);
      }
    }
    if (!questions?.length) {
      setStructureQuestionsError(
        "Questions could not be generated — tap Retry or continue to the next phase."
      );
      setStructureSaqQuestions([]);
      return false;
    }
    setStructureQuestionsError(null);
    setStructureSaqQuestions(questions);
    return true;
  }

  // PHASE 1: Brain Dump + SAQ Priming (retry a few times; fallback to generateSAQs so questions show without user clicking Retry)
  const initBrainDump = async () => {
    setLoading(true);
    setQuestionsError(null);
    const maxAttempts = 2;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let questions = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const crossHdr = isCrossLecture ? crossSystemPrefix + "\n\n" : "";
          const crossExtra = isCrossLecture
            ? `This is a CROSS-LECTURE session. Generate priming questions that touch multiple lectures where possible.\n\n`
            : "";
          const parsed = await geminiJSON(
            crossHdr +
              crossExtra +
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
        setQuestionsError(null);
      } else {
        const ok = await runBrainDumpFollowupQuestions();
        if (!ok) setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
      }
    } catch (err) {
      console.error("initBrainDump SAQ generation error:", err);
      const ok = await runBrainDumpFollowupQuestions();
      if (!ok) setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (resuming || prepComplete) initBrainDump();
  }, [resuming, prepComplete]);

  const submitBrainDump = async () => {
    if (!brainDump.trim()) return;
    setLoading(true);
    setQuestionsError(null);
    try {
      const sessionContext = buildSessionContext(lec, blockId, resolvedObjectives || []);
      const crossBrain =
        isCrossLecture && crossCtx?.lecs?.length
          ? `${crossSystemPrefix}\n\nThe student should brain dump across ALL of the following lectures: ${crossCtx.lecs
              .map((l) => `${l.lectureType || "LEC"} ${l.lectureNumber ?? ""} — ${l.lectureTitle || l.fileName || ""}`)
              .join("; ")}. Evaluate their recall for each lecture separately AND note any cross-lecture connections they made. Call out missing connections explicitly.\n\n`
          : "";
      const systemPrompt =
        "You are a medical education tutor evaluating a student's brain dump before study. " +
        "Respond with ONLY a single JSON object (no markdown fences). " +
        "Fields: strengths (array of strings), gaps (array), misconceptions (array), readinessScore (0-100 integer), message (string). " +
        "Be encouraging but honest. Weight feedback using weak/struggling objectives in the student context when provided.";

      const userPrompt =
        crossBrain +
          `A medical student was asked to brain dump everything they know about: ${lectureTitle}\n\n` +
          `Their response:\n"${brainDump}"\n\n` +
          `Learning objectives:\n${objList}\n\n` +
        `Evaluate what they got right, what gaps exist, and what misconceptions to watch for.\n\n` +
          `Return ONLY JSON:\n` +
        `{"strengths":["knew X","mentioned Y"],"gaps":["missing A","no mention of B"],"misconceptions":["confused X with Y"],"readinessScore":40,"message":"Good start! You have the basics of X but..."}\n\n` +
        `---\nSTUDENT CONTEXT:\n${sessionContext}\n---`;

      const fallbackEval = {
        strengths: [],
        gaps: [],
        misconceptions: [],
        readinessScore: 30,
        message: "Could not evaluate — continue to questions below.",
      };

      try {
        const evalPayload = await callAIJSON(systemPrompt, userPrompt, fallbackEval, 1500);
        const rawScore =
          evalPayload?.readinessScore ??
          evalPayload?.readiness_score ??
          evalPayload?.readiness ??
          evalPayload?.score ??
          evalPayload?.Score;
        let readinessScore = null;
        if (rawScore !== undefined && rawScore !== null && rawScore !== "") {
          const n = Number(rawScore);
          if (!Number.isNaN(n)) readinessScore = Math.min(100, Math.max(0, Math.round(n)));
        }
        const msg = String(evalPayload?.message ?? evalPayload?.Message ?? evalPayload?.feedback ?? "").trim();
        setBrainDumpFeedback({
          strengths: Array.isArray(evalPayload?.strengths) ? evalPayload.strengths : Array.isArray(evalPayload?.Strengths) ? evalPayload.Strengths : [],
          gaps: Array.isArray(evalPayload?.gaps) ? evalPayload.gaps : Array.isArray(evalPayload?.Gaps) ? evalPayload.Gaps : [],
          misconceptions: Array.isArray(evalPayload?.misconceptions)
            ? evalPayload.misconceptions
            : Array.isArray(evalPayload?.Misconceptions)
              ? evalPayload.Misconceptions
              : [],
          readinessScore,
          message:
            msg ||
            (readinessScore != null
              ? ""
              : "Could not evaluate — continue to questions below."),
        });
      } catch (err) {
        console.warn("Brain dump eval failed:", err?.message || err);
        setBrainDumpFeedback({
          readinessScore: null,
          message:
            "Good start — you have some prior knowledge. Continue to the questions below to build on this.",
          gaps: [],
          strengths: ["Prior knowledge noted"],
          misconceptions: [],
        });
      }

      const ok = await runBrainDumpFollowupQuestions();
      if (!ok) {
        setSaqQuestions((prev) => (prev.length > 0 ? prev : []));
      }
    } catch (err) {
      console.error("submitBrainDump error:", err);
      await runBrainDumpFollowupQuestions();
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

  const generateTeachingSection = async (objIndex) => {
    const objs = resolvedObjectives || [];
    const obj = objs[objIndex];
    if (!obj) return;
    const objText = (obj.objective || obj.text || "").trim();
    if (!objText) return;

    setLoadingSection(true);
    try {
      const content =
        isCrossLecture && crossCtx?.combinedContent
          ? crossCtx.combinedContent
          : getLecText(lec) || lectureContent || lec?.text || "";
      const slice = content.slice(0, 4000);
      const result = await callAI(
        `You are a medical tutor teaching ${lectureTitle || "this lecture"}. Be conversational, clear, and use analogies. Teach one concept at a time. End with ONE check question to verify understanding.`,
        `Teach this specific learning objective using the lecture content below. Be thorough but concise.\n\nOBJECTIVE: ${objText}\n\nLECTURE CONTENT:\n${slice}\n\nStructure your response as:\n1. Core concept explanation (3-5 sentences)\n2. Key mechanism or process\n3. Clinical relevance (1-2 sentences)\n4. Check question: "Quick check: [simple question]"`,
        1500
      );
      setSectionExplanation(result);
    } catch (err) {
      console.error("generateTeachingSection failed:", err);
      setSectionExplanation(
        "Teaching content could not be generated. Use your lecture materials, tap Explain differently, or continue to the next objective."
      );
    } finally {
      setLoadingSection(false);
    }
  };

  const advanceFromBrainDump = () => {
    advancePhase("teach");
    setPatientCase(null);
    setLoadingTooLong(false);
    setTeachingSection(0);
    setSectionExplanation(null);
    setSectionUnderstood({});
  };

  const patientCaseFallback = () => ({
    case: `A 45-year-old patient presents with findings relevant to ${lectureTitle || "today's lecture"}. As you study the material, consider how the anatomical structures and physiological mechanisms covered explain this patient's presentation and symptoms.`,
    focus: "Think about how the core concepts from this lecture explain this patient's presentation.",
  });

  useEffect(() => {
    if (phase !== "patient") return;
    if (patientCase?.case) return;

    if (!isCrossLecture && lec?.teachingMap?.clinicalHook) {
      setPatientCase({
        case: lec.teachingMap.clinicalHook,
        focus: "Think about how the core concepts from this lecture explain this patient's presentation.",
      });
      return;
    }

    let cancelled = false;

    const load = async () => {
      const masteredTexts = (resolvedObjectives || [])
        .filter((_, i) => sectionUnderstood[i])
        .map((o) => (o.objective || o.text || "").trim())
        .filter(Boolean);

      if (masteredTexts.length > 0) {
        try {
          const result = await callAI(
            `You create clinical cases for medical education. The case must test the specific mechanisms just learned — not general knowledge.`,
            `Create a SHORT patient case (3-4 sentences) that requires applying these specific concepts:\n${masteredTexts.join("\n")}\n\nThe case should:\n- Present a patient with a clinical problem\n- Require the student to apply the mechanisms above to explain what's happening\n- End with: "Using what you just learned, explain what is happening at the cellular/vascular level."\n\nLecture: ${lectureTitle || ""}`,
            800
          );
          if (!cancelled) {
            setPatientCase({
              case: result,
              focus:
                "Using what you just learned, explain what is happening at the cellular/vascular level.",
            });
          }
          return;
        } catch (err) {
          console.error("Objective-based patient case failed:", err);
        }
      }

      const contentForCase =
        isCrossLecture && crossCtx?.combinedContent ? crossCtx.combinedContent : lectureContent;
      console.log(
        "DeepLearn patient case load — content length:",
        (contentForCase || "").length,
        "objectives:",
        (resolvedObjectives || []).length
      );

      if (!contentForCase || contentForCase.length < 100) {
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
        const result = await generatePatientCase(
          contentForCase,
          resolvedObjectives || [],
          lectureTitle,
          lec,
          blockId,
          patientCaseCrossAugment || undefined
        );
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
  }, [
    phase,
    lectureTitle,
    lectureContent,
    resolvedObjectives,
    lec?.teachingMap?.clinicalHook,
    isCrossLecture,
    crossCtx?.combinedContent,
    patientCaseCrossAugment,
    sectionUnderstood,
  ]);

  useEffect(() => {
    if (phase === "gaps" && resolvedObjectives.length === 0 && (blockObjectives || []).length > 0 && !manualInput) {
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
    if (phase !== "patient" || patientCase?.case) {
      setLoadingTooLong(false);
      return;
    }
    const t = setTimeout(() => setLoadingTooLong(true), 8000);
    return () => clearTimeout(t);
  }, [phase, patientCase?.case]);

  const advanceToReadRecall = async () => {
    setLoading(true);
    try {
      const crossHdr = isCrossLecture ? crossSystemPrefix + "\n\n" : "";
      const recallExtra = isCrossLecture
        ? `Each question should integrate concepts across the selected lectures where possible.\n\n`
        : "";
      const parsed = await geminiJSON(
        crossHdr +
          `Generate 3 read-and-recall questions for: ${lectureTitle}\n\n` +
          `Patient context: ${patientCase?.case || ""}\n` +
          `Objectives:\n${objList}\n\n` +
          recallExtra +
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
      advancePhase("selftest");
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
      advancePhase("gaps");
    }
  };

  const advanceToMCQ = async () => {
    setLoading(true);
    setMcqGenerationError(null);
    try {
      const sessionContext = buildSessionContext(lec, blockId, resolvedObjectives || []);

      // Compute adaptive difficulty tier from performance history + current streak
      const storedPerfRaw = (() => {
        try { return JSON.parse(localStorage.getItem("rxt-performance") || "{}"); } catch { return {}; }
      })();
      const perfKey = lec?.id && blockId ? `${lec.id}__${blockId}` : null;
      const perfEntry = perfKey ? (storedPerfRaw[perfKey] || null) : null;
      const tierInfo = computeDifficultyTier(perfEntry, sessionStreak);
      const difficultyBlock = buildDifficultyInstruction(tierInfo);
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

      const crossMcq =
        isCrossLecture && crossCtx?.combinedContent
          ? `${crossSystemPrefix}\n\nCOMBINED LECTURE MATERIAL (excerpt for sourcing):\n${(crossCtx.combinedContent || "").slice(0, 12000)}\n\n` +
            `Generate questions that test INTEGRATED knowledge across the selected lectures. At least half the questions should require knowledge from 2+ lectures to answer correctly. ` +
            `Use the combined content of all lectures as source material. Weight questions toward the weakest lecture's objectives.\n\n`
          : "";

      const parsed = await geminiJSON(
        crossMcq +
          `Generate 5 high-quality MCQs to close this learning session on: ${lectureTitle}\n\n` +
          `Patient case context: ${patientCase?.case || ""}\n\n` +
          `Learning objectives:\n${objList}\n\n` +
          styleSection +
          `${MCQ_DISTINCT_OPTIONS_RULE}\n\n` +
          `${MCQ_OPTION_UNIQUENESS_CRITICAL}\n\n` +
          `${MCQ_LAB_NORMAL_RANGES_RULE}\n\n` +
          `Rules:\n` +
          `- Each question must start from the PATIENT (vignette-first)\n` +
          `- Ask "what is the underlying mechanism" not "what is the drug"\n` +
          `- Make wrong answers clinically plausible\n` +
          `- Reference the patient case where possible\n` +
          `${difficultyBlock}\n\n` +
          `- ⭐ STARRED OBJECTIVES (mastery-required, from STUDENT CONTEXT): At least 2 of 5 questions MUST directly test a ⭐ starred objective. These are professor-designated high-yield topics — they appear on every exam. Never skip them regardless of difficulty tier.\n` +
          `- If weak objectives exist in STUDENT CONTEXT, at least half the questions must test those specific objectives.\n` +
          `  Use the struggling objectives as the basis for distractor construction — make wrong answers reflect common misconceptions about those weak areas.\n` +
          `- Every stem MUST end with a question ending in "?"\n` +
          `- Keep explanations under 60 words\n\n` +
          `Return ONLY JSON:\n` +
          `{"questions":[{"stem":"The patient above now develops X. Which mechanism best explains...?","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveId":"","topic":"${lectureTitle}"}]}` +
          `\n\n---\nSTUDENT CONTEXT:\n${sessionContext}\n---`,
        4000
      );

      const rawQs = parsed?.questions || [];
      const qs = [];
      for (let i = 0; i < rawQs.length; i++) {
        const q = rawQs[i];
        const { valid, q: fixed } = dedupeMcqQuestionChoices(q);
        if (!valid) continue;
        qs.push({
          ...fixed,
          id: `dl_${Date.now()}_${i}`,
          num: qs.length + 1,
          difficulty: tierInfo.tier,
        });
      }
      setMcqQuestions(qs);
      setCurrentMCQ(0);
      setMcqSelected(null);
      setMcqFeedback(null);
      if (qs.length === 0) {
        setMcqGenerationError(
          "Generated MCQs had duplicate or invalid answer choices (need 4 distinct options). Try again."
        );
        return;
      }
      advancePhase("apply");
    } finally {
      setLoading(false);
    }
  };

  const handleMcqConfidence = useCallback((questionId, flag) => {
    if (!questionId) return;
    setMcqResults((prev) => {
      const idx = prev.findIndex((r) => r.questionId === questionId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        confidenceFlag: flag === "guessed" ? "guessed" : "knew",
      };
      return next;
    });
    setMcqFeedback((f) => (f && f.questionId === questionId ? { ...f, confidenceChosen: flag } : f));
  }, []);

  const submitMCQ = () => {
    if (!mcqSelected) return;
    const q = mcqQuestions[currentMCQ];
    const correct = mcqSelected === q.correct;
    const questionId = q.id;
    const result = {
      correct,
      score: correct ? 100 : 0,
      objectiveId: q.objectiveId,
      topic: q.topic,
      questionId,
      stem: q.stem,
      correctText: q.choices?.[q.correct] ?? "",
    };
    setMcqFeedback({
      correct,
      explanation: q.explanation,
      correctAnswer: q.correct,
      correctText: q.choices?.[q.correct],
      questionId,
    });
    setMcqResults((prev) => [...prev, result]);
    // Update within-session streak for adaptive difficulty
    setSessionStreak((prev) => updateSessionStreak(prev, correct));
  };

  const nextMCQ = () => {
    const fb = mcqFeedback;
    let mergedResults = mcqResults;
    if (fb?.correct && fb.questionId && !fb.confidenceChosen) {
      const idx = mcqResults.findIndex((r) => r.questionId === fb.questionId);
      if (idx >= 0) {
        mergedResults = [...mcqResults];
        mergedResults[idx] = { ...mergedResults[idx], confidenceFlag: "knew" };
        setMcqResults(mergedResults);
      }
    }
    if (currentMCQ < mcqQuestions.length - 1) {
      setCurrentMCQ((prev) => prev + 1);
      setMcqSelected(null);
      setMcqFeedback(null);
    } else {
      const total = mergedResults.length;
      const score =
        total > 0
          ? Math.round(
              (mergedResults.filter((r) => mcqResultCountsTowardCorrectScore(r)).length / total) * 100
            )
          : 0;
      setPostMCQScore(score);
      advancePhase("summary");
    }
  };

  useEffect(() => {
    dlMcqStemContextRef.current = String(mcqQuestions[currentMCQ]?.stem || "");
  }, [mcqQuestions, currentMCQ]);

  useEffect(() => {
    setDlStemAnnotation(null);
  }, [currentMCQ, mcqQuestions]);

  const fetchDlStemAnnotation = useCallback(async (selectedText) => {
    const questionContext = dlMcqStemContextRef.current || "";
    const fallback = {
      normalRange: null,
      direction: null,
      significance: "No information found.",
      clinicalImplication: null,
    };
    try {
      const result = await callAIJSON(
        `You are a clinical medicine tutor helping a medical student think through a question stem. When given a selected term or lab value, return a JSON object with:
{
  "normalRange": "string or null — only for lab values/vitals",
  "direction": "HIGH or LOW or null — if it's a lab value, is this value abnormal and in which direction",
  "significance": "1-2 sentences: what does this finding mean clinically in plain language",
  "clinicalImplication": "1 sentence: what diagnosis or mechanism does this point toward"
}
Be concise. Medical student level. No preamble.`,
        `Question context: "${questionContext.slice(0, 400)}"
Student selected: "${selectedText}"

What is the clinical significance of this finding?`,
        fallback,
        1000
      );
      const merged = {
        normalRange: result?.normalRange ?? null,
        direction: result?.direction ?? null,
        significance:
          result?.significance != null && String(result.significance).trim()
            ? String(result.significance).trim()
            : fallback.significance,
        clinicalImplication: result?.clinicalImplication ?? null,
      };
      setDlStemAnnotation((prev) => (prev ? { ...prev, loading: false, result: merged } : null));
    } catch {
      setDlStemAnnotation((prev) =>
        prev
          ? { ...prev, loading: false, result: { significance: "Could not load — check AI connection." } }
          : null
      );
    }
  }, []);

  const handleDlStemSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const container = dlStemContainerRef.current;
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selectedText || selectedText.length < 2) return;
    if (!container || !selection?.anchorNode || !selection?.focusNode) return;
    if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
    let range;
    try {
      range = selection.getRangeAt(0);
    } catch {
      return;
    }
    const rect = range.getBoundingClientRect();
    setDlStemAnnotation({
      text: selectedText,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      loading: true,
      result: null,
    });
    fetchDlStemAnnotation(selectedText);
  }, [fetchDlStemAnnotation]);

  const handleAddDlStemAnnotationToNotes = useCallback(
    (annotation) => {
      const oid = resolveMcqObjectiveIdForNotes;
      if (!blockId || !oid || !onAppendObjectiveNote) return;
      const line = `\n[${annotation.text}]: ${annotation.result?.significance || ""}`;
      onAppendObjectiveNote(blockId, oid, line);
      setDlStemAnnotation(null);
      setDlStemToast("📝 Added to objective notes");
      window.setTimeout(() => setDlStemToast(null), 2000);
    },
    [blockId, onAppendObjectiveNote, resolveMcqObjectiveIdForNotes]
  );

  if (loading && phase === "prime")
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

  // ── Prep Screen (shown before Phase 1) ──────────────────────────────
  // Priority rule: if this is a resumed session, skip prep entirely.
  if (!resuming && !prepComplete) {
    const lecId = lec?.id;

    const getLecPerf = (l, bid) => {
      if (!l?.id || !bid) return null;
      const exactKey = makeTopicKey ? makeTopicKey(l.id, bid) : null;
      const ph = performanceHistory || {};
      if (exactKey && ph[exactKey]) return ph[exactKey];
      if (!exactKey) return null;
      const byId = Object.keys(ph || {}).find((k) => k.startsWith(l.id + "__"));
      return byId ? ph[byId] : null;
    };

    const formatRelativeDate = (isoDate) => {
      const d = new Date(isoDate);
      if (Number.isNaN(d.getTime())) return "—";
      d.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - d) / 86400000);
      if (diff === 0) return "Today";
      if (diff === 1) return "Yesterday";
      if (diff < 7) return diff + " days ago";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const getScoreTrend = (recentScores) => {
      if (!Array.isArray(recentScores) || recentScores.length < 4) return "new";
      const last3 = recentScores.slice(-3);
      const prev3 = recentScores.slice(-6, -3);
      if (prev3.length === 0) return "new";
      const lastAvg = last3.reduce((a, b) => a + b, 0) / last3.length;
      const prevAvg = prev3.reduce((a, b) => a + b, 0) / prev3.length;
      const delta = lastAvg - prevAvg;
      if (delta > 5) return "improving";
      if (delta < -5) return "declining";
      return "stable";
    };

    const perf = getLecPerf(lec, blockId);
    const sessionsArr = Array.isArray(perf?.sessions) ? perf.sessions : [];
    const totalSessions = sessionsArr.length;
    const lastSession = totalSessions ? sessionsArr[totalSessions - 1] : null;

    const lastScoreRaw = perf?.score ?? perf?.lastScore ?? lastSession?.score ?? null;
    const lastScore = lastScoreRaw != null && typeof lastScoreRaw === "number" ? lastScoreRaw : lastScoreRaw != null ? Number(lastScoreRaw) : null;
    const lastDateRaw = perf?.date ?? perf?.lastStudied ?? lastSession?.date ?? null;
    const lastDate = lastDateRaw ? new Date(lastDateRaw).toISOString() : null;

    const confidenceLevelRaw = perf?.confidenceLevel ?? lastSession?.confidenceLevel ?? null;
    const confidenceBucket = (() => {
      if (confidenceLevelRaw == null) return null;
      if (typeof confidenceLevelRaw === "number") {
        if (confidenceLevelRaw >= 4) return "good";
        if (confidenceLevelRaw === 3) return "okay";
        if (confidenceLevelRaw <= 2) return "low";
      }
      const s = String(confidenceLevelRaw).toLowerCase();
      if (s.includes("high")) return "good";
      if (s.includes("medium") || s.includes("okay") || s.includes("3")) return "okay";
      if (s.includes("low") || s.includes("1") || s.includes("2")) return "low";
      return null;
    })();

    const scoreColor =
      lastScore == null
        ? T.text3
        : lastScore >= 70
          ? "#639922"
          : lastScore >= 50
            ? "#BA7517"
            : "#E24B4A";

    const allScoresChrono = sessionsArr
      .map((s) => s?.score)
      .filter((s) => s != null && typeof s === "number");
    const trend = totalSessions >= 2 ? getScoreTrend(allScoresChrono) : "new";
    const trendCfg =
      trend === "improving"
        ? { arrow: "↑", label: "improving", color: "#639922" }
        : trend === "declining"
          ? { arrow: "↓", label: "declining", color: "#E24B4A" }
          : trend === "stable"
            ? { arrow: "→", label: "stable", color: T.text2 }
            : { arrow: "—", label: "not enough data", color: T.text3 };

    const lecObjs = (blockObjectives || []).filter((o) => o?.linkedLecId === lecId);
    const weakObjectives = lecObjs
      .filter((o) => o?.status === "struggling" || o?.status === "inprogress")
      .sort((a, b) => {
        const aRank = a?.status === "struggling" ? 0 : 1;
        const bRank = b?.status === "struggling" ? 0 : 1;
        return aRank - bRank;
      })
      .slice(0, 5);

    const objMastered = lecObjs.filter((o) => o?.status === "mastered").length;
    const objInProgress = lecObjs.filter((o) => o?.status === "inprogress").length;
    const objStruggling = lecObjs.filter((o) => o?.status === "struggling").length;
    const objUntested = lecObjs.filter((o) => !o?.status || o?.status === "untested").length;
    const objTotal = lecObjs.length;

    const bloomLevels = lecObjs
      .map((o) => o?.bloom_level)
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    const highestBloom = bloomLevels.length ? Math.max(...bloomLevels) : null;

    // Activity log context from rxt-completion
    const activityKey = lecId ? `${lecId}__${blockId}` : null;
    let activityLog = [];
    try {
      const store = JSON.parse(localStorage.getItem("rxt-completion") || "{}");
      const entry = activityKey ? store?.[activityKey] : null;
      if (Array.isArray(entry?.activityLog)) activityLog = entry.activityLog;
    } catch {}
    const recentActivities = activityLog
      .filter((a) => a && a.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 3);

    const confidencePill = (conf) => {
      const v = conf == null ? null : String(conf).toLowerCase();
      const good = v === "good" || v === "high";
      const okay = v === "okay" || v === "medium";
      const struggling = v === "struggling" || v === "low";
      const cfg = good
        ? { sym: "✓", fg: "#639922", bg: "#63992215", br: "#63992240" }
        : okay
          ? { sym: "△", fg: "#BA7517", bg: "#BA751715", br: "#BA751740" }
          : struggling
            ? { sym: "⚠", fg: "#E24B4A", bg: "#E24B4A15", br: "#E24B4A40" }
            : { sym: "—", fg: T.text3, bg: T.border2, br: T.border2 };
      return cfg;
    };

    const activityIcon = (type) => {
      const t = String(type || "").toLowerCase();
      return t === "deep_learn"
        ? "🧠"
        : t === "review"
          ? "📖"
          : t === "anki"
            ? "🃏"
            : t === "questions"
              ? "❓"
              : t === "notes"
                ? "📝"
                : t === "sg_tbl"
                  ? "👥"
                  : t === "manual"
                    ? "✏️"
                    : "•";
    };

    const activityLabel = (type) => {
      const t = String(type || "").toLowerCase();
      return t === "deep_learn"
        ? "Deep Learn"
        : t === "review"
          ? "Review"
          : t === "anki"
            ? "Anki"
            : t === "questions"
              ? "Questions"
              : t === "notes"
                ? "Notes"
                : t === "sg_tbl"
                  ? "SG Table"
                  : t === "manual"
                    ? "Manual"
                    : "Activity";
    };

    const confidenceText =
      confidenceBucket === "good"
        ? "✓ Good"
        : confidenceBucket === "okay"
          ? "△ Okay"
          : confidenceBucket === "low"
            ? "⚠ Low"
            : "—";

    const confidenceColor =
      confidenceBucket === "good"
        ? "#639922"
        : confidenceBucket === "okay"
          ? "#BA7517"
          : confidenceBucket === "low"
            ? "#E24B4A"
            : T.text3;

    const complexityChip =
      highestBloom != null && highestBloom >= 4 ? (
        <span
          style={{
            background: "#FAEEDA",
            color: "#633806",
            border: "0.5px solid #EF9F27",
            borderRadius: 10,
            padding: "4px 10px",
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: MONO,
            fontWeight: 700,
          }}
        >
          △ Bloom's {highestBloom} — high complexity
        </span>
      ) : null;

    const showWeakObjectives = weakObjectives.length > 0;

    // Subtitle: lecture type + number, blockId
    const subtitle = `${lec?.lectureType || "LEC"} ${lec?.lectureNumber ?? ""}`.trim() + ` · ${blockId}`;

    const startBtnStyle = {
      background: T.statusGood || "#2563eb",
      color: "#fff",
      fontSize: 14,
      padding: "10px 20px",
      borderRadius: 10,
      cursor: "pointer",
      border: "none",
      fontFamily: SERIF,
      fontWeight: 900,
      whiteSpace: "nowrap",
    };

    const scoreBadge = (s) =>
      s == null ? { txt: "—", fg: T.text3 } : s >= 70 ? { txt: s + "%", fg: "#639922" } : s >= 50 ? { txt: s + "%", fg: "#BA7517" } : { txt: s + "%", fg: "#E24B4A" };

    return (
      <div style={{ padding: "20px 24px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ width: "100%", padding: "20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: T.text1, fontFamily: SERIF }}>
              {lec?.title || lec?.lectureTitle || lectureTitle || "Deep Learn"}
            </div>
            <button type="button" onClick={() => setPrepComplete(true)} style={startBtnStyle}>
              Start Session →
            </button>
          </div>

          <div style={{ fontSize: 12, color: T.text3, marginBottom: 16 }}>
            {subtitle}
          </div>

          <div style={{ borderTop: "0.5px solid " + T.border2, marginBottom: 14 }} />

          {/* SECTION 1 — LAST SESSION */}
          {totalSessions === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px 0", gap: 8 }}>
              <div style={{ fontSize: 18, color: T.text3 }}>○</div>
              <div style={{ fontSize: 14, color: T.text2, fontFamily: MONO }}>
                First session — no history yet
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "16px 0", borderBottom: "0.5px solid " + T.border2 }}>
              <div style={{ minWidth: 140 }}>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: scoreColor }}>
                  {lastScore != null && Number.isFinite(lastScore) ? Math.round(lastScore) + "%" : "—"}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>last score</div>
              </div>

              <div style={{ minWidth: 140 }}>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: T.text1 }}>
                  {totalSessions}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>sessions total</div>
              </div>

              <div style={{ minWidth: 170 }}>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: T.text1 }}>
                  {lastDate ? formatRelativeDate(lastDate) : "—"}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>last studied</div>
              </div>

              <div style={{ minWidth: 140 }}>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: confidenceColor }}>
                  {confidenceText}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>last confidence</div>
              </div>

              {totalSessions >= 2 && (
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: trendCfg.color }}>
                    {trendCfg.arrow}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>trend</div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 2 — OBJECTIVE STATUS */}
          <div style={{ padding: "14px 0", borderBottom: "0.5px solid " + T.border2, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: T.text3, marginBottom: 8, fontFamily: MONO }}>
                Objective coverage
              </div>
              <div style={{ height: 6, width: 160, borderRadius: 3, overflow: "hidden", display: "flex", background: T.border2 }}>
                {objTotal > 0 ? (
                  <>
                    <div style={{ width: (objMastered / objTotal) * 100 + "%", background: "#639922" }} />
                    <div style={{ width: (objInProgress / objTotal) * 100 + "%", background: "#BA7517" }} />
                    <div style={{ width: (objStruggling / objTotal) * 100 + "%", background: "#E24B4A" }} />
                    <div style={{ flex: 1, background: "transparent" }} />
                  </>
                ) : (
                  <div style={{ width: "100%", background: T.border2 }} />
                )}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 6 }}>
                [{objMastered}] mastered · [{objUntested}] untested
              </div>
            </div>

            {complexityChip}
          </div>

          {/* SECTION 3 — WEAK OBJECTIVES */}
          {showWeakObjectives && (
            <div style={{ padding: "14px 0 0" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: T.text3, marginBottom: 6, fontFamily: MONO }}>
                Watch these
              </div>
              {weakObjectives.map((o, idx) => {
                const statusDot = o.status === "struggling" ? "#E24B4A" : "#BA7517";
                const bloomLevel = typeof o.bloom_level === "number" ? o.bloom_level : 2;
                const bloomName = o.bloom_level_name || LEVEL_NAMES[bloomLevel] || "Understand";
                return (
                  <div
                    key={o.id || idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "6px 0",
                      borderBottom: "0.5px solid " + T.border2,
                      borderRadius: 0,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, marginTop: 5, background: statusDot, flexShrink: 0 }} />
                    <div
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: T.text2,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {o.objective || o.text || "—"}
                    </div>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: LEVEL_BG[bloomLevel] || T.inputBg,
                        color: LEVEL_COLORS[bloomLevel] || T.text2,
                        border: "0.5px solid " + (LEVEL_COLORS[bloomLevel] || T.border1) + "40",
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                      title={bloomName}
                    >
                      {bloomName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* SECTION 4 — RECENT ACTIVITY */}
          {recentActivities.length > 0 && (
            <div style={{ padding: "14px 0 0" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: T.text3, marginBottom: 6, fontFamily: MONO }}>
                Recent activity
              </div>
              {recentActivities.map((a, idx) => {
                const conf = a?.confidenceRating ?? null;
                const pill = confidencePill(conf);
                return (
                  <div key={a.id || idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12 }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{activityIcon(a?.activityType)}</span>
                    <span style={{ color: T.text2, flex: 1 }}>{activityLabel(a?.activityType)}</span>
                    <span style={{ fontFamily: MONO, color: T.text3, fontSize: 12, marginRight: 8 }}>
                      {formatRelativeDate(a.date)}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 700,
                        color: pill.fg,
                        background: pill.bg,
                        border: "1px solid " + pill.br,
                        padding: "2px 8px",
                        borderRadius: 999,
                        flexShrink: 0,
                      }}
                    >
                      {pill.sym}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* BOTTOM ACTION ROW */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, gap: 12, flexWrap: "wrap" }}>
            <div style={{ color: T.text3, fontSize: 12, fontFamily: MONO }}>
              {totalSessions === 0
                ? "This will be your first session"
                : lastScore != null && typeof lastScore === "number" && lastScore < 70
                  ? "⚠ Focus on weak objectives this session"
                  : "✓ Looking good — keep the streak going"}
            </div>
            <button type="button" onClick={() => setPrepComplete(true)} style={startBtnStyle}>
              Start Session →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const phaseIcons = Object.fromEntries(DEEP_LEARN_PHASES.map((p) => [p.id, p.icon]));
  const phaseLabels = Object.fromEntries(DEEP_LEARN_PHASES.map((p) => [p.id, p.label]));

  const dlLectureTagColor = (tag) => {
    const u = String(tag || "").toUpperCase();
    if (u.startsWith("DLA")) return "#6366f1";
    if (u.startsWith("LEC")) return "#60a5fa";
    if (u.startsWith("SG")) return "#a78bfa";
    if (u.startsWith("TBL")) return "#f59e0b";
    return tc;
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

  const CrossLectureStrip = () =>
    isCrossLecture && crossCtx?.lecs?.length ? (
      <div
        style={{
          marginBottom: 16,
          marginTop: -8,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3 }}>Cross-lecture session</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(crossCtx.lecs || []).map((l) => (
            <span
              key={l.id}
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: T.text3,
                background: dlLecturePillColorFromLec(l) + "22",
                border: "1px solid " + dlLecturePillColorFromLec(l) + "55",
                padding: "2px 8px",
                borderRadius: 6,
              }}
            >
              {l.lectureType || "LEC"} {l.lectureNumber ?? ""}
            </span>
          ))}
        </div>
      </div>
    ) : null;

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
    <div style={{ padding: "20px 24px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <PhaseBar />
      <CrossLectureStrip />

      {/* Phase 1: Brain Dump + SAQ */}
      {phase === "prime" && (
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "prime")?.subtitle || "BRAIN DUMP"}
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
              {isCrossLecture && crossCtx?.lecs?.length ? (
                <>
                  Before we begin — write down everything you know about:
                  <ul style={{ margin: "8px 0 0 0", paddingLeft: 20, color: T.text1 }}>
                    {(crossCtx.lecs || []).map((l) => (
                      <li key={l.id} style={{ marginBottom: 4 }}>
                        <strong>
                          {l.lectureType || "LEC"} {l.lectureNumber ?? ""} — {l.lectureTitle || l.fileName || ""}
                        </strong>
                      </li>
                    ))}
                  </ul>
                  Include any connections you see between them. Don&apos;t look anything up.
                </>
              ) : (
                <>
                  Before we begin — write down everything you already know about{" "}
                  <strong style={{ color: T.text1 }}>{lectureTitle}</strong>. Don&apos;t look anything up. This
                  primes your brain for new information.
                </>
              )}
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
              placeholder={
                isCrossLecture
                  ? "Write everything you know about each lecture above and how they connect — anatomy, clinical links, mechanisms..."
                  : "Write everything you know... anatomy, physiology, clinical relevance, drugs, anything."
              }
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
              {(() => {
                const displayReadiness = brainDumpFeedback?.readinessScore ?? null;
                return displayReadiness != null ? (
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                      color:
                        displayReadiness >= 60
                          ? T.statusGood
                          : displayReadiness >= 30
                            ? T.statusWarn
                            : T.statusBad,
                    }}
                  >
                    Readiness: {displayReadiness}%
              </div>
                ) : (
                  <div
                    style={{
                      color: T.textSecondary || T.text3,
                      fontSize: 13,
                      fontFamily: MONO,
                    }}
                  >
                    Continue to questions below
                  </div>
                );
              })()}

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
                  {typeof q === "object" && Array.isArray(q?.lectureTags) && q.lectureTags.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {q.lectureTags.map((t) => {
                        const s = String(t);
                        const short = s.length > 20 ? s.slice(0, 17) + "…" : s;
                        const bg = dlLectureTagColor(s);
                        return (
                          <span
                            key={s + idx}
                            title={s}
                            style={{
                              fontFamily: MONO,
                              fontSize: 11,
                              color: "#fff",
                              background: bg,
                              padding: "2px 8px",
                              borderRadius: 10,
                              maxWidth: 140,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {short}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
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
            <div style={{ textAlign: "center", marginTop: 16, padding: "0 16px 16px" }}>
              <div
                style={{
                  fontSize: 13,
                  color: T.textSecondary || T.text3,
                  marginBottom: 12,
                  fontFamily: MONO,
                  maxWidth: 420,
                  marginLeft: "auto",
                  marginRight: "auto",
                  lineHeight: 1.5,
                }}
              >
                {questionsError ||
                  "Questions could not be generated — tap Retry or continue to the next phase."}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={async () => {
                    setQuestionsError(null);
                  setLoading(true);
                  try {
                      await runBrainDumpFollowupQuestions();
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                style={{
                    padding: "8px 20px",
                  borderRadius: 8,
                    background: T.accent || tc,
                    color: "#fff",
                    border: "none",
                    cursor: loading ? "default" : "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  fontFamily: MONO,
                  }}
                >
                  {loading ? "Generating…" : "↺ Retry"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuestionsError(null);
                    advanceFromBrainDump();
                  }}
                  disabled={loading}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    border: `1px solid ${T.border1 || T.border2}`,
                    background: "transparent",
                    color: T.text1,
                  cursor: loading ? "default" : "pointer",
                    fontSize: 13,
                    fontFamily: MONO,
                    fontWeight: 600,
                }}
              >
                  Skip → Next phase
              </button>
              </div>
            </div>
          )}

          {brainDumpFeedback && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                Guided teaching is next — one objective at a time from your lecture.
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
                {loading ? "Preparing…" : "Start guided teaching →"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase 2: Guided teaching (objective-driven) */}
      {phase === "teach" && (
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "teach")?.subtitle || "GUIDED TEACHING"}
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "teach")?.title || "Guided Teaching"}
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Each step focuses on one objective from this lecture. Ask for a lesson, then continue when it clicks.
            </div>
            {deeplinkObjectiveId &&
              !resuming &&
              resolvedObjectives.length > 0 &&
              !resolvedObjectives.some((o) => o.id === deeplinkObjectiveId) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    background: T.statusWarnBg,
                    border: "1px solid " + T.statusWarnBorder,
                    borderRadius: 8,
                    fontFamily: MONO,
                    fontSize: 12,
                    color: T.statusWarn,
                    lineHeight: 1.5,
                  }}
                >
                  Could not match the linked drill objective to this lecture&apos;s list — browse objectives with the
                  numbered steps above.
                </div>
              )}
          </div>

          {resolvedObjectives.length === 0 ? (
            <div
              style={{
                padding: 16,
                background: T.cardBg,
                border: "1px solid " + T.border1,
                borderRadius: 10,
                fontFamily: MONO,
                fontSize: 13,
                color: T.text2,
                lineHeight: 1.6,
              }}
            >
              No objectives are linked to this lecture yet. Add objectives in your block or paste them manually where
              Deep Learn asks, then restart or go back and enter them — guided teaching needs at least one objective.
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                {resolvedObjectives.map((obj, i) => (
                  <div
                    key={obj.id || `obj-${i}`}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: sectionUnderstood[i] ? "#16a34a" : i === teachingSection ? T.accent || tc : T.border1,
                      cursor: i <= teachingSection ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: "white",
                      fontWeight: 700,
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => i <= teachingSection && setTeachingSection(i)}
                    onKeyDown={(e) => e.key === "Enter" && i <= teachingSection && setTeachingSection(i)}
                  >
                    {sectionUnderstood[i] ? "✓" : i + 1}
                  </div>
                ))}
              </div>

              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.accent || tc,
                  marginBottom: 8,
                  letterSpacing: "0.03em",
                  fontFamily: MONO,
                }}
              >
                OBJECTIVE {teachingSection + 1} OF {resolvedObjectives.length}
              </div>
              <div
                id={
                  resolvedObjectives[teachingSection]?.id
                    ? `rxt-dl-teach-obj-${resolvedObjectives[teachingSection].id}`
                    : undefined
                }
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  marginBottom: 16,
                  lineHeight: 1.4,
                  fontFamily: SERIF,
                  color: T.text1,
                }}
              >
                {resolvedObjectives[teachingSection]?.objective ||
                  resolvedObjectives[teachingSection]?.text ||
                  ""}
              </div>

              {loadingSection ? (
                <div style={{ color: T.textSecondary || T.text3, fontSize: 13, fontFamily: MONO }}>Teaching this section…</div>
              ) : sectionExplanation ? (
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.7,
                    color: T.text1,
                    marginBottom: 20,
                    whiteSpace: "pre-wrap",
                    fontFamily: MONO,
                  }}
                >
                  {sectionExplanation}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void generateTeachingSection(teachingSection)}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 8,
                    background: T.accent || tc,
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 14,
                    fontFamily: MONO,
                  }}
                >
                  📖 Teach me this objective →
                </button>
              )}

              {sectionExplanation && (
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSectionUnderstood((prev) => ({ ...prev, [teachingSection]: true }));
                      if (teachingSection < resolvedObjectives.length - 1) {
                        setTeachingSection((s) => s + 1);
                        setSectionExplanation(null);
                      } else {
                        setPatientCase(null);
                        advancePhase("patient");
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      borderRadius: 8,
                      background: "#16a34a",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                      fontFamily: MONO,
                      minWidth: 160,
                    }}
                  >
                    {teachingSection < resolvedObjectives.length - 1
                      ? "✓ Got it — next objective →"
                      : "✓ Got it — meet your patient →"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSectionExplanation(null);
                      void generateTeachingSection(teachingSection);
                    }}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 8,
                      border: "1px solid " + T.border1,
                      background: "transparent",
                      color: T.text1,
                      cursor: "pointer",
                      fontSize: 13,
                      fontFamily: MONO,
                    }}
                  >
                    ↺ Explain differently
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Phase 3: Patient anchor */}
      {phase === "patient" && (
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "patient")?.subtitle || "PATIENT ANCHOR"}
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
                      generatePatientCase(lectureContent, resolvedObjectives || [], lectureTitle, lec, blockId)
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
            onClick={() => void advanceToReadRecall()}
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
            Self-Test →
          </button>
        </div>
      )}

      {/* Phase 6: Fix Your Gaps (structure + anatomy walkthrough) */}
      {phase === "gaps" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mcqGenerationError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid " + (T.statusWarn || "#f59e0b"),
                background: T.statusWarnBg || "#fffbeb",
                fontFamily: MONO,
                fontSize: 13,
                color: T.text2,
                lineHeight: 1.5,
              }}
            >
              {mcqGenerationError}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setMcqGenerationError(null);
                    void advanceToMCQ();
                  }}
                  disabled={loading}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: loading ? T.border1 : tc,
                    color: "#fff",
                    cursor: loading ? "default" : "pointer",
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {loading ? "Generating…" : "↺ Regenerate MCQs"}
                </button>
              </div>
            </div>
          )}
          {isFirstPass && isAnatomyContent && walkthroughObjectives.length === 0 && (
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
                Objectives couldn&apos;t be loaded for this lecture. Enter them manually to continue — one per line, or paste them from your lecture slides.
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
          )}
          {isFirstPass && isAnatomyContent && walkthroughObjectives.length > 0 && (
            <>
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
                  {DEEP_LEARN_PHASES.find((p) => p.id === "gaps")?.subtitle || "FIX YOUR GAPS"}
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
                onComplete={() => void advanceToMCQ()}
                sessionId={sessionId}
                deleteSession={deleteSession}
              />
            </>
          )}
          {!(isFirstPass && isAnatomyContent && walkthroughObjectives.length > 0) && (
            <>
              {!structureContent && loading && (
                <div style={{ padding: 32, textAlign: "center", fontFamily: MONO, color: T.text3 }}>Building your gap review…</div>
              )}
              {!structureContent && !loading && (
                <div style={{ padding: 32, textAlign: "center", fontFamily: MONO, color: T.text3 }}>Preparing structure review…</div>
              )}
              {structureContent && (
                <>
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "gaps")?.subtitle || "FIX YOUR GAPS"}
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "gaps")?.title || "Fix Your Gaps"}
            </div>
            <div
              style={{
                fontFamily: MONO,
                color: T.text3,
                fontSize: 13,
              }}
            >
              Walk the hierarchy. At each level ask: &quot;How does this explain my patient&apos;s presentation?&quot; Answer
              each question, then connect it to your patient.
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
                  setStructureQuestionsError(null);
                  setLoading(true);
                  try {
                    await runStructureSaqQuestions(lines);
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
            <div style={{ textAlign: "center", marginTop: 16, padding: "20px" }}>
              <div
                style={{
                  fontSize: 13,
                  color: T.textSecondary || T.text3,
                  marginBottom: 12,
                  fontFamily: MONO,
                  maxWidth: 420,
                  marginLeft: "auto",
                  marginRight: "auto",
                  lineHeight: 1.5,
                }}
              >
                {structureQuestionsError ||
                  "Questions could not be generated — tap Retry or continue to the next phase."}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={async () => {
                    setStructureQuestionsError(null);
                  setLoading(true);
                  try {
                      await runStructureSaqQuestions();
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                style={{
                    padding: "8px 20px",
                  borderRadius: 8,
                    background: T.accent || tc,
                    color: "#fff",
                    border: "none",
                    cursor: loading ? "default" : "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  fontFamily: MONO,
                  }}
                >
                  {loading ? "Generating…" : "↺ Retry"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStructureQuestionsError(null);
                    void advanceToMCQ();
                  }}
                  disabled={loading}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    border: `1px solid ${T.border1 || T.border2}`,
                    background: "transparent",
                    color: T.text1,
                  cursor: loading ? "default" : "pointer",
                    fontSize: 13,
                    fontFamily: MONO,
                    fontWeight: 600,
                }}
              >
                  Skip → Next phase
              </button>
              </div>
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
                  onClick={() => void advanceToMCQ()}
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
                  {loading ? "Generating MCQs..." : "Clinical MCQs →"}
                </button>
              </>
            );
          })()}
                </>
                  )}
                </>
          )}
        </div>
      )}

      {/* Phase 4: Self-Test */}
      {phase === "selftest" && (() => {
        const lectureText =
          isCrossLecture && crossCtx?.lecs?.length
            ? (crossCtx.lecs || [])
                .map((l) => {
                  const title = `[${l.lectureType || "LEC"} ${l.lectureNumber ?? ""} — ${l.lectureTitle || l.fileName || ""}]`;
                  const content = getLecText(l) || l.text || "";
                  return `${title}\n${content}`;
                })
                .join("\n\n────────────────────\n\n")
            : lectureContent || getLecText(lec) || lec?.text || "";
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
              {DEEP_LEARN_PHASES.find((p) => p.id === "selftest")?.subtitle || "SELF-TEST"}
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
                      ? isCrossLecture && crossCtx?.lecs?.length
                        ? `Recall the key points from all ${crossCtx.lecs.length} lectures above, and describe any connections between them.`
                        : "You've been taught the key concepts. Now close your eyes and recall — what were the main ideas, key terms, and clinical connections from this lecture?"
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
                          (isCrossLecture ? crossSystemPrefix + "\n\n" : "") +
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
      {phase === "apply" && mcqQuestions.length > 0 && (
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: MONO, color: tc, fontSize: 10, letterSpacing: 1.5 }}>
                {DEEP_LEARN_PHASES.find((p) => p.id === "apply")?.subtitle || "CLINICAL MCQ"} ({currentMCQ + 1}/{mcqQuestions.length})
              </div>
              {(() => {
                const tier = mcqQuestions[0]?.difficulty;
                if (!tier) return null;
                const tierMeta = {
                  foundational: { label: "Foundational", color: "#22c55e" },
                  developing:   { label: "Developing",   color: "#f59e0b" },
                  advanced:     { label: "Advanced",     color: "#f97316" },
                  exam:         { label: "Exam-Ready",   color: "#ef4444" },
                };
                const meta = tierMeta[tier] || { label: tier, color: tc };
                return (
                  <div style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: 1,
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: `1px solid ${meta.color}`,
                    color: meta.color,
                    textTransform: "uppercase",
                  }}>
                    {meta.label}
                  </div>
                );
              })()}
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
              width: "100%",
              maxWidth: 860,
              margin: "0 auto",
              boxSizing: "border-box",
              background: T.cardBg,
              border: "1px solid " + T.border1,
              borderRadius: 12,
              padding: "18px 24px",
            }}
          >
            <div
              ref={dlStemContainerRef}
              onMouseUp={handleDlStemSelection}
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 16,
                lineHeight: 1.75,
                fontWeight: 600,
                cursor: "text",
                userSelect: "text",
                position: "relative",
                WebkitUserSelect: "text",
              }}
            >
              {renderAnnotatableStemNodes(String(mcqQuestions[currentMCQ]?.stem || ""))}
            </div>
          </div>

          <div
            style={{
              width: "100%",
              maxWidth: 860,
              margin: "0 auto",
              padding: "0 24px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
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
                {mcqFeedback.correct && !mcqFeedback.confidenceChosen && (
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 12, color: T.text3, fontFamily: MONO }}>
                      Did you actually know this?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleMcqConfidence(mcqFeedback.questionId, "knew")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid " + T.border1,
                        background: T.inputBg,
                        color: T.text1,
                        fontFamily: MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      ✓ Yes, knew it
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMcqConfidence(mcqFeedback.questionId, "guessed")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid " + T.border1,
                        background: T.inputBg,
                        color: T.text1,
                        fontFamily: MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      ⚡ Got lucky
                    </button>
                  </div>
                )}
                {mcqFeedback.confidenceChosen === "guessed" && (
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      color: T.statusWarn,
                      marginTop: 8,
                    }}
                  >
                    Flagged for review — this won&apos;t count toward mastery
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
          {dlStemAnnotation && (
            <>
              <div
                role="presentation"
                style={{ position: "fixed", inset: 0, zIndex: 9998 }}
                onClick={() => setDlStemAnnotation(null)}
              />
              <div
                role="dialog"
                aria-label="Stem annotation"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  left: Math.max(
                    8,
                    Math.min(
                      dlStemAnnotation.x - 150,
                      (typeof window !== "undefined" ? window.innerWidth : 800) - 308
                    )
                  ),
                  top: Math.max(
                    8,
                    Math.min(
                      dlStemAnnotation.y - 160,
                      (typeof window !== "undefined" ? window.innerHeight : 600) - 280
                    )
                  ),
                  width: 300,
                  background: "white",
                  borderRadius: 12,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                  border: "1px solid #e2e8f0",
                  padding: 16,
                  zIndex: 9999,
                  fontFamily: MONO,
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: "#1e293b",
                      wordBreak: "break-word",
                      paddingRight: 8,
                    }}
                  >
                    🔬 {dlStemAnnotation.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDlStemAnnotation(null)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 16,
                      color: "#94a3b8",
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
                {dlStemAnnotation.loading ? (
                  <div style={{ color: "#64748b" }}>Looking up...</div>
                ) : (
                  <>
                    {dlStemAnnotation.result?.normalRange && (
                      <div
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #86efac",
                          borderRadius: 6,
                          padding: "6px 10px",
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>Normal range:</span>{" "}
                        <span style={{ color: "#15803d" }}>{dlStemAnnotation.result.normalRange}</span>
                        {dlStemAnnotation.result.direction && (
                          <span
                            style={{
                              marginLeft: 8,
                              color:
                                String(dlStemAnnotation.result.direction).toUpperCase() === "HIGH"
                                  ? "#dc2626"
                                  : "#2563eb",
                              fontWeight: 700,
                            }}
                          >
                            {String(dlStemAnnotation.result.direction).toUpperCase() === "LOW" ? "↓ " : "↑ "}
                            {String(dlStemAnnotation.result.direction).toUpperCase()}
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ color: "#334155", lineHeight: 1.5, marginBottom: 8 }}>
                      {dlStemAnnotation.result?.significance}
                    </div>
                    {dlStemAnnotation.result?.clinicalImplication && (
                      <div
                        style={{
                          background: "#eff6ff",
                          border: "1px solid #93c5fd",
                          borderRadius: 6,
                          padding: "6px 10px",
                          color: "#1d4ed8",
                          fontSize: 11,
                        }}
                      >
                        💡 {dlStemAnnotation.result.clinicalImplication}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAddDlStemAnnotationToNotes(dlStemAnnotation)}
                      disabled={!resolveMcqObjectiveIdForNotes || !onAppendObjectiveNote}
                      style={{
                        marginTop: 10,
                        width: "100%",
                        padding: "6px 0",
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                        background:
                          !resolveMcqObjectiveIdForNotes || !onAppendObjectiveNote ? T.border1 : "#f8fafc",
                        color: "#475569",
                        fontSize: 11,
                        cursor:
                          !resolveMcqObjectiveIdForNotes || !onAppendObjectiveNote ? "not-allowed" : "pointer",
                        fontFamily: MONO,
                        opacity: !resolveMcqObjectiveIdForNotes || !onAppendObjectiveNote ? 0.55 : 1,
                      }}
                    >
                      📝 Save to objective notes
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {dlStemToast && (
            <div
              style={{
                position: "fixed",
                bottom: 24,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 10000,
                padding: "8px 16px",
                borderRadius: 8,
                background: "#1e293b",
                color: "#f8fafc",
                fontFamily: MONO,
                fontSize: 12,
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              }}
            >
              {dlStemToast}
            </div>
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
              {isCrossLecture && crossCtx?.lecs?.length ? crossLectureTitleLine(crossCtx.lecs) : lectureTitle}
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
            {isCrossLecture && crossCtx?.lecs?.length ? (
              <div
                style={{
                  fontFamily: MONO,
                  color: T.text2,
                  fontSize: 12,
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                How confident do you feel about:
                <ul style={{ margin: "8px 0 0 0", paddingLeft: 18 }}>
                  {(crossCtx.lecs || []).map((l) => (
                    <li key={l.id}>
                      {l.lectureType || "LEC"} {l.lectureNumber ?? ""} — {l.lectureTitle || l.fileName || ""}
                    </li>
                  ))}
                </ul>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
                  Single confidence rating applies to all lectures in this session.
                </div>
              </div>
            ) : null}
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
              if (isCrossLecture && crossCtx?.lecs?.length >= 2) {
                const score =
                  postMCQScore != null
                    ? postMCQScore
                    : results?.length
                      ? Math.round(
                          (results.filter((r) => mcqResultCountsTowardCorrectScore(r)).length / results.length) *
                            100
                        )
                      : 0;
                finalizeCrossSession(
                  crossCtx,
                  {
                    score,
                    preSAQScore,
                    postMCQScore: score,
                    confidenceLevel,
                  },
                  blockId,
                  makeTopicKey,
                  results
                );
                if (sessionId && deleteSession) deleteSession(sessionId);
                onComplete?.();
                return;
              }
              const meta = {
                blockId,
                topicKey: makeTopicKey
                  ? makeTopicKey(resolvedObjectives?.[0]?.linkedLecId ?? null, blockId)
                  : (blockId + "__" + (resolvedObjectives?.[0]?.linkedLecId || "block")),
                difficulty: (() => {
                  try {
                    const p = JSON.parse(localStorage.getItem("rxt-performance") || "{}");
                    const tk = makeTopicKey
                      ? makeTopicKey(resolvedObjectives?.[0]?.linkedLecId ?? null, blockId)
                      : (blockId + "__" + (resolvedObjectives?.[0]?.linkedLecId || "block"));
                    return computeDifficultyLabel(p[tk] || null);
                  } catch { return "foundational"; }
                })(),
                targetObjectives: resolvedObjectives,
                preSAQScore,
                postMCQScore,
                confidenceLevel,
                nextReview,
                sessionType: "deepLearn",
                lectureId: resolvedObjectives?.[0]?.linkedLecId ?? null,
              };
              if (sessionId && deleteSession) deleteSession(sessionId);
              if (meta.lectureId) {
                dlLogDeepLearnActivityToCompletion(meta.lectureId, blockId, confidenceLevel);
              }
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

// Wrapper: show Config then Session (mastery loop)
export default function DeepLearn({
  blockId,
  lecs = [],
  blockObjectives = [],
  lecObjectives: lecObjectivesProp = [],
  getBlockObjectives,
  onAppendObjectiveNote,
  questionBanksByFile = {},
  buildQuestionContext,
  detectStudyMode: detectStudyModeProp,
  onBack,
  onRelaunch,
  termColor,
  makeTopicKey,
  performanceHistory = {},
  initialRapidFireMode = false,
  preselectLecId = null,
  deeplinkObjectiveId = null,
}) {
  const { T } = useTheme();
  const tc = termColor || T.purple;

  // ── Rapid Fire Mode (compressed, no AI generation) ──────────────────────────
  function buildRapidFireQueue(lec, _blockId, blockObjs) {
    const lecObjs = (blockObjs || []).filter((o) => o?.linkedLecId === lec?.id);

    // Priority order:
    // 1. Struggling objectives
    // 2. In progress objectives
    // 3. Untested objectives (high Bloom first)
    // 4. Mastered objectives (low priority, add if queue < 10)
    const struggling = lecObjs.filter((o) => o?.status === "struggling");
    const inprogress = lecObjs.filter((o) => o?.status === "inprogress");
    const untested = lecObjs
      .filter((o) => !o?.status || o?.status === "untested")
      .sort((a, b) => (b?.bloom_level || 1) - (a?.bloom_level || 1));
    const mastered = lecObjs.filter((o) => o?.status === "mastered");

    let queue = [...struggling, ...inprogress, ...untested];

    // If queue is very short, pad with mastered to ensure at least 5 cards
    if (queue.length < 5) {
      queue = [...queue, ...mastered.slice(0, 5 - queue.length)];
    }

    return queue;
  }

  const rapidFireLec = useMemo(() => {
    if (!Array.isArray(lecs) || lecs.length === 0) return null;
    const objs = lecObjectivesProp || [];
    const linked = objs.find((o) => o?.linkedLecId)?.linkedLecId;
    if (linked) {
      const byId = lecs.find((l) => l.id === linked);
      if (byId) return byId;
    }
    const first = objs?.[0];
    if (first && (first.lectureNumber != null || first.lectureType != null)) {
      const num = first.lectureNumber;
      const type = (first.lectureType || "LEC").toUpperCase();
      const byTypeNum = lecs.find(
        (l) =>
          String(l.lectureNumber) === String(num) &&
          String((l.lectureType || "LEC").toUpperCase()) === String(type)
      );
      if (byTypeNum) return byTypeNum;
    }
    return lecs[0] || null;
  }, [lecs, lecObjectivesProp]);

  const initialRfQueue =
    initialRapidFireMode && rapidFireLec ? buildRapidFireQueue(rapidFireLec, blockId, blockObjectives) : [];

  const [rapidFireMode, setRapidFireMode] = useState(!!initialRapidFireMode);
  const [rfQueue, setRfQueue] = useState(initialRfQueue);
  const [rfIndex, setRfIndex] = useState(0);
  const [rfRevealed, setRfRevealed] = useState(false);
  const [rfComplete, setRfComplete] = useState(false);
  const [rfStats, setRfStats] = useState({ mastered: 0, okay: 0, struggling: 0, skipped: 0 });
  const [rfStartTime, setRfStartTime] = useState(null);
  const [rfElapsedSeconds, setRfElapsedSeconds] = useState(0);
  const [rfCardOpacity, setRfCardOpacity] = useState(1);

  const [rfStrugglingIds, setRfStrugglingIds] = useState([]);
  const rfSavedRef = useRef(false);
  const rfInitOnceRef = useRef(false);

  const startRapidFireWithQueue = useCallback(
    (queue) => {
      setRfQueue(queue || []);
      setRfIndex(0);
      setRfRevealed(false);
      setRfComplete(false);
      setRfStats({ mastered: 0, okay: 0, struggling: 0, skipped: 0 });
      setRfStartTime(Date.now());
      setRfElapsedSeconds(0);
      setRfCardOpacity(1);
      setRfStrugglingIds([]);
      rfSavedRef.current = false;
      rfInitOnceRef.current = true;
      setRapidFireMode(true);
    },
    []
  );

  const exitRapidFire = useCallback(() => {
    setRapidFireMode(false);
    setRfComplete(false);
    setRfRevealed(false);
  }, []);

  useEffect(() => {
    if (!initialRapidFireMode) return;
    if (!rapidFireLec) return;
    if (rfInitOnceRef.current) return;
    rfInitOnceRef.current = true;
    queueMicrotask(() =>
      startRapidFireWithQueue(buildRapidFireQueue(rapidFireLec, blockId, blockObjectives))
    );
  }, [initialRapidFireMode, rapidFireLec, blockId, blockObjectives, startRapidFireWithQueue]);

  useEffect(() => {
    if (!rapidFireMode || rfComplete || !rfStartTime) return;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - rfStartTime) / 1000);
      setRfElapsedSeconds(elapsed);
    }, 1000);
    queueMicrotask(() =>
      setRfElapsedSeconds(Math.floor((Date.now() - rfStartTime) / 1000))
    );
    return () => clearInterval(id);
  }, [rapidFireMode, rfComplete, rfStartTime]);

  useEffect(() => {
    if (!rapidFireMode || rfComplete) return;
    queueMicrotask(() => setRfCardOpacity(0));
    const t = setTimeout(() => setRfCardOpacity(1), 60);
    return () => clearTimeout(t);
  }, [rfRevealed, rfIndex, rapidFireMode, rfComplete]);

  const advanceRf = useCallback(() => {
    setRfRevealed(false);
    if (rfIndex + 1 >= rfQueue.length) setRfComplete(true);
    else setRfIndex((prev) => prev + 1);
  }, [rfIndex, rfQueue.length]);

  const handleRfSkip = useCallback(() => {
    setRfStats((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
    advanceRf();
  }, [advanceRf]);

  const handleRfAssess = useCallback(
    (newStatus) => {
      const obj = rfQueue[rfIndex];
      if (!obj) return;

      // Update objective status in rxt-block-objectives
      try {
        const key = "rxt-block-objectives";
        const stored = JSON.parse(localStorage.getItem(key) || "{}");
        const bid = blockId;
        const blockObjs = stored[bid] || [];
        const idx = blockObjs.findIndex((o) => o?.id === obj?.id);
        if (idx !== -1) {
          blockObjs[idx].status = newStatus;
          blockObjs[idx].lastDrilled = new Date().toISOString();
          stored[bid] = blockObjs;
          localStorage.setItem(key, JSON.stringify(stored));
        }
      } catch (e) {
        console.warn("Rapid Fire objective update failed:", e);
      }

      if (newStatus === "struggling")
        setRfStrugglingIds((prev) => (prev.includes(obj.id) ? prev : [...prev, obj.id]));

      // Update stats
      setRfStats((prev) => ({
        ...prev,
        mastered: newStatus === "mastered" ? prev.mastered + 1 : prev.mastered,
        okay: newStatus === "inprogress" ? prev.okay + 1 : prev.okay,
        struggling: newStatus === "struggling" ? prev.struggling + 1 : prev.struggling,
      }));

      advanceRf();
    },
    [rfQueue, rfIndex, blockId, advanceRf]
  );

  // Keyboard shortcuts while Rapid Fire is active.
  useEffect(() => {
    if (!rapidFireMode) return;
    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exitRapidFire();
        return;
      }

      if (rfComplete) return;

      const revealKeys = e.key === " " || e.key === "Spacebar" || e.key === "Enter";
      if (!rfRevealed && revealKeys) {
        e.preventDefault();
        setRfRevealed(true);
        return;
      }

      if (rfRevealed) {
        if (e.key === "1" || e.key === "ArrowLeft") {
          e.preventDefault();
          handleRfAssess("struggling");
        } else if (e.key === "2" || e.key === "ArrowDown") {
          e.preventDefault();
          handleRfAssess("inprogress");
        } else if (e.key === "3" || e.key === "ArrowRight") {
          e.preventDefault();
          handleRfAssess("mastered");
        } else if (e.key === "s" || e.key === "S" || e.key === "ArrowUp") {
          e.preventDefault();
          handleRfSkip();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rapidFireMode, rfComplete, rfRevealed, handleRfAssess, handleRfSkip, exitRapidFire]);

  // Save lightweight rapid-fire session to rxt-performance after completion.
  useEffect(() => {
    if (!rfComplete) return;
    if (!rapidFireLec) return;
    if (rfSavedRef.current) return;
    if (!rfStartTime) return;

    try {
      rfSavedRef.current = true;
      const key = `${rapidFireLec.id}__${blockId}`;
      const allPerf = JSON.parse(localStorage.getItem("rxt-performance") || "{}");
      const existing = allPerf[key] || { sessions: [] };
      const existingSessions = Array.isArray(existing.sessions) ? existing.sessions : [];

      const assessedCount = rfStats.mastered + rfStats.okay + rfStats.struggling;
      const score = Math.round((rfStats.mastered / Math.max(assessedCount, 1)) * 100);
      const now = new Date().toISOString();

      const rfSessionRecord = {
        score,
        date: now,
        startedAt: now,
        completedAt: now,
        questionCount: assessedCount,
        difficulty: "rapid_fire",
        sessionType: "rapid_fire",
        lectureId: rapidFireLec.id,
        blockId,
        topicKey: key,
        lectureType: rapidFireLec.lectureType ?? null,
        lectureNumber: rapidFireLec.lectureNumber ?? null,
        lectureName: rapidFireLec.lectureTitle || rapidFireLec.fileName || rapidFireLec.fileName || null,
        rfStats: { ...rfStats },
        durationSeconds: Math.floor((Date.now() - rfStartTime) / 1000),
      };

      const updatedSessions = [...existingSessions, rfSessionRecord].slice(-50);
      allPerf[key] = {
        ...existing,
        sessions: updatedSessions,
        lastStudied: now,
        firstStudied: existing.firstStudied || now,
        lastScore: score,
        lectureId: rapidFireLec.id,
        blockId,
        lectureType: rfSessionRecord.lectureType ?? existing.lectureType,
        lectureNumber: rfSessionRecord.lectureNumber ?? existing.lectureNumber,
        lectureName: rfSessionRecord.lectureName ?? existing.lectureName,
        currentDifficulty: existing.currentDifficulty || "rapid_fire",
      };
      localStorage.setItem("rxt-performance", JSON.stringify(allPerf));
    } catch (e) {
      console.warn("Rapid Fire performance save failed:", e);
    }
  }, [rfComplete, rapidFireLec, rfStartTime, blockId, rfStats]);

  const [phase, setPhase] = useState("config");
  const [sessionParams, setSessionParams] = useState(null);
  const [crossPrepPayload, setCrossPrepPayload] = useState(null);
  const [pausedExpanded, setPausedExpanded] = useState(false);

  const [savedDeepLearnSessions, setSavedDeepLearnSessions] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("rxt-dl-sessions") || "{}");
      return migrateSavedDeepLearnSessionsMap(raw);
    } catch {
      return {};
    }
  });

  const saveDeepLearnProgress = useCallback((sessionId, data) => {
    setSavedDeepLearnSessions((prev) => {
      const normalized = {
        ...data,
        phase: typeof data?.phase === "string" ? migrateDeepLearnPhase(data.phase) : data?.phase,
      };
      const updated = {
        ...prev,
        [sessionId]: {
          ...normalized,
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

  const launchDeepLearn = useCallback((cfg, sid) => {
    const { selectedTopics, blockId: bid } = cfg;
    setSessionParams({
      sessionType: cfg.sessionType,
      selectedTopics,
      blockId: bid,
      sessionId: sid,
      isCrossLecture: !!cfg.isCrossLecture,
      crossCtx: cfg.crossCtx || null,
      displayLectureTitle: cfg.displayLectureTitle || null,
      deeplinkObjectiveId: cfg.deeplinkObjectiveId ?? null,
    });
    setPhase("session");
  }, []);

  const crossIdsKey = (topics) =>
    [...(topics || [])]
      .map((t) => t.lecId)
      .filter(Boolean)
      .sort()
      .join(",");

  const handleStart = useCallback(
    ({ sessionType, selectedTopics, blockId: bid }) => {
      const lecTopics = (selectedTopics || []).filter((t) => t.lecId);
      const sessionDeeplink = lecTopics.length >= 2 ? null : deeplinkObjectiveId ?? null;
      if (lecTopics.length >= 2) {
        const idsKey = crossIdsKey(lecTopics);
        const sessionId = `dl_cross_${bid}_${idsKey.replace(/,/g, "_")}_${Date.now()}`;
        const existingSession = Object.values(savedDeepLearnSessions).find((s) => {
          if (s.blockId !== bid || s.phase === "summary" || !s.isCrossLecture) return false;
          const ek = [...(s.crossLectureIds || [])].sort().join(",");
          return ek === idsKey;
        });
        if (existingSession) {
          setPendingDeepLearnStart({
            cfg: {
              sessionType,
              selectedTopics: lecTopics,
              blockId: bid,
              isCrossLecture: true,
              deeplinkObjectiveId: null,
            },
            sessionId,
            existingSession,
          });
          return;
        }
        setCrossPrepPayload({ sessionType, selectedTopics: lecTopics, blockId: bid, sessionId });
        setPhase("crossPrep");
        return;
      }

      const sessionId = `dl_${bid}_${selectedTopics?.[0]?.lecId}_${Date.now()}`;
      const existingSession = Object.values(savedDeepLearnSessions).find(
        (s) =>
          s.blockId === bid &&
          s.lecId === selectedTopics?.[0]?.lecId &&
          s.phase !== "summary"
      );
      if (existingSession) {
        setPendingDeepLearnStart({
          cfg: { sessionType, selectedTopics, blockId: bid, deeplinkObjectiveId: sessionDeeplink },
          sessionId,
          existingSession,
        });
        return;
      }
      launchDeepLearn(
        { sessionType, selectedTopics, blockId: bid, deeplinkObjectiveId: sessionDeeplink },
        sessionId
      );
    },
    [savedDeepLearnSessions, launchDeepLearn, deeplinkObjectiveId]
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

  const resumedCrossCtx = useMemo(() => {
    if (!sessionParams?.isCrossLecture) return null;
    if (sessionParams.crossCtx?.lecs?.length >= 2) return sessionParams.crossCtx;
    const ids = sessionParams.crossLectureIds?.length
      ? sessionParams.crossLectureIds
      : (sessionParams.selectedTopics || []).map((t) => t.lecId).filter(Boolean);
    const lecObjs = ids.map((id) => lecs.find((l) => l.id === id)).filter(Boolean);
    if (lecObjs.length < 2) return null;
    return buildCrossLectureContext(
      lecObjs,
      sessionParams.blockId ?? blockId,
      blockObjectives,
      performanceHistory,
      makeTopicKey
    );
  }, [sessionParams, lecs, blockObjectives, performanceHistory, makeTopicKey, blockId]);

  const objectivesForSession = sessionParams?.resuming
    ? sessionParams.objectives?.length
      ? sessionParams.objectives
      : resumedCrossCtx?.allObjs || []
    : sessionParams?.isCrossLecture && resumedCrossCtx
      ? resumedCrossCtx.allObjs
      : firstTopic?.weak
        ? firstTopic.objectives || []
        : lecObjectivesProp && lecObjectivesProp.length > 0
          ? lecObjectivesProp
          : filteredByLec.length > 0
            ? filteredByLec
            : blockObjectives && blockObjectives.length > 0
              ? blockObjectives
              : [];

  if (rapidFireMode) {
    const lec = rapidFireLec;
    const currentObj = rfQueue[rfIndex];
    const totalCards = rfQueue.length || 0;

    const formatMMSS = (seconds) => {
      const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
      const m = Math.floor(s / 60);
      const ss = s % 60;
      return `${m}:${String(ss).padStart(2, "0")}`;
    };

    const assessedCount = rfStats.mastered + rfStats.okay + rfStats.struggling;
    const elapsedSeconds = rfElapsedSeconds;

    const insight =
      rfStats.struggling > rfStats.mastered
        ? { text: "⚠ Most of these need more work — add them to your review schedule", color: "#A32D2D" }
        : rfStats.mastered > (totalCards || 1) * 0.7
          ? { text: "✓ Strong performance — well prepared on these objectives", color: "#27500A" }
          : { text: "△ Mixed results — focus on the struggling objectives next session", color: "#633806" };

    // Completion screen
    if (rfComplete) {
      const pace =
        elapsedSeconds > 0 ? Math.round(((assessedCount / (elapsedSeconds / 60)) || 0) * 10) / 10 : 0;

      const struggledIds = rfStrugglingIds;
      return (
        <div style={{ padding: "24px 32px 48px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: MONO }}>
          <div style={{ maxWidth: 400, margin: "0 auto", padding: "0 0 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: T.text1 }}>⚡ Rapid Fire complete</div>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 13 }}>{formatMMSS(elapsedSeconds)}</div>
            </div>

            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 13, marginBottom: 0, textAlign: "center" }}>
              {assessedCount} objectives reviewed
            </div>

            <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
              {[
                { label: "✓ Mastered", val: rfStats.mastered, color: "#639922" },
                { label: "△ Okay", val: rfStats.okay, color: "#BA7517" },
                { label: "⚠ Struggling", val: rfStats.struggling, color: "#E24B4A" },
                { label: "→ Skipped", val: rfStats.skipped, color: T.text3 },
              ].map((cell) => (
                <div
                  key={cell.label}
                  style={{
                    flex: 1,
                    background: T.cardBg,
                    borderRadius: 12,
                    padding: 12,
                    textAlign: "center",
                    border: "1px solid " + T.border1,
                  }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 900, color: cell.color }}>{cell.val}</div>
                  <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>{cell.label.replace(/[✓△⚠→]\s*/g, "")}</div>
                </div>
              ))}
            </div>

            <div style={{ fontFamily: MONO, color: T.text2, fontSize: 13, textAlign: "center", marginBottom: 12 }}>
              {pace} objectives/minute
            </div>

            <div style={{ fontSize: 13, textAlign: "center", marginBottom: 16, color: insight.color }}>{insight.text}</div>

            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {rfStats.struggling > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const ids = struggledIds;
                    const queue =
                      lec
                        ? (blockObjectives || []).filter((o) => o?.linkedLecId === lec.id && ids.includes(o?.id))
                        : [];
                    startRapidFireWithQueue(queue);
                  }}
                  style={{
                    background: "#FCEBEB",
                    color: "#A32D2D",
                    border: "0.5px solid #F09595",
                    borderRadius: "var(--border-radius-md, 8px)",
                    padding: "10px 14px",
                    fontFamily: MONO,
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  ⚡ Run again — struggling only
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  exitRapidFire();
                  const sel = lec
                    ? [
                        {
                          id: lec.id + "_full",
                          label: lec.lectureTitle,
                          lecId: lec.id,
                          weak: false,
                        },
                      ]
                    : [];
                  if (sel.length > 0) {
                    handleStart({ sessionType: "deep", selectedTopics: sel, blockId });
                  }
                }}
                style={{
                  background: "#EEEDFE",
                  color: "#3C3489",
                  border: "0.5px solid #AFA9EC",
                  borderRadius: "var(--border-radius-md, 8px)",
                  padding: "10px 14px",
                  fontFamily: MONO,
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                ▶ Full Deep Learn
              </button>
              <button
                type="button"
                onClick={() => {
                  exitRapidFire();
                }}
                style={{
                  background: T.cardBg,
                  border: "1px solid " + T.border1,
                  borderRadius: "var(--border-radius-md, 8px)",
                  padding: "10px 14px",
                  fontFamily: MONO,
                  fontSize: 12,
                  cursor: "pointer",
                  color: T.text1,
                  fontWeight: 700,
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Empty queue
    if (!lec || totalCards === 0) {
      return (
        <div style={{ padding: "24px 32px 48px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: MONO }}>
          <div style={{ maxWidth: 420, margin: "0 auto", background: T.cardBg, borderRadius: 12, border: "1px solid " + T.border1, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>⚡ Rapid Fire</div>
              <button
                type="button"
                onClick={exitRapidFire}
                style={{ fontSize: 12, color: T.text3, border: "none", background: "transparent", cursor: "pointer", fontFamily: MONO }}
              >
                ✕ Exit
              </button>
            </div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12, textAlign: "center", padding: 20 }}>
              No objectives available for this lecture.
            </div>
          </div>
        </div>
      );
    }

    // Active session UI
    const statusColor =
      currentObj?.status === "mastered"
        ? "#639922"
        : currentObj?.status === "inprogress"
          ? "#BA7517"
          : currentObj?.status === "struggling"
            ? "#E24B4A"
            : T.text3;

    const bloomLevel = currentObj?.bloom_level || 2;
    const bloomName = LEVEL_NAMES[bloomLevel] || LEVEL_NAMES[2];
    const bloomColor = LEVEL_COLORS[bloomLevel] || LEVEL_COLORS[2];
    const bloomBg = (LEVEL_BG && LEVEL_BG[bloomLevel]) || bloomColor + "18";

    const fillColor =
      rfStats.struggling > rfStats.mastered
        ? "#E24B4A"
        : rfStats.mastered > (totalCards || 1) * 0.6
          ? "#639922"
          : "#BA7517";

    const timerStr = formatMMSS(rfElapsedSeconds);

    return (
      <div style={{ padding: "24px 32px 48px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: MONO }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>⚡ Rapid Fire</div>
            <div style={{ fontSize: 12, color: T.text3 }}>
              · {(lec.lectureType || "LEC")} {lec.lectureNumber ?? ""}
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 13, color: T.text3 }}>{timerStr}</div>
          <button
            type="button"
            onClick={exitRapidFire}
            style={{
              fontSize: 12,
              color: T.text3,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontFamily: MONO,
              padding: 0,
            }}
          >
            ✕ Exit
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ height: 4, borderRadius: 2, background: T.border2 }}>
              <div
                style={{
                  height: "100%",
                  borderRadius: 2,
                  width: `${totalCards ? (rfIndex / totalCards) * 100 : 0}%`,
                  background: fillColor,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, flexShrink: 0 }}>
            {rfIndex} / {totalCards}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {rfStats.mastered > 0 && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: "#639922" }}>✓ {rfStats.mastered}</span>
            )}
            {rfStats.okay > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: "#BA7517" }}>△ {rfStats.okay}</span>}
            {rfStats.struggling > 0 && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: "#E24B4A" }}>⚠ {rfStats.struggling}</span>
            )}
          </div>
        </div>

        <div
          style={{
            background: T.cardBg,
            border: "0.5px solid " + T.border2,
            borderRadius: "var(--border-radius-lg, 12px)",
            padding: 24,
            minHeight: 180,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            cursor: "pointer",
            transition: "opacity 0.1s ease",
            opacity: rfCardOpacity,
          }}
          onClick={() => {
            if (!rfRevealed) setRfRevealed(true);
          }}
          role="button"
          tabIndex={0}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: T.text3,
                    background: T.pillBg,
                    border: "1px solid " + T.border1,
                    borderRadius: 999,
                    padding: "3px 10px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {(lec.lectureType || "LEC").toUpperCase()}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3 }}>
                  {lec.lectureNumber ?? ""}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: T.text3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 320,
                  }}
                >
                  {lec.lectureTitle || lec.fileName || ""}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: bloomBg,
                  color: bloomColor,
                  fontFamily: MONO,
                  fontWeight: 600,
                  border: "0.5px solid " + bloomColor + "55",
                }}
              >
                {bloomName}
              </span>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor, display: "inline-block" }} />
            </div>
          </div>

          <div
            style={{
              fontSize: rfRevealed ? 15 : 17,
              lineHeight: 1.6,
              color: rfRevealed ? T.text2 : T.text1,
              fontWeight: 400,
              flex: 1,
              whiteSpace: "pre-wrap",
            }}
          >
            {currentObj?.text || currentObj?.objective || ""}
          </div>

          {!rfRevealed ? (
            <div style={{ fontSize: 11, color: T.text3, textAlign: "center", marginTop: 16 }}>
              Tap to reveal · or press Space
            </div>
          ) : (
            <>
              <div style={{ borderTop: "0.5px solid " + T.border2, margin: "12px 0" }} />
              <div style={{ fontSize: 13, color: T.text2, fontStyle: "italic", marginBottom: 12, textAlign: "center" }}>
                How well did you know this?
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRfAssess("struggling");
                  }}
                  style={{
                    background: "#FCEBEB",
                    color: "#A32D2D",
                    border: "0.5px solid #F09595",
                    padding: "10px 16px",
                    fontSize: 13,
                    borderRadius: "var(--border-radius-md, 8px)",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontWeight: 700,
                  }}
                >
                  ⚠ Struggling
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRfAssess("inprogress");
                  }}
                  style={{
                    background: "#FAEEDA",
                    color: "#633806",
                    border: "0.5px solid #EF9F27",
                    padding: "10px 16px",
                    fontSize: 13,
                    borderRadius: "var(--border-radius-md, 8px)",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontWeight: 700,
                  }}
                >
                  △ Okay
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRfAssess("mastered");
                  }}
                  style={{
                    background: "#EAF3DE",
                    color: "#27500A",
                    border: "0.5px solid #97C459",
                    padding: "10px 16px",
                    fontSize: 13,
                    borderRadius: "var(--border-radius-md, 8px)",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontWeight: 700,
                  }}
                >
                  ✓ Got it
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRfSkip();
                  }}
                  style={{
                    background: "transparent",
                    border: "0.5px solid " + T.border2,
                    color: T.text3,
                    padding: "10px 12px",
                    fontSize: 12,
                    borderRadius: "var(--border-radius-md, 8px)",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontWeight: 700,
                  }}
                >
                  → Skip
                </button>
              </div>
              <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginTop: 8 }}>
                Space reveal · 1 struggling · 2 okay · 3 got it · S skip
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 32px 48px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: MONO }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <button
          type="button"
          onClick={() => {
            if (phase === "session") {
              setPhase("config");
              setSessionParams(null);
            } else if (phase === "crossPrep") {
              setPhase("config");
              setCrossPrepPayload(null);
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
                Phase {deepLearnPhaseNumber(pendingDeepLearnStart.existingSession.phase)}{" "}
                ({migrateDeepLearnPhase(pendingDeepLearnStart.existingSession.phase)})
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
                ▶ Resume from Phase {deepLearnPhaseNumber(pendingDeepLearnStart.existingSession.phase)}
              </button>
              <button
                onClick={() => {
                  deleteDeepLearnSession(pendingDeepLearnStart.existingSession.sessionId);
                  const cfg = pendingDeepLearnStart.cfg;
                  if (cfg.isCrossLecture && cfg.selectedTopics?.length >= 2) {
                    const sel = cfg.selectedTopics
                      .map((t) => lecs.find((l) => l.id === t.lecId))
                      .filter(Boolean);
                    const xctx = buildCrossLectureContext(
                      sel,
                      cfg.blockId,
                      blockObjectives,
                      performanceHistory,
                      makeTopicKey
                    );
                    launchDeepLearn(
                      {
                        ...cfg,
                        crossCtx: xctx,
                        displayLectureTitle: crossLectureTitleLine(sel),
                      },
                      pendingDeepLearnStart.sessionId
                    );
                  } else {
                    launchDeepLearn(cfg, pendingDeepLearnStart.sessionId);
                  }
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

          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, color: T.text3, marginBottom: 10, textAlign: "center", fontFamily: MONO }}>
              What's next?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => onRelaunch?.("deep_learn")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid #dc2626`,
                  background: "transparent",
                  color: "#dc2626",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: MONO,
                }}
              >
                🧠 Deep Learn again
              </button>
              <button
                type="button"
                onClick={() => onRelaunch?.("drill")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${T.accent || "#2563eb"}`,
                  background: "transparent",
                  color: T.accent || "#2563eb",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: MONO,
                }}
              >
                ⚡ Drill objectives
              </button>
              <button
                type="button"
                onClick={() => onRelaunch?.("quiz")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid #d97706`,
                  background: "transparent",
                  color: "#d97706",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: MONO,
                }}
              >
                📝 Quiz
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "crossPrep" && crossPrepPayload && (() => {
        const MONO_X = "'DM Mono','Courier New',monospace";
        const SERIF_X = "'Playfair Display',Georgia,serif";
        const bid = crossPrepPayload.blockId;
        const selectedLecs = crossPrepPayload.selectedTopics
          .map((t) => lecs.find((l) => l.id === t.lecId))
          .filter(Boolean);
        const ctx = buildCrossLectureContext(
          selectedLecs,
          bid,
          blockObjectives,
          performanceHistory,
          makeTopicKey
        );
        const trunc = (s, n) => {
          const t = String(s || "");
          return t.length > n ? t.slice(0, n - 1) + "…" : t;
        };
        const scoreChip = (l) => {
          const perf = readLecPerf(l, bid, performanceHistory, makeTopicKey);
          const arr = Array.isArray(perf?.sessions) ? perf.sessions : [];
          const nSess = typeof perf?.sessions === "number" && !Array.isArray(perf?.sessions) ? perf.sessions : arr.length;
          const sc = perf?.lastScore ?? perf?.score ?? null;
          const col = sc == null ? T.text3 : Number(sc) >= 70 ? "#639922" : Number(sc) >= 50 ? "#BA7517" : "#E24B4A";
          const pct = sc != null && Number.isFinite(Number(sc)) ? `${sc}%` : "—";
          return { nSess, pct, col, label: `${l.lectureType || "LEC"}${l.lectureNumber ?? ""}` };
        };
        return (
          <div style={{ padding: "20px 24px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: MONO_X }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: T.text1, marginBottom: 8, fontFamily: SERIF_X }}>
              Cross-lecture session
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {selectedLecs.map((l) => {
                const full = `${l.lectureType || "LEC"} ${l.lectureNumber ?? ""} — ${l.lectureTitle || l.fileName || ""}`;
                const col = dlLecturePillColorFromLec(l);
                return (
                  <span
                    key={l.id}
                    title={full}
                    style={{
                      fontFamily: MONO_X,
                      fontSize: 11,
                      background: col + "22",
                      color: col,
                      border: "1px solid " + col + "55",
                      padding: "4px 10px",
                      borderRadius: 20,
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {trunc(full, 20)}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {selectedLecs.map((l) => {
                const c = scoreChip(l);
                return (
                  <span
                    key={l.id}
                    style={{
                      fontFamily: MONO_X,
                      fontSize: 11,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid " + T.border1,
                      color: c.col,
                      background: T.cardBg,
                    }}
                  >
                    {c.label} · {c.nSess} sessions · {c.pct}
                  </span>
                );
              })}
            </div>
            <div style={{ fontFamily: MONO_X, fontSize: 13, color: T.text2, marginBottom: 20 }}>
              {ctx.weakCount > 0 ? (
                <>△ {ctx.weakCount} weak objectives across {selectedLecs.length} lectures</>
              ) : (
                <>○ No weak objectives — first sessions</>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  launchDeepLearn(
                    {
                      sessionType: crossPrepPayload.sessionType,
                      selectedTopics: crossPrepPayload.selectedTopics,
                      blockId: bid,
                      isCrossLecture: true,
                      crossCtx: ctx,
                      displayLectureTitle: crossLectureTitleLine(selectedLecs),
                    },
                    crossPrepPayload.sessionId
                  );
                  setCrossPrepPayload(null);
                }}
                style={{
                  background: T.statusGood || "#10b981",
                  border: "none",
                  color: "#fff",
                  padding: "12px 24px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: SERIF_X,
                  fontSize: 15,
                  fontWeight: 900,
                }}
              >
                Start Session →
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhase("config");
                  setCrossPrepPayload(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: tc,
                  fontFamily: MONO_X,
                  fontSize: 12,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Back
              </button>
            </div>
          </div>
        );
      })()}

      {phase === "config" && (
        <>
          {(() => {
            const blockSessions = Object.values(savedDeepLearnSessions)
              .filter((s) => s.blockId === blockId && s.phase !== "summary")
              .sort((a, b) => new Date(b.lastSaved || 0) - new Date(a.lastSaved || 0));
            if (!blockSessions.length) return null;
            const recent = blockSessions[0];
            const resumeBtnStyle = {
              background: T.statusWarn,
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            };
            if (!pausedExpanded) {
              return (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setPausedExpanded(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPausedExpanded(true);
                    }
                  }}
                  style={{
                    background: "#FAEEDA",
                    border: "0.5px solid #EF9F27",
                    borderRadius: "var(--border-radius-md, 8px)",
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: 10, color: "#633806", flexShrink: 0 }}>▸</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#633806", fontFamily: MONO, flexShrink: 0 }}>
                    {blockSessions.length} paused session{blockSessions.length !== 1 ? "s" : ""}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#854F0B",
                      fontFamily: MONO,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    most recent: {recent?.lectureTitle || "—"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionParams({ ...recent, resuming: true });
                      setPhase("session");
                    }}
                    style={resumeBtnStyle}
                  >
                    Resume →
                  </button>
                </div>
              );
            }
            return (
              <div
                style={{
                  background: "#FAEEDA",
                  border: "0.5px solid #EF9F27",
                  borderRadius: "var(--border-radius-md, 8px)",
                  padding: "12px 14px",
                  marginBottom: 16,
                }}
              >
                <button
                  type="button"
                  onClick={() => setPausedExpanded(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "none",
                    border: "none",
                    padding: "0 0 10px 0",
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 12,
                    color: "#633806",
                    width: "100%",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 10 }}>▾</span>
                  <span style={{ fontWeight: 600 }}>
                    {blockSessions.length} paused session{blockSessions.length !== 1 ? "s" : ""}
                  </span>
                  <span style={{ fontSize: 11, color: "#854F0B" }}>· tap to collapse</span>
                </button>
                {blockSessions.map((s, idx) => (
                  <div
                    key={s.sessionId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: idx < blockSessions.length - 1 ? "1px solid #EF9F27" : "none",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: MONO, color: T.text1, fontSize: 12, fontWeight: 700 }}>{s.lectureTitle}</div>
                      <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                        Phase {deepLearnPhaseNumber(s.phase)} · {migrateDeepLearnPhase(s.phase)}
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
                      type="button"
                      onClick={() => {
                        setSessionParams({ ...s, resuming: true });
                        setPhase("session");
                      }}
                      style={resumeBtnStyle}
                    >
                      Resume →
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDeepLearnSession(s.sessionId)}
                      style={{
                        background: "none",
                        border: "none",
                        color: T.text3,
                        cursor: "pointer",
                        fontSize: 13,
                        flexShrink: 0,
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
            performanceHistory={performanceHistory}
            makeTopicKey={makeTopicKey}
            onStart={handleStart}
            T={T}
            tc={tc}
            preselectLecId={preselectLecId}
          />
        </>
      )}

      {phase === "session" && firstTopic && (
        <DeepLearnSession
          topic={firstTopic}
          lectureTitle={
            sessionParams?.displayLectureTitle ||
            (sessionParams?.isCrossLecture && resumedCrossCtx
              ? crossLectureTitleLine(resumedCrossCtx.lecs)
              : lectureForTopic?.lectureTitle || firstTopic.label)
          }
          lectureContent={
            sessionParams?.resuming
              ? sessionParams.lectureContent
              : sessionParams?.isCrossLecture && resumedCrossCtx
                ? resumedCrossCtx.combinedContent
                : getLecText(lectureForTopic) || lectureForTopic?.text || ""
          }
          objectives={objectivesForSession}
          blockId={blockId}
          blockObjectives={blockObjectives}
          getBlockObjectives={getBlockObjectives}
          onAppendObjectiveNote={onAppendObjectiveNote}
          lec={lectureForTopic}
          performanceHistory={performanceHistory}
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
          initialTeachingSection={sessionParams?.resuming ? sessionParams.teachingSection : undefined}
          initialSectionExplanation={sessionParams?.resuming ? sessionParams.sectionExplanation : undefined}
          initialSectionUnderstood={sessionParams?.resuming ? sessionParams.sectionUnderstood : undefined}
          initialStructureSaqAttempts={sessionParams?.resuming ? sessionParams.structureSaqAttempts : undefined}
          initialRecallStep={sessionParams?.resuming ? sessionParams.recallStep : undefined}
          crossCtx={resumedCrossCtx}
          skipIntroPrep={!!sessionParams?.isCrossLecture && !sessionParams?.resuming}
          deeplinkObjectiveId={sessionParams?.deeplinkObjectiveId ?? null}
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
