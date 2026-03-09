import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Tracker from "./Tracker";
import LearningModel from "./LearningModel.jsx";
import DeepLearn from "./DeepLearn";
import ObjectiveTracker from "./ObjectiveTracker";
import { loadPDFJS, parseExamPDF } from "./examParser";
import { extractPDFWithMistralSafe } from "./mistralOCR";
import { loadProfile, saveProfile, recordAnswer } from "./learningModel";
import {
  ThemeContext,
  useTheme,
  themes,
  getScoreColor,
  getScoreLabel,
  getBarColor,
  getObjStatusColor,
  getObjStatusIcon,
  getUrgencyColor,
  URGENCY_LABELS,
  StatusBadge,
} from "./theme";
import {
  enrichObjectiveWithBloom,
  getActivityType,
  LEVEL_NAMES,
  LEVEL_COLORS,
  LEVEL_BG,
} from "./bloomsTaxonomy";
import FTM2_DATA from "./ftm2_objectives_full.json";
import {
  getAvailableProviders,
  setDefaultProvider,
  DEFAULT_PROVIDER,
  AI_PROVIDERS,
  callAIJSON,
} from "./aiClient";

async function analyzeLecture(lec, extractedText) {
  const systemPrompt = `You are an expert medical educator analyzing a lecture for a medical student study app.
Analyze this lecture content and produce a structured teaching map.
Raw JSON only, no markdown, no backticks:
{
  "summary": "<2-3 sentence overview of what this lecture covers>",
  "clinicalHook": "<a real patient scenario in 2-3 sentences that this entire lecture explains — make it vivid and specific>",
  "sections": [
    {
      "title": "<section title>",
      "objectives": ["<objective 1>", "<objective 2>"],
      "coreContent": "<3-5 sentences teaching the key concepts of this section — define terms, explain mechanisms, build from basic science to clinical>",
      "keyTerms": ["<term>", "<term>", "<term>"],
      "clinicalRelevance": "<1-2 sentences — how does this section explain or connect to the patient scenario above>",
      "commonMistakes": "<1 sentence — what do students commonly confuse or miss here>",
      "anchorQuestion": "<one Socratic reasoning question — not recall, but application>"
    }
  ],
  "bigPicture": "<the single most important clinical takeaway from this entire lecture>"
}`;

  const userPrompt = `Lecture title: ${lec.title || lec.lectureTitle || ""}
Lecture type: ${lec.lectureType || ""} ${lec.lectureNumber ?? ""}

Full lecture content:
${(extractedText || "").slice(0, 6000)}`;

  const fallback = { summary: "", clinicalHook: "", sections: [], bigPicture: "" };
  try {
    const result = await callAIJSON(systemPrompt, userPrompt, fallback, 2000);
    if (result && Array.isArray(result.sections)) return result;
    return fallback;
  } catch (e) {
    console.warn("analyzeLecture failed:", e?.message || e);
    return fallback;
  }
}

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

function deduplicateTrackerRows(rows) {
  const seen = {};
  const merged = [];
  (rows || []).forEach((row) => {
    // ONLY deduplicate by lectureId — never by topic string alone.
    // Topic strings like "Objectives" or "Body Planes" can appear in
    // multiple lectures and must NOT be merged.
    const key = row.lectureId
      ? `lecId_${row.lectureId}`
      : `manual_${row.id}`;
    if (seen[key] !== undefined) {
      const existing = merged[seen[key]];
      const combinedScores = [...(existing.scores || []), ...(row.scores || [])].filter((s) => s != null && s !== "");
      merged[seen[key]] = {
        ...existing,
        lastStudied: [existing.lastStudied, row.lastStudied].filter(Boolean).sort().slice(-1)[0] || existing.lastStudied,
        reps: (existing.reps || 0) + (row.reps || 0),
        scores: combinedScores,
        score: row.score != null && row.score !== "" ? row.score : existing.score,
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
function deduplicateLectures(lecs) {
  const seen = new Map();
  // Sort newest first so we keep the latest upload
  const sorted = [...(lecs || [])].sort((a, b) => 
    new Date(b.uploadDate || b.uploadedAt || 0) - new Date(a.uploadDate || a.uploadedAt || 0)
  );
  sorted.forEach(lec => {
    // Only deduplicate if we have a valid type and number, otherwise use ID so we don't merge unrelated lectures
    const hasNum = lec.lectureNumber != null && String(lec.lectureNumber).trim() !== "";
    const key = (lec.lectureType && hasNum)
      ? `${lec.blockId}__${lec.lectureType.trim()}__${String(lec.lectureNumber).trim()}`
      : lec.id;
    if (!seen.has(key)) seen.set(key, lec);
  });
  return Array.from(seen.values());
}

async function loadLectures() {
  const meta = await sGet("rxt-lec-meta");
  if (!meta || !Array.isArray(meta)) return [];
  const out = [];
  for (const m of meta) {
    const fullText = (await sGet("rxt-lec-" + m.id)) || "";
    out.push({ ...m, fullText });
  }
  
  const deduped = deduplicateLectures(out);
  if (deduped.length < out.length) {
    console.log(`Removed ${out.length - deduped.length} duplicate lectures`);
    await saveLectures(deduped);
  }
  
  return deduped;
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

function findBlockForObjectives(blocks, preferName) {
  const allBlocks = Array.isArray(blocks) ? blocks : Object.values(blocks || {});
  if (!allBlocks.length) return null;

  const exact = allBlocks.find(
    (b) => (b.name || "").toLowerCase() === (preferName || "").toLowerCase()
  );
  if (exact) return exact;

  const ftm2 = allBlocks.find((b) => /ftm\s*2/i.test(b.name || ""));
  if (ftm2) return ftm2;

  const ftm1 = allBlocks.find((b) => /ftm\s*1/i.test(b.name || ""));
  if (ftm1) return ftm1;

  return allBlocks.find((b) => /ftm/i.test(b.name || "")) || null;
}

function alignObjectivesToLectures(blockId, objectives, lectures) {
  if (!objectives?.length || !lectures?.length) return objectives;

  return objectives.map((obj) => {
    let matched = lectures.find((lec) => {
      let lecType = (lec.lectureType || "LEC").toUpperCase();
      if (lecType === "LECTURE" || lecType.startsWith("LECT")) lecType = "LEC";
      const lecNum = String(lec.lectureNumber || "");
      const objActivity = (obj.activity || "").toUpperCase().replace(/\s+/g, " ").trim();

      if (objActivity && objActivity !== "UNKNOWN" && lecNum) {
        if (objActivity === lecType + lecNum) return true;
        if (objActivity === lecType + " " + lecNum) return true;
        const actMatch = objActivity.replace(/\s/g, "").match(/^([A-Z]+)(\d+)$/);
        if (actMatch && actMatch[1] === lecType && actMatch[2] === lecNum) return true;
      }
      if (obj.lectureNumber != null && lec.lectureNumber != null && String(obj.lectureNumber) === String(lec.lectureNumber)) {
        const objType = (obj.lectureType || "LEC").toUpperCase();
        const objTypeNorm = objType === "LECTURE" || objType.startsWith("LECT") ? "LEC" : objType.slice(0, 4);
        if (objTypeNorm === lecType) return true;
      }
      if (obj.activity && lec.lectureNumber != null) {
        const actNum = parseInt((obj.activity || "").replace(/\D/g, ""), 10);
        if (!Number.isNaN(actNum) && actNum === parseInt(lec.lectureNumber, 10)) return true;
      }
      if (obj.lectureNumber && (lec.filename || lec.fileName)) {
        const fn = (lec.filename || lec.fileName || "").toLowerCase();
        const n = String(obj.lectureNumber);
        if (
          fn.includes("lecture" + n) ||
          fn.includes("lec" + n) ||
          fn.includes("lec_" + n) ||
          fn.includes("dla" + n) ||
          fn.includes("l" + n + "_") ||
          fn.includes("_" + n + "_")
        )
          return true;
      }
      return false;
    });

    // Title match: collect all that match by title, then prefer DLA/type+number when objective title or activity hints at it
    if (!matched && obj.lectureTitle && obj.lectureTitle.length > 5) {
      const objTitle = (obj.lectureTitle || "").toLowerCase().slice(0, 50);
      const objTitleUpper = (obj.lectureTitle || "").toUpperCase();
      const titleMatches = lectures.filter((lec) => {
        const lecTitle = (lec.lectureTitle || lec.filename || "").toLowerCase();
        return lecTitle.includes(objTitle) || objTitle.includes(lecTitle.slice(0, 40));
      });
      if (titleMatches.length === 1) matched = titleMatches[0];
      else if (titleMatches.length > 1) {
        // Prefer lecture whose type+number appears in objective title/activity (e.g. "DLA 5")
        const prefer = titleMatches.find((lec) => {
          const type = (lec.lectureType || "LEC").toUpperCase().replace(/^LECTURE$|^LECT/i, "LEC");
          const num = String(lec.lectureNumber ?? "");
          const needle = num ? (type + " " + num).trim() : type;
          const needleNoSpace = type + num;
          return objTitleUpper.includes(needle) || objTitleUpper.includes(needleNoSpace) || (obj.activity || "").toUpperCase().includes(needle);
        });
        matched = prefer || titleMatches.find((l) => (l.lectureType || "LEC").toUpperCase().includes("DLA")) || titleMatches[0];
      }
    }
    // Last resort: match by lecture number within same block
    let finalMatch = matched;
    if (!finalMatch && obj.lectureNumber != null) {
      const fallbackLec = lectures.find(
        (l) =>
          String(l.lectureNumber) === String(obj.lectureNumber) &&
          (!obj.lectureType || !l.lectureType || (obj.lectureType || "LEC") === (l.lectureType || "LEC"))
      );
      if (fallbackLec) finalMatch = fallbackLec;
    }

    return {
      ...obj,
      linkedLecId: finalMatch?.id || obj.linkedLecId || null,
      sourceFile: finalMatch?.id ?? obj.sourceFile ?? null,
      linkedLecName: finalMatch?.lectureTitle || finalMatch?.filename || finalMatch?.fileName || obj.linkedLecName || null,
      hasLecture: !!finalMatch,
    };
  });
}

// Single source of truth for "objective is linked to an uploaded lecture in this block"
function isObjectiveLinked(obj, blockLecs) {
  return !!obj?.linkedLecId && (blockLecs || []).some((l) => l.id === obj.linkedLecId);
}

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
  const pdf = await lib.getDocument({ data: await file.arrayBuffer(), verbosity: 0 }).promise;
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

const safeJSON = (raw) => {
  if (!raw) throw new Error("Empty response");

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  try {
    return JSON.parse(
      cleaned
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
        .replace(/,\s*([}\]])/g, "$1")
    );
  } catch {}

  const arrayStart = cleaned.indexOf('"questions"');
  if (arrayStart !== -1) {
    const bracketOpen = cleaned.indexOf("[", arrayStart);
    if (bracketOpen !== -1) {
      const arraySection = cleaned.slice(bracketOpen);
      const questions = [];
      let depth = 0;
      let objStart = -1;

      for (let i = 0; i < arraySection.length; i++) {
        const ch = arraySection[i];
        if (ch === '"') {
          i++;
          while (i < arraySection.length) {
            if (arraySection[i] === "\\") {
              i += 2;
              continue;
            }
            if (arraySection[i] === '"') break;
            i++;
          }
          continue;
        }
        if (ch === "{") {
          if (depth === 0) objStart = i;
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0 && objStart !== -1) {
            try {
              const obj = JSON.parse(arraySection.slice(objStart, i + 1));
              if (obj.stem) questions.push(obj);
            } catch {}
            objStart = -1;
          }
        }
      }

      if (questions.length > 0) {
        console.warn(`safeJSON: salvaged ${questions.length} complete questions from truncated response`);
        return { questions };
      }
    }
  }

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1).replace(/,\s*([}\]])/g, "$1"));
    } catch {}
  }

  throw new Error(`Invalid JSON from Claude: ${cleaned.slice(0, 120)}...`);
};

const detectStudyMode = (lec, objectives = []) => {
  const title = (lec?.lectureTitle || lec?.fileName || "").toLowerCase();
  const discipline = (lec?.subject || lec?.discipline || "").toLowerCase();
  const objText = (objectives || []).map((o) => o.objective).join(" ").toLowerCase();
  const allText = title + " " + discipline + " " + objText;

  const hasUploadedContent = ((lec?.chunks || []).map((c) => c.text || "").join("").trim().length) > 200;
  const isAnatomy = /\banat|anatomy|muscle|bone|nerve|artery|vein|ligament|joint|vertebr|spinal|plexus|foramen|fossa|groove|insertion|origin|landmark|imaging|radiol|x.ray|mri|ct scan|ultrasound/i.test(allText);
  const isHistology = /\bhisto|histol|microscop|stain|cell type|tissue|epithelial|connective|gland|slide/i.test(allText);

  if (isAnatomy || isHistology) {
    return {
      mode: isHistology ? "histology" : "anatomy",
      label: isHistology ? "Histology" : "Anatomy & Structure",
      icon: isHistology ? "🔬" : "🦴",
      recommended: ["anki", "deepLearn"],
      avoid: [],
      hasUploadedContent,
      reason: `${isHistology ? "Histology" : "Anatomy"} is best studied with Anki image cards. Log your Anki sessions here to track progress.`,
      color: isHistology ? "#a78bfa" : "#6366f1",
    };
  }

  if (/\bphar|drug|pharmac|receptor|agonist|antagonist|inhibit|mechanism|dose|toxicity|side effect|contraindic/i.test(allText)) {
    return { mode: "pharmacology", label: "Pharmacology", icon: "💊", recommended: ["deepLearn", "flashcards", "mcq"], avoid: [], reason: "Pharmacology requires understanding mechanisms and drug class patterns — Deep Learn + flashcards work well together.", color: "#10b981" };
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
};

const validateAndFixQuestions = (questions) => {
  return (questions || []).map((q) => {
    const stem = (q.stem || "").trim();
    const hasQuestion = stem.endsWith("?") ||
      /which|what|how|why|where|identify|select/i.test(stem.slice(-100));
    if (!hasQuestion && stem.length > 20) {
      const choiceValues = Object.values(q.choices || {}).join(" ").toLowerCase();
      let questionSuffix = " Which of the following best answers this clinical scenario?";
      if (/muscle|nerve|bone|artery|vein|ligament/i.test(choiceValues)) {
        questionSuffix = " Which anatomical structure is most directly involved?";
      } else if (/inhibit|block|activate|receptor|enzyme/i.test(choiceValues)) {
        questionSuffix = " Which mechanism best explains these findings?";
      } else if (/deficiency|excess|elevated|decreased/i.test(choiceValues)) {
        questionSuffix = " Which of the following is the most likely diagnosis?";
      } else if (/treat|drug|medication|therapy/i.test(choiceValues)) {
        questionSuffix = " Which is the most appropriate next step in management?";
      }
      return { ...q, stem: stem + questionSuffix };
    }
    return q;
  });
};

const buildExamPrompt = (count, objectives, content, uploadedQs, mode, difficulty) => {
  const objList = (objectives || [])
    .slice(0, 20)
    .map((o, i) => `${i + 1}. [${o.activity || ""}] ${o.objective}`)
    .join("\n");

  const styleRef = (uploadedQs || [])
    .slice(0, 3)
    .map((q) => `Q: ${q.stem}\nCorrect: ${q.choices?.[q.correct]}`)
    .join("\n\n");

  return (
    `Generate exactly ${count} USMLE Step 1 clinical vignette questions. Keep each explanation under 60 words.\n` +
    `Difficulty: ${(difficulty || "medium").toString().toUpperCase()}\n\n` +
    `CRITICAL STEM RULE: Every stem MUST end with a direct question sentence.\n` +
    `The question sentence must start with "Which", "What", "How", "Why", "Where", "Which of the following", etc.\n` +
    `NEVER end a stem with just a clinical description — always end with the actual question.\n\n` +
    `Example stem ending: "...tenderness along the paraspinal muscles. Which muscle group is most likely responsible for maintaining lumbar lordosis?"\n\n` +
    `OBJECTIVES TO COVER:\n${objList}\n\n` +
    (styleRef ? `EXAM STYLE REFERENCE:\n${styleRef}\n\n` : "") +
    (content ? `LECTURE CONTENT:\n${content.slice(0, 4000)}\n\n` : "") +
    `Rules:\n` +
    `- Exactly ${count} questions, no more no less\n` +
    `- Each maps to one objective\n` +
    `- Vary clinical scenarios and patient demographics\n` +
    `- Keep each explanation under 60 words to save space\n` +
    `- Never truncate — complete all ${count} questions fully\n\n` +
    `Return ONLY complete valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveId":"...","topic":"...","difficulty":"${difficulty || "medium"}","usedUploadedStyle":${!!(uploadedQs && uploadedQs.length)}}]}`
  );
};

const getReviewInterval = (confidenceLevel, isCurrentBlock, blockAgeMonths) => {
  if (isCurrentBlock) {
    return confidenceLevel === "High" ? 7 : confidenceLevel === "Medium" ? 3 : 1;
  }
  if (blockAgeMonths <= 1) {
    return confidenceLevel === "High" ? 42 : confidenceLevel === "Medium" ? 30 : 14;
  }
  if (blockAgeMonths <= 3) {
    return confidenceLevel === "High" ? 60 : confidenceLevel === "Medium" ? 45 : 30;
  }
  return confidenceLevel === "High" ? 90 : confidenceLevel === "Medium" ? 60 : 30;
};

const buildExamPromptFromContext = (count, objectives, context, difficulty) => {
  const { relevantQs = [], lectureChunks = "", styleAnalysis, stylePrefs } = context || {};
  const diff = (difficulty || "medium").toString().toUpperCase();
  const targetObjectives = (objectives || []).slice(0, 20);
  const objList = targetObjectives
    .map((o, i) => `${i + 1}. [${o.activity || ""}] ${o.objective}`)
    .join("\n");

  const bloomDist = targetObjectives.reduce((acc, obj) => {
    const lvl = obj.bloom_level ?? 2;
    acc[lvl] = (acc[lvl] || 0) + 1;
    return acc;
  }, {});
  const avgBloom = targetObjectives.length
    ? Math.round(
        Object.entries(bloomDist).reduce((sum, [lvl, cnt]) => sum + parseInt(lvl, 10) * cnt, 0) / targetObjectives.length
      )
    : 2;
  const bloomGuidance =
    avgBloom <= 1
      ? "Focus on recall and definition questions. Ask students to identify, name, or define concepts."
      : avgBloom === 2
        ? "Focus on comprehension. Ask students to explain, describe, or summarize concepts in their own words."
        : avgBloom === 3
          ? "Focus on application. Use clinical scenarios where students must apply concepts to solve problems."
          : avgBloom === 4
            ? "Focus on analysis. Ask students to compare, contrast, differentiate between related concepts."
            : avgBloom === 5
              ? "Focus on evaluation. Use complex vignettes requiring students to justify, prioritize, or defend clinical decisions."
              : "Focus on synthesis and creation. Ask students to formulate, design, or construct a complete clinical reasoning chain.";
  const bloomSection =
    `\nBloom's Taxonomy guidance for this question set (avg level ${avgBloom}/6):\n${bloomGuidance}\n` +
    `Individual objective levels: ${(targetObjectives || [])
      .map((o) => `"${(o.objective || "").slice(0, 40)}..." = L${o.bloom_level ?? 2} ${o.bloom_level_name || "Understand"}`)
      .join("; ")}\n`;

  const stylePrefText = [
    stylePrefs?.longStems && "Use long, detailed clinical vignette stems (4-6 sentences).",
    stylePrefs?.hardDistractors && "Use challenging distractors that are plausible and require careful reasoning.",
    stylePrefs?.labValues && "Include specific lab values, vital signs, and diagnostic data where relevant.",
    stylePrefs?.firstAid && "Reference First Aid mnemonics and high-yield facts where applicable.",
    stylePrefs?.explainWrong && "For each question, include a brief explanation of why each wrong answer is incorrect.",
  ]
    .filter(Boolean)
    .join(" ");

  const styleSection =
    relevantQs.length > 0 && styleAnalysis
      ? `\nYOUR SCHOOL'S EXAM STYLE (${relevantQs.length} questions from ${(styleAnalysis.sourceFiles || []).join(", ")}):\n` +
        `- Average stem length: ~${styleAnalysis.avgStemLength || 0} characters\n` +
        `- Clinical vignettes: ${styleAnalysis.hasClinicalCases || 0} of ${relevantQs.length} questions use patient scenarios\n` +
        `- Mechanism questions: ${styleAnalysis.hasMechanisms || 0} questions test mechanisms\n\n` +
        `EXAMPLE QUESTIONS (match this exact style):\n` +
        relevantQs
          .slice(0, 5)
          .map(
            (q) =>
              `Q: ${q.stem}\n` +
              `A: ${q.choices?.A ?? ""}  B: ${q.choices?.B ?? ""}  C: ${q.choices?.C ?? ""}  D: ${q.choices?.D ?? ""}\n` +
              `Correct: ${q.correct ?? "A"} — ${q.choices?.[q.correct ?? "A"] ?? ""}`
          )
          .join("\n\n")
      : "\n(No uploaded exam questions available for style reference — using USMLE Step 1 standard format)\n";

  const contentSection =
    lectureChunks.length > 100
      ? `\nLECTURE CONTENT (base questions on this material):\n${lectureChunks.slice(0, 4000)}\n`
      : "\n(No lecture slides uploaded — generating from objectives only)\n";

  return (
    `Generate exactly ${count} questions.\n` +
    `Difficulty: ${diff}\n` +
    (stylePrefText ? `Style preferences: ${stylePrefText}\n\n` : "") +
    styleSection +
    contentSection +
    bloomSection +
    `\nOBJECTIVES TO COVER:\n${objList}\n\n` +
    `RULES:\n` +
    `- Every stem MUST end with a "?" question\n` +
    `- Match the style patterns from uploaded exams above\n` +
    `- Keep explanations under 60 words\n` +
    `- Never truncate — complete all ${count} questions\n\n` +
    `Return ONLY complete JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveCovered":"...","topic":"...","difficulty":"${diff}","usedUploadedStyle":${relevantQs.length > 0}}]}`
  );
};

function extractLecNumberFromFilename(filename) {
  const patterns = [
    /lecture[_\s-]*(\d+)/i,
    /\blec[_\s-]*(\d+)/i,
    /\bL(\d{1,3})\b/,
    /\bdla[_\s-]*(\d+)/i,
    /\blab[_\s-]*(\d+)/i,
    /_(\d{1,3})[_\s]/,
    /\s(\d{1,3})\s/,
  ];
  for (const p of patterns) {
    const m = filename.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

const detectLectureType = (fileName, title = "") => {
  const text = (fileName + " " + title).toUpperCase();
  if (/\bDLA\b/.test(text)) return "DLA";
  if (/\bSGL?\b|\bSMALL\s*GROUP\b/.test(text)) return "SG";
  if (/\bTBL\b|\bTEAM.BASED\b/.test(text)) return "TBL";
  if (/\bLAB\b/.test(text)) return "LAB";
  if (/\bLEC\b|\bLECTURE\b/.test(text)) return "LEC";
  if (/\bCLIN\b|\bCLINICAL\b/.test(text)) return "CLIN";
  return "LEC";
};

const detectLectureNumber = (fileName, title = "", type = "LEC") => {
  const text = (fileName + " " + title).trim();
  const dlaMatch = text.match(/DLA\s*(\d+)/i);
  const lecMatch = text.match(/(?:Lecture|Lec)\s*(\d+)/i);
  const sgMatch = text.match(/SG\s*(\d+)/i);
  const tblMatch = text.match(/TBL\s*(\d+)/i);
  if (dlaMatch) return parseInt(dlaMatch[1], 10);
  if (lecMatch) return parseInt(lecMatch[1], 10);
  if (sgMatch) return parseInt(sgMatch[1], 10);
  if (tblMatch) return parseInt(tblMatch[1], 10);
  const fallbackNum = text.match(/\b(\d{1,3})\b/);
  if (fallbackNum) return parseInt(fallbackNum[1], 10);
  return 1;
};

const detectWeekNumber = (fileName, title = "") => {
  const text = (fileName + " " + title).toLowerCase();
  const match = text.match(/\b(?:week|wk|w)\s*(\d+)\b/);
  if (match) return parseInt(match[1], 10);
  return null;
};

async function extractObjectivesFromLecture(file) {
  if (!GEMINI_KEY) return [];
  try {
    await loadPDFJS();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
    const pagesToCheck = Math.min(5, pdf.numPages);
    const images = [];
    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      images.push(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    }
    const parts = [
      ...images.map((img) => ({ inline_data: { mime_type: "image/jpeg", data: img } })),
      {
        text:
          "These are the first pages of a medical school lecture PDF.\n\n" +
          "Look for a slide titled 'Learning Objectives', 'Objectives', 'Goals', or similar.\n" +
          "Extract EVERY objective listed — they start with action verbs like Describe, Explain, List, Define, Compare, Identify, Discuss, Analyze, Predict.\n\n" +
          "Also extract:\n" +
          "- Lecture number (e.g. Lecture 27 → 27)\n" +
          "- Lecture title\n" +
          "- Discipline (BCHM, GNET, HCB, PHAR, PHYS, ANAT, etc.)\n\n" +
          "If no objectives slide exists, return {\"objectives\":[]}\n\n" +
          "Return ONLY valid JSON:\n" +
          '{"lectureNumber":27,"lectureTitle":"Proteoglycans","discipline":"BCHM",' +
          '"objectives":["Describe the general structure of proteoglycans","Discuss the functions of hyaluronic acid"]}',
      },
    ];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: 4000, temperature: 0.0 },
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
    const raw = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1) return [];
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    const lecNum = parsed.lectureNumber ?? detectLectureNumber(file.name, parsed.lectureTitle || "");
    const lecTitle = parsed.lectureTitle || file.name;
    const discipline = parsed.discipline || "Unknown";
    const lectureType = detectLectureType(file.name, lecTitle);
    const lectureNumber = lecNum != null ? lecNum : 1;
    const activityStr = `${lectureType}${lectureNumber}`;
    return (parsed.objectives || [])
      .filter((o) => typeof o === "string" && o.length > 10)
      .map((obj, i) => {
        const o = {
          id: `extracted_${Date.now()}_${i}`,
          activity: activityStr,
          lectureNumber: lectureNumber,
          lectureType,
          discipline,
          lectureTitle: lecTitle,
          code: null,
          objective: obj.trim(),
          status: "untested",
          confidence: 0,
          lastTested: null,
          quizScore: null,
          source: "extracted",
        };
        return o;
      });
  } catch (e) {
    console.warn("extractObjectivesFromLecture failed:", e.message);
    return [];
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
    "{\"subject\":\"Physiology\",\"subtopics\":[\"Topic A\",\"Topic B\",\"Topic C\"],\"keyTerms\":[\"term1\",\"term2\",\"term3\",\"term4\",\"term5\"],\"lectureTitle\":\"Specific Title\",\"lectureNumber\":50,\"lectureType\":\"Lecture\"}\n\n" +
    "Rules:\n" +
    "- subject must be ONE of the subjects listed above, pick the closest match\n" +
    "- subtopics must be 3-6 specific topics covered in this lecture\n" +
    "- keyTerms must be 5-8 high yield medical terms from the content\n" +
    "- lectureTitle must be specific, not generic\n" +
    "- lectureNumber: extract the lecture number as a number only (e.g. 50), or null if not found. Look for patterns like 'Lecture 50', 'Lec 50', 'L50', 'FTM Lecture 50' in the content\n" +
    "- lectureType must be exactly one of: Lecture, DLA, Lab, unknown\n\n" +
    "TEXT:\n" + text.slice(0, 5000);
  const raw = await claude(prompt);
  const parsed = safeJSON(raw);
  if (parsed.lectureNumber != null && typeof parsed.lectureNumber === "string") {
    const n = parseInt(parsed.lectureNumber, 10);
    parsed.lectureNumber = isNaN(n) ? null : n;
  }
  return parsed;
}

const VIGNETTE_JSON_INSTRUCTION = "IMPORTANT: You must complete the entire JSON response. Never cut off mid-string. If you are running low on space, reduce the explanation length but always close every JSON object, array, and string properly.";

const DIFFICULTY_LADDER = ["easy", "medium", "hard", "expert"];
const DIFFICULTY_INSTRUCTIONS = {
  easy: "Use straightforward single-concept questions. Direct recall with simple distractors.",
  medium: "USMLE Step 1 standard. Clinical vignettes with 2-step reasoning. Plausible distractors.",
  hard: "Complex multi-step reasoning. Two or more concepts integrated. Challenging distractors that require ruling out.",
  expert: "Hardest USMLE difficulty. Complex vignettes requiring synthesis across multiple topics. All distractors clinically plausible. Include secondary complications and exceptions.",
};

function buildLectureContext(lectureId, subtopic, blockId, { lecs, getBlockObjectives }) {
  let questionBanksByFile = {};
  try {
    questionBanksByFile = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
  } catch {}
  const lec = (lecs || []).find((l) => l.id === lectureId);
  if (!lec) return { context: "", questionExamples: [], objectives: [], lectureContent: "", patterns: {}, lec: null };

  const fromChunks = (lec.chunks || [])
    .map((c) => c.text || c.content || "")
    .join("\n");
  let lectureContent = (fromChunks || lec.fullText || "")
    .slice(0, 8000);
  const contentNote = lec.extractionMethod === "mistral-ocr"
    ? "The following lecture content has been extracted with high-fidelity OCR, preserving tables, headings, and document structure as markdown. Use the structure to identify high-yield topics."
    : "The following is extracted lecture text.";
  if (lectureContent) lectureContent = contentNote + "\n\n" + lectureContent;

  const uploadedQs = Object.values(questionBanksByFile || {})
    .flat()
    .filter((q) => {
      const topicMatch = (q.topic || "").toLowerCase().includes((subtopic || "").toLowerCase().slice(0, 20));
      const lecMatch = (q.topic || "").toLowerCase().includes((lec.lectureTitle || "").toLowerCase().slice(0, 20));
      const numMatch = (q.topic || "").toLowerCase().includes("lecture " + (lec.lectureNumber ?? ""));
      return topicMatch || lecMatch || numMatch;
    })
    .slice(0, 15);

  const allObjs = getBlockObjectives ? getBlockObjectives(blockId) || [] : [];
  const lecObjs = allObjs.filter(
    (o) =>
      o.linkedLecId === lec.id ||
      (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
  );

  const questionExamples = uploadedQs.map((q) => ({
    stem: q.stem,
    choices: q.choices,
    correct: q.correct,
    explanation: q.explanation,
    type: q.type,
    difficulty: q.difficulty,
  }));

  const patterns = {
    avgStemLength: Math.round(uploadedQs.reduce((a, q) => (q.stem || "").length + a, 0) / Math.max(uploadedQs.length, 1)),
    commonTypes: [...new Set(uploadedQs.map((q) => q.type).filter(Boolean))],
    hasClinicalCases: uploadedQs.some((q) => /patient|year.old|presents|history/i.test(q.stem || "")),
    hasCalculations: uploadedQs.some((q) => /calculate|compute|determine.*value|what is the.*level/i.test(q.stem || "")),
    hasMechanisms: uploadedQs.some((q) => /mechanism|pathway|enzyme|receptor/i.test(q.stem || "")),
  };

  return { lectureContent, questionExamples, objectives: lecObjs, patterns, lec };
}

function buildTopicVignettesPrompt(n, subject, focusLine, keyTerms, fullText, difficulty, questionType) {
  const diffLine = difficulty && difficulty !== "auto"
    ? "DIFFICULTY LEVEL: " + difficulty.toUpperCase() + "\n" + (DIFFICULTY_INSTRUCTIONS[difficulty] || "") + "\n\n"
    : "";
  return (
    "Generate exactly " + n + " USMLE Step 1 clinical vignette questions.\n\n" +
    diffLine +
    "CRITICAL: Each 'stem' field must end with a '?' question sentence.\n" +
    "Format: [Clinical scenario 2-4 sentences]. [Question sentence ending in ?]\n" +
    "Example: 'A 45-year-old male presents with... Which of the following muscles is responsible for...?'\n\n" +
    "Subject: " + subject + "\n" +
    focusLine + "\n" +
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

async function genTopicVignettes(cfg) {
  try {
    const { lecture, subject, subtopic, scope, qCount, difficulty, questionType } = cfg;
    const fullText = lecture?.fullText || "";
    const keyTerms = lecture?.keyTerms || [];
    const count = qCount || 10;
    const diff = difficulty ?? "auto";
    const qType = questionType ?? "clinicalVignette";
    const focusLine =
      scope === "full"
        ? "Cover ALL of these subtopics equally: " + (lecture?.subtopics || []).join(", ")
        : "Focus on subtopic: " + (subtopic || "Review");
    const BATCH_SIZE = 5;

    if (count <= BATCH_SIZE) {
      const prompt = buildTopicVignettesPrompt(count, subject, focusLine, keyTerms, fullText, diff, qType);
      const raw = await claude(prompt, 8000);
  const data = safeJSON(raw);
  return validateAndFixQuestions((data.vignettes || []).slice(0, count).map((v) => ({
    ...v,
    difficulty: v.difficulty || diff || "medium",
  })));
}

    const allVignettes = [];
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const batchCount = Math.min(BATCH_SIZE, count - i);
      const prompt = buildTopicVignettesPrompt(batchCount, subject, focusLine, keyTerms, fullText, diff, qType);
      const raw = await claude(prompt, 8000);
      const data = safeJSON(raw);
      const batch = (data.vignettes || []).slice(0, batchCount).map((v) => ({
        ...v,
        difficulty: v.difficulty || diff || "medium",
      }));
      batch.forEach((v, j) => { v.id = "v" + (allVignettes.length + j + 1); });
      allVignettes.push(...batch);
    }
    return validateAndFixQuestions(allVignettes.slice(0, count));
  } catch (e) {
    throw new Error("genTopicVignettes: " + (e.message || String(e)));
  }
}

async function genTopicVignettesWithContext(cfg, deps) {
  const { lectureId, subtopic, count = 10, difficulty, blockId } = {
    lectureId: cfg.lecture?.id,
    subtopic: cfg.subtopic,
    count: cfg.qCount || 10,
    difficulty: cfg.difficulty,
    blockId: cfg.blockId,
  };
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
  const { lectures = [], getBlockObjectives, getTopicDifficulty, sessions = [], performanceHistory: perfHistory = {}, makeTopicKey: makeKey, stylePrefs } = deps || {};
  const { lectureContent, questionExamples, objectives, patterns, lec } = buildLectureContext(
    lectureId,
    subtopic,
    blockId,
    { lecs: lectures, getBlockObjectives }
  );

  const topicKey = makeKey ? makeKey(lectureId || null, blockId) : (lectureId || blockId) + "__" + (subtopic || "full");
  const currentDiff = (getTopicDifficulty && getTopicDifficulty(topicKey)) || difficulty || "medium";
  const perfData = perfHistory[topicKey];
  const streak = perfData?.streak || 0;
  const lastScore = perfData?.sessions?.slice(-1)[0]?.score ?? null;
  console.log(`Generating for ${topicKey} at difficulty: ${currentDiff}, streak: ${streak}, lastScore: ${lastScore}`);

  const examplesSection =
    questionExamples.length > 0
      ? "\n\nEXAMPLE QUESTIONS FROM YOUR SCHOOL'S UPLOADED EXAM BANKS:\n" +
        "(Study these carefully — model your questions after this exact style, format, length, and clinical depth)\n" +
        questionExamples
          .slice(0, 5)
          .map(
            (q, i) =>
              `EXAMPLE ${i + 1}:\nQ: ${q.stem}\nA: ${q.choices?.A} B: ${q.choices?.B} C: ${q.choices?.C} D: ${q.choices?.D}\nCorrect: ${q.correct}\nExplanation: ${q.explanation || "N/A"}`
          )
          .join("\n\n")
      : "";

  const objectivesSection =
    objectives.length > 0
      ? "\n\nLEARNING OBJECTIVES THAT MUST BE COVERED:\n" +
        "(Every question must map to one of these — these are the official exam objectives)\n" +
        objectives.map((o, i) => `${i + 1}. [${o.code || o.id}] ${o.objective}`).join("\n")
      : "";

  const contentSection = lectureContent ? "\n\nLECTURE CONTENT TO BASE QUESTIONS ON:\n" + lectureContent : "";

  const styleGuide =
    questionExamples.length > 0
      ? `\nQUESTION STYLE REQUIREMENTS (match your school's style exactly):
- Stem length: approximately ${patterns.avgStemLength} characters
- ${patterns.hasClinicalCases ? "USE clinical patient vignettes (your school uses patient-based questions)" : "Use direct concept questions"}
- ${patterns.hasCalculations ? "INCLUDE calculation-based questions where appropriate" : ""}
- ${patterns.hasMechanisms ? "INCLUDE mechanism/pathway questions" : ""}
- Question types used: ${(patterns.commonTypes || []).join(", ") || "mixed"}`
      : "";

  const stylePrefText = [
    stylePrefs?.longStems && "Use long, detailed clinical vignette stems (4-6 sentences).",
    stylePrefs?.hardDistractors && "Use challenging distractors that are plausible and require careful reasoning.",
    stylePrefs?.labValues && "Include specific lab values, vital signs, and diagnostic data where relevant.",
    stylePrefs?.firstAid && "Reference First Aid mnemonics and high-yield facts where applicable.",
    stylePrefs?.explainWrong && "For each question, include a brief explanation of why each wrong answer is incorrect.",
  ]
    .filter(Boolean)
    .join(" ");

  const prompt =
    `Generate ${count} questions on "${subtopic}" from ${lec?.lectureTitle || subtopic}.\n\n` +
    (stylePrefText ? `Style preferences: ${stylePrefText}\n\n` : "") +
    `CRITICAL: Each 'stem' field must end with a '?' question sentence.\n` +
    `Format: [Clinical scenario 2-4 sentences]. [Question sentence ending in ?]\n` +
    `Example: 'A 45-year-old male presents with... Which of the following muscles is responsible for...?'\n\n` +
    `DIFFICULTY: ${currentDiff.toUpperCase()}\n` +
    (currentDiff === "easy" ? "Straightforward single-concept questions, direct recall.\n" : "") +
    (currentDiff === "medium" ? "USMLE Step 1 standard, 2-step clinical reasoning.\n" : "") +
    (currentDiff === "hard" ? "Multi-step reasoning, integrated concepts, challenging distractors.\n" : "") +
    (currentDiff === "expert" ? "Hardest USMLE level, synthesis across topics, all distractors plausible.\n" : "") +
    styleGuide +
    objectivesSection +
    examplesSection +
    contentSection +
    `\n\nCRITICAL RULES:
- Each question must be UNIQUE — no repetition of stems, scenarios, or patient details
- Vary the question format: some mechanism, some clinical presentation, some pharmacology, some lab values
- Vary patient demographics, settings, and presentations
- Never repeat the same correct answer letter more than 3 times in a row
- If objectives are provided, ensure every objective is covered at least once
- Base every question on the lecture content provided — do not invent off-topic content\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveId":"...","topic":"${(subtopic || "").replace(/"/g, '\\"')}","difficulty":"${currentDiff}","type":"clinicalVignette"}]}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8000, temperature: 0.9 },
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
  const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(first, last + 1).replace(/,\s*([}\]])/g, "$1"));
  } catch {
    parsed = { questions: [] };
  }
  const generatedQuestions = (parsed.questions || []).map((q, i) => ({
    ...q,
    id: "gen_" + Date.now() + "_" + i,
    num: i + 1,
    difficulty: q.difficulty || currentDiff || "medium",
  }));

  const recentStems = new Set(
    (sessions || [])
      .slice(-10)
      .flatMap((s) => (s.questions || []).map((q) => (q.stem || "").slice(0, 40).toLowerCase()))
  );
  const freshQuestions = generatedQuestions.filter(
    (q) => !recentStems.has((q.stem || "").slice(0, 40).toLowerCase())
  );
  const final = freshQuestions.length >= count * 0.6 ? freshQuestions : generatedQuestions;
  return validateAndFixQuestions(final);
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
      "CRITICAL: Each 'stem' field must end with a '?' question sentence.\n" +
      "Format: [Clinical scenario 2-4 sentences]. [Question sentence ending in ?]\n" +
      "Example: 'A 45-year-old male presents with... Which of the following muscles is responsible for...?'\n\n" +
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
  return (data.vignettes || []).slice(0, count).map((v) => ({
    ...v,
    difficulty: v.difficulty || difficulty || "medium",
  }));
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

async function genObjectiveQuestions(objectives, lectureTitle, difficulty = "medium") {
  const objList = objectives
    .map((o, i) => `${i + 1}. [${o.id}] ${o.objective}`)
    .join("\n");
  const diffInstructions = DIFFICULTY_INSTRUCTIONS[difficulty] || DIFFICULTY_INSTRUCTIONS.medium;
  const prompt =
    "You are a medical school exam writer. Generate clinical vignette questions that DIRECTLY test these learning objectives from " +
    lectureTitle +
    ".\n\nDIFFICULTY LEVEL: " + difficulty.toUpperCase() + "\n" + diffInstructions + "\n\n" +
    "CRITICAL: Each 'stem' field must end with a '?' question sentence.\n" +
    "Format: [Clinical scenario 2-4 sentences]. [Question sentence ending in ?]\n" +
    "Example: 'A 45-year-old male presents with... Which of the following muscles is responsible for...?'\n\n" +
    "LEARNING OBJECTIVES TO COVER:\n" +
    objList +
    "\n\nRules:\n" +
    "- Each question MUST map to a specific objective — include the objective code in the question metadata\n" +
    "- Write questions at USMLE Step 1 difficulty\n" +
    "- Use clinical vignettes where possible (patient scenarios)\n" +
    "- Cover every objective at least once if possible\n" +
    "- Distribute questions: one per objective for short lists, sample for long lists\n\n" +
    "Return ONLY valid JSON:\n" +
    '{"questions":[{\n' +
    '  "stem": "A 45-year-old man presents with...",\n' +
    '  "choices": {"A":"...","B":"...","C":"...","D":"..."},\n' +
    '  "correct": "B",\n' +
    '  "explanation": "This tests objective X because...",\n' +
    '  "objectiveId": "SOM.MK.I.BPM1.1.FTM.3.BCHM.0153",\n' +
    '  "objectiveText": "the short objective being tested",\n' +
    '  "difficulty": "medium",\n' +
    '  "type": "clinicalVignette"\n' +
    "}]}\n";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8000, temperature: 0.9 },
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
  const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  const data = first !== -1 && last !== -1 ? safeJSON(raw.slice(first, last + 1)) : { questions: [] };
  const questions = data.questions || [];
  return questions.map((q, i) => ({
    id: "objq" + (i + 1),
    stem: q.stem || "",
    choices: q.choices || { A: "", B: "", C: "", D: "" },
    correct: q.correct || "A",
    explanation: q.explanation || "",
    topic: q.objectiveText || lectureTitle,
    objectiveId: q.objectiveId || null,
    difficulty: q.difficulty || difficulty || "medium",
  }));
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

function getAvgScore(lecId, sessions) {
  const s = (sessions || []).filter(x => x.lectureId === lecId);
  if (!s.length) return 0;
  return s.reduce((a, x) => a + (x.total ? (x.correct / x.total) * 100 : 0), 0) / s.length;
}

function mastery(p, T) {
  if (!T) return { fg: "#6b7280", bg: "#0d1829", border: "#1a2a3a", label: "○ Untested" };
  if (p === null) return { fg: T.statusNeutral, bg: T.statusNeutralBg, border: T.border1, label: "○ Untested" };
  if (p >= 80) return { fg: T.statusGood, bg: T.statusGoodBg, border: T.statusGoodBorder, label: "✓ Strong" };
  if (p >= 60) return { fg: T.statusProgress, bg: T.statusProgressBg, border: T.statusProgressBorder, label: "◑ Moderate" };
  if (p >= 40) return { fg: T.statusWarn, bg: T.statusWarnBg, border: T.statusWarnBorder, label: "△ Weak" };
  return { fg: T.statusBad, bg: T.statusBadBg, border: T.statusBadBorder, label: "⚠ Low" };
}

// Colorblind-safe score/bar color helpers (use T.status* instead of green/red/amber)
function scoreColor(T, score) {
  if (score == null) return T.statusNeutral;
  return score >= 80 ? T.statusGood : score >= 60 ? T.statusProgress : score >= 40 ? T.statusWarn : T.statusBad;
}
function scoreLabel(score) {
  if (score == null) return "○ —";
  return score >= 80 ? "✓ Strong" : score >= 60 ? "◑ OK" : score >= 40 ? "△ Weak" : "⚠ Low";
}
function barColor(T, pct) {
  return pct === 100 ? T.statusGood : pct >= 70 ? T.statusProgress : pct >= 40 ? T.statusWarn : pct > 0 ? T.statusBad : T.statusNeutral;
}
function objStatusColor(T, status) {
  return { mastered: T.statusGood, inprogress: T.statusProgress, struggling: T.statusBad, untested: T.statusNeutral }[status] || T.statusNeutral;
}
function objStatusIcon(status) {
  return { mastered: "✓", inprogress: "◑", struggling: "⚠", untested: "○" }[status] || "○";
}
const urgencyLabel = { overdue: "⏰ Overdue", soon: "⏱ Due Soon", weak: "△ Weak", untouched: "○ Not Started", ok: "✓ OK" };
function urgencyColor(T, urgency) {
  return { overdue: T.statusBad, soon: T.statusWarn, weak: T.statusWarn, untouched: T.statusNeutral, ok: T.statusGood }[urgency] || T.statusNeutral;
}

function blockStatus(T) {
  return {
    complete: { color: T.statusGood, icon: "✓", label: "Completed" },
    active: { color: T.statusProgress, icon: "◉", label: "In Progress" },
    upcoming: { color: T.text4, icon: "○", label: "Upcoming" },
  };
}

const PALETTE = ["#60a5fa","#f472b6","#34d399","#a78bfa","#fb923c","#38bdf8","#4ade80","#facc15","#22d3ee","#fb7185"];

// ─────────────────────────────────────────────
// SMALL UI PIECES
// ─────────────────────────────────────────────
const MONO = "'DM Mono', 'Courier New', monospace";
const SERIF = "'Playfair Display', Georgia, serif";

const LEC_TYPE_STYLES = {
  LEC:  { bg: "#ef444418", color: "#ef4444", border: "#ef444440" },
  DLA:  { bg: "#6366f118", color: "#6366f1", border: "#6366f140" },
  SG:   { bg: "#10b98118", color: "#10b981", border: "#10b98140" },
  TBL:  { bg: "#f59e0b18", color: "#f59e0b", border: "#f59e0b40" },
  LAB:  { bg: "#a78bfa18", color: "#a78bfa", border: "#a78bfa40" },
  CLIN: { bg: "#60a5fa18", color: "#60a5fa", border: "#60a5fa40" },
};
function lecTypeBadge(type) {
  let key = (type || "LEC").toUpperCase();
  if (key === "LECTURE" || key.startsWith("LECT")) key = "LEC";
  else key = key.slice(0, 4);
  const s = LEC_TYPE_STYLES[key] || LEC_TYPE_STYLES.LEC;
  return (
    <span style={{
      fontFamily: MONO,
      fontSize: 10,
      fontWeight: 700,
      padding: "2px 7px",
      borderRadius: 5,
      background: s.bg,
      color: s.color,
      border: "1px solid " + s.border,
    }}>
      {key}
    </span>
  );
}

function Spinner({ msg }) {
  const { T } = useTheme();
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:18, padding:"70px 40px" }}>
      <div style={{ width:44, height:44, border:"3px solid " + T.border1, borderTopColor:T.statusBad, borderRadius:"50%", animation:"rxt-spin 0.85s linear infinite" }} />
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
        border: "none", color: disabled ? T.text4 : T.text1,
        padding: "10px 22px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: MONO, fontSize: 15, fontWeight: 600,
        opacity: disabled ? 0.6 : 1, ...style,
      }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// SESSION CONFIG (before starting a session)
// ─────────────────────────────────────────────
function SessionConfig({ cfg, onStart, onBack, termColor, getTopicDifficulty, performanceHistory = {}, makeTopicKey }) {
  const { T } = useTheme();
  const topicKey = makeTopicKey
    ? (cfg.mode === "lecture" && cfg.lecture ? makeTopicKey(cfg.lecture.id, cfg.blockId ?? cfg.lecture?.blockId) : makeTopicKey(null, cfg.blockId || ""))
    : (cfg.mode === "lecture" && cfg.lecture ? cfg.lecture.id + "__" + (cfg.subtopic || "full") : "block__" + (cfg.blockId || ""));
  const storedDiff = getTopicDifficulty ? getTopicDifficulty(topicKey) : "medium";
  const storedPerf = getTopicDifficulty ? (performanceHistory[topicKey] || null) : null;

  const [qCount, setQCount] = useState(cfg.qCount || 10);
  const [difficulty, setDifficulty] = useState(cfg.difficulty || (storedDiff !== "medium" ? storedDiff : "auto"));
  const [mode, setMode] = useState(cfg.mode || "lecture");
  const scopeOptions =
    cfg.mode === "block"
      ? [{ value: "block", label: "🏛 Block Exam", desc: "All lectures in block" }]
      : [
          { value: "subtopic", label: "📌 This Subtopic", desc: cfg.subtopic === "__full__" ? "Full lecture" : (cfg.subtopic || "Current topic") },
          { value: "full", label: "📚 Full Lecture", desc: "All subtopics combined" },
        ];
  const [scope, setScope] = useState(
    cfg.mode === "block" ? "block" : cfg.subtopic === "__full__" ? "full" : "subtopic"
  );
  const tc = termColor || T.red;
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const diffOptions = [
    { value: "auto", label: "Auto", desc: "Based on your weak areas", color: T.blue },
    { value: "easy", label: "Easy", desc: "Foundational concepts", color: T.statusGood },
    { value: "medium", label: "Medium", desc: "Standard Step 1 level", color: T.statusWarn },
    { value: "hard", label: "Hard", desc: "Challenging distractors", color: T.statusBad },
    { value: "expert", label: "Expert", desc: "Hardest USMLE synthesis", color: "#a78bfa" },
  ];

  const questionTypes = [
    { value: "clinicalVignette", label: "Clinical Vignette", icon: "🏥", desc: "USMLE patient scenarios" },
    { value: "mechanismBased", label: "Mechanism", icon: "⚙️", desc: "Pathophysiology focus" },
    { value: "pharmacology", label: "Pharmacology", icon: "💊", desc: "Drug mechanisms" },
    { value: "mixed", label: "Mixed", icon: "🔀", desc: "All types combined" },
  ];
  const [questionType, setQuestionType] = useState("clinicalVignette");

  return (
    <div style={{ background: T.appBg, minHeight: "100%", maxWidth: 580, margin: "0 auto", padding: "40px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontFamily: MONO, fontSize: 13, marginBottom: 16, padding: 0 }}
        >
          ← Back
        </button>
        <h1 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 6, color: T.text1 }}>
          {cfg.mode === "block" ? "Block Exam" : (cfg.subtopic === "__full__" ? "Full Lecture Quiz" : cfg.subtopic)}
        </h1>
        <p style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}>
          {cfg.mode === "block"
            ? "Comprehensive review across all lectures in this block"
            : (cfg.subject || "") + " · " + (cfg.lecture?.lectureTitle || "")}
        </p>
      </div>

      <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>QUIZ SCOPE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {scopeOptions.map((o) => (
            <div
              key={o.value}
              onClick={() => setScope(o.value)}
              style={{
                background: scope === o.value ? tc + "18" : T.cardBg,
                border: "1px solid " + (scope === o.value ? tc : T.border1),
                borderRadius: 10,
                padding: "12px 16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 14,
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 22 }}>{o.label.split(" ")[0]}</span>
              <div>
                <div style={{ fontFamily: MONO, color: scope === o.value ? T.text1 : T.text2, fontSize: 14, fontWeight: 600 }}>
                  {o.label.split(" ").slice(1).join(" ")}
                </div>
                <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12, marginTop: 2 }}>{o.desc}</div>
              </div>
              {scope === o.value && <div style={{ marginLeft: "auto", color: tc, fontSize: 16 }}>✓</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 2, marginBottom: 16 }}>NUMBER OF QUESTIONS</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <button
            onClick={() => setQCount((q) => Math.max(1, q - 1))}
            style={{
              width: 44, height: 44, borderRadius: 10, background: T.inputBg,
              border: "1px solid " + T.border1, color: T.text1, fontSize: 24, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.border1)}
          >
            −
          </button>
          <div style={{ textAlign: "center", minWidth: 80 }}>
            <div style={{ fontFamily: SERIF, color: tc, fontSize: 52, fontWeight: 900, lineHeight: 1 }}>{qCount}</div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12, marginTop: 4 }}>
              {qCount === 1 ? "question" : "questions"} · {qCount <= 5 ? "Quick drill" : qCount <= 10 ? "Standard" : qCount <= 20 ? "Deep dive" : "Full block"}
            </div>
          </div>
          <button
            onClick={() => setQCount((q) => Math.min(40, q + 1))}
            style={{
              width: 44, height: 44, borderRadius: 10, background: T.inputBg,
              border: "1px solid " + T.border1, color: T.text1, fontSize: 24, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.border1)}
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
                background: qCount === n ? tc + "22" : T.cardBg,
                border: "1px solid " + (qCount === n ? tc : T.border1),
                color: qCount === n ? tc : T.text3,
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 13,
                transition: "all 0.15s",
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>DIFFICULTY</div>
        {storedPerf?.sessions?.length > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 14px", background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 3 }}>YOUR CURRENT LEVEL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14, color: storedDiff === "expert" ? "#a78bfa" : storedDiff === "hard" ? T.statusBad : storedDiff === "medium" ? T.statusWarn : T.statusGood }}>
                  {storedDiff.toUpperCase()}
                </span>
                {storedPerf.streak >= 1 && (
                  <span style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 12 }}>🔥 {storedPerf.streak} streak</span>
                )}
                {storedPerf.trend === "improving" && (
                  <span style={{ fontFamily: MONO, color: T.statusGood, fontSize: 12 }}>↑ improving</span>
                )}
                {storedPerf.trend === "declining" && (
                  <span style={{ fontFamily: MONO, color: T.statusBad, fontSize: 12 }}>↓ needs work</span>
                )}
              </div>
            </div>
            <svg width="80" height="28" style={{ flexShrink: 0 }}>
              {storedPerf.sessions.slice(-5).map((s, i, arr) => {
                const x = (i / (arr.length - 1 || 1)) * 72 + 4;
                const y = 24 - (s.score / 100) * 20;
                const c = getScoreColor(T, s.score);
                return (
                  <g key={i}>
                    {i > 0 && (() => {
                      const px = ((i - 1) / (arr.length - 1 || 1)) * 72 + 4;
                      const py = 24 - (arr[i - 1].score / 100) * 20;
                      return <line x1={px} y1={py} x2={x} y2={y} stroke={T.border1} strokeWidth="1.5" />;
                    })()}
                    <circle cx={x} cy={y} r="3" fill={c} />
                  </g>
                );
              })}
            </svg>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {diffOptions.map((d) => (
            <div
              key={d.value}
              onClick={() => setDifficulty(d.value)}
              style={{
                background: difficulty === d.value ? d.color + "18" : T.cardBg,
                border: "1px solid " + (difficulty === d.value ? d.color : T.border1),
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontFamily: MONO, color: difficulty === d.value ? d.color : T.text2, fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{d.label}</div>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>{d.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>QUESTION TYPE</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {questionTypes.map((t) => (
            <div
              key={t.value}
              onClick={() => setQuestionType(t.value)}
              style={{
                background: questionType === t.value ? tc + "18" : T.cardBg,
                border: "1px solid " + (questionType === t.value ? tc : T.border1),
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
                <div style={{ fontFamily: MONO, color: questionType === t.value ? T.text1 : T.text2, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => onStart({ ...cfg, qCount, difficulty, questionType, scope })}
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
  const { T } = useTheme();
  const [idx, setIdx] = useState(0);
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const tc = termColor || T.red;
  const q = questions[idx];
  const yourAnswer = originalAnswers[q.id];
  const correctAnswer = q.correct;

  return (
    <div style={{ background: T.appBg, minHeight: "100%", maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 900, marginBottom: 4, color: T.text1 }}>
            📋 Review Missed Questions
          </h2>
          <p style={{ fontFamily: MONO, color: T.text3, fontSize: 13 }}>
            Question {idx + 1} of {questions.length} missed
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid " + T.border1,
            color: T.text3,
            padding: "8px 16px",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 13,
          }}
        >
          ✕ Close Review
        </button>
      </div>

      <div style={{ height: 5, background: T.border1, borderRadius: 2, marginBottom: 28 }}>
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

      <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 16, padding: 28, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 12,
              background: T.statusBadBg,
              color: T.statusBad,
              border: "1px solid " + T.statusBadBorder,
              padding: "3px 10px",
              borderRadius: 5,
            }}
          >
            ✗ You answered: {yourAnswer || "Skipped"}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 12,
              background: T.statusGoodBg,
              color: T.statusGood,
              border: "1px solid " + T.statusGoodBorder,
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
            fontSize: 16,
            color: T.text1,
            lineHeight: 1.8,
            marginBottom: 24,
            padding: "16px",
            background: T.inputBg,
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
                  border: "1px solid " + (isCorrect ? T.statusGood : isYours ? T.statusBad : T.border1),
                  background: isCorrect ? T.statusGoodBg : isYours ? T.statusBadBg : T.cardBg,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 15,
                    flexShrink: 0,
                    marginTop: 1,
                    color: isCorrect ? T.statusGood : isYours ? T.statusBad : T.text3,
                  }}
                >
                  {letter} {isCorrect ? "✓" : isYours ? "✗" : ""}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 15,
                    color: isCorrect ? T.statusGood : isYours ? T.statusBad : T.text2,
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
          <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "16px 18px", opacity: 1, filter: "none" }}>
            <div style={{ fontFamily: MONO, color: T.statusGood, fontSize: 11, letterSpacing: 2, marginBottom: 10 }}>
              EXPLANATION
            </div>
            <p style={{ fontFamily: MONO, fontSize: 14, color: T.text1, lineHeight: 1.8, margin: 0 }}>{q.explanation}</p>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          style={{
            background: T.cardBg,
            border: "1px solid " + T.border1,
            color: idx === 0 ? T.text4 : T.text1,
            padding: "10px 24px",
            borderRadius: 10,
            cursor: idx === 0 ? "not-allowed" : "pointer",
            fontFamily: MONO,
            fontSize: 14,
            transition: "all 0.15s",
          }}
        >
          ← Previous
        </button>

        <span style={{ fontFamily: MONO, color: T.text3, fontSize: 13 }}>
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
              fontSize: 14,
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
              fontSize: 14,
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
function Session({ cfg, onDone, onBack, onGenerateTopicVignettes }) {
  const { T } = useTheme();
  const hasPreloaded = !!(cfg.vignettes && Array.isArray(cfg.vignettes) && cfg.vignettes.length > 0);
  const [vigs, setVigs]       = useState(hasPreloaded ? cfg.vignettes : []);
  const [loading, setLoading] = useState(!hasPreloaded);
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
    if (cfg.vignettes && Array.isArray(cfg.vignettes) && cfg.vignettes.length > 0) {
      setVigs(cfg.vignettes);
      setLoading(false);
      return;
    }
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
          const generator = onGenerateTopicVignettes || genTopicVignettes;
          list = await generator(cfg);
        }
        if (live) setVigs(validateAndFixQuestions(list || []));
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
      const correctCount = nr.filter((r) => r.ok).length;
      const resultsWithObjectives = nr.map((r) => {
        const vig = vigs.find((v) => v.id === r.questionId);
        return {
          questionId: vig?.id ?? r.questionId,
          objectiveId: vig?.objectiveId ?? null,
          objectiveCovered: vig?.objectiveCovered ?? null,
          lectureRef: vig?.lectureRef ?? null,
          topic: vig?.topic ?? r.topic ?? null,
          correct: r.ok,
          score: r.ok ? 100 : 0,
        };
      });
      onDone({
        correct: correctCount,
        total: nr.length,
        date: new Date().toISOString(),
        results: resultsWithObjectives,
      });
      setResults(nr);
      setDone(true);
    } else {
      setResults(nr); setIdx(i => i + 1); setSel(null); setShown(false);
    }
  };

  if (!vigs?.length && !loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: MONO, color: T.text3 }}>
        No questions available. Go back and try again.
      </div>
    );
  }

  if (loading) {
    const msg = cfg.mode === "block"
      ? "Building block exam — " + cfg.qCount + " questions from " + (cfg.blockLectures || []).length + " lectures…"
      : "Generating " + cfg.qCount + " vignettes for \"" + cfg.subtopic + "\"…";
    return <Spinner msg={msg} />;
  }

  if (error) return (
    <div style={{ background: T.appBg, minHeight: "100%", maxWidth: 640, margin: "0 auto", padding: 40 }}>
      <div style={{ fontFamily: MONO, color: T.statusBad, fontSize: 15, marginBottom: 16, fontWeight: 600 }}>
        ⚠ Session error
      </div>
      <pre
        style={{
          background: T.border2,
          border: "1px solid " + T.border1,
          borderRadius: 8,
          padding: 16,
          color: T.text1,
          fontSize: 14,
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
      <div style={{ background: T.appBg, minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "70px 40px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 24, color: T.text3 }}>Session Complete</div>
        <Ring score={score} size={130} tint={tc} />
        <p style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}>{results.filter(r => r.ok).length} / {results.length} correct</p>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center", maxWidth: 420 }}>
          {results.map((r, i) => (
            <div key={i} style={{ width: 38, height: 38, borderRadius: 9, background: r.ok ? T.statusGoodBg : T.statusBadBg, border: "2px solid " + (r.ok ? T.statusGood : T.statusBad), display: "flex", alignItems: "center", justifyContent: "center", color: r.ok ? T.statusGood : T.statusBad, fontSize: 17 }}>
              {r.ok ? "✓" : "✗"}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
          <Btn onClick={onBack} color={tc} style={{ padding: "12px 32px", fontSize: 16 }}>← Back to Block</Btn>
          {missedQuestions.length > 0 && (
            <button
              onClick={() => setReviewMode(true)}
              style={{
                background: T.cardBg,
                border: "1px solid " + T.statusBad,
                color: T.statusBad,
                padding: "12px 28px",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: SERIF,
                fontSize: 17,
                fontWeight: 700,
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
  const difficulty = v?.difficulty ?? cfg?.difficulty ?? "medium";
  const dColor = { easy: T.statusGood, medium: T.statusWarn, hard: T.statusBad, expert: "#a78bfa" };
  const dc = dColor[difficulty] || dColor.medium || T.amber;

  return (
    <div style={{ background: T.appBg, minHeight: "100%", maxWidth: 840, margin: "0 auto", padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>← Exit</button>
        <div style={{ flex: 1, height: 10, background: T.border1, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: (idx / vigs.length * 100) + "%", background: tc, borderRadius: 2, transition: "width 0.4s" }} />
        </div>
        <span style={{ fontFamily: MONO, color: T.text3, fontSize: 13 }}>{idx + 1}/{vigs.length}</span>
      </div>

      {/* Difficulty + topic */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: MONO, background: dc + "18", color: dc, fontSize: 13, padding: "3px 10px", borderRadius: 20, letterSpacing: 1.5, border: "1px solid " + dc + "30" }}>
          {(difficulty || "medium").toUpperCase()}
        </span>
        {v.topic && <span style={{ fontFamily: MONO, color: T.text3, fontSize: 13 }}>{v.topic}</span>}
      </div>

      {/* Generated With — style indicator */}
      {vigs.some((q) => q.usedUploadedStyle) && (
        <div style={{ fontFamily: MONO, color: T.statusGood, fontSize: 10, display: "flex", alignItems: "center", gap: 5 }}>
          <span>✓</span>
          <span>Questions styled from your uploaded {cfg.blockName || "block"} exams</span>
        </div>
      )}
      {!vigs.some((q) => q.usedUploadedStyle) && (
        <div style={{ fontFamily: MONO, color: T.statusWarn, fontSize: 10, display: "flex", alignItems: "center", gap: 5 }}>
          <span>⚠</span>
          <span>No uploaded exams matched — using USMLE standard style. Upload {cfg.blockName || "block"} exams to improve.</span>
        </div>
      )}

      {/* Stem */}
      <div style={{ background:T.inputBg, border:"1px solid " + T.border1, borderRadius:16, padding:28 }}>
        {v.imageQuestion ? (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {v.questionPageImage && (
              <div style={{ background: T.inputBg, borderRadius: 12, overflow: "hidden", border: "1px solid " + T.border1 }}>
                <img
                  src={"data:image/png;base64," + v.questionPageImage}
                  alt="Histology question slide"
                  style={{ width:"100%", display:"block", borderRadius:12 }}
                />
              </div>
            )}
            <p style={{ fontFamily:MONO, color:T.text3, fontSize:11, margin:0 }}>
              🔬 Identify the structures or select the correct answer based on the histological slide above.
            </p>
            {shown && v.answerPageImage && (
              <div>
                <div style={{ fontFamily:MONO, color:T.statusGood, fontSize:11, marginBottom:8, letterSpacing:1 }}>
                  ✓ ANSWER — ANNOTATED SLIDE
                </div>
                <div style={{ background: T.cardBg, borderRadius: 12, overflow: "hidden", border: "1px solid " + T.statusGoodBorder }}>
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
              <span style={{ fontFamily:MONO, color:T.text3, fontSize:10 }}>Highlight:</span>
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
                    border: highlightColor === c ? "2px solid " + T.text1 : "2px solid transparent",
                    transition:"transform 0.1s",
                    transform: highlightColor === c ? "scale(1.3)" : "scale(1)",
                  }}
                />
              ))}
              <span style={{ fontFamily:MONO, color:T.text4, fontSize:10, marginLeft:4 }}>
                Select text to highlight · Click highlight to remove
              </span>
            </div>
            <div
              id={"stem-" + v.id}
              onMouseUp={() => handleStemMouseUp(v.id)}
              style={{ userSelect:"text", cursor:"text", lineHeight:1.7 }}
            >
              <p style={{ fontFamily:SERIF, color:T.text1, lineHeight:1.7, fontSize:18, fontWeight:600, margin:0 }}>
                {renderStemWithHighlights(v.stem, v.id)}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Choices */}
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {CHOICES.map(letter => {
          const isEliminated = (eliminated[v.id] || []).includes(letter);
          const isSelected   = sel === letter;
          const isCorrect    = shown && letter === v.correct;
          const isWrong      = shown && isSelected && letter !== v.correct;

          let bg = T.cardBg, border = T.border1, color = T.text2;
          if (shown) {
            if (letter === v.correct)     { bg = T.statusGoodBg; border = T.statusGood; color = T.statusGood; }
            else if (letter === sel)      { bg = T.statusBadBg; border = T.statusBad; color = T.statusBad; }
          } else if (isSelected) {
            bg = tc + "18"; border = tc; color = T.text1;
          }

          return (
            <div key={letter} style={{ display:"flex", alignItems:"flex-start", gap:10, opacity: isEliminated ? 0.4 : 1 }}>
              {!shown && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleEliminate(v.id, letter); }}
                  title={isEliminated ? "Restore choice" : "Eliminate this choice"}
                  style={{
                    flexShrink: 0, width: 20, height: 20, marginTop: 2, borderRadius: 4,
                    background: "none", border: "1px solid " + T.border1, color: isEliminated ? T.statusBad : T.text3,
                    cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.statusBad; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = isEliminated ? T.statusBad : T.border1; }}
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
                  padding: "14px 16px",
                  cursor: shown || isEliminated ? "default" : "pointer",
                  display: "flex",
                  gap: 13,
                  color,
                  fontFamily: MONO,
                  fontSize: 15,
                  lineHeight: 1.65,
                  transition: "background 0.1s, border-color 0.1s",
                  textDecoration: isEliminated ? "line-through" : "none",
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 22, color: isEliminated ? T.text4 : (shown || isSelected ? color : T.text3) }}>{letter}.</span>
                <span style={{ flex: 1, color: isEliminated ? T.text4 : color }}>{v.choices[letter]}</span>
                {shown && letter === v.correct && <span style={{ color: T.statusGood }}>✓</span>}
                {shown && letter === sel && letter !== v.correct && <span style={{ color: T.statusBad }}>✗</span>}
              </div>
            </div>
          );
        })}
      </div>
      {!shown && (
        <p style={{ fontFamily: MONO, color: T.text3, fontSize: 12, marginTop: 8 }}>
          ✕ Click the X button next to a choice to eliminate it · Click ↩ to restore
        </p>
      )}

      {/* Explanation */}
      {shown && (
        <div style={{ background: T.cardBg, border: "1px solid " + T.border1, borderRadius: 14, padding: 24, opacity: 1, filter: "none" }}>
          <div style={{ fontFamily: MONO, color: T.blue, fontSize: 13, letterSpacing: 3, marginBottom: 12 }}>EXPLANATION</div>
          <p style={{ fontFamily: SERIF, color: T.text1, lineHeight: 1.7, fontSize: 15, margin: 0 }}>{v.explanation}</p>
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
        {!shown
          ? <Btn onClick={() => setShown(true)} color={tc} disabled={!sel}>Reveal Answer</Btn>
          : <Btn onClick={next} color={T.statusGood}>{idx+1>=vigs.length ? "Finish ✓" : "Next →"}</Btn>
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
        border: "1px solid " + T.blue,
        color: T.text1,
        fontFamily: "'DM Mono','Courier New',monospace",
        fontSize: 15,
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
      <span style={{ fontSize: 12, opacity: 0.5 }}>✏</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// EDITABLE LECTURE NUMBER & TYPE BADGE
// ─────────────────────────────────────────────
function EditableLecNumber({ value, type, onChange, tc, T }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const MONO = "'DM Mono','Courier New',monospace";

  const commit = () => {
    setEditing(false);
    const num = parseInt(draft, 10);
    if (!isNaN(num)) onChange(num);
    else if (draft === "") onChange(null);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        onClick={e => e.stopPropagation()}
        style={{
          width: 44,
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 700,
          color: tc,
          background: "transparent",
          border: "none",
          borderBottom: "1px solid " + tc,
          outline: "none",
          textAlign: "right",
          padding: "0 2px",
        }}
        placeholder="#"
      />
    );
  }

  const noValue = value == null;
  return (
    <span
      onClick={e => { e.stopPropagation(); setDraft(value ?? ""); setEditing(true); }}
      title={noValue ? "Click to set lecture number" : "Click to edit lecture number"}
      style={{
        fontFamily: MONO,
        color: noValue ? T.amber : tc,
        fontSize: 13,
        fontWeight: 700,
        minWidth: 28,
        textAlign: "right",
        flexShrink: 0,
        cursor: "text",
        borderBottom: "1px dashed " + (noValue ? T.amberBorder : tc),
      }}
    >
      {value ?? "?"}
    </span>
  );
}

function LecTypeBadge({ value, onChange, tc, T }) {
  const TYPES = ["LEC", "DLA", "SG", "TBL", "LAB", "CLIN"];
  const MONO = "'DM Mono','Courier New',monospace";
  const cycle = (e) => {
    e.stopPropagation();
    const v = (value || "LEC").toUpperCase();
    const key = v === "LECTURE" || v.startsWith("LECT") ? "LEC" : v.slice(0, 4);
    const idx = TYPES.indexOf(key);
    const next = TYPES[(idx >= 0 ? idx : 0) + 1] || TYPES[0];
    onChange(next);
  };
  let key = (value || "LEC").toUpperCase();
  if (key === "LECTURE" || key.startsWith("LECT")) key = "LEC";
  else key = key.slice(0, 4);
  const s = LEC_TYPE_STYLES[key] || LEC_TYPE_STYLES.LEC;
  return (
    <span
      onClick={cycle}
      title="Click to change type"
      style={{
        fontFamily: MONO,
        color: s.color,
        background: s.bg,
        border: "1px solid " + s.border,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 5,
        cursor: "pointer",
        flexShrink: 0,
        letterSpacing: 0.5,
        transition: "all 0.15s",
      }}
    >
      {key}
    </span>
  );
}

// ─────────────────────────────────────────────
// WEEK GROUP (collapsible week section for lecture list)
// ─────────────────────────────────────────────
const DOW_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekGroup({
  weekLabel,
  weekNumber,
  lecs,
  isCurrentWeek,
  mastered,
  struggling,
  total,
  pct,
  avgScore,
  sessionCount,
  defaultOpen,
  expandedLec,
  setExpandedLec,
  ...lecRowProps
}) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const { T, tc } = lecRowProps;
  const [open, setOpen] = useState(defaultOpen);

  const hasStruggling = struggling > 0;
  const headerColor = isCurrentWeek ? tc : hasStruggling ? T.statusBad : T.text2;

  const weekLecs = lecs;
  const byDay = DOW_ORDER.reduce((acc, day) => {
    const dayLecs = weekLecs.filter((l) => l.dayOfWeek === day);
    if (dayLecs.length > 0) acc[day] = dayLecs;
    return acc;
  }, {});
  const unassigned = weekLecs.filter((l) => !l.dayOfWeek);
  const todayDow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 16px",
          borderRadius: open ? "10px 10px 0 0" : 10,
          background: isCurrentWeek ? tc + "12" : T.cardBg,
          border: "1px solid " + (isCurrentWeek ? tc + "50" : T.border1),
          cursor: "pointer",
          userSelect: "none",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = isCurrentWeek ? tc + "1a" : T.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = isCurrentWeek ? tc + "12" : T.cardBg)}
      >
        <span
          style={{
            fontFamily: MONO,
            color: T.text3,
            fontSize: 11,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            display: "inline-block",
            flexShrink: 0,
          }}
        >
          ▶
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: SERIF, color: headerColor, fontSize: 15, fontWeight: 900 }}>
              {weekLabel}
            </span>
            {isCurrentWeek && (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  color: tc,
                  background: tc + "18",
                  padding: "2px 7px",
                  borderRadius: 4,
                  border: "1px solid " + tc + "40",
                }}
              >
                CURRENT
              </span>
            )}
            {hasStruggling && (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  color: T.statusBad,
                  background: T.statusBadBg,
                  padding: "2px 7px",
                  borderRadius: 4,
                }}
              >
                ⚠ {struggling} struggling
              </span>
            )}
          </div>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, marginTop: 1 }}>
            {lecs.length} lecture{lecs.length !== 1 ? "s" : ""} ·{" "}
            {total > 0 ? `${mastered}/${total} obj` : "no objectives"}{" "}
            {sessionCount > 0 ? `· ${sessionCount} sessions` : ""}{" "}
            {avgScore != null ? `· avg ${avgScore}%` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {total > 0 && (
            <>
              <div style={{ width: 80, height: 5, background: T.border1, borderRadius: 3 }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    background: pct === 100 ? T.statusGood : isCurrentWeek ? tc : T.statusWarn,
                    width: pct + "%",
                    transition: "width 0.4s",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  color: pct === 100 ? T.statusGood : headerColor,
                  minWidth: 32,
                }}
              >
                {pct}%
              </span>
            </>
          )}
        </div>
      </div>
      {open && (
        <div
          style={{
            borderTop: "none",
            borderRight: "1px solid " + (isCurrentWeek ? tc + "50" : T.border1),
            borderBottom: "1px solid " + (isCurrentWeek ? tc + "50" : T.border1),
            borderLeft: "1px solid " + (isCurrentWeek ? tc + "50" : T.border1),
            borderRadius: "0 0 10px 10px",
            overflow: "hidden",
          }}
        >
          {DOW_ORDER.filter((d) => byDay[d]).map((day) => {
            const isToday = day === todayDow;
            return (
              <div key={day} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 12px",
                    marginBottom: 4,
                  }}
                >
                  <div style={{ height: 1, width: 12, background: isToday ? tc : T.border1 }} />
                  <span
                    style={{
                      fontFamily: MONO,
                      color: isToday ? tc : T.text3,
                      fontSize: isToday ? 11 : 10,
                      fontWeight: isToday ? 700 : 400,
                      letterSpacing: 1,
                    }}
                  >
                    {day.toUpperCase()}
                  </span>
                  {isToday && (
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 8,
                        color: "#fff",
                        background: tc,
                        padding: "1px 6px",
                        borderRadius: 3,
                        fontWeight: 700,
                      }}
                    >
                      TODAY
                    </span>
                  )}
                  <div style={{ flex: 1, height: 1, background: isToday ? tc + "40" : T.border2 }} />
                  <span style={{ fontFamily: MONO, color: T.text3, fontSize: 9 }}>
                    {byDay[day].length} lecture{byDay[day].length !== 1 ? "s" : ""}
                  </span>
                </div>
                {byDay[day].map((lec, i) => (
                  <div key={lec.id} style={{ borderTop: i > 0 ? "1px solid " + T.border2 : "none" }}>
                    <LecListRow
                      lec={lec}
                      index={i}
                      onOpen={() => setExpandedLec(lec.id)}
                      onClose={() => setExpandedLec(null)}
                      isExpanded={expandedLec === lec.id}
                      {...lecRowProps}
                    />
                  </div>
                ))}
              </div>
            );
          })}
          {unassigned.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 12px",
                  marginBottom: 4,
                }}
              >
                <div style={{ flex: 1, height: 1, background: T.border2 }} />
                <span style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1 }}>
                  UNSCHEDULED
                </span>
                <div style={{ flex: 1, height: 1, background: T.border2 }} />
              </div>
              {unassigned.map((lec, i) => (
                <div key={lec.id} style={{ borderTop: i > 0 ? "1px solid " + T.border2 : "none" }}>
                  <LecListRow
                    lec={lec}
                    index={i}
                    onOpen={() => setExpandedLec(lec.id)}
                    onClose={() => setExpandedLec(null)}
                    isExpanded={expandedLec === lec.id}
                    {...lecRowProps}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// LECTURE LIST ROW (compact list view)
// ─────────────────────────────────────────────
function LecListRow({ lec, index, tc, T, sessions, onOpen, isExpanded, onClose, onStart, onDeepLearn, handleDeepLearnStart, setAnkiLogTarget, detectStudyMode: detectStudyModeFn, onUpdateLec, mergeMode, mergeSelected = [], onMergeToggle, bulkWeekTarget, allObjectives, allBlockObjectives, getBlockObjectives, updateObjective, currentBlock, startObjectiveQuiz, getLectureSubtopicCompletion, getLecCompletion, makeSubtopicKey, performanceHistory = {}, reanalyzeLecture }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const [quizLoading, setQuizLoading] = useState(false);

  const lecSessions = (sessions || []).filter(s => s.lectureId === lec.id);
  const sessionCount = lecSessions.length;
  const isMergeSelected = mergeSelected.includes(lec.id);
  const objectivesList = allBlockObjectives ?? allObjectives ?? [];
  const lecObjs = objectivesList.filter(
    (o) =>
      o.linkedLecId === lec.id ||
      (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
  );
  const masteredObjs = lecObjs.filter((o) => o.status === "mastered").length;
  const strugglingObjs = lecObjs.filter((o) => o.status === "struggling").length;

  return (
    <div style={{
      borderRadius: isExpanded ? 12 : 8,
      border: "1px solid " + (isMergeSelected ? T.amberBorder : isExpanded ? tc : T.border1),
      background: isMergeSelected ? T.amberBg : (isExpanded ? T.cardBg : "transparent"),
      transition: "all 0.18s",
      overflow: "hidden",
      boxShadow: isExpanded ? "0 2px 12px rgba(0,0,0,0.08)" : "none",
    }}>
      <div
        onClick={() => !mergeMode && (isExpanded ? onClose() : onOpen())}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: isExpanded ? "14px 16px" : "10px 14px",
          cursor: "pointer",
          transition: "padding 0.18s",
        }}
        onMouseEnter={e => !isExpanded && !isMergeSelected && (e.currentTarget.style.background = T.inputBg)}
        onMouseLeave={e => !isExpanded && !isMergeSelected && (e.currentTarget.style.background = "transparent")}
      >
        {mergeMode && (
          <div
            onClick={e => { e.stopPropagation(); onMergeToggle?.(lec.id); }}
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              flexShrink: 0,
              border: "2px solid " + (isMergeSelected ? T.amber : T.border1),
              background: isMergeSelected ? T.amber : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {isMergeSelected && <span style={{ color: T.text1, fontSize: 14, fontWeight: 700 }}>✓</span>}
          </div>
        )}
        <EditableLecNumber
          value={lec.lectureNumber}
          type={lec.lectureType}
          tc={tc}
          T={T}
          onChange={num => onUpdateLec(lec.id, { lectureNumber: num })}
        />
        <LecTypeBadge
          value={lec.lectureType}
          tc={tc}
          T={T}
          onChange={type => onUpdateLec(lec.id, { lectureType: type })}
        />
        <select
          value={lec.weekNumber ?? ""}
          onChange={(e) => {
            e.stopPropagation();
            onUpdateLec(lec.id, { weekNumber: e.target.value ? parseInt(e.target.value, 10) : null });
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: lec.weekNumber ? tc + "15" : T.inputBg,
            border: "1px solid " + (lec.weekNumber ? tc + "60" : T.border1),
            borderRadius: 6,
            padding: "3px 8px",
            color: lec.weekNumber ? tc : T.text3,
            fontFamily: MONO,
            fontSize: 10,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <option value="">+ Week</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
            <option key={w} value={w}>Wk {w}</option>
          ))}
        </select>
        {lec.weekNumber != null && lec.weekNumber !== "" && (
          <select
            value={lec.dayOfWeek || ""}
            onChange={(e) => {
              e.stopPropagation();
              onUpdateLec(lec.id, { dayOfWeek: e.target.value || null });
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: lec.dayOfWeek ? tc + "15" : T.inputBg,
              border: "1px solid " + (lec.dayOfWeek ? tc + "60" : T.border1),
              borderRadius: 6,
              padding: "3px 8px",
              color: lec.dayOfWeek ? tc : T.text3,
              fontFamily: MONO,
              fontSize: 10,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <option value="">+ Day</option>
            {DOW_ORDER.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        {bulkWeekTarget != null && !lec.weekNumber && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateLec(lec.id, { weekNumber: bulkWeekTarget });
            }}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "3px 10px",
              borderRadius: 6,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            → Assign Wk {bulkWeekTarget}
          </button>
        )}
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: tc, flexShrink: 0 }} />
        <span style={{ fontFamily: SERIF, color: T.text1, fontSize: 15, fontWeight: 700, lineHeight: 1.4, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {(() => {
            const title = (lec.lectureTitle || "").trim();
            const fileName = (lec.fileName || lec.filename || "").replace(/\.pdf$/i, "").trim();
            if (title && title.toLowerCase() !== fileName.toLowerCase()) return title;
            return title || fileName;
          })()}
        </span>
        {lec.isMerged && (
          <span title={"Merged from: " + (lec.mergedFrom || []).map(m => m.title).join(", ")} style={{ fontFamily: MONO, color: T.amber, background: T.amberBg, border: "1px solid " + T.amberBorder, fontSize: 10, padding: "1px 7px", borderRadius: 3, letterSpacing: 0.5, flexShrink: 0 }}>MERGED</span>
        )}
        {lec.extractionMethod === "mistral-ocr" && (
          <span title="Parsed with Mistral OCR — high quality extraction" style={{ fontFamily: MONO, fontSize: 8, color: "#7c3aed", background: "#7c3aed15", padding: "1px 5px", borderRadius: 3, border: "1px solid #7c3aed30", flexShrink: 0 }}>OCR✓</span>
        )}
        {((lec.extractedText || lec.fullText)?.length > 0 && !lec.teachingMap && reanalyzeLecture) && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); reanalyzeLecture(lec); }}
            style={{ fontFamily: MONO, fontSize: 10, color: tc, background: tc + "15", border: "1px solid " + tc + "40", padding: "2px 8px", borderRadius: 4, cursor: "pointer", flexShrink: 0 }}
          >
            🔍 Analyze with AI
          </button>
        )}
        {lec.teachingMap?.sections?.length > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.statusProgress ?? tc, flexShrink: 0 }}>
            ✓ {lec.teachingMap.sections?.length} sections mapped
          </span>
        )}
        {lec.subject && lec.subject !== lec.discipline && (
          <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10, flexShrink: 0 }}>{lec.subject}</span>
        )}
        {sessionCount > 0 && (
          <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, flexShrink: 0 }}>
            {sessionCount} session{sessionCount !== 1 ? "s" : ""}
          </span>
        )}
        {getLecCompletion && (() => {
          const pct = getLecCompletion(lec, currentBlock?.id);
          const color = getBarColor(T, pct);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <div style={{ width: 60, height: 4, background: T.border1, borderRadius: 2 }}>
                <div style={{ height: "100%", borderRadius: 2, background: color, width: pct + "%", transition: "width 0.4s" }} />
              </div>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color, minWidth: 32 }}>
                {pct}%
              </span>
            </div>
          );
        })()}
        {strugglingObjs > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.statusBad, flexShrink: 0 }}>⚠{strugglingObjs}</span>
        )}
        <span style={{ color: T.text3, fontSize: 13, flexShrink: 0, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>
          ▾
        </span>
      </div>

      {isExpanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid " + T.border1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>Week:</span>
            <select
              value={lec.weekNumber ?? ""}
              onChange={(e) => {
                const wk = e.target.value ? parseInt(e.target.value, 10) : null;
                onUpdateLec(lec.id, { weekNumber: wk });
              }}
              style={{
                background: T.inputBg,
                border: "1px solid " + T.border1,
                borderRadius: 6,
                padding: "4px 10px",
                color: T.text1,
                fontFamily: MONO,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <option value="">Unassigned</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
          {detectStudyModeFn && (() => {
            const studyMode = detectStudyModeFn(lec, lecObjs);
            const recLabels = { flashcards: "Flashcards", imageQuiz: "Image Quiz", anki: "Anki", deepLearn: "Deep Learn", mcq: "MCQ Practice", algorithmDraw: "Algorithm Drawing", labelDiagram: "Label Diagrams" };
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 9,
                  marginBottom: 12,
                  background: studyMode.color + "12",
                  border: "1px solid " + studyMode.color + "40",
                }}
              >
                <span style={{ fontSize: 18 }}>{studyMode.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO, color: studyMode.color, fontSize: 11, fontWeight: 700, marginBottom: 2 }}>
                    {studyMode.label}
                    {" — " + (studyMode.recommended || []).map((r) => recLabels[r] || r).join(" · ")}
                  </div>
                  <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, lineHeight: 1.5 }}>{studyMode.reason}</div>
                </div>
              </div>
            );
          })()}
          <div style={{ padding: "12px 0 10px" }}>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>SUBTOPICS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {(() => {
                const getSubtopicCompletion = (lec, si, subName, blockId) => {
                  const blockObjs = getBlockObjectives?.(blockId) || [];
                  const lecObjs = blockObjs.filter(
                    (o) =>
                      o.linkedLecId === lec.id ||
                      (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                  );
                  if (lecObjs.length === 0) return { pct: 0, mastered: 0, total: 0, sessions: 0 };
                  const subWords = subName
                    .toLowerCase()
                    .split(/\s+/)
                    .filter((w) => w.length > 3);
                  const subObjs = lecObjs.filter((o) => {
                    const objText = (o.objective || "").toLowerCase();
                    return subWords.some((w) => objText.includes(w));
                  });
                  const totalSubs = lec.subtopics?.length || 1;
                  const objsToUse =
                    subObjs.length > 0
                      ? subObjs
                      : lecObjs.slice(
                          Math.floor((si / totalSubs) * lecObjs.length),
                          Math.floor(((si + 1) / totalSubs) * lecObjs.length)
                        );
                  if (objsToUse.length === 0) {
                    const lecPct = getLecCompletion ? getLecCompletion(lec, blockId) : 0;
                    return {
                      pct: lecPct,
                      mastered: 0,
                      total: 0,
                      sessions: 0,
                      fallback: true,
                      struggling: 0,
                      untested: 0,
                      weakness: null,
                    };
                  }
                  const mastered = objsToUse.filter((o) => o.status === "mastered").length;
                  const inProgress = objsToUse.filter((o) => o.status === "inprogress").length;
                  const struggling = objsToUse.filter((o) => o.status === "struggling").length;
                  const untested = objsToUse.filter((o) => o.status === "untested").length;
                  const total = objsToUse.length;
                  const pct = Math.round(((mastered + inProgress * 0.5) / total) * 100);
                  const weakness =
                    struggling > 0
                      ? "critical"
                      : pct < 50 && untested > 0
                        ? "weak"
                        : pct < 80 && total > 0
                          ? "review"
    : null;
                  const subKey = makeSubtopicKey ? makeSubtopicKey(lec.id, si, blockId) : null;
                  const subPerf = subKey ? performanceHistory[subKey] : null;
                  const sessions = subPerf?.sessions?.length || 0;
                  return {
                    pct,
                    mastered,
                    total,
                    sessions,
                    lastScore: subPerf?.lastScore,
                    struggling,
                    untested,
                    weakness,
                  };
                };
                return (lec.subtopics || []).map((sub, si) => {
                  const {
                    pct,
                    mastered,
                    total,
                    sessions,
                    lastScore,
                    weakness,
                  } = getSubtopicCompletion(lec, si, sub, currentBlock?.id);
                  const isDone = pct >= 100;
                  const ringColor = isDone
                    ? T.statusGood
                    : weakness === "critical"
                      ? T.statusBad
                      : weakness === "weak"
                        ? T.statusWarn
                        : pct >= 80
                          ? tc
                          : T.statusWarn;
                  const rowBg = isDone
                    ? T.statusGoodBg
                    : weakness === "critical"
                      ? T.statusBadBg
                      : weakness === "weak"
                        ? T.statusWarnBg
                        : T.inputBg;
                  const rowBorder = isDone
                    ? T.statusGoodBorder
                    : weakness === "critical"
                      ? T.statusBadBorder
                      : weakness === "weak"
                        ? T.statusWarnBorder
                        : T.border1;
                  return (
                    <div
                      key={si}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 14px",
                        borderRadius: 8,
                        marginBottom: 4,
                        background: rowBg,
                        border: "1px solid " + rowBorder,
                        transition: "all 0.2s",
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          flexShrink: 0,
                          position: "relative",
                          background: `conic-gradient(${ringColor} ${pct * 3.6}deg, ${T.border1} 0deg)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: T.cardBg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 8,
                              fontWeight: 700,
                              color: isDone ? T.statusGood : weakness ? ringColor : pct > 0 ? tc : T.text3,
                            }}
                          >
                            {isDone ? "✓" : pct + "%"}
                          </span>
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            overflow: "hidden",
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: MONO,
                              color: isDone ? T.statusGood : T.text1,
                              fontSize: 12,
                              fontWeight: isDone ? 700 : 400,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {isDone && "✓ "}{sub}
                          </span>
                          {weakness && (
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 4,
                                flexShrink: 0,
                                background:
                                  weakness === "critical"
                                    ? T.statusBadBg
                                    : weakness === "weak"
                                      ? T.statusWarnBg
                                      : T.border1,
                                color:
                                  weakness === "critical"
                                    ? T.statusBad
                                    : weakness === "weak"
                                      ? T.statusWarn
                                      : T.text3,
                                border:
                                  "1px solid " +
                                  (weakness === "critical"
                                    ? T.statusBadBorder
                                    : weakness === "weak"
                                      ? T.statusWarnBorder
                                      : T.border2),
                              }}
                            >
                              {weakness === "critical"
                                ? "⚠ Struggling"
                                : weakness === "weak"
                                  ? "△ Weak"
                                  : "↻ Review"}
                            </span>
                          )}
                        </div>
                        {(total > 0 || sessions > 0) && (
                          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, marginTop: 1 }}>
                            {total > 0 && `${mastered}/${total} obj`}
                            {sessions > 0 && ` · ${sessions} session${sessions !== 1 ? "s" : ""}`}
                            {lastScore != null && (
                              <span
                                style={{
                                  color: getScoreColor(T, lastScore),
                                }}
                              >
                                {" "}
                                · {lastScore}%
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const subObjs = (() => {
                            const blockObjs = getBlockObjectives?.(currentBlock?.id) || allBlockObjectives || [];
                            const lecObjs = blockObjs.filter(
                              (o) =>
                                o.linkedLecId === lec.id ||
                                (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                            );
                            const subWords = sub.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
                            const matched = lecObjs.filter((o) =>
                              subWords.some((w) => (o.objective || "").toLowerCase().includes(w))
                            );
                            return matched.length > 0 ? matched : lecObjs.slice(si * 2, si * 2 + 3);
                          })();
                          await startObjectiveQuiz?.(subObjs, sub, currentBlock?.id, {
                            lectureId: lec.id,
                            subtopicIndex: si,
                            subtopicName: sub,
                          });
                        }}
                        style={{
                          background: isDone ? T.statusGoodBg : tc + "18",
                          border: "1px solid " + (isDone ? T.statusGoodBorder : tc + "50"),
                          color: isDone ? T.statusGood : tc,
                          padding: "5px 10px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {isDone ? "Review" : "► Quiz"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateLec(lec.id, {
                            subtopics: (lec.subtopics || []).filter((_, i) => i !== si),
                          });
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: T.text3,
                          cursor: "pointer",
                          fontSize: 12,
                          flexShrink: 0,
                          padding: "4px",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = T.statusBad)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = T.text3)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
          {lec.keyTerms?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>KEY TERMS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {lec.keyTerms.slice(0, 6).map((t, i) => (
                  <span key={i} style={{ fontFamily: MONO, color: T.text3, background: T.inputBg, border: "1px solid " + T.border1, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>{t}</span>
                ))}
              </div>
            </div>
          )}
          {(() => {
            const expandedObjs = (allBlockObjectives ?? allObjectives ?? []).filter(
              (o) =>
                o.linkedLecId === lec.id ||
                (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
            );
            if (!expandedObjs.length) return null;

            const mastered = expandedObjs.filter((o) => o.status === "mastered").length;
            const struggling = expandedObjs.filter((o) => o.status === "struggling").length;
            const untested = expandedObjs.filter((o) => o.status === "untested").length;

  return (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid " + T.border2 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5 }}>
                    LEARNING OBJECTIVES ({expandedObjs.length})
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    {mastered > 0 && <span style={{ fontFamily: MONO, color: T.statusGood, fontSize: 11 }}>✓ {mastered}</span>}
                    {struggling > 0 && <span style={{ fontFamily: MONO, color: T.statusBad, fontSize: 11 }}>⚠ {struggling}</span>}
                    {untested > 0 && <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>○ {untested}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {expandedObjs.map((obj, i) => {
                    const statusColor = getObjStatusColor(T, obj.status);
                    const statusIcon = getObjStatusIcon(obj.status);
                    const bloomColor = LEVEL_COLORS[obj.bloom_level] || "#6b7280";
                    const bloomBg = LEVEL_BG[obj.bloom_level] || "#6b728015";
                    const bloomName = obj.bloom_level_name || "Understand";
                    const bloomLevel = obj.bloom_level ?? 2;
                    const lecDate = lec.lectureDate;
                    const isPre = lecDate && new Date(lecDate) > new Date();
                    const actType = getActivityType(lec.lectureType);
                    const guidance =
                      actType === "DLA"
                        ? obj.dla_guide
                        : actType === "SG"
                          ? obj.sg_guide
                          : isPre
                            ? obj.pre_lecture_guide
                            : obj.post_lecture_guide;
                    return (
                      <div
                        key={obj.id || i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          padding: "10px 0",
                          borderBottom: "1px solid " + T.border2,
                        }}
                      >
                        <span
                          onClick={() => {
                            if (!updateObjective || !currentBlock?.id) return;
                            const next = { untested: "inprogress", inprogress: "mastered", mastered: "struggling", struggling: "untested" }[obj.status] || "inprogress";
                            updateObjective(currentBlock.id, obj.id, { status: next });
                          }}
                          title="Click to cycle status"
                          style={{ color: statusColor, fontSize: 14, flexShrink: 0, marginTop: 1, cursor: updateObjective ? "pointer" : "default", transition: "transform 0.1s" }}
                          onMouseEnter={(e) => updateObjective && (e.currentTarget.style.transform = "scale(1.3)")}
                          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                        >
                          {statusIcon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: MONO, color: T.text1, fontSize: 12, lineHeight: 1.6 }}>{obj.objective}</div>
                          {guidance && (
                            <div style={{ fontFamily: MONO, color: bloomColor, fontSize: 10, marginTop: 4, fontStyle: "italic", lineHeight: 1.5 }}>💡 {guidance}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 9,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background: bloomBg,
                              color: bloomColor,
                              border: "1px solid " + bloomColor + "40",
                              whiteSpace: "nowrap",
                            }}
                          >
                            L{bloomLevel} {bloomName}
                          </span>
                          {obj.bloom_verb && obj.bloom_verb !== "unknown" && (
                            <span style={{ fontFamily: MONO, fontSize: 8, color: T.text3, fontStyle: "italic" }}>verb: {obj.bloom_verb}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  {startObjectiveQuiz && (
                    <button
                      type="button"
                      disabled={quizLoading}
                      onClick={async () => {
                        setQuizLoading(true);
                        try {
                          await startObjectiveQuiz(expandedObjs, lec.lectureTitle || lec.filename, currentBlock?.id);
                        } finally {
                          setQuizLoading(false);
                        }
                      }}
                      style={{
                        flex: 1,
                        background: quizLoading ? T.inputBg : tc + "18",
                        border: "1px solid " + (quizLoading ? T.border1 : tc + "50"),
                        color: quizLoading ? T.text3 : tc,
                        padding: "10px 0",
                        borderRadius: 8,
                        cursor: quizLoading ? "not-allowed" : "pointer",
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => !quizLoading && (e.currentTarget.style.background = tc + "30")}
                      onMouseLeave={(e) => !quizLoading && (e.currentTarget.style.background = quizLoading ? T.inputBg : tc + "18")}
                    >
                      {quizLoading ? (
                        <>
                          <div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid " + T.border1, borderTopColor: tc, animation: "rxt-spin 0.7s linear infinite" }} />
                          Generating...
                        </>
                      ) : (
                        "🎯 Quiz These Objectives"
                      )}
                    </button>
                  )}
                  {updateObjective && currentBlock?.id && (
                    <button
                      type="button"
                      onClick={() => expandedObjs.forEach((o) => updateObjective(currentBlock.id, o.id, { status: "mastered" }))}
                      style={{ background: T.statusGoodBg, border: "1px solid " + T.statusGoodBorder, color: T.statusGood, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: 12 }}
                    >
                      ✓ All Done
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
            <button
              type="button"
              onClick={() => onStart(lec, "__full__")}
              style={{ flex: 1, background: "none", border: "1px dashed " + tc + "60", color: tc, padding: "7px 0", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: 12, transition: "all 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.background = tc + "12")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              📚 Full Lecture Quiz
            </button>
            {(() => {
              const studyMode = detectStudyModeFn ? detectStudyModeFn(lec, lecObjs) : { mode: "clinical", color: tc, icon: "🧬" };
              const isVisual = ["anatomy", "histology"].includes(studyMode.mode);

              return (
                <div style={{ display: "flex", gap: 8, flex: 1 }}>
                  <button
                    type="button"
                    onClick={() => setAnkiLogTarget?.(lec)}
                    style={{
                      flex: 1,
                      background: "#f59e0b18",
                      border: "1px solid #f59e0b50",
                      color: "#f59e0b",
                      padding: "10px 0",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    📇 Log Anki
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeepLearnStart?.({ selectedTopics: [{ id: lec.id + "_full", label: lec.lectureTitle, lecId: lec.id, weak: false }], blockId: currentBlock?.id })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: T.cardBg,
                      border: "1.5px solid " + tc,
                      borderRadius: 8,
                      color: tc,
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    🧠 Deep Learn
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// BLOCK WEAK OBJECTIVES BREAKDOWN (collapsible)
// ─────────────────────────────────────────────
function BlockWeakObjectivesBreakdown({ blockObjs, lecs, blockId, currentBlock, T, tc, startObjectiveQuiz, updateObjective, lecTypeBadge }) {
  const [showWeak, setShowWeak] = useState(false);
  const weakObjs = (blockObjs || []).filter(
    (o) => o.status === "struggling" || o.status === "untested"
  );

  if (weakObjs.length === 0) {
    return (
      <div style={{ fontFamily: MONO, color: T.statusGood, fontSize: 11, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        ✓ All objectives mastered — you're ready!
      </div>
    );
  }

  const blockLecs = (lecs || []).filter((l) => !currentBlock?.id || l.blockId === currentBlock?.id);
  const byLecture = {};
  weakObjs.forEach((o) => {
    let lec =
      blockLecs.find((l) => l.id === o.linkedLecId) ||
      blockLecs.find(
        (l) =>
          l.blockId === currentBlock?.id &&
          String(l.lectureNumber) === String(o.lectureNumber) &&
          (l.lectureType || "LEC") === (o.lectureType || l.lectureType || "LEC")
      ) ||
      blockLecs.find(
        (l) =>
          l.blockId === currentBlock?.id &&
          String(l.lectureNumber) === String(o.lectureNumber)
      ) ||
      blockLecs.find((l) => {
        const activity = (o.activity || "").toLowerCase().trim();
        const title = (l.lectureTitle || l.fileName || "").toLowerCase();
        const typeNum = `${(l.lectureType || "lec").toLowerCase()}${l.lectureNumber}`;
        return (
          activity &&
          activity !== "unknown" &&
          (title.includes(activity.slice(0, 15)) ||
            activity.includes(typeNum) ||
            typeNum.includes(activity.replace(/\s+/g, "")))
        );
      }) ||
      blockLecs.find((l) => {
        const objText = (o.objective || "").toLowerCase();
        const titleWords = (l.lectureTitle || "")
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 4);
        return titleWords.some((w) => objText.includes(w));
      });
    // When still unknown, match by objective's lectureTitle to lecture title (so DLA 4 merged objectives show under DLA 4)
    if (!lec && ((o.activity || "").trim() === "Unknown" || !(o.activity || "").trim()) && (o.lectureTitle || "").trim().length >= 5) {
      const objTitle = (o.lectureTitle || "").trim().toLowerCase().slice(0, 50);
      const titleMatches = blockLecs.filter((l) => {
        const lecTitle = (l.lectureTitle || l.fileName || "").toLowerCase();
        return lecTitle.includes(objTitle) || objTitle.includes(lecTitle.slice(0, 50));
      });
      if (titleMatches.length === 1) lec = titleMatches[0];
      else if (titleMatches.length > 1)
        lec = titleMatches.find((l) => (l.lectureType || "").toUpperCase().includes("DLA")) || titleMatches[0];
    }

    const key = lec?.id || `unknown_${o.activity || o.lectureNumber || "misc"}`;
    const label = lec
      ? `${lec.lectureType || "LEC"}${lec.lectureNumber} — ${lec.lectureTitle || lec.fileName || ""}`
      : o.activity
        ? o.activity
        : o.lectureNumber
          ? `Lecture ${o.lectureNumber}`
          : "Unlinked Objectives";

    if (!byLecture[key]) byLecture[key] = { label, lec, objs: [] };
    byLecture[key].objs.push(o);
  });

  const groups = Object.values(byLecture).sort((a, b) => {
    const aStruggling = a.objs.filter((o) => o.status === "struggling").length;
    const bStruggling = b.objs.filter((o) => o.status === "struggling").length;
    return bStruggling - aStruggling;
  });

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setShowWeak((p) => !p)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          marginBottom: showWeak ? 12 : 0,
        }}
      >
        <span style={{ fontFamily: MONO, color: T.statusBad, fontSize: 10, letterSpacing: 1.5, fontWeight: 700 }}>
          ⚠ {weakObjs.filter((o) => o.status === "struggling").length} STRUGGLING
        </span>
        <span style={{ fontFamily: MONO, color: T.statusNeutral, fontSize: 10, letterSpacing: 1.5 }}>
          ○ {weakObjs.filter((o) => o.status === "untested").length} UNTESTED
        </span>
        <span
          style={{
            fontFamily: MONO,
            color: T.text3,
            fontSize: 10,
            marginLeft: 4,
            transform: showWeak ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            transition: "transform 0.2s",
          }}
        >
          ▶
        </span>
      </button>

      {showWeak && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.map((group) => {
            const struggling = group.objs.filter((o) => o.status === "struggling");
            const untested = group.objs.filter((o) => o.status === "untested");

            return (
              <div
                key={group.label}
                style={{
                  background: T.inputBg,
                  border: "1px solid " + T.border1,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: "1px solid " + T.border2,
                    background: struggling.length > 0 ? T.statusBadBg : T.statusNeutralBg,
                  }}
                >
                  {group.lec && lecTypeBadge && lecTypeBadge(group.lec.lectureType || "LEC")}
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
                    {group.label}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {struggling.length > 0 && (
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          color: T.statusBad,
                          fontWeight: 700,
                          background: T.statusBadBg,
                          padding: "2px 7px",
                          borderRadius: 4,
                          border: "1px solid " + T.statusBadBorder,
                        }}
                      >
                        ⚠ {struggling.length}
                      </span>
                    )}
                    {untested.length > 0 && (
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          color: T.statusNeutral,
                          fontWeight: 700,
                          background: T.statusNeutralBg,
                          padding: "2px 7px",
                          borderRadius: 4,
                          border: "1px solid " + T.border1,
                        }}
                      >
                        ○ {untested.length}
                      </span>
                    )}
                    <button
                      onClick={() =>
                        startObjectiveQuiz(
                          group.objs,
                          group.lec?.lectureTitle || group.label,
                          blockId,
                          { lectureId: group.lec?.id }
                        )
                      }
                      style={{
                        background: tc,
                        border: "none",
                        color: "#fff",
                        padding: "3px 10px",
                        borderRadius: 5,
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      Quiz →
                    </button>
                  </div>
                </div>

                <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {struggling.map((o) => (
                    <div
                      key={o.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "5px 0",
                        borderBottom: "1px solid " + T.border2,
                      }}
                    >
                      <span style={{ color: T.statusBad, fontSize: 13, flexShrink: 0, marginTop: 1 }}>⚠</span>
                      <span style={{ fontFamily: MONO, color: T.text2, fontSize: 11, lineHeight: 1.5, flex: 1 }}>{o.objective}</span>
                      <button
                        onClick={() =>
                          updateObjective(blockId, o.id, {
                            status: o.status === "struggling" ? "inprogress" : "struggling",
                          })
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: T.text3,
                          cursor: "pointer",
                          fontFamily: MONO,
                          fontSize: 9,
                          flexShrink: 0,
                          padding: "2px 4px",
                        }}
                      >
                        cycle
                      </button>
                    </div>
                  ))}

                  {untested.map((o) => (
                    <div
                      key={o.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "5px 0",
                        borderBottom: "1px solid " + T.border2,
                      }}
                    >
                      <span style={{ color: T.statusNeutral, fontSize: 13, flexShrink: 0, marginTop: 1 }}>○</span>
                      <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, lineHeight: 1.5, flex: 1 }}>{o.objective}</span>
                      <button
                        onClick={() => updateObjective(blockId, o.id, { status: "inprogress" })}
                        style={{
                          background: "none",
                          border: "none",
                          color: T.text3,
                          cursor: "pointer",
                          fontFamily: MONO,
                          fontSize: 9,
                          flexShrink: 0,
                          padding: "2px 4px",
                        }}
                      >
                        start
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <button
            onClick={() =>
              startObjectiveQuiz(weakObjs, "All Weak Objectives", blockId)
            }
            style={{
              background: T.statusBad,
              border: "none",
              color: "#fff",
              padding: "12px 0",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 14,
              fontWeight: 900,
            }}
          >
            ⚠ Quiz All {weakObjs.length} Weak Objectives →
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// LECTURE CARD
// ─────────────────────────────────────────────
const DOW_ORDER_CARD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function LecCard({ lec, sessions, accent, tint, onStudy, onDelete, onUpdateLec, onDeepLearn, mergeMode, mergeSelected = [], onMergeToggle, bulkWeekTarget, allObjectives, showSubjectLabel = true, setAnkiLogTarget, getBlockObjectives, currentBlock, setBlockObjectives, startObjectiveQuiz, detectStudyMode, handleDeepLearnStart, getLectureSubtopicCompletion, getLecCompletion, getSubtopicCompletion, getLecPerf, reviewedLectures = {}, setReviewedLectures, markLectureReviewed, unmarkLectureReviewed, reanalyzeLecture }) {
  const { T } = useTheme();
  const tc = tint || accent || "#ef4444";
  const MONO = "'DM Mono','Courier New',monospace";
  const [confirming, setConfirming] = useState(false);
  const confirmTimeoutRef = useRef(null);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicDraft, setNewTopicDraft] = useState("");
  const addTopicRef = useRef();
  const isMergeSelected = mergeSelected.includes(lec.id);

  // Single source for completion: ring, bar, and any % label all use lecPct
  const lecPct = getLecCompletion ? getLecCompletion(lec, currentBlock?.id) : null;
  const blockObjs = getBlockObjectives ? (getBlockObjectives(currentBlock?.id) || []) : [];
  const lecObjs = blockObjs.filter(
    (o) =>
      o.linkedLecId === lec.id ||
      (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
  );
  const mastered = lecObjs.filter((o) => o.status === "mastered").length;
  const struggling = lecObjs.filter((o) => o.status === "struggling").length;
  const inProgress = lecObjs.filter((o) => o.status === "inprogress").length;
  const total = lecObjs.length;

  const ringColor =
    lecPct === 100
      ? T.statusGood
      : struggling > 0
        ? T.statusBad
        : lecPct >= 70
          ? T.statusProgress
          : lecPct >= 40
            ? T.statusWarn
            : lecPct > 0
              ? T.statusWarn
              : T.statusNeutral;

  const perf = getLecPerf ? getLecPerf(lec, currentBlock?.id) : null;
  const lastScore = perf?.lastScore ?? perf?.sessions?.slice(-1)[0]?.score ?? null;
  const sessionCount = perf?.sessions?.length || 0;
  const reviewKey = currentBlock?.id ? `${lec.id}__${currentBlock.id}` : null;
  const isReviewed = reviewKey ? !!reviewedLectures[reviewKey] : false;

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

  return (
    <div style={{ background: isMergeSelected ? T.amberBg : T.cardBg, border: "1px solid " + (isMergeSelected ? T.amberBorder : T.border1), borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12, position: "relative", boxShadow: T.cardShadow || "0 1px 4px rgba(15,23,42,0.08)" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: tc, borderRadius: "14px 14px 0 0" }} />
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, display: "flex", alignItems: "center", gap: 4, pointerEvents: "auto" }}>
        {mergeMode && (
          <div
            onClick={e => { e.stopPropagation(); onMergeToggle?.(lec.id); }}
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              border: "2px solid " + (isMergeSelected ? T.amber : T.border1),
              background: isMergeSelected ? T.amber : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {isMergeSelected && <span style={{ color: T.text1, fontSize: 14, fontWeight: 700 }}>✓</span>}
          </div>
        )}
        {confirming ? (
          <>
            <button onClick={cancelConfirm} style={{ background:T.border1, border:"1px solid " + T.text5, color:T.text5, padding:"4px 10px", borderRadius:6, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Cancel</button>
            <button onClick={doDelete} style={{ background:T.statusBadBg, border:"1px solid "+T.statusBadBorder, color:T.statusBad, padding:"4px 10px", borderRadius:6, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Delete</button>
          </>
        ) : (
          <button onClick={startConfirm} style={{ background:T.border1, border:"1px solid " + T.text5, color:T.text5, cursor:"pointer", fontSize:12, width:24, height:24, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center" }} title="Delete lecture">✕</button>
        )}
      </div>

      {(() => {
        const blockId = currentBlock?.id;
        if (!blockId || !setBlockObjectives || !getBlockObjectives) return null;
        const lecObjs = (getBlockObjectives(blockId) || []).filter((o) => o.linkedLecId === lec.id);
        const SHOULDER = /axilla|shoulder|cervicoaxillary|axillary|subclavian/i;
        const NEURAL = /neural tube|spinal cord|vertebra|neuroectoderm/i;
        const lecTitle = (lec.lectureTitle || "").toLowerCase();
        const mismatch = lecObjs.filter(
          (o) =>
            (SHOULDER.test(o.objective || "") && NEURAL.test(lecTitle)) ||
            (NEURAL.test(o.objective || "") && SHOULDER.test(lecTitle))
        );
        if (!mismatch.length) return null;
        const mismatchKey = (o) => o.id || (o.objective || "").slice(0, 80);
        const mismatchKeys = new Set(mismatch.map(mismatchKey));
        return (
          <div
            style={{
              background: T.statusBadBg,
              border: "1px solid " + T.statusBadBorder,
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontFamily: MONO, color: T.statusBad, fontSize: 11, flex: 1 }}>
              ⚠ {mismatch.length} objectives from wrong lecture detected
            </span>
            <button
              onClick={() => {
                setBlockObjectives((prev) => {
                  const data = prev[blockId] || { imported: [], extracted: [] };
                  const unlink = (o) => (mismatchKeys.has(mismatchKey(o)) ? { ...o, linkedLecId: null } : o);
                  const imported = (data.imported || []).map(unlink);
                  const extracted = (data.extracted || []).map(unlink);
                  const next = { ...prev, [blockId]: { ...data, imported, extracted } };
                  try {
                    localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
                  } catch {}
                  return next;
                });
              }}
              style={{
                fontFamily: MONO,
                fontSize: 10,
                padding: "4px 10px",
                borderRadius: 5,
                background: T.statusBad,
                border: "none",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              ✕ Remove them
            </button>
          </div>
        );
      })()}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", paddingRight:20 }}>
        <div style={{ flex:1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <EditableLecNumber
              value={lec.lectureNumber}
              type={lec.lectureType}
              tc={tc}
              T={T}
              onChange={num => onUpdateLec(lec.id, { lectureNumber: num })}
            />
            <LecTypeBadge
              value={lec.lectureType}
              tc={tc}
              T={T}
              onChange={type => onUpdateLec(lec.id, { lectureType: type })}
            />
            {lec.isMerged && (
              <span title={"Merged from: " + (lec.mergedFrom || []).map(m => m.title).join(", ")} style={{ fontFamily: MONO, color: T.amber, background: T.amberBg, border: "1px solid " + T.amberBorder, fontSize: 10, padding: "1px 7px", borderRadius: 3, letterSpacing: 0.5 }}>MERGED</span>
            )}
            {lec.extractionMethod === "mistral-ocr" && (
              <span title="Parsed with Mistral OCR — high quality extraction" style={{ fontFamily: MONO, fontSize: 8, color: "#7c3aed", background: "#7c3aed15", padding: "1px 5px", borderRadius: 3, border: "1px solid #7c3aed30" }}>OCR✓</span>
            )}
            {((lec.extractedText || lec.fullText)?.length > 0 && !lec.teachingMap && reanalyzeLecture) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); reanalyzeLecture(lec); }}
                style={{ fontFamily: MONO, fontSize: 10, color: tc, background: tc + "15", border: "1px solid " + tc + "40", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}
              >
                🔍 Analyze with AI
              </button>
            )}
            {lec.teachingMap?.sections?.length > 0 && (
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.statusProgress ?? tc }}>
                ✓ {lec.teachingMap.sections?.length} sections mapped
              </span>
            )}
          </div>
          {showSubjectLabel && (lec.subject || lec.discipline) && (
            <div style={{ fontFamily: MONO, color: tc, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
              <EditableText
                value={lec.subject || lec.discipline || ""}
                onChange={newSubject => onUpdateLec(lec.id, { subject: newSubject })}
                style={{ fontFamily: MONO, color: tc, fontSize: 10, fontWeight: 700 }}
                placeholder="Subject"
              />
            </div>
          )}
          <div style={{ marginBottom: 2 }}>
            <EditableText
              value={(() => {
                const title = (lec.lectureTitle || "").trim();
                const fileName = (lec.fileName || lec.filename || "").replace(/\.pdf$/i, "").trim();
                if (title && title.toLowerCase() !== fileName.toLowerCase()) return title;
                return title || fileName;
              })()}
              onChange={newTitle => onUpdateLec(lec.id, { lectureTitle: newTitle })}
              style={{
                fontFamily: SERIF,
                color: T.text1,
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
              placeholder="Click to set title"
            />
          </div>
        </div>
        {/* Completion ring — top right of card */}
        <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
          <svg width="56" height="56" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="28" cy="28" r="22" fill="none" stroke={T.border1} strokeWidth="4" />
            <circle
              cx="28"
              cy="28"
              r="22"
              fill="none"
              stroke={ringColor}
              strokeWidth="4"
              strokeDasharray={`${(lecPct ?? 0) * 1.382} 138.2`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.5s ease" }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 900, color: ringColor, lineHeight: 1 }}>
              {lecPct != null ? lecPct + "%" : "—"}
            </span>
          </div>
        </div>
        {sessionCount === 0 && isReviewed && reviewKey && (unmarkLectureReviewed || setReviewedLectures) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (unmarkLectureReviewed && currentBlock?.id) {
                unmarkLectureReviewed(lec, currentBlock.id);
              } else if (setReviewedLectures) {
                setReviewedLectures((prev) => {
                  const next = { ...prev };
                  delete next[reviewKey];
                  return next;
                });
              }
            }}
            title="Unmark as reviewed"
            style={{
              fontFamily: MONO,
              fontSize: 9,
              color: T.statusProgress,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              flexShrink: 0,
            }}
          >
            ◑ Reviewed
          </button>
        )}
      </div>

      {/* Week / Day assignment — always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
        <select
          value={lec.weekNumber ?? ""}
          onChange={(e) => onUpdateLec(lec.id, { weekNumber: e.target.value ? parseInt(e.target.value, 10) : null })}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: lec.weekNumber ? tc + "15" : T.inputBg,
            border: "1px solid " + (lec.weekNumber ? tc + "60" : T.border1),
            borderRadius: 6,
            padding: "3px 8px",
            color: lec.weekNumber ? tc : T.text3,
            fontFamily: MONO,
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          <option value="">+ Week</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
            <option key={w} value={w}>Wk {w}</option>
          ))}
        </select>
        {lec.weekNumber != null && lec.weekNumber !== "" && (
          <select
            value={lec.dayOfWeek || ""}
            onChange={(e) => onUpdateLec(lec.id, { dayOfWeek: e.target.value || null })}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: lec.dayOfWeek ? tc + "15" : T.inputBg,
              border: "1px solid " + (lec.dayOfWeek ? tc + "60" : T.border1),
              borderRadius: 6,
              padding: "3px 8px",
              color: lec.dayOfWeek ? tc : T.text3,
              fontFamily: MONO,
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            <option value="">+ Day</option>
            {DOW_ORDER_CARD.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        {bulkWeekTarget != null && !lec.weekNumber && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateLec(lec.id, { weekNumber: bulkWeekTarget });
            }}
            style={{
              background: tc,
              border: "none",
              color: "#fff",
              padding: "3px 10px",
              borderRadius: 6,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            → Assign Wk {bulkWeekTarget}
          </button>
        )}
      </div>

      {lecObjs.length > 0 && (() => {
        const dist = lecObjs.reduce((acc, o) => {
          acc[o.bloom_level ?? 2] = (acc[o.bloom_level ?? 2] || 0) + 1;
          return acc;
        }, {});
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6].filter((l) => dist[l]).map((l) => (
              <span
                key={l}
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: LEVEL_BG[l],
                  color: LEVEL_COLORS[l],
                  border: "1px solid " + LEVEL_COLORS[l] + "30",
                }}
              >
                L{l} ×{dist[l]}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Objective bar */}
      {total > 0 && (
        <div>
          <div style={{ height: 5, background: T.border1, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", display: "flex" }}>
              <div style={{ width: (mastered / total) * 100 + "%", background: T.statusGood, transition: "width 0.4s" }} />
              <div style={{ width: (inProgress / total) * 100 + "%", background: T.statusProgress, transition: "width 0.4s" }} />
              <div style={{ width: (struggling / total) * 100 + "%", background: T.statusBad, transition: "width 0.4s" }} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: MONO, color: T.statusGood, fontSize: 10 }}>✓ {mastered}</span>
            {inProgress > 0 && (
              <span style={{ fontFamily: MONO, color: T.statusProgress, fontSize: 10 }}>◑ {inProgress}</span>
            )}
            {struggling > 0 && (
              <span style={{ fontFamily: MONO, color: T.statusBad, fontSize: 10 }}>⚠ {struggling}</span>
            )}
            <span style={{ fontFamily: MONO, color: T.statusNeutral, fontSize: 10 }}>○ {total - mastered - inProgress - struggling}</span>
            {lastScore != null && (
              <span style={{ fontFamily: MONO, marginLeft: "auto", fontSize: 11, fontWeight: 700, color: getScoreColor(T, lastScore) }}>
                {lastScore}%
              </span>
            )}
          </div>
        </div>
      )}

      {sessionCount > 0 && (
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, marginTop: 4 }}>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {(lec.keyTerms || []).slice(0, 5).map(kt => (
          <span key={kt} style={{ fontFamily: MONO, background: T.border1, color: T.text2, fontSize: 13, padding: "2px 8px", borderRadius: 20 }}>{kt}</span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {(lec.subtopics || []).map((sub, si) => {
          const { pct, weakness } =
            getSubtopicCompletion
              ? getSubtopicCompletion(lec, si, sub, currentBlock?.id)
              : { pct: 0, weakness: null };
          const subColor =
            pct === 100
              ? T.statusGood
              : weakness === "critical"
                ? T.statusBad
                : weakness === "weak"
                  ? T.statusWarn
                  : pct > 0
                    ? T.statusProgress
                    : T.statusNeutral;

          return (
            <div
              key={si}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderRadius: 7,
                marginBottom: 3,
                background:
                  weakness === "critical"
                    ? T.statusBadBg
                    : weakness === "weak"
                      ? T.statusWarnBg
                      : T.inputBg,
                border:
                  "1px solid " +
                  (weakness === "critical"
                    ? T.statusBadBorder
                    : weakness === "weak"
                      ? T.statusWarnBorder
                      : T.border1),
              }}
            >
              {/* Mini ring — stroke starts from top (-90deg), text upright (+90deg) */}
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: `conic-gradient(${subColor} ${Math.min(100, pct) * 3.6}deg, ${T.border1} 0deg)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: "rotate(-90deg)",
                }}
              >
                <div
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: T.cardBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: "rotate(90deg)",
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 7, fontWeight: 700, color: subColor }}>
                    {pct >= 100 ? "✓" : pct > 0 ? pct + "%" : "○"}
                  </span>
              </div>
              </div>

              <span
                style={{
                  fontFamily: MONO,
                  color: T.text1,
                  fontSize: 11,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {sub}
              </span>

              {weakness && (
                <span style={{ fontFamily: MONO, fontSize: 8, color: subColor, fontWeight: 700, flexShrink: 0 }}>
                  {weakness === "critical" ? "⚠" : weakness === "weak" ? "△" : "↻"}
                </span>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateLec(lec.id, { subtopics: (lec.subtopics || []).filter((_, i) => i !== si) });
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: T.text3,
                  cursor: "pointer",
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const subObjs = (() => {
                    const bo = getBlockObjectives(currentBlock?.id) || [];
                    const lo = bo.filter(
                      (o) =>
                        o.linkedLecId === lec.id ||
                        (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                    );
                    const sw = sub.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
                    const m = lo.filter((o) =>
                      sw.some((w) => (o.objective || "").toLowerCase().includes(w))
                    );
                    return m.length ? m : lo.slice(si * 2, si * 2 + 3);
                  })();
                  await startObjectiveQuiz(subObjs, sub, currentBlock?.id, {
                    lectureId: lec.id,
                    subtopicIndex: si,
                    subtopicName: sub,
                  });
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: tc,
                  cursor: "pointer",
                  fontSize: 11,
                  flexShrink: 0,
                  fontWeight: 700,
                }}
              >
                ▶
              </button>
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
            <button type="button" onClick={() => { const t = newTopicDraft.trim(); if (t) { onUpdateLec(lec.id, { subtopics: [...(lec.subtopics || []), t] }); setNewTopicDraft(""); } setAddingTopic(false); }} style={{ background: tc, border: "none", color: T.text1, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Add</button>
      </div>
        ) : (
          <button type="button" onClick={() => setAddingTopic(true)} style={{ background:T.border1, border:"1px dashed "+T.text5, color:T.text5, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:11, textAlign:"left" }}>+ Add Topic</button>
        )}
      </div>
      {!lec.weekNumber && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            background: T.amberBg,
            borderRadius: 7,
            border: "1px solid " + T.amberBorder,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ fontFamily: MONO, color: T.amber, fontSize: 10 }}>△ Assign to week:</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
              <button
                key={w}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateLec(lec.id, { weekNumber: w });
                }}
                style={{
                  background: T.inputBg,
                  border: "1px solid " + T.border1,
                  borderRadius: 5,
                  padding: "3px 9px",
                  fontFamily: MONO,
                  fontSize: 10,
                  cursor: "pointer",
                  color: T.text2,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = tc + "20";
                  e.currentTarget.style.borderColor = tc;
                  e.currentTarget.style.color = tc;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = T.inputBg;
                  e.currentTarget.style.borderColor = T.border1;
                  e.currentTarget.style.color = T.text2;
                }}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => onStudy(lec, "__full__")}
        style={{
          marginTop: 10,
          width: "100%",
          background: "none",
          border: "1px solid " + tc,
          color: tc,
          padding: "7px 0",
          borderRadius: 8,
          cursor: "pointer",
          fontFamily: MONO,
          fontSize: 13,
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = tc + "18")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        📚 Quiz Full Lecture
      </button>
      <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 10, borderTop: "1px solid " + T.border2 }}>
        <button
          onClick={e => {
            e.stopPropagation();
            setAnkiLogTarget?.(lec);
          }}
          style={{ flex: 1, background: "#f59e0b18", border: "1px solid #f59e0b50", color: "#f59e0b", padding: "8px 0", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: 11, fontWeight: 700 }}
        >
          📇 Anki
        </button>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            handleDeepLearnStart?.({ selectedTopics: [{ id: lec.id + "_full", label: lec.lectureTitle, lecId: lec.id, weak: false }], blockId: currentBlock?.id });
          }}
          style={{
            flex: 1,
            padding: "10px",
            background: T.cardBg,
            border: "1.5px solid " + tc,
            borderRadius: 8,
            color: tc,
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          🧠 Deep Learn
        </button>
        {sessionCount === 0 && !isReviewed && reviewKey && (markLectureReviewed || setReviewedLectures) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (markLectureReviewed && currentBlock?.id) {
                markLectureReviewed(lec, currentBlock.id);
              } else if (setReviewedLectures) {
                setReviewedLectures((prev) => ({
                  ...prev,
                  [reviewKey]: { date: new Date().toISOString(), method: "manual" },
                }));
              }
            }}
            style={{
              padding: "6px 10px",
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 6,
              color: T.text3,
              fontFamily: MONO,
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            ✓ Mark Reviewed
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HEATMAP
// ─────────────────────────────────────────────
function Heatmap({
  lectures,
  getLecCompletion,
  getSubtopicCompletion,
  getBlockObjectives,
  startObjectiveQuiz,
  currentBlock,
  lecTypeBadge,
  tc,
}) {
  const { T } = useTheme();
  const blockId = currentBlock?.id;
  if (!lectures.length)
    return (
      <div style={{ background: T.cardBg, border: "1px dashed " + T.border1, borderRadius: 14, padding: 50, textAlign: "center", boxShadow: T.shadowSm }}>
        <p style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>Upload lectures to see the heatmap.</p>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {lectures.map((lec) => {
        const lecPct = getLecCompletion ? getLecCompletion(lec, blockId) : 0;
        const lecColor = getBarColor(T, lecPct);
        return (
          <div
            key={lec.id}
            style={{
              background: T.cardBg,
              border: "1px solid " + T.border1,
              borderRadius: 12,
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {lecTypeBadge && lecTypeBadge(lec.lectureType || "LEC")}
                <span style={{ fontFamily: MONO, color: lecColor, fontSize: 13, fontWeight: 700 }}>
                  {lec.lectureTitle || lec.fileName}
                </span>
                <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
                  {lec.subject || lec.discipline || ""}
                </span>
              </div>
              <span
                style={{
                  fontFamily: MONO,
                  fontWeight: 900,
                  fontSize: 14,
                  color: lecColor,
                }}
              >
                {lecPct > 0 ? lecPct + "%" : "—"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 8,
              }}
            >
              {(lec.subtopics || []).map((sub, si) => {
                const { pct, mastered, total, weakness } =
                  getSubtopicCompletion ? getSubtopicCompletion(lec, si, sub, blockId) : { pct: 0, mastered: 0, total: 0, weakness: null };

                const cellColor =
                  pct === 100 ? T.statusGood : weakness === "critical" ? T.statusBad : weakness === "weak" ? T.statusWarn : pct >= 60 ? tc : pct > 0 ? T.statusProgress : T.text3;
                const cellBg =
                  pct === 100 ? T.statusGoodBg : weakness === "critical" ? T.statusBadBg : weakness === "weak" ? T.statusWarnBg : pct > 0 ? tc + "0d" : T.inputBg;
                const cellPattern =
                  weakness === "critical"
                    ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(147,51,234,0.1) 3px, rgba(147,51,234,0.1) 6px)"
                    : weakness === "weak"
                      ? "repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(217,119,6,0.08) 4px, rgba(217,119,6,0.08) 8px)"
                      : "none";
                const cellBorder =
                  pct === 100 ? T.statusGoodBorder : weakness === "critical" ? T.statusBadBorder : weakness === "weak" ? T.statusWarnBorder : pct > 0 ? tc + "40" : T.border1;

                return (
                  <div
                    key={si}
                    style={{
                      background: cellBg,
                      backgroundImage: cellPattern,
                      border: "1px solid " + cellBorder,
                      borderRadius: 8,
                      padding: "10px 12px",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onClick={async () => {
                      if (!startObjectiveQuiz || !getBlockObjectives) return;
                      const blockObjs = getBlockObjectives(blockId) || [];
                      const lecObjs = blockObjs.filter(
                        (o) =>
                          o.linkedLecId === lec.id ||
                          (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                      );
                      const subWords = sub.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
                      const subObjs = lecObjs.filter((o) =>
                        subWords.some((w) => (o.objective || "").toLowerCase().includes(w))
                      );
                      await startObjectiveQuiz(
                        subObjs.length ? subObjs : lecObjs.slice(si * 2, si * 2 + 3),
                        sub,
                        blockId,
                        { lectureId: lec.id, subtopicIndex: si, subtopicName: sub }
                      );
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                      <div style={{ fontFamily: MONO, color: T.text1, fontSize: 11, lineHeight: 1.4, flex: 1 }}>
                        {sub}
                      </div>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontWeight: 900,
                          fontSize: 12,
                          flexShrink: 0,
                          color: cellColor,
                        }}
                      >
                        {pct > 0 ? pct + "%" : "—"}
                      </span>
                    </div>
                    {total > 0 && (
                      <div style={{ height: 3, background: T.border1, borderRadius: 2, marginTop: 6 }}>
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 2,
                            background: cellColor,
                            width: pct + "%",
                            transition: "width 0.4s",
                          }}
                        />
                      </div>
                    )}
                    {weakness && (
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 8,
                          color: cellColor,
                          marginTop: 4,
                          fontWeight: 700,
                        }}
                      >
                        {weakness === "critical" ? "⚠ Struggling" : weakness === "weak" ? "△ Needs Work" : "↻ Review"}
                      </div>
                    )}
                  </div>
                );
              })}

              {(lec.subtopics || []).length === 0 &&
                (() => {
                  const blockObjs = getBlockObjectives?.(blockId) || [];
                  const lecObjs = blockObjs.filter(
                    (o) =>
                      o.linkedLecId === lec.id ||
                      (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                  );
                  return (
                    <div
                      style={{
                        background: lecPct > 0 ? tc + "0d" : T.inputBg,
                        border: "1px solid " + (lecPct > 0 ? tc + "40" : T.border1),
                        borderRadius: 8,
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
                        {lecObjs.length} objectives
                      </div>
                      <div style={{ fontFamily: MONO, color: lecColor, fontSize: 12, fontWeight: 700, marginTop: 2 }}>
                        {lecPct}% complete
                      </div>
                    </div>
                  );
                })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// AI CONTEXT BADGE — shows what content is used for generation
// ─────────────────────────────────────────────
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
          {context.hasUploadedQs
            ? `✓ ${context.relevantQs.length} uploaded questions as style guide`
            : "✗ No uploaded questions matched"}
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
          {context.hasLectureContent
            ? `✓ Lecture slides loaded (${Math.round(context.lectureChunks.length / 100) * 100} chars)`
            : "✗ No lecture slides uploaded"}
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
          {context.hasObjectives
            ? `✓ ${context.objectives.length} objectives targeted`
            : "⚠ No objectives linked"}
        </span>
      </div>
      {context.styleAnalysis?.sourceFiles?.length > 0 && (
        <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
          Style learned from: {context.styleAnalysis.sourceFiles.join(", ")}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ANKI LOG MODAL — log external Anki sessions for a lecture
// ─────────────────────────────────────────────
function AnkiLogModal({ lec, blockId, onSave, onClose, T, tc }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const [cardCount, setCardCount] = useState("");
  const [newCards, setNewCards] = useState("");
  const [reviewCards, setReviewCards] = useState("");
  const [retention, setRetention] = useState("");
  const [timeSpent, setTimeSpent] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [notes, setNotes] = useState("");
  const [studyDate, setStudyDate] = useState(new Date().toISOString().slice(0, 10));

  const handleSave = () => {
    const total = parseInt(cardCount || 0, 10) || parseInt(newCards || 0, 10) + parseInt(reviewCards || 0, 10);
    if (!total) return;

    const score = retention ? parseInt(retention, 10) : confidence === "High" ? 85 : confidence === "Medium" ? 65 : 45;

    onSave({
      sessionType: "anki",
      date: new Date(studyDate).toISOString(),
      completedAt: new Date().toISOString(),
      score,
      cardCount: total,
      newCards: parseInt(newCards || 0, 10),
      reviewCards: parseInt(reviewCards || 0, 10),
      retention: retention ? parseInt(retention, 10) : null,
      timeSpent: timeSpent ? parseInt(timeSpent, 10) : null,
      confidenceLevel: confidence,
      notes,
      lectureId: lec.id,
      blockId,
      questionCount: total,
    });
  };

  const canSave = parseInt(cardCount || 0, 10) || parseInt(newCards || 0, 10) || parseInt(reviewCards || 0, 10);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000bb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: T.cardBg,
          borderRadius: 18,
          padding: "28px 32px",
          maxWidth: 440,
          width: "100%",
          border: "1px solid " + T.border1,
          boxShadow: "0 20px 60px #00000050",
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: MONO, color: "#f59e0b", fontSize: 9, letterSpacing: 1.5, marginBottom: 4 }}>📇 LOG ANKI SESSION</div>
          <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 18, fontWeight: 900 }}>{lec.lectureTitle || lec.fileName}</div>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginTop: 2 }}>{lec.lectureType || "LEC"}{lec.lectureNumber}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, letterSpacing: 1, marginBottom: 5 }}>STUDY DATE</div>
          <input
            type="date"
            value={studyDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setStudyDate(e.target.value)}
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 8,
              padding: "9px 14px",
              color: T.text1,
              fontFamily: MONO,
              fontSize: 13,
              width: "100%",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>TOTAL CARDS</div>
          <input
            type="number"
            value={cardCount}
            onChange={(e) => setCardCount(e.target.value)}
            placeholder="e.g. new + reviews"
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 7,
              padding: "8px 10px",
              color: T.text1,
              fontFamily: MONO,
              fontSize: 13,
              width: "100%",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {[
            { label: "New Cards", val: newCards, set: setNewCards },
            { label: "Reviews", val: reviewCards, set: setReviewCards },
            { label: "Retention %", val: retention, set: setRetention },
            { label: "Min Spent", val: timeSpent, set: setTimeSpent },
          ].map((field) => (
            <div key={field.label} style={{ flex: 1 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>{field.label}</div>
              <input
                type="number"
                value={field.val}
                onChange={(e) => field.set(e.target.value)}
                placeholder="0"
                style={{
                  background: T.inputBg,
                  border: "1px solid " + T.border1,
                  borderRadius: 7,
                  padding: "8px 10px",
                  color: T.text1,
                  fontFamily: MONO,
                  fontSize: 13,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>HOW DID IT FEEL?</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { val: "Low", label: "😰 Tough", color: T.statusBad },
              { val: "Medium", label: "😐 OK", color: T.statusWarn },
              { val: "High", label: "💪 Solid", color: T.statusGood },
            ].map((c) => (
              <button
                key={c.val}
                onClick={() => setConfidence(c.val)}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: confidence === c.val ? 700 : 400,
                  border: "1px solid " + (confidence === c.val ? c.color : T.border1),
                  background: confidence === c.val ? c.color + "18" : T.inputBg,
                  color: confidence === c.val ? c.color : T.text3,
                  transition: "all 0.15s",
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, letterSpacing: 1, marginBottom: 5 }}>NOTES (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. struggled with muscle origins, nailed nerve supply..."
            rows={2}
            style={{
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 8,
              padding: "10px 14px",
              color: T.text1,
              fontFamily: MONO,
              fontSize: 12,
              width: "100%",
              boxSizing: "border-box",
              resize: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: T.inputBg,
              border: "1px solid " + T.border1,
              color: T.text2,
              padding: "12px 0",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              flex: 2,
              background: !canSave ? T.border1 : "#f59e0b",
              border: "none",
              color: "#fff",
              padding: "12px 0",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: SERIF,
              fontSize: 15,
              fontWeight: 900,
              opacity: !canSave ? 0.5 : 1,
            }}
          >
            Log Session →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CONFIDENCE MODAL (post-session rating)
// ─────────────────────────────────────────────
function ConfidenceModal({ lectureName, score, sessionType, onRate, T, tc }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const scoreColor = getScoreColor(T, score);
  const suggestedConfidence = score >= 80 ? "High" : score >= 60 ? "Medium" : "Low";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
      <div style={{ background: T.cardBg, borderRadius: 20, padding: "32px", maxWidth: 420, width: "100%", border: "1px solid " + T.border1, boxShadow: "0 24px 64px #00000060", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎯</div>
          <div style={{ fontFamily: SERIF, color: T.text1, fontSize: 20, fontWeight: 900, marginBottom: 4 }}>Session Complete</div>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginBottom: 12 }}>{lectureName}</div>
          {score != null && (
            <div style={{ display: "inline-block", background: scoreColor + "15", border: "2px solid " + scoreColor, borderRadius: 12, padding: "10px 24px" }}>
              <div style={{ fontFamily: MONO, color: scoreColor, fontSize: 32, fontWeight: 900 }}>{score}%</div>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>
                {sessionType === "anki" ? "retention" : sessionType === "deepLearn" ? "post-MCQ" : "score"}
              </div>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, letterSpacing: 1.5, textAlign: "center", marginBottom: 12 }}>HOW CONFIDENT DO YOU FEEL ABOUT THIS MATERIAL?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { val: "High", emoji: "💪", label: "Solid", sub: "I could explain this to someone else", color: T.statusGood, bg: T.statusGoodBg, border: T.statusGoodBorder },
              { val: "Medium", emoji: "😐", label: "Getting There", sub: "I understand most of it but have some gaps", color: T.statusWarn, bg: T.statusWarnBg, border: T.statusWarnBorder },
              { val: "Low", emoji: "😰", label: "Shaky", sub: "I need more review — this didn't stick well", color: T.statusBad, bg: T.statusBadBg, border: T.statusBadBorder },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => onRate(opt.val)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "2px solid " + (opt.val === suggestedConfidence ? opt.color : T.border1),
                  background: opt.val === suggestedConfidence ? opt.bg : T.inputBg,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                  width: "100%",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.border = "2px solid " + opt.color; e.currentTarget.style.background = opt.bg; }}
                onMouseLeave={(e) => { e.currentTarget.style.border = "2px solid " + (opt.val === suggestedConfidence ? opt.color : T.border1); e.currentTarget.style.background = opt.val === suggestedConfidence ? opt.bg : T.inputBg; }}
              >
                <span style={{ fontSize: 24, flexShrink: 0 }}>{opt.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO, color: opt.color, fontSize: 13, fontWeight: 700 }}>
                    {opt.label}
                    {opt.val === suggestedConfidence && <span style={{ fontFamily: MONO, color: T.text3, fontSize: 9, fontWeight: 400, marginLeft: 8 }}>suggested</span>}
                  </div>
                  <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginTop: 2 }}>{opt.sub}</div>
                </div>
                <span style={{ fontFamily: MONO, color: T.text3, fontSize: 16, flexShrink: 0 }}>→</span>
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => onRate(suggestedConfidence)} style={{ background: "none", border: "none", color: T.text3, fontFamily: MONO, fontSize: 11, cursor: "pointer", textAlign: "center", padding: "4px" }}>
          Skip — use suggested ({suggestedConfidence})
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EXAM CONFIG MODAL
// ─────────────────────────────────────────────
function ExamConfigModal({ config, blockObjs, blockLecs, questionBanksByFile, performanceHistory, onStart, onCancel, T, tc, buildQuestionContext, stylePrefs = {}, updateStylePref }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const DIFFICULTY_LADDER = ["easy", "medium", "hard", "expert"];

  const { mode, blockId } = config;

  const lectureGroups = useMemo(() => {
    const groups = {};
    (blockObjs || []).forEach((obj) => {
      const key = obj.activity || "Unknown";
      if (!groups[key]) {
        const matchedLec = blockLecs.find(
          (l) =>
            String(l.lectureNumber) === String(obj.lectureNumber) ||
            (l.lectureTitle || "").toLowerCase().includes((obj.lectureTitle || "").slice(0, 20).toLowerCase())
        );
        const uploadedQs = Object.entries(questionBanksByFile || {})
          .flatMap(([fname, qs]) => (qs || []).map((q) => ({ ...q, fname })))
          .filter(
            (q) =>
              (q.topic || "").toLowerCase().includes((obj.lectureTitle || "").slice(0, 15).toLowerCase()) ||
              (obj.lectureNumber && (q.topic || "").includes(String(obj.lectureNumber)))
          );
        groups[key] = {
          activity: key,
          lectureNumber: obj.lectureNumber,
          discipline: obj.discipline,
          lectureTitle: obj.lectureTitle,
          objectives: [],
          matchedLec,
          uploadedQCount: uploadedQs.length,
          perfKey: matchedLec ? matchedLec.id + "__full" : null,
        };
      }
      groups[key].objectives.push(obj);
    });
    return Object.values(groups).sort((a, b) => (a.lectureNumber || 99) - (b.lectureNumber || 99));
  }, [blockObjs, blockLecs, questionBanksByFile]);

  const defaultLecIds = useMemo(() => {
    if (mode === "weak") {
      return (blockLecs || []).filter((lec) =>
        lectureGroups.some(
          (g) =>
            g.matchedLec?.id === lec.id &&
            g.objectives.some((o) => o.status === "struggling" || o.status === "untested")
        )
      ).map((l) => l.id);
    }
    return (blockLecs || []).map((l) => l.id);
  }, [lectureGroups, mode, blockLecs]);

  const [selectedLecIds, setSelectedLecIds] = useState(defaultLecIds);
  const [selectedSubtopics, setSelectedSubtopics] = useState([]);
  const [questionCount, setQuestionCount] = useState(20);
  const [focusMode, setFocusMode] = useState(mode === "weak" ? "weak" : "all");

  useEffect(() => {
    setSelectedLecIds(defaultLecIds);
    setSelectedSubtopics([]);
    setFocusMode(mode === "weak" ? "weak" : "all");
  }, [mode, defaultLecIds]);

  const selectedGroups = lectureGroups.filter((g) => g.matchedLec && selectedLecIds.includes(g.matchedLec.id));
  const totalObjs = selectedGroups.flatMap((g) => g.objectives);
  const weakObjs = totalObjs.filter((o) => o.status === "struggling" || o.status === "untested");
  const masteredObjs = totalObjs.filter((o) => o.status === "mastered");
  const hasUploadedQs = selectedGroups.some((g) => g.uploadedQCount > 0);
  const hasUploadedLecs = selectedGroups.some((g) => g.matchedLec);
  const totalUploadedQs = selectedGroups.reduce((a, g) => a + g.uploadedQCount, 0);

  const aiContext = useMemo(() => {
    if (!buildQuestionContext || !blockId) return null;
    const selectedLecIds = selectedGroups.filter((g) => g.matchedLec).map((g) => g.matchedLec.id);
    return buildQuestionContext(blockId, selectedGroups.length === 1 ? selectedGroups[0]?.matchedLec?.id : null, questionBanksByFile, "exam", { selectedLecIds });
  }, [buildQuestionContext, blockId, selectedGroups, questionBanksByFile]);

  const avgDifficulty = (() => {
    const diffs = selectedGroups.map((g) => (g.perfKey ? performanceHistory[g.perfKey]?.currentDifficulty : null)).filter(Boolean);
    if (!diffs.length) return "medium";
    const avg = diffs.reduce((a, d) => a + DIFFICULTY_LADDER.indexOf(d), 0) / diffs.length;
    return DIFFICULTY_LADDER[Math.round(avg)];
  })();

  const diffColor = { easy: "#10b981", medium: "#f59e0b", hard: "#ef4444", expert: "#a78bfa" }[avgDifficulty];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000c0", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: T.cardBg, borderRadius: 18, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", border: "1px solid " + T.border1, boxShadow: T.shadowMd }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid " + T.border1, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: MONO, color: tc, fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>
              {mode === "objectives" ? "🎯 OBJECTIVES EXAM" : mode === "weak" ? "⚠ WEAK AREAS" : "📋 FULL REVIEW"}
            </div>
            <h2 style={{ fontFamily: SERIF, color: T.text1, fontSize: 22, fontWeight: 900, margin: 0 }}>Configure Your Session</h2>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 22 }}>✕</button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5 }}>NUMBER OF QUESTIONS</span>
              <span style={{ fontFamily: MONO, color: tc, fontSize: 22, fontWeight: 700 }}>{questionCount}</span>
            </div>
            <input type="range" min={5} max={50} step={5} value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} style={{ width: "100%", accentColor: tc }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, color: T.text3, fontSize: 11, marginTop: 4 }}>
              <span>5 — quick check</span>
              <span>20 — standard</span>
              <span>50 — full block</span>
            </div>
          </div>
          {updateStylePref && (
            <div style={{ padding: 14, background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 9, letterSpacing: 1.5, marginBottom: 10 }}>STYLE PREFERENCES</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 20px" }}>
                {[
                  { key: "longStems", label: "Long stems" },
                  { key: "hardDistractors", label: "Hard distractors" },
                  { key: "labValues", label: "Include lab values" },
                  { key: "firstAid", label: "First Aid references" },
                  { key: "explainWrong", label: "Explain wrong answers" },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 12, color: T.text2, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!stylePrefs[key]} onChange={(e) => updateStylePref(key, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>QUESTION FOCUS</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { val: "weak", label: "⚠ Weak & Untested", desc: weakObjs.length + " objectives" },
                { val: "all", label: "⊞ All Objectives", desc: totalObjs.length + " objectives" },
                { val: "untested", label: "○ Untested Only", desc: totalObjs.filter((o) => o.status === "untested").length + " objectives" },
                { val: "mastered", label: "✓ Mastered Review", desc: masteredObjs.length + " objectives" },
              ].map((opt) => (
                <div
                  key={opt.val}
                  onClick={() => setFocusMode(opt.val)}
                  style={{
                    flex: "1 1 140px",
                    padding: "10px 14px",
                    borderRadius: 9,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    border: "1px solid " + (focusMode === opt.val ? tc : T.border1),
                    background: focusMode === opt.val ? tc + "18" : T.inputBg,
                  }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: focusMode === opt.val ? tc : T.text1 }}>{opt.label}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3, marginTop: 2 }}>{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5 }}>SELECT LECTURES ({selectedLecIds.length}/{(blockLecs || []).length})</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setSelectedLecIds((blockLecs || []).map((l) => l.id))}
                style={{ fontFamily: MONO, fontSize: 11, color: tc, background: tc + "12", border: "1px solid " + tc + "40", padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}
              >
                Select All
              </button>
              <button
                onClick={() => {
                  setSelectedLecIds([]);
                  setSelectedSubtopics([]);
                }}
                style={{ fontFamily: MONO, fontSize: 11, color: T.text3, background: T.inputBg, border: "1px solid " + T.border1, padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}
              >
                Clear
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {(() => {
                const blockLecsList = blockLecs || [];
                return blockLecsList.map((lec) => {
                  const subtopics = lec.subtopics || [];
                  const isSelected = selectedLecIds.includes(lec.id);
                  const allSubSel = subtopics.every((_, i) => selectedSubtopics.includes(lec.id + "_sub_" + i));
                  const someSubSel = subtopics.some((_, i) => selectedSubtopics.includes(lec.id + "_sub_" + i));

                  return (
                    <div key={lec.id} style={{ marginBottom: 8 }}>
                      {/* Parent lecture row */}
                      <div
                        onClick={() => {
                          if (isSelected) {
                            setSelectedLecIds((prev) => prev.filter((id) => id !== lec.id));
                            setSelectedSubtopics((prev) => prev.filter((s) => !s.startsWith(lec.id + "_sub_")));
                          } else {
                            setSelectedLecIds((prev) => [...prev, lec.id]);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 14px",
                          borderRadius: subtopics.length > 0 ? "10px 10px 0 0" : 10,
                          background: isSelected ? tc + "12" : T.inputBg,
                          borderTop: "1px solid " + (isSelected ? tc + "60" : T.border1),
                          borderRight: "1px solid " + (isSelected ? tc + "60" : T.border1),
                          borderBottom: subtopics.length > 0 ? "none" : "1px solid " + (isSelected ? tc + "60" : T.border1),
                          borderLeft: "1px solid " + (isSelected ? tc + "60" : T.border1),
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 5,
                            flexShrink: 0,
                            border: "2px solid " + (isSelected ? tc : T.border1),
                            background: isSelected ? tc : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isSelected && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {lecTypeBadge(lec.lectureType || "LEC")}
                            {lec.extractionMethod === "mistral-ocr" && (
                              <span title="Parsed with Mistral OCR — high quality extraction" style={{ fontFamily: MONO, fontSize: 8, color: "#7c3aed", background: "#7c3aed15", padding: "1px 5px", borderRadius: 3, border: "1px solid #7c3aed30", flexShrink: 0 }}>OCR✓</span>
                            )}
                            <span style={{ fontFamily: MONO, color: T.text1, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {lec.lectureTitle || lec.fileName}
                            </span>
                          </div>
                          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 10, marginTop: 2 }}>
                            {lec.lectureType || "LEC"}{lec.lectureNumber}
                            {subtopics.length > 0 && ` · ${subtopics.length} subtopics`}
                          </div>
                        </div>
                        {(() => {
                          const lecObjs = (blockObjs || []).filter(
                            (o) =>
                              o.linkedLecId === lec.id ||
                              (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                          );
                          return lecObjs.length > 0 ? (
                            <span style={{ fontFamily: MONO, color: T.statusGood, fontSize: 10, flexShrink: 0 }}>📖 {lecObjs.length} obj</span>
                          ) : (
                            <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10, flexShrink: 0 }}>📭 no obj</span>
                          );
                        })()}
                      </div>
                      {/* Subtopics nested below */}
                      {subtopics.length > 0 && (
                        <div
                          style={{
                            borderTop: "1px solid " + T.border2,
                            borderRight: "1px solid " + (isSelected ? tc + "60" : T.border1),
                            borderBottom: "1px solid " + (isSelected ? tc + "60" : T.border1),
                            borderLeft: "1px solid " + (isSelected ? tc + "60" : T.border1),
                            borderRadius: "0 0 10px 10px",
                            overflow: "hidden",
                          }}
                        >
                          {subtopics.map((sub, si) => {
                            const subKey = lec.id + "_sub_" + si;
                            const subSel = selectedSubtopics.includes(subKey);
                            return (
                              <div
                                key={subKey}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSubtopics((prev) => (subSel ? prev.filter((s) => s !== subKey) : [...prev, subKey]));
                                  if (!isSelected && !subSel) {
                                    setSelectedLecIds((prev) => [...prev, lec.id]);
                                  }
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 12,
                                  padding: "9px 14px 9px 42px",
                                  background: subSel ? tc + "0a" : T.cardBg,
                                  borderBottom: si < subtopics.length - 1 ? "1px solid " + T.border2 : "none",
                                  cursor: "pointer",
                                  transition: "background 0.15s",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = subSel ? tc + "14" : (T.hoverBg ?? T.inputBg))}
                                onMouseLeave={(e) => (e.currentTarget.style.background = subSel ? tc + "0a" : T.cardBg)}
                              >
                                <div
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 4,
                                    flexShrink: 0,
                                    border: "2px solid " + (subSel ? tc : T.border1),
                                    background: subSel ? tc : "transparent",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  {subSel && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                                </div>
                                <span style={{ fontFamily: MONO, color: T.text2, fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {sub}
                                </span>
                                <span style={{ fontFamily: MONO, color: T.text3, fontSize: 9 }}>subtopic</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {aiContext && <AIContextBadge context={aiContext} T={T} MONO={MONO} />}

          <div style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>SESSION PREVIEW</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {[
                { label: "Questions", val: questionCount },
                { label: "Lectures", val: selectedLecIds.length },
                { label: "Objectives", val: focusMode === "weak" ? weakObjs.length : focusMode === "untested" ? totalObjs.filter((o) => o.status === "untested").length : totalObjs.length },
                { label: "Difficulty", val: avgDifficulty.toUpperCase(), color: diffColor },
              ].map((s) => (
                <div key={s.label}>
                  <div style={{ fontFamily: MONO, color: s.color || tc, fontSize: 18, fontWeight: 700 }}>{s.val}</div>
                  <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: hasUploadedLecs ? T.statusGood : T.text3, background: hasUploadedLecs ? T.statusGoodBg : T.pillBg, border: "1px solid " + (hasUploadedLecs ? T.statusGoodBorder : T.border1), padding: "2px 8px", borderRadius: 4 }}>{hasUploadedLecs ? "📖 Using lecture slides" : "📭 No slides uploaded"}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: hasUploadedQs ? T.statusGood : T.text3, background: hasUploadedQs ? T.statusGoodBg : T.pillBg, border: "1px solid " + (hasUploadedQs ? T.statusGoodBorder : T.border1), padding: "2px 8px", borderRadius: 4 }}>{hasUploadedQs ? "📝 " + totalUploadedQs + " uploaded questions as style guide" : "📝 No uploaded questions"}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.amber, background: T.amberBg, border: "1px solid " + T.amberBorder, padding: "2px 8px", borderRadius: 4 }}>🎯 {focusMode === "weak" ? weakObjs.length + " weak objectives targeted" : totalObjs.length + " objectives targeted"}</span>
            </div>
          </div>

          <button
            disabled={selectedLecIds.length === 0}
            onClick={() =>
              onStart({
                mode,
                questionCount,
                focusMode,
                selectedActivities: selectedGroups.map((g) => g.activity),
                selectedGroups,
                selectedLecIds,
                selectedSubtopics,
                targetObjectives: focusMode === "weak" ? weakObjs : focusMode === "untested" ? totalObjs.filter((o) => o.status === "untested") : focusMode === "mastered" ? masteredObjs : totalObjs,
                blockId,
              })
            }
            style={{
              background: selectedLecIds.length === 0 ? T.border1 : tc,
              border: "none",
              color: "#fff",
              padding: "14px 0",
              borderRadius: 11,
              cursor: selectedLecIds.length === 0 ? "not-allowed" : "pointer",
              fontFamily: SERIF,
              fontSize: 18,
              fontWeight: 900,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { if (selectedLecIds.length > 0) e.currentTarget.style.opacity = "0.88"; }}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Generate {questionCount} Questions →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MERGE MODAL
// ─────────────────────────────────────────────
function MergeModal({ config, onConfirm, onCancel, T, tc }) {
  const { lectures } = config;
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";

  const primaryLec = lectures.length ? lectures.reduce((a, b) =>
    (b.chunks?.length || 0) > (a.chunks?.length || 0) ? b : a
  , lectures[0]) : null;

  const [title, setTitle] = useState(primaryLec?.lectureTitle || "");
  const [subject, setSubject] = useState(primaryLec?.subject || "");
  const [lecNum, setLecNum] = useState(primaryLec?.lectureNumber ?? "");
  const [lecType, setLecType] = useState(primaryLec?.lectureType || "Lecture");
  const [strategy, setStrategy] = useState("append");
  const [keepOriginals, setKeep] = useState(false);

  const allSubtopics = [...new Set(lectures.flatMap(l => l.subtopics || []))];
  const allKeyTerms = [...new Set(lectures.flatMap(l => l.keyTerms || []))];

  if (!lectures.length) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: T.overlayBg,
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}>
      <div style={{
        background: T.cardBg, borderRadius: 16, width: "100%", maxWidth: 560,
        maxHeight: "85vh", overflowY: "auto",
        border: "1px solid " + T.border1, boxShadow: T.shadowMd,
      }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid " + T.border1, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>⊕</span>
          <div>
            <h3 style={{ fontFamily: SERIF, color: T.text1, fontSize: 18, fontWeight: 900, margin: 0 }}>Merge {lectures.length} Lectures</h3>
            <p style={{ fontFamily: MONO, color: T.text3, fontSize: 12, margin: 0 }}>Combined content will be searchable and quizzable as one lecture</p>
          </div>
          <button onClick={onCancel} style={{ marginLeft: "auto", background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>MERGING (primary content first)</div>
            {lectures.map((l, i) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, marginBottom: 6, background: T.inputBg, border: "1px solid " + T.border1 }}>
                <span style={{ fontFamily: MONO, color: T.amber, fontSize: 13, fontWeight: 700, minWidth: 16 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO, color: T.text1, fontSize: 13 }}>{l.lectureNumber ? (l.lectureType || "Lecture") + " " + l.lectureNumber + " — " : ""}{l.lectureTitle || l.filename}</div>
                  <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, marginTop: 1 }}>{l.chunks?.length || 0} content chunks · {l.subtopics?.length || 0} subtopics</div>
                </div>
                {i === 0 && <span style={{ fontFamily: MONO, color: T.amber, background: T.amberBg, border: "1px solid " + T.amberBorder, fontSize: 10, padding: "2px 6px", borderRadius: 3 }}>PRIMARY</span>}
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>MERGED LECTURE TITLE</div>
            <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: "100%", background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 8, padding: "9px 12px", fontFamily: MONO, color: T.text1, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>LECTURE NUMBER</div>
              <input value={lecNum} onChange={e => setLecNum(e.target.value)} placeholder="e.g. 50" style={{ width: "100%", background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 8, padding: "9px 12px", fontFamily: MONO, color: T.text1, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>TYPE</div>
              <select value={lecType} onChange={e => setLecType(e.target.value)} style={{ width: "100%", background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 8, padding: "9px 12px", fontFamily: MONO, color: T.text1, fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                {["Lecture", "DLA", "Lab", "Combined"].map(ty => <option key={ty} value={ty}>{ty}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>CONTENT STRATEGY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { value: "append", label: "Append", desc: "Add supplementary lecture content after primary — best when one is simpler/shorter" },
                { value: "interleave", label: "Interleave", desc: "Mix subtopics from both in topic order — best when they cover same topics differently" },
                { value: "primary", label: "Primary Only", desc: "Keep primary lecture content, use secondary only for extra subtopics and key terms" },
              ].map(opt => (
                <div key={opt.value} onClick={() => setStrategy(opt.value)} style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (strategy === opt.value ? T.amber : T.border1), background: strategy === opt.value ? T.amberBg : T.inputBg, transition: "all 0.15s" }}>
                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: strategy === opt.value ? T.amber : T.text1 }}>{opt.label}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: T.text3, marginTop: 2 }}>{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>PREVIEW — MERGED SUBTOPICS ({allSubtopics.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
              {allSubtopics.map((s, i) => (
                <span key={i} style={{ fontFamily: MONO, color: T.text2, background: T.pillBg, border: "1px solid " + T.border1, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>{s}</span>
              ))}
            </div>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 6 }}>KEY TERMS ({allKeyTerms.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {allKeyTerms.slice(0, 10).map((kt, i) => (
                <span key={i} style={{ fontFamily: MONO, color: T.text3, background: T.pillBg, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>{kt}</span>
              ))}
              {allKeyTerms.length > 10 && <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>+{allKeyTerms.length - 10} more</span>}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: T.inputBg, border: "1px solid " + T.border1, cursor: "pointer" }} onClick={() => setKeep(k => !k)}>
            <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, border: "2px solid " + (keepOriginals ? T.amber : T.border1), background: keepOriginals ? T.amber : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
              {keepOriginals && <span style={{ color: T.text1, fontSize: 13 }}>✓</span>}
            </div>
            <div>
              <div style={{ fontFamily: MONO, color: T.text1, fontSize: 13 }}>Keep original lectures</div>
              <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>Originals stay in the list alongside the merged lecture</div>
            </div>
          </div>

          <button onClick={() => onConfirm({ title, subject, lecNum: parseInt(lecNum, 10) || null, lecType, strategy, keepOriginals, lectures })} style={{ background: T.amber, border: "none", color: T.text1, padding: "13px 0", borderRadius: 10, cursor: "pointer", fontFamily: SERIF, fontSize: 18, fontWeight: 900, transition: "opacity 0.15s" }} onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")} onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
            ⊕ Create Merged Lecture
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// OBJECTIVES IMPORTER (summary PDF)
// ─────────────────────────────────────────────
function ObjectivesImporter({ blockId, onImport, T, tc }) {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");
  const [count, setCount] = useState(0);
  const [liveObjectives, setLiveObjectives] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [showLive, setShowLive] = useState(true);
  const liveEndRef = useRef(null);
  const MONO = "'DM Mono','Courier New',monospace";

  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true);
    setLiveObjectives([]);
    setMsg("📄 Reading PDF...");
    setCount(0);

    try {
      await loadPDFJS();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
      setTotalPages(pdf.numPages);

      const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
      const allObjectives = [];

      setMsg("📤 Uploading PDF...");
      const uploadRes = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: {
            "X-Goog-Upload-Protocol": "raw",
            "X-Goog-Upload-Command": "start, upload, finalize",
            "X-Goog-Upload-Header-Content-Type": "application/pdf",
            "X-Goog-Upload-Header-Content-Length": String(file.size),
            "Content-Type": "application/pdf",
          },
          body: file,
        }
      );

      const uploadData = await uploadRes.json();
      const fileUri = uploadData?.file?.uri;
      const fileName = uploadData?.file?.name;
      if (!fileUri) throw new Error("Upload failed: " + JSON.stringify(uploadData).slice(0, 200));

      const passes = [
        { label: "pages 1–3", instruction: "Extract ALL objectives from pages 1, 2, and 3 only." },
        { label: "pages 4–6", instruction: "Extract ALL objectives from pages 4, 5, and 6 only." },
        { label: "pages 7–9", instruction: "Extract ALL objectives from pages 7, 8, and 9 only." },
        { label: "final check", instruction: "Extract any remaining objectives not yet captured. Scan every page." },
      ];

      for (let pi = 0; pi < passes.length; pi++) {
        const pass = passes[pi];
        setMsg(`🧠 Pass ${pi + 1}/4 — ${pass.label}...`);

        const seenCodes = new Set(allObjectives.map((o) => o.code).filter(Boolean));

        const prompt =
          `This PDF is a medical school module objectives document.\n` +
          `It is a TABLE with 5 columns: Activity | Discipline | Title | Objective Code | Objective Text\n\n` +
          `CRITICAL TABLE RULE: The table uses MERGED CELLS.\n` +
          `Only the FIRST row of each lecture group has Activity/Discipline/Title filled in.\n` +
          `All other rows in that group have BLANK Activity/Discipline/Title cells.\n` +
          `You MUST forward-fill: when Activity is blank, use the last non-blank Activity above it.\n` +
          `Same for Discipline and Title.\n\n` +
          `${pass.instruction}\n\n` +
          `There are 30-50 objectives per page. Extract EVERY ROW.\n` +
          (seenCodes.size > 0
            ? `Already extracted ${allObjectives.length} objectives with codes: ${[...seenCodes].slice(0, 10).join(", ")}...\nDo NOT repeat these.\n\n`
            : "") +
          `Normalize Activity: "Lecture 27" → "Lec27", "DLA 16" → "DLA16", "SG 07" → "SG07"\n\n` +
          `Return ONLY this JSON (no markdown):\n` +
          `{"objectives":[{"activity":"Lec27","lectureNumber":27,"discipline":"BCHM","lectureTitle":"Proteoglycans and Glycoproteins","code":"SOM.MK.I.BPM1.1.FTM.3.BCHM.0143","objective":"Describe the general structure of proteoglycans"}]}`;

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        { file_data: { mime_type: "application/pdf", file_uri: fileUri } },
                        { text: prompt },
                      ],
                    },
                  ],
                  generationConfig: { maxOutputTokens: 16000, temperature: 0.0 },
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
            const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (!raw) continue;

            const first = raw.indexOf("{");
            const last = raw.lastIndexOf("}");
            if (first === -1) continue;

            let parsed;
            try {
              parsed = JSON.parse(raw.slice(first, last + 1));
            } catch {
              try {
                parsed = JSON.parse(
                  raw
                    .slice(first, last + 1)
                    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
                    .replace(/,\s*([}\]])/g, "$1")
                );
              } catch {
                continue;
              }
            }

            const arr =
              parsed?.objectives ||
              Object.values(parsed || {}).find((v) => Array.isArray(v) && v.length > 0) ||
              [];

            const newOnes = arr
              .filter((o) => (o?.objective || "").length > 10)
              .filter((o) => !seenCodes.has(o.code))
              .map((o, i) => ({
                id: o.code || `imp_${Date.now()}_${i}`,
                activity: o.activity || "Unknown",
                lectureNumber: o.lectureNumber || parseInt((o.activity || "").match(/\d+/)?.[0]) || null,
                discipline: o.discipline || "Unknown",
                lectureTitle: o.lectureTitle || "",
                code: o.code || null,
                objective: o.objective || "",
                status: "untested",
                confidence: 0,
                lastTested: null,
                quizScore: null,
                source: "imported",
              }));

            allObjectives.push(...newOnes);
            setLiveObjectives([...allObjectives]);
            setCount(allObjectives.length);
            setMsg(`✓ Pass ${pi + 1} done — ${allObjectives.length} objectives so far`);
            break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 800));
          }
        }

        await new Promise((r) => setTimeout(r, 400));
      }

      try {
        await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`,
          { method: "DELETE" }
        );
      } catch {}

      const seen = new Set();
      const deduped = allObjectives.filter((o) => {
        const key = (o.objective || "").slice(0, 55).toLowerCase().replace(/\W/g, "");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setLiveObjectives(deduped);
      setCount(deduped.length);
      setMsg(`✓ ${deduped.length} objectives imported`);
      onImport(deduped);
    } catch (e) {
      setMsg("✗ " + e.message);
    }
    setImporting(false);
  };

  return (
    <div style={{ background: T.inputBg, border: "2px dashed " + (tc || T.red) + "50", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 24 }}>🎯</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, color: T.text2, fontSize: 13, fontWeight: 600 }}>Import Module Objectives Summary</div>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 12, marginTop: 2 }}>
            {msg || "Upload your school's objectives summary PDF (the one listing ALL lectures). Individual lecture objectives are extracted automatically when you upload lectures above."}
          </div>
        </div>
        <label style={{ background: importing ? T.border1 : (tc || T.red), border: "none", color: "#fff", padding: "8px 18px", borderRadius: 8, cursor: importing ? "not-allowed" : "pointer", fontFamily: MONO, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {importing ? "Importing..." : "📥 Import PDF"}
          <input type="file" accept=".pdf" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} style={{ display: "none" }} disabled={importing} />
        </label>
        <button
          type="button"
          onClick={() => { setLiveObjectives([]); setCurrentPage(0); setTotalPages(0); setMsg(""); }}
          style={{ background: "none", border: "1px solid " + T.border1, color: T.text3, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}
        >
          Replace
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {importing && totalPages > 0 && (
          <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
            page {currentPage}/{totalPages}
          </span>
        )}
        <div style={{ background: importing ? (tc || T.statusBad) + "22" : (T.statusGoodBg || T.inputBg), border: "1px solid " + (importing ? (tc || T.statusBad) : (T.statusGood || "#2563eb")), borderRadius: 6, padding: "2px 10px" }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: importing ? (tc || T.red) : (T.green || "#10b981") }}>
            {liveObjectives.length} found
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowLive(v => !v)}
          style={{ background: "none", border: "1px solid " + T.border1, color: T.text3, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}
        >
          {showLive ? "hide" : "show"}
        </button>
      </div>

      {importing && totalPages > 0 && (
        <div style={{ height: 5, background: T.border1, borderRadius: 2, marginBottom: 10 }}>
          <div style={{ height: "100%", background: tc || T.red, borderRadius: 2, width: (currentPage / totalPages * 100) + "%", transition: "width 0.4s ease" }} />
        </div>
      )}

      {showLive && (
        <div style={{ maxHeight: 320, overflowY: "auto", background: T.cardBg, borderRadius: 10, border: "1px solid " + T.border1, padding: "4px 0" }}>
          {(() => {
            const grouped = {};
            liveObjectives.forEach(o => {
              const key = o.activity || "Unknown";
              if (!grouped[key]) grouped[key] = { activity: key, discipline: o.discipline, lectureTitle: o.lectureTitle, objectives: [] };
              grouped[key].objectives.push(o);
            });
            return Object.values(grouped).map(group => (
              <div key={group.activity}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", position: "sticky", top: 0, background: T.cardBg, borderBottom: "1px solid " + (T.border2 || T.border1), zIndex: 1 }}>
                  <span style={{ fontFamily: MONO, color: tc || T.red, fontSize: 12, fontWeight: 700, minWidth: 44 }}>{group.activity}</span>
                  <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, background: (T.pillBg || T.inputBg), padding: "1px 6px", borderRadius: 3 }}>{group.discipline}</span>
                  <span style={{ fontFamily: MONO, color: T.text2, fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.lectureTitle}</span>
                  <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>{group.objectives.length} obj</span>
                </div>
                {group.objectives.map((obj, i) => (
                  <div key={obj.id || i} style={{ padding: "5px 12px 5px 20px", borderBottom: "1px solid " + (T.border2 || T.border1) + "40", display: "flex", alignItems: "flex-start", gap: 8, animation: "rxtFadeIn 0.25s ease" }}>
                    <span style={{ color: T.green || "#10b981", fontSize: 12, flexShrink: 0, paddingTop: 1 }}>○</span>
                    <span style={{ fontFamily: MONO, color: T.text2, fontSize: 12, lineHeight: 1.5, flex: 1 }}>{obj.objective}</span>
                    {obj.code && (
                      <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, flexShrink: 0, paddingTop: 2, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{obj.code}</span>
                    )}
                  </div>
                ))}
              </div>
            ));
          })()}
          {importing && (
            <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid " + T.border1, borderTopColor: tc || T.red, animation: "rxtSpin 0.7s linear infinite", flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 12 }}>{msg}</span>
            </div>
          )}
          <div ref={liveEndRef} />
        </div>
      )}

      <style>{`
        @keyframes rxtFadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes rxtBounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
        @keyframes rxtSpin { to { transform:rotate(360deg); } }
      `}</style>
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
  const [aiProvider, setAiProvider] = useState(DEFAULT_PROVIDER);

  const [view,    setView]    = useState("block");
  const [termId,  setTermId]  = useState("term1");
  const [blockId, setBlockId] = useState(() => {
    try {
      const saved = localStorage.getItem("rxt-current-block");
      if (saved) return saved;
      const allBlocks = DEFAULT_TERMS.flatMap((t) => t.blocks || []);
      if (!allBlocks.length) return null;
      const inProgress = allBlocks.find((b) => b.status === "inprogress" || b.status === "active");
      if (inProgress) return inProgress.id;
      const notDone = allBlocks.find((b) => b.status !== "completed" && b.status !== "done" && b.status !== "complete");
      if (notDone) return notDone.id;
      return allBlocks[allBlocks.length - 1]?.id || allBlocks[0]?.id;
    } catch {
      return null;
    }
  });
  const activeTerm  = terms.find(t => t.id === termId);
  const activeBlock = activeTerm?.blocks.find(b => b.id === blockId);
  const [tab,     setTab]     = useState("lectures");
  const [studyCfg, setStudyCfg] = useState(null);
  const [ankiLogTarget, setAnkiLogTarget] = useState(null);
  const [trackerKey, setTrackerKey] = useState(0);
  const [performanceHistory, setPerformanceHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-performance") || "{}");
    } catch {
      return {};
    }
  });
  const [trackerRows, setTrackerRowsState] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("rxt-tracker-v2") || "[]");
      return deduplicateTrackerRows(raw);
    } catch {
      return [];
    }
  });
  const setTrackerRows = useCallback((updaterOrValue) => {
    setTrackerRowsState((prev) => {
      const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
      try {
        localStorage.setItem("rxt-tracker-v2", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  const sessionSaveInProgress = useRef(false);
  const [examDates, setExamDates] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-exam-dates") || "{}");
    } catch {
      return {};
    }
  });
  const saveExamDate = (blockId, date) => {
    setExamDates((prev) => {
      const updated = { ...prev, [blockId]: date };
      localStorage.setItem("rxt-exam-dates", JSON.stringify(updated));
      return updated;
    });
  };
  const [perfToast, setPerfToast] = useState(null);
  const [currentSessionMeta, setCurrentSessionMeta] = useState(null);
  const [sessionSummary, setSessionSummary] = useState(null);
  const [pendingConfidence, setPendingConfidence] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg]         = useState("");
  const [aLoading, setALoading]   = useState(false);
  const [sidebar, setSidebar]     = useState(true);
  const [drag, setDrag]           = useState(false);

  const [newTermName,  setNewTermName]  = useState("");
  const [newBlockName, setNewBlockName] = useState("");
  const [showNewTerm,  setShowNewTerm]  = useState(false);
  const [showNewBlk,   setShowNewBlk]  = useState(null);

  const [lecView, setLecView] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("rxt-lec-view") || "list") : "list"
  );
  const toggleLecView = (v) => {
    setLecView(v);
    if (typeof window !== "undefined") localStorage.setItem("rxt-lec-view", v);
  };
  const [expandedLec, setExpandedLec] = useState(null);

  const [lecSort, setLecSort] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("rxt-lec-sort") || "number") : "number"
  );

  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState([]);
  const [mergeConfig, setMergeConfig] = useState({ open: false, lectures: [] });

  const [stylePrefs, setStylePrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-style-prefs") || "{}");
    } catch {
      return {};
    }
  });
  const updateStylePref = (key, val) => {
    setStylePrefs((prev) => {
      const updated = { ...prev, [key]: val };
      try {
        localStorage.setItem("rxt-style-prefs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const [blockObjectives, setBlockObjectives] = useState(() => {
    try {
      const raw = localStorage.getItem("rxt-block-objectives") || "{}";
      const stored = JSON.parse(raw);
      console.log("Loading objectives from localStorage:", Object.keys(stored || {}).map((k) => ({ blockId: k, imported: (stored[k]?.imported || []).length, extracted: (stored[k]?.extracted || []).length })));

      const allBlocks = DEFAULT_TERMS.flatMap((t) => t.blocks || []);
      const ftm2Block = findBlockForObjectives(allBlocks, "FTM 2");
      const ftm2Id = ftm2Block?.id || "ftm2_default";

      console.log("FTM2 block found:", ftm2Id, ftm2Block?.name);
      console.log("FTM2 objectives in JSON:", FTM2_DATA?.objectives?.length);
      console.log("Already stored:", stored[ftm2Id]?.imported?.length || 0);

      const storedCount = stored[ftm2Id]?.imported?.length || 0;
      const isFTMBlock = ftm2Block && /ftm/i.test(ftm2Block.name || "");
      if (storedCount < 300 && FTM2_DATA?.objectives?.length > 0 && isFTMBlock) {
        console.log("Seeding FTM2 objectives:", FTM2_DATA.objectives.length);
        stored[ftm2Id] = {
          imported: FTM2_DATA.objectives,
          extracted: stored[ftm2Id]?.extracted || [],
        };
        localStorage.setItem("rxt-block-objectives", JSON.stringify(stored));
      }

      return stored;
    } catch (e) {
      console.error("blockObjectives init error:", e);
      return {};
    }
  });

  const [reviewedLectures, setReviewedLectures] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-reviewed-lecs") || "{}");
    } catch {
      return {};
    }
  });

  const [activeSessions, setActiveSessions] = useState({});

  useEffect(() => {
    try {
      localStorage.setItem("rxt-reviewed-lecs", JSON.stringify(reviewedLectures));
    } catch {}
  }, [reviewedLectures]);

  const getBlockObjectives = (bid) => {
    const data = blockObjectives[bid] || { imported: [], extracted: [] };
    const all = [...(data.imported || []), ...(data.extracted || [])];
    const seen = new Set();
    return all.filter((obj) => {
      const key = (obj.objective || "").slice(0, 60).toLowerCase().replace(/\W/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const handleRealignObjectives = useCallback(
    (blockId) => {
      setBlockObjectives((prev) => {
        const data = prev[blockId] || { imported: [], extracted: [] };
        const objs = data.imported || [];
        const blockLecs = lectures.filter((l) => l.blockId === blockId);
        const aligned = alignObjectivesToLectures(blockId, objs, blockLecs);
        const next = { ...prev, [blockId]: { ...data, imported: aligned } };
        try {
          localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [lectures]
  );

  const repairObjectiveAlignmentRepairedRef = useRef(0);
  const repairObjectiveAlignment = useCallback(
    (blockId) => {
      if (!blockId) return 0;
      const blockLecs = (lectures || []).filter((l) => l.blockId === blockId);
      if (!blockLecs.length) return 0;
      let repaired = 0;
      const data = (blockObjectives || {})[blockId] || { imported: [], extracted: [] };
      let imported = Array.isArray(data.imported) ? data.imported : [];
      let extracted = Array.isArray(data.extracted) ? data.extracted : [];

      // One-time migration: objectives with legacy timestamp-style linkedLecId (extracted_...) don't match any lecture
      const hasLegacyIds = [...imported, ...extracted].some((o) => o?.linkedLecId?.startsWith?.("extracted_"));
      if (hasLegacyIds) {
        const migrateLegacy = (obj) => {
          if (!obj?.linkedLecId?.startsWith("extracted_")) return obj;
          const match = blockLecs.find(
            (l) =>
              String(l.lectureType || "LEC") === String(obj.lectureType || "LEC") &&
              String(l.lectureNumber) === String(obj.lectureNumber)
          );
          if (match) {
            repaired++;
            console.log(`Migrating objective from ${obj.linkedLecId} → ${match.id}`);
            return { ...obj, linkedLecId: match.id, sourceFile: match.id };
          }
          return obj;
        };
        imported = imported.map(migrateLegacy);
        extracted = extracted.map(migrateLegacy);
      }

      const reStamp = (obj) => {
        if (!obj || typeof obj !== "object") return obj;
        if (obj.linkedLecId && obj.sourceFile) return obj;
        const match = blockLecs.find(
          (l) =>
            String(l.lectureType || "LEC") === String(obj.lectureType || "LEC") &&
            String(l.lectureNumber) === String(obj.lectureNumber)
        );
        if (match) {
          repaired++;
          return { ...obj, linkedLecId: match.id, sourceFile: match.id };
        }
        return obj;
      };
      const repairOne = (obj) => {
        if (!obj || typeof obj !== "object") return obj;
        if (obj.linkedLecId && blockLecs.find((l) => l.id === obj.linkedLecId)) return obj;
        if (obj.sourceFile) {
          const matchedLec = blockLecs.find((l) => l.id === obj.sourceFile);
          if (matchedLec) {
            repaired++;
            return { ...obj, linkedLecId: matchedLec.id, lectureType: matchedLec.lectureType, lectureNumber: matchedLec.lectureNumber };
          }
        }
        const activity = String(obj.activity || obj.activityRaw || "").trim();
        const numMatch = activity.match(/(\d+)/);
        if (!numMatch) return obj;
        const actNum = parseInt(numMatch[1], 10);
        const actLower = activity.toLowerCase();
        const typeHint = actLower.includes("dla") ? "DLA" : actLower.includes("sg") ? "SG" : actLower.includes("tbl") ? "TBL" : "LEC";
        const matchedLec = blockLecs.find(
          (l) =>
            parseInt(l.lectureNumber, 10) === actNum &&
            (l.lectureType || "LEC").toUpperCase().replace("SGS", "SG") === typeHint
        );
        if (matchedLec) {
          repaired++;
          return { ...obj, linkedLecId: matchedLec.id, lectureType: matchedLec.lectureType, lectureNumber: actNum };
        }
        return obj;
      };
      const updatedImported = imported.map(reStamp).map(repairOne);
      const updatedExtracted = extracted.map(reStamp).map(repairOne);
      if (repaired > 0) {
        repairObjectiveAlignmentRepairedRef.current = repaired;
        const next = { ...(blockObjectives || {}), [blockId]: { ...data, imported: updatedImported, extracted: updatedExtracted } };
        try {
          localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
        } catch (e) {
          console.error(e);
        }
        setBlockObjectives(next);
      }
      return repaired;
    },
    [lectures, blockObjectives]
  );

  useEffect(() => {
    const bid = activeBlock?.id ?? blockId;
    if (bid) repairObjectiveAlignment(bid);
  }, [activeBlock?.id, blockId, lectures.length, repairObjectiveAlignment]);

  const bidForObjectives = activeBlock?.id ?? blockId;
  const repairedBlockObjs = useMemo(() => {
    if (!bidForObjectives) return [];
    const data = blockObjectives[bidForObjectives] || { imported: [], extracted: [] };
    const allObjs = [...(data.imported || []), ...(data.extracted || [])];
    const blockLecs = lectures.filter((l) => l.blockId === bidForObjectives);
    if (!blockLecs.length) return allObjs;
    const reStamp = (obj) => {
      if (!obj || typeof obj !== "object") return obj;
      if (obj.linkedLecId && obj.sourceFile) return obj;
      const match = blockLecs.find(
        (l) =>
          String(l.lectureType || "LEC") === String(obj.lectureType || "LEC") &&
          String(l.lectureNumber) === String(obj.lectureNumber)
      );
      return match ? { ...obj, linkedLecId: match.id, sourceFile: match.id } : obj;
    };
    const repairOne = (obj) => {
      if (!obj || typeof obj !== "object") return obj;
      if (obj.linkedLecId && blockLecs.find((l) => l.id === obj.linkedLecId)) return obj;
      if (obj.sourceFile) {
        const matchedLec = blockLecs.find((l) => l.id === obj.sourceFile);
        if (matchedLec) return { ...obj, linkedLecId: matchedLec.id, lectureType: matchedLec.lectureType, lectureNumber: matchedLec.lectureNumber };
      }
      const activity = String(obj.activity || obj.activityRaw || "").trim();
      const numMatch = activity.match(/(\d+)/);
      if (!numMatch) return obj;
      const actNum = parseInt(numMatch[1], 10);
      const actLower = activity.toLowerCase();
      const typeHint = actLower.includes("dla") ? "DLA" : actLower.includes("sg") ? "SG" : actLower.includes("tbl") ? "TBL" : "LEC";
      const matchedLec = blockLecs.find(
        (l) =>
          parseInt(l.lectureNumber, 10) === actNum &&
          (l.lectureType || "LEC").toUpperCase().replace("SGS", "SG") === typeHint
      );
      return matchedLec ? { ...obj, linkedLecId: matchedLec.id, lectureType: matchedLec.lectureType, lectureNumber: actNum } : obj;
    };
    const repairedImported = (data.imported || []).map(reStamp).map(repairOne);
    const repairedExtracted = (data.extracted || []).map(reStamp).map(repairOne);
    return [...repairedImported, ...repairedExtracted];
  }, [blockObjectives, bidForObjectives, lectures]);

  useEffect(() => {
    if (!bidForObjectives || !setBlockObjectives) return;
    const data = blockObjectives[bidForObjectives] || { imported: [], extracted: [] };
    const allObjs = [...(data.imported || []), ...(data.extracted || [])];
    const blockLecs = lectures.filter((l) => l.blockId === bidForObjectives);
    if (!blockLecs.length) return;
    const lecIds = new Set(blockLecs.map((l) => l.id));
    const needsLink = (o) =>
      !o?.linkedLecId ||
      !lecIds.has(o.linkedLecId) ||
      ((o.activity || "").trim() === "Unknown" && !lecIds.has(o.linkedLecId));
    const anyUnstamped = allObjs.some(needsLink);
    if (!anyUnstamped) return;
    const findLecForObj = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      const byTypeNum = blockLecs.find(
        (l) =>
          String(l.lectureType || "LEC") === String(obj?.lectureType || "LEC") &&
          String(l.lectureNumber) === String(obj?.lectureNumber)
      );
      if (byTypeNum) return byTypeNum;
      const objTitle = (obj.lectureTitle || "").trim().toLowerCase().slice(0, 40);
      if (objTitle.length < 5) return null;
      const titleMatches = blockLecs.filter(
        (l) => (l.lectureTitle || l.fileName || "").toLowerCase().includes(objTitle) || objTitle.includes((l.lectureTitle || l.fileName || "").toLowerCase().slice(0, 40))
      );
      if (titleMatches.length === 0) return null;
      if (titleMatches.length === 1) return titleMatches[0];
      const objTitleUpper = (obj.lectureTitle || "").toUpperCase();
      const prefer = titleMatches.find((l) => {
        const type = (l.lectureType || "LEC").toUpperCase().replace(/^LECTURE$|^LECT/i, "LEC");
        const num = String(l.lectureNumber ?? "");
        const needle = num ? type + " " + num : type;
        if (objTitleUpper.includes(needle) || objTitleUpper.includes(type + num)) return true;
        if ((obj.lectureType || "").toUpperCase() === type) return true;
        if ((obj.activity || "").toUpperCase().replace(/\s/g, "").includes(type + num)) return true;
        return false;
      });
      return prefer || titleMatches.find((l) => (l.lectureType || "").toUpperCase().includes("DLA")) || titleMatches[0];
    };
    const repairOne = (obj) => {
      if (obj?.linkedLecId && lecIds.has(obj.linkedLecId) && (obj.activity || "").trim() !== "Unknown") return obj;
      const match = findLecForObj(obj);
      return match ? { ...obj, linkedLecId: match.id, sourceFile: match.id } : obj;
    };
    const repairedImported = (data.imported || []).map(repairOne);
    const repairedExtracted = (data.extracted || []).map(repairOne);
    const changed =
      repairedImported.some((o, i) => o.linkedLecId !== (data.imported || [])[i]?.linkedLecId) ||
      repairedExtracted.some((o, i) => o.linkedLecId !== (data.extracted || [])[i]?.linkedLecId);
    if (!changed) return;
    setBlockObjectives((prev) => ({
      ...prev,
      [bidForObjectives]: { ...data, imported: repairedImported, extracted: repairedExtracted },
    }));
  }, [bidForObjectives, blockObjectives, lectures, setBlockObjectives]);

  // When in Deep Learn view, also run link-by-title for the Deep Learn block so that block gets repaired even if it's not the active block
  useEffect(() => {
    const dlBid = view === "deeplearn" && studyCfg?.blockId ? studyCfg.blockId : null;
    if (!dlBid || !setBlockObjectives || !blockObjectives) return;
    const data = blockObjectives[dlBid] || { imported: [], extracted: [] };
    const allObjs = [...(data.imported || []), ...(data.extracted || [])];
    const blockLecs = (lectures || []).filter((l) => l.blockId === dlBid);
    if (!blockLecs.length) return;
    const lecIds = new Set(blockLecs.map((l) => l.id));
    const needsLink = (o) =>
      !o?.linkedLecId ||
      !lecIds.has(o.linkedLecId) ||
      ((o.activity || "").trim() === "Unknown" && !lecIds.has(o.linkedLecId));
    if (!allObjs.some(needsLink)) return;
    const findLec = (obj) => {
      const byTypeNum = blockLecs.find(
        (l) =>
          String(l.lectureType || "LEC") === String(obj?.lectureType || "LEC") &&
          String(l.lectureNumber) === String(obj?.lectureNumber)
      );
      if (byTypeNum) return byTypeNum;
      const objTitle = (obj.lectureTitle || "").trim().toLowerCase().slice(0, 40);
      if (objTitle.length < 5) return null;
      const titleMatches = blockLecs.filter(
        (l) => (l.lectureTitle || l.fileName || "").toLowerCase().includes(objTitle) || objTitle.includes((l.lectureTitle || l.fileName || "").toLowerCase().slice(0, 40))
      );
      if (titleMatches.length === 0) return null;
      if (titleMatches.length === 1) return titleMatches[0];
      const objTitleUpper = (obj.lectureTitle || "").toUpperCase();
      const prefer = titleMatches.find((l) => {
        const type = (l.lectureType || "LEC").toUpperCase().replace(/^LECTURE$|^LECT/i, "LEC");
        const num = String(l.lectureNumber ?? "");
        const needle = num ? type + " " + num : type;
        if (objTitleUpper.includes(needle) || objTitleUpper.includes(type + num)) return true;
        if ((obj.lectureType || "").toUpperCase() === type) return true;
        if ((obj.activity || "").toUpperCase().replace(/\s/g, "").includes(type + num)) return true;
        return false;
      });
      return prefer || titleMatches.find((l) => (l.lectureType || "").toUpperCase().includes("DLA")) || titleMatches[0];
    };
    const repairOne = (obj) => {
      if (obj?.linkedLecId && lecIds.has(obj.linkedLecId) && (obj.activity || "").trim() !== "Unknown") return obj;
      const match = findLec(obj);
      return match ? { ...obj, linkedLecId: match.id, sourceFile: match.id } : obj;
    };
    const repairedImported = (data.imported || []).map(repairOne);
    const repairedExtracted = (data.extracted || []).map(repairOne);
    const changed =
      repairedImported.some((o, i) => o.linkedLecId !== (data.imported || [])[i]?.linkedLecId) ||
      repairedExtracted.some((o, i) => o.linkedLecId !== (data.extracted || [])[i]?.linkedLecId);
    if (!changed) return;
    setBlockObjectives((prev) => ({
      ...prev,
      [dlBid]: { ...data, imported: repairedImported, extracted: repairedExtracted },
    }));
  }, [view, studyCfg?.blockId, blockObjectives, lectures, setBlockObjectives]);

  // Repair objectives with activity "Unknown" that are linked to a lecture — set activity from lecture (e.g. "DLA 2")
  const repairUnknownActivityRef = useRef(false);
  useEffect(() => {
    if (repairUnknownActivityRef.current || !setBlockObjectives || !blockObjectives) return;
    const bids = Object.keys(blockObjectives);
    let anyChange = false;
    const next = { ...blockObjectives };
    bids.forEach((bid) => {
      const data = next[bid];
      if (!data) return;
      const blockLecs = (lectures || []).filter((l) => l.blockId === bid);
      let blockChanged = false;
      const fixActivity = (obj) => {
        if (!obj || typeof obj !== "object") return obj;
        const act = (obj.activity || "").trim();
        if (act && act !== "Unknown") return obj;
        if (!obj.linkedLecId) return obj;
        const lec = blockLecs.find((l) => l.id === obj.linkedLecId);
        if (!lec) return obj;
        const newActivity = `${lec.lectureType || "LEC"} ${lec.lectureNumber ?? ""}`.trim();
        if (!newActivity) return obj;
        blockChanged = true;
        return { ...obj, activity: newActivity };
      };
      const imported = (data.imported || []).map(fixActivity);
      const extracted = (data.extracted || []).map(fixActivity);
      if (blockChanged) {
        anyChange = true;
        next[bid] = { ...data, imported, extracted };
      }
    });
    if (anyChange) {
      repairUnknownActivityRef.current = true;
      setBlockObjectives(next);
      try {
        localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
      } catch {}
    }
  }, [blockObjectives, lectures, setBlockObjectives]);

  // One-time repair for existing orphaned objectives (match by lectureType + lectureNumber only)
  const repairAllBlocksOnMountRef = useRef(false);
  useEffect(() => {
    if (repairAllBlocksOnMountRef.current) return;
    const bids = Object.keys(blockObjectives || {});
    if (bids.length > 0 && (lectures || []).length > 0) {
      repairAllBlocksOnMountRef.current = true;
      bids.forEach((bid) => repairObjectiveAlignment(bid));
    }
  }, [blockObjectives, lectures, repairObjectiveAlignment]);

  useEffect(() => {
    const bid = activeBlock?.id ?? blockId;
    if (!bid) return;
    const objs = getBlockObjectives(bid) || [];
    const unlinked = objs.filter(
      (o) => !o.linkedLecId || !lectures.find((l) => l.id === o.linkedLecId)
    );
    if (unlinked.length > 0) {
      console.log(`${unlinked.length} unlinked objectives — running repair`);
      const t = setTimeout(() => repairObjectiveAlignment(bid), 100);
      return () => clearTimeout(t);
    }
  }, [activeBlock?.id, blockId, lectures.length, blockObjectives, getBlockObjectives, repairObjectiveAlignment]);

  // One-time migration: unlink obviously misassigned objectives (e.g. shoulder/axilla linked to neural lecture)
  useEffect(() => {
    const bid = activeBlock?.id ?? blockId;
    if (!bid || !lectures.length) return;
    const data = blockObjectives[bid];
    if (!data) return;
    const imported = data.imported || [];
    const extracted = data.extracted || [];
    if (!imported.length && !extracted.length) return;
    const SHOULDER_KEYWORDS = /axilla|shoulder|cervicoaxillary|axillary|subclavian|scapula|brachial plexus|rotator cuff|glenohumeral/i;
    const NEURAL_KEYWORDS = /neural tube|spinal cord|vertebra|neuroectoderm|neural plate|neural crest|somite|notochord|meninges|neurulation/i;
    let fixed = 0;
    const clean = (obj) => {
      if (!obj?.linkedLecId) return obj;
      const linkedLec = lectures.find((l) => l.id === obj.linkedLecId);
      if (!linkedLec) return obj;
      const lecTitle = (linkedLec.lectureTitle || linkedLec.fileName || linkedLec.filename || "").toLowerCase();
      const objText = (obj.objective || "").toLowerCase();
      if (SHOULDER_KEYWORDS.test(objText) && NEURAL_KEYWORDS.test(lecTitle)) {
        fixed++;
        console.log(`🔧 Removing misassigned obj from ${linkedLec.lectureTitle}:`, obj.objective?.slice(0, 50));
        return { ...obj, linkedLecId: null };
      }
      if (NEURAL_KEYWORDS.test(objText) && SHOULDER_KEYWORDS.test(lecTitle)) {
        fixed++;
        return { ...obj, linkedLecId: null };
      }
      return obj;
    };
    const cleanedImported = imported.map(clean);
    const cleanedExtracted = extracted.map(clean);
    if (fixed > 0) {
      console.log(`🔧 Removed ${fixed} misassigned objectives`);
      setBlockObjectives((prev) => {
        const next = { ...prev, [bid]: { ...data, imported: cleanedImported, extracted: cleanedExtracted } };
        try {
          localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }, [activeBlock?.id, blockId, lectures.length, blockObjectives]);

  useEffect(() => {
    const bid = activeBlock?.id ?? blockId;
    if (!bid) return;
    try {
      const blockObjs = getBlockObjectives(bid) || [];
      const blockLecs = (lectures || []).filter((l) => l.blockId === bid);
      const lec = blockLecs.find(
        (l) =>
          (String(l.lectureType || "").toUpperCase().includes("DLA") || (l.lectureType || "").toUpperCase() === "DLA") &&
          String(l.lectureNumber) === "4"
      );
      const dla4ObjsByActivity = blockObjs.filter(
        (o) =>
          (o.activity || "").toLowerCase().includes("dla") &&
          (o.activity || "").includes("4")
      );
      const dla4ObjsByLec = lec ? blockObjs.filter((o) => o.linkedLecId === lec.id) : [];
      console.log("DLA 4 objectives found:", dla4ObjsByActivity.length, "(by activity)", dla4ObjsByLec.length, "(by linkedLecId)");
      console.log("DLA 4 lec.id:", lec?.id);
      console.log("All block objectives count:", blockObjs.length);
      console.log("Sample linkedLecIds:", blockObjs.slice(0, 5).map((o) => o.linkedLecId));
      console.log("Sample sourceFiles:", blockObjs.slice(0, 5).map((o) => o.sourceFile));
      const sampleActivities = [...new Set(blockObjs.map((o) => o.activity))].slice(0, 10);
      console.log("Sample activities:", sampleActivities);
      const unknownObjs = blockObjs.filter((o) => (o.activity || "").trim() === "Unknown" || !(o.activity || "").trim());
      if (unknownObjs.length > 0) {
        console.log(
          "Objectives with activity 'Unknown' (which file/lecture):",
          unknownObjs.slice(0, 5).map((o) => ({
            lectureTitle: o.lectureTitle,
            sourceFile: o.sourceFile,
            linkedLecId: o.linkedLecId,
            objectivePreview: (o.objective || o.text || "").slice(0, 50) + "...",
          }))
        );
        console.log("Total objectives with Unknown activity:", unknownObjs.length);
      }
    } catch (e) {
      console.warn("Objective alignment debug log failed:", e);
    }
  }, [activeBlock?.id, blockId, lectures, getBlockObjectives]);

  useEffect(() => {
    setBlockObjectives((prev) => {
      let changed = false;
      const updated = { ...prev };
      const blockLecsByBid = {};
      lectures.forEach((l) => {
        const bid = l.blockId;
        if (!blockLecsByBid[bid]) blockLecsByBid[bid] = [];
        blockLecsByBid[bid].push(l);
      });
      Object.keys(updated).forEach((blockId) => {
        const data = updated[blockId];
        if (!data) return;
        const lecsInBlock = blockLecsByBid[blockId] || [];
        const enrich = (obj) => {
          if (obj.bloom_level) return obj;
          changed = true;
          const lec = lecsInBlock.find(
            (l) => l.id === obj.linkedLecId || String(l.lectureNumber) === String(obj.lectureNumber)
          );
          return enrichObjectiveWithBloom(obj, lec?.lectureType || "LEC");
        };
        const imported = (data.imported || []).map(enrich);
        const extracted = (data.extracted || []).map(enrich);
        updated[blockId] = { ...data, imported, extracted };
      });
      if (changed) {
        try {
          localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
        } catch {}
      }
      return changed ? updated : prev;
    });
  }, [lectures.length]);

  useEffect(() => {
    const allLecIds = new Set(lectures.map((l) => l.id));
    Object.entries(performanceHistory || {}).forEach(([key, entry]) => {
      const lecId = key.split("__")[0];
      if (lecId !== "block" && !allLecIds.has(lecId)) {
        console.warn(`🔴 Orphaned performance key: ${key} — lecture ${lecId} no longer exists`);
      }
    });
  }, [lectures.length]);

  const makeTopicKey = (lectureId, blockId) =>
    lectureId ? `${lectureId}__${blockId}` : `block__${blockId}`;

  const makeSubtopicKey = (lecId, subtopicIndex, blockId) =>
    `${lecId}__sub${subtopicIndex}__${blockId}`;

  const hasOrphanedPerf = useMemo(() => {
    const bid = activeBlock?.id ?? blockId;
    const blockLecs = (lectures || []).filter((l) => l.blockId === bid);
    const lecIds = new Set(blockLecs.map((l) => l.id));
    return Object.keys(performanceHistory || {}).some((key) => {
      const parts = key.split("__");
      if (parts.length !== 2) return false; // only lecture-level keys are lecId__blockId
      const [lecId, keyBlockId] = parts;
      return keyBlockId === bid && lecId !== "block" && !lecIds.has(lecId);
    });
  }, [performanceHistory, lectures, activeBlock?.id, blockId]);

  const [showManualResync, setShowManualResync] = useState(false);
  const [orphanedSessionsForManual, setOrphanedSessionsForManual] = useState([]);

  const resyncOrphanedPerformance = useCallback(() => {
    const bid = activeBlock?.id ?? blockId;
    if (!bid) return;
    const allPerf = JSON.parse(localStorage.getItem("rxt-performance") || "{}");
    const blockLecs = (lectures || []).filter((l) => l.blockId === bid);
    const lecIds = new Set(blockLecs.map((l) => l.id));

    const orphanedKeys = Object.keys(allPerf).filter((key) => {
      const parts = key.split("__");
      if (parts.length !== 2) return false;
      const [lecId, keyBlockId] = parts;
      return keyBlockId === bid && lecId !== "block" && !lecIds.has(lecId);
    });

    console.log("Orphaned keys:", orphanedKeys);
    console.log("Sample orphaned session:", orphanedKeys[0] ? allPerf[orphanedKeys[0]] : "none");
    console.log("Current lec type+numbers:", blockLecs.map((l) => `${l.lectureType}${l.lectureNumber} → ${l.id}`));

    console.log(`Found ${orphanedKeys.length} orphaned performance keys`);
    if (orphanedKeys.length === 0) {
      const allOrphaned = Object.keys(allPerf).filter((key) => {
        const lecId = key.split("__")[0];
        return lecId !== "block" && !lectures.some((l) => l.id === lecId);
      });
      console.log("All orphaned keys across all blocks:", allOrphaned);
    }

    let migrated = 0;
    const updatedPerf = { ...allPerf };
    const unmatched = [];

    orphanedKeys.forEach((oldKey) => {
      const perfData = allPerf[oldKey];
      const sessions = Array.isArray(perfData) ? perfData : (perfData?.sessions != null ? perfData.sessions : [perfData]);
      const sample = sessions[0] ?? perfData ?? {};

      // Try every possible match strategy in order:
      let match = null;

      // Strategy 1: lectureType + lectureNumber stored on session
      if (!match && sample.lectureType != null && sample.lectureNumber != null) {
        match = blockLecs.find(
          (l) =>
            (l.lectureType || "LEC") === (sample.lectureType || "LEC") &&
            String(l.lectureNumber) === String(sample.lectureNumber)
        );
      }

      // Strategy 2: lectureName partial match
      if (!match && sample.lectureName) {
        const nameLower = String(sample.lectureName).toLowerCase();
        match = blockLecs.find((l) => {
          const lecName = (l.lectureTitle || l.filename || l.fileName || "").toLowerCase();
          return lecName.includes(nameLower.slice(0, 15)) || nameLower.includes(lecName.slice(0, 15));
        });
      }

      // Strategy 3: parse lectureType+number from the old lecId string itself
      // e.g. "extracted_1772945556111_DLA4" or similar patterns
      if (!match) {
        const keyStr = oldKey.toUpperCase();
        match = blockLecs.find((l) => {
          const pattern = String((l.lectureType || "LEC") + (l.lectureNumber ?? "")).toUpperCase();
          return pattern.length >= 2 && keyStr.includes(pattern);
        });
      }

      // Strategy 4: match by session count / score fingerprint as last resort
      // (skip — too unreliable)

      if (match) {
        const newKey = `${match.id}__${bid}`;
        if (!updatedPerf[newKey]) {
          updatedPerf[newKey] = perfData;
          delete updatedPerf[oldKey];
          migrated++;
          console.log(`✓ Migrated: ${oldKey} → ${newKey} (${match.lectureTitle || match.filename || match.id})`);
        } else {
          const existing = updatedPerf[newKey];
          const existingSessions = existing?.sessions ?? (existing ? [existing] : []);
          const incomingSessions = Array.isArray(perfData?.sessions) ? perfData.sessions : (perfData ? [perfData] : []);
          const merged = [...existingSessions, ...incomingSessions].sort(
            (a, b) => new Date(a?.date || 0) - new Date(b?.date || 0)
          );
          updatedPerf[newKey] = { ...existing, ...perfData, sessions: merged.slice(-50) };
          delete updatedPerf[oldKey];
          migrated++;
          console.log(`✓ Merged: ${oldKey} → ${newKey}`);
        }
      } else {
        unmatched.push({ oldKey, sample });
        console.warn(`✗ Could not match orphaned key: ${oldKey}`, sample);
      }
    });

    if (migrated > 0) {
      try {
        localStorage.setItem("rxt-performance", JSON.stringify(updatedPerf));
      } catch (e) {
        console.warn("Failed to persist resynced performance", e);
      }
      setPerformanceHistory(updatedPerf);
      setShowManualResync(false);
      setOrphanedSessionsForManual([]);
      alert(`✓ Resynced ${migrated} lecture sessions.`);
    } else {
      if (unmatched.length > 0) {
        setOrphanedSessionsForManual(unmatched);
        setShowManualResync(true);
      }
      console.log("Orphaned keys found:", orphanedKeys.length);
      console.log("Full perf keys:", Object.keys(allPerf));
      alert(
        orphanedKeys.length > 0
          ? "No sessions resynced automatically. Use the manual mapping below to assign each session to a lecture."
          : "No orphaned sessions found to resync."
      );
    }
  }, [activeBlock?.id, blockId, lectures, setPerformanceHistory]);

  const dismissOrphanedSession = useCallback((oldKey) => {
    setPerformanceHistory((prev) => {
      const next = { ...prev };
      delete next[oldKey];
      try {
        localStorage.setItem("rxt-performance", JSON.stringify(next));
      } catch (e) {
        console.warn("Failed to persist dismissal", e);
      }
      return next;
    });
    setOrphanedSessionsForManual((prev) => {
      const next = prev.filter((o) => o.oldKey !== oldKey);
      setShowManualResync(next.length > 0);
      return next;
    });
  }, [setPerformanceHistory]);

  const manuallyMapSession = useCallback(
    (oldKey, newLecId) => {
      if (!newLecId) return;
      const bid = activeBlock?.id ?? blockId;
      const newKey = `${newLecId}__${bid}`;
      setPerformanceHistory((prev) => {
        const next = { ...prev };
        const existing = next[newKey];
        const incoming = next[oldKey];

        if (existing) {
          // Merge sessions if both exist
          const existingSessions = existing?.sessions ?? (existing ? [existing] : []);
          const incomingSessions = Array.isArray(incoming?.sessions) ? incoming.sessions : (incoming ? [incoming] : []);
          const merged = [...existingSessions, ...incomingSessions].sort(
            (a, b) => new Date(a?.date || 0) - new Date(b?.date || 0)
          );
          next[newKey] = { ...existing, ...incoming, sessions: merged.slice(-50) };
        } else {
          next[newKey] = incoming;
        }

        delete next[oldKey];
        try {
          localStorage.setItem("rxt-performance", JSON.stringify(next));
        } catch (e) {
          console.warn("Failed to persist manual mapping", e);
        }
        return next;
      });
      setOrphanedSessionsForManual((prev) => {
        const next = prev.filter((o) => o.oldKey !== oldKey);
        setShowManualResync(next.length > 0);
        return next;
      });
    },
    [activeBlock?.id, blockId, setPerformanceHistory]
  );

  useEffect(() => {
    const cleanupVersion = "cleanup_v3";
    if (localStorage.getItem(cleanupVersion)) return;
    if (lectures.length === 0) return;

    console.log("🧹 Running session bleed cleanup...");

    setPerformanceHistory((prev) => {
      const cleaned = {};
      let removed = 0;

      Object.entries(prev || {}).forEach(([key, entry]) => {
        const lecId = key.split("__")[0];

        if (lecId === "block") {
          cleaned[key] = entry;
          return;
        }

        const lecExists = lectures.some((l) => l.id === lecId);
        if (lecExists) {
          const cleanedSessions = (entry.sessions || []).filter(
            (s) => !s.lectureId || s.lectureId === lecId
          );
          cleaned[key] = { ...entry, sessions: cleanedSessions };
        } else {
          removed++;
          console.log(`🗑 Removed orphaned key: ${key}`);
        }
      });

      console.log(`✅ Cleanup done. Removed ${removed} orphaned keys.`);
      try {
        localStorage.setItem("rxt-performance", JSON.stringify(cleaned));
      } catch {}
      return cleaned;
    });

    localStorage.setItem(cleanupVersion, "done");
  }, [lectures.length]);

  const resolveTopicLabel = useCallback(
    (topicKey, sessionRecord, blockId) => {
      const lecs = lectures;
      const blocksArr = (terms || []).flatMap((t) => t.blocks || []);
      const lecId =
        sessionRecord?.lectureId ||
        (typeof topicKey === "string" ? topicKey.split("__")[0] : null);

      if (lecId && lecId !== "block") {
        const lec = lecs.find((l) => l.id === lecId);
        if (lec) {
          const typeLabel = `${lec.lectureType || "LEC"}${lec.lectureNumber ?? ""}`;
          const title = lec.lectureTitle || lec.fileName || "";
          const sessionType = (sessionRecord?.sessionType || "").toLowerCase();
          const typeSuffix =
            sessionType === "anki"
              ? " — Anki"
              : sessionType === "deeplearn"
                ? " — Deep Learn"
                : sessionType === "quiz" || sessionType === "objectivequiz"
                  ? " — Quiz"
                  : sessionType === "blockexam"
                    ? " — Block Exam"
                    : "";
          return `${typeLabel} — ${title}${typeSuffix}`.trim();
        }
      }

      if (
        (typeof topicKey === "string" && topicKey.startsWith("block__")) ||
        lecId === "block"
      ) {
        const block = blocksArr.find(
          (b) => b.id === blockId || (typeof topicKey === "string" && topicKey.includes(b.id))
        );
        const sessionType = (sessionRecord?.sessionType || "").toLowerCase();
        const blockName = block?.name || "Block";
        return sessionType === "blockexam"
          ? `${blockName} — Block Exam`
          : `${blockName} — ${sessionRecord?.topic || "Review"}`;
      }

      if (topicKey) {
        const key = String(topicKey);
        return key
          .replace(/__full__/g, " — Full Lecture")
          .replace(/__weak__/g, " — Weak Areas")
          .replace(/__/g, " — ")
          .replace(/^block /i, "Block Exam: ")
          .trim();
      }

      return (
        sessionRecord?.topic ||
        sessionRecord?.lectureTitle ||
        sessionRecord?.title ||
        "Study Session"
      );
    },
    [lectures, terms]
  );

  const migratePerformanceOnUpload = useCallback(
    (newLec, blockId, currentLectures, setPerf) => {
      if (!newLec?.id || !blockId) return;
      const allPerf = JSON.parse(localStorage.getItem("rxt-performance") || "{}");
      const blockLecsBefore = (currentLectures || []).filter((l) => l.blockId === blockId);
      const newType = newLec.lectureType || "LEC";
      const newNum = String(newLec.lectureNumber ?? "");
      const oldLec = blockLecsBefore.find(
        (l) =>
          (l.lectureType || "LEC") === newType &&
          String(l.lectureNumber ?? "") === newNum &&
          l.id !== newLec.id
      );
      if (!oldLec) return;
      const oldKey = `${oldLec.id}__${blockId}`;
      const newKey = `${newLec.id}__${blockId}`;
      if (allPerf[oldKey] && !allPerf[newKey]) {
        console.log(`Migrating performance: ${oldKey} → ${newKey}`);
        allPerf[newKey] = allPerf[oldKey];
        delete allPerf[oldKey];
        try {
          localStorage.setItem("rxt-performance", JSON.stringify(allPerf));
        } catch (e) {
          console.warn("Failed to persist performance migration", e);
        }
        setPerf((prev) => {
          const updated = { ...prev };
          updated[newKey] = prev[oldKey];
          delete updated[oldKey];
          return updated;
        });
      }
    },
    []
  );

  const syncTrackerRow = useCallback(
    (lectureId, blockId, sessionRecord) => {
      if (!lectureId) {
        console.warn("syncTrackerRow called without lectureId — skipping");
        return;
      }
      const lec = lectures.find((l) => l.id === lectureId);
      if (!lec) {
        console.warn("syncTrackerRow: no lecture found for id", lectureId);
        return;
      }
      const blockName = (terms || []).flatMap((t) => t.blocks || []).find((b) => b.id === blockId)?.name || "";
      const topicKey = sessionRecord?.topicKey ?? makeTopicKey(lectureId, blockId);
      const topicLabel =
        sessionRecord.sessionType === "reviewed"
          ? "◑ Reviewed"
          : (lec.lectureTitle || lec.fileName || "").trim() || resolveTopicLabel(topicKey, sessionRecord, blockId);

      setTrackerRows((prev) => {
        const existingIdx = prev.findIndex((r) => r.lectureId === lectureId);

        const confidenceNum =
          sessionRecord.confidenceLevel === "High"
            ? 5
            : sessionRecord.confidenceLevel === "Medium"
              ? 3
              : sessionRecord.confidenceLevel === "Low"
                ? 1
                : null;

        const preRead = sessionRecord.sessionType === "anki";
        const lecture = sessionRecord.sessionType === "deepLearn" || sessionRecord.sessionType === "reviewed";
        const postReview =
          sessionRecord.sessionType === "quiz" || sessionRecord.sessionType === "objectiveQuiz";
        const anki = sessionRecord.sessionType === "blockExam";

        const dateStr = sessionRecord.date?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const sessionType = sessionRecord.sessionType || null;

        const updatedRow =
          existingIdx >= 0
            ? {
                ...prev[existingIdx],
                topic: topicLabel,
                lastStudied: dateStr,
                reps: (prev[existingIdx].reps || 0) + 1,
                scores: [...(prev[existingIdx].scores || []), sessionRecord.score].filter((s) => s != null),
                confidence: confidenceNum ?? prev[existingIdx].confidence,
                ankiDate:
                  sessionRecord.sessionType === "anki" ? dateStr : prev[existingIdx].ankiDate,
                preRead: prev[existingIdx].preRead || preRead,
                lecture: prev[existingIdx].lecture || lecture,
                postReview: prev[existingIdx].postReview || postReview,
                anki: prev[existingIdx].anki || anki,
                sessionType: sessionType ?? prev[existingIdx].sessionType,
              }
            : {
                id: `auto_${lectureId}_${Date.now()}`,
                lectureId,
                blockId,
                block: blockName,
                subject: lec.subject || lec.discipline || "",
                topic: topicLabel,
                lectureDate: "",
                lastStudied: dateStr,
                ankiDate: sessionRecord.sessionType === "anki" ? dateStr : "",
                preRead,
                lecture,
                postReview,
                anki,
                confidence: confidenceNum,
                scores: sessionRecord.score != null ? [sessionRecord.score] : [],
                notes: "",
                reps: 1,
                autoGenerated: true,
                sessionType,
              };

        const updated =
          existingIdx >= 0 ? prev.map((r, i) => (i === existingIdx ? updatedRow : r)) : [...prev, updatedRow];
        return deduplicateTrackerRows(updated);
      });
    },
    [lectures, terms, setTrackerRows, resolveTopicLabel, makeTopicKey]
  );

  const markLectureReviewed = useCallback(
    (lec, blockId) => {
      if (!lec || !blockId) return;
      const key = `${lec.id}__${blockId}`;
      setReviewedLectures((prev) => ({
        ...prev,
        [key]: { date: new Date().toISOString(), method: "manual" },
      }));
      setBlockObjectives((prev) => {
        const data = prev[blockId] || { imported: [], extracted: [] };
        const linkedToThisLec = (obj) =>
          obj.linkedLecId === lec.id ||
          (Array.isArray(lec.mergedFrom) && lec.mergedFrom.some((m) => m && m.id === obj.linkedLecId));
        const mapUntestedToInProgress = (obj) =>
          linkedToThisLec(obj) && obj.status === "untested"
            ? { ...obj, status: "inprogress" }
            : obj;
        const updatedImported = (data.imported || []).map(mapUntestedToInProgress);
        const updatedExtracted = (data.extracted || []).map(mapUntestedToInProgress);
        const next = { ...prev, [blockId]: { ...data, imported: updatedImported, extracted: updatedExtracted } };
        try {
          localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
        } catch {}
        return next;
      });
      syncTrackerRow(lec.id, blockId, {
        sessionType: "reviewed",
        score: null,
        date: new Date().toISOString(),
        topicKey: makeTopicKey(lec.id, blockId),
        note: "Marked as reviewed (attended / Anki unsuspended)",
      });
    },
    [setReviewedLectures, setBlockObjectives, syncTrackerRow, makeTopicKey]
  );

  const unmarkLectureReviewed = useCallback(
    (lec, blockId) => {
      if (!lec || !blockId) return;
      const key = `${lec.id}__${blockId}`;
      setReviewedLectures((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      const perfKey = makeTopicKey(lec.id, blockId);
      const hasSessions = (performanceHistory[perfKey]?.sessions?.length || 0) > 0;
      if (!hasSessions) {
        setBlockObjectives((prev) => {
          const data = prev[blockId] || { imported: [], extracted: [] };
          const revertInProgressToUntested = (obj) =>
            obj.linkedLecId === lec.id && obj.status === "inprogress"
              ? { ...obj, status: "untested" }
              : obj;
          const updatedImported = (data.imported || []).map(revertInProgressToUntested);
          const updatedExtracted = (data.extracted || []).map(revertInProgressToUntested);
          const next = { ...prev, [blockId]: { ...data, imported: updatedImported, extracted: updatedExtracted } };
          try {
            localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
          } catch {}
          return next;
        });
      }
    },
    [setReviewedLectures, setBlockObjectives, makeTopicKey, performanceHistory]
  );

  const handleDeepLearnStart = async ({ selectedTopics, blockId: bId }) => {
    const bid = bId ?? activeBlock?.id ?? blockId;
    repairObjectiveAlignment(bid);
    await new Promise((r) => setTimeout(r, 300)); // let setState propagate
    const lecId = selectedTopics?.[0]?.lecId;
    const lec = lectures.find((l) => l.id === lecId);
    const freshObjs = (getBlockObjectives(bid) || []).filter(
      (o) =>
        o.linkedLecId === lec?.id || (lec?.mergedFrom || []).includes(o.linkedLecId)
    );
    console.log("Fresh objectives after repair:", freshObjs.length);
    const topicKey = makeTopicKey(lecId, bid);
    if (topicKey) setActiveSessions((prev) => ({ ...prev, [topicKey]: true }));
    setStudyCfg({
      blockId: bid,
      lecs: lectures.filter((l) => l.blockId === bid),
      blockObjectives: getBlockObjectives(bid),
      preselectedLecId: lecId,
    });
    setView("deeplearn");
  };

  const handleAnkiLog = (sessionData) => {
    if (!ankiLogTarget) return;
    const lec = ankiLogTarget;
    const bid = lec.blockId || activeBlock?.id || blockId;
    const isCurrentBlock = bid === activeBlock?.id;
    const firstSessionDate = Object.values(performanceHistory)
      .flatMap((p) => p.sessions || [])
      .filter((s) => s.blockId === bid)
      .map((s) => s.date)
      .filter(Boolean)
      .sort()[0];
    const blockAgeMonths = firstSessionDate
      ? (Date.now() - new Date(firstSessionDate)) / (1000 * 60 * 60 * 24 * 30)
      : 0;
    const nextReview = getReviewInterval(sessionData.confidenceLevel, isCurrentBlock, blockAgeMonths);
    const fakeCount = sessionData.cardCount || 10;
    const correctCount = Math.round((sessionData.score / 100) * fakeCount);
    handleSessionComplete(
      Array(fakeCount).fill(null).map((_, i) => ({
        correct: i < correctCount,
        score: sessionData.score,
        topic: lec.lectureTitle,
        lectureId: lec.id,
        sessionType: "anki",
      })),
      {
        blockId: bid,
        lectureId: lec.id,
        topicKey: makeTopicKey(lec.id, bid),
        sessionType: "anki",
        confidenceLevel: sessionData.confidenceLevel,
        difficulty: "medium",
        targetObjectives: (getBlockObjectives(bid) || []).filter((o) => o.linkedLecId === lec.id),
        nextReview,
        ...sessionData,
      }
    );
    setAnkiLogTarget(null);
  };

  const buildStudySchedule = (blockId) => {
    const examDate = examDates[blockId];
    if (!examDate) return null;

    const exam = new Date(examDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((exam - today) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return null;

    const blockLecs = lectures.filter((l) => l.blockId === blockId);
    const blockObjs = getBlockObjectives(blockId) || [];
    const perf = performanceHistory;

    const lecturePlans = blockLecs.map((lec) => {
      const lecObjs = blockObjs.filter(
        (o) =>
          o.linkedLecId === lec.id ||
          (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
      );
      const struggling = lecObjs.filter((o) => o.status === "struggling").length;
      const untested = lecObjs.filter((o) => o.status === "untested").length;
      const mastered = lecObjs.filter((o) => o.status === "mastered").length;
      const total = lecObjs.length;

      const lecPerfKey = Object.keys(perf).find((k) => k.startsWith(lec.id));
      const lecPerf = lecPerfKey ? perf[lecPerfKey] : null;
      const lastScore = lecPerf?.sessions?.slice(-1)[0]?.score ?? null;
      const sessionsDone = lecPerf?.sessions?.length || 0;
      const confidence = lecPerf?.confidenceLevel || "Low";

      const isStruggling = struggling > 0 || (lastScore !== null && lastScore < 60);
      const requiredReps = isStruggling ? 5 : confidence === "High" ? 3 : 4;
      const repsRemaining = Math.max(0, requiredReps - sessionsDone);

      const baseIntervals = isStruggling
        ? [1, 2, 4, 7, 12]
        : [1, 3, 7, 14, 21];

      const studyMode = detectStudyMode(lec, lecObjs);

      return {
        lec,
        lecObjs,
        struggling,
        untested,
        mastered,
        total,
        lastScore,
        sessionsDone,
        confidence,
        isStruggling,
        requiredReps,
        repsRemaining,
        baseIntervals,
        studyMode,
        priority:
          isStruggling
            ? "critical"
            : untested > total * 0.5
              ? "high"
              : confidence === "Low"
                ? "high"
                : "normal",
      };
    });

    const MAX_PER_DAY = 3;
    const schedule = {};

    const addToDay = (dateObj, item) => {
      const key = dateObj.toISOString().slice(0, 10);
      if (!schedule[key]) schedule[key] = [];
      if (schedule[key].length < MAX_PER_DAY) {
        schedule[key].push(item);
        return true;
      }
      const next = new Date(dateObj);
      next.setDate(next.getDate() + 1);
      if (next < exam) {
        const nextKey = next.toISOString().slice(0, 10);
        if (!schedule[nextKey]) schedule[nextKey] = [];
        if (schedule[nextKey].length < MAX_PER_DAY) {
          schedule[nextKey].push(item);
          return true;
        }
      }
      return false;
    };

    lecturePlans.forEach((plan) => {
      if (plan.repsRemaining <= 0) return;

      let intervals = plan.baseIntervals.slice(0, plan.repsRemaining);

      if (daysLeft < intervals[intervals.length - 1]) {
        const scale = daysLeft / intervals[intervals.length - 1];
        intervals = intervals.map((d, i) =>
          i === 0 ? 1 : Math.max(i + 1, Math.round(d * scale))
        );
      }

      intervals.forEach((dayOffset, repIdx) => {
        const sessionDate = new Date(today);
        sessionDate.setDate(today.getDate() + dayOffset);

        if (sessionDate >= exam) return;

        addToDay(sessionDate, {
          lectureId: plan.lec.id,
          lectureTitle: plan.lec.lectureTitle || plan.lec.fileName,
          lectureType: plan.lec.lectureType || "Lec",
          lectureNum: plan.lec.lectureNumber,
          repNumber: plan.sessionsDone + repIdx + 1,
          totalReps: plan.requiredReps,
          isStruggling: plan.isStruggling,
          priority: plan.priority,
          studyMode: plan.studyMode,
          objectives: plan.lecObjs,
          blockId,
        });
      });
    });

    const sortedDays = Object.entries(schedule).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    return {
      examDate,
      daysLeft,
      totalSessions: Object.values(schedule).flat().length,
      criticalCount: lecturePlans.filter((p) => p.priority === "critical").length,
      lecturePlans,
      schedule: sortedDays,
    };
  };

  const generateDailySchedule = (blockId, examDate) => {
    if (!examDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exam = new Date(examDate);
    exam.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((exam - today) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return { schedule: [], daysLeft: 0, lecScores: [], upcoming: [], undated: [], needsBlockStart: false };

    const blockLecs = lectures.filter((l) => l.blockId === blockId);
    const blockObjs = getBlockObjectives(blockId) || [];
    const blocks = terms.flatMap((t) => t.blocks || []);
    const block = blocks.find((b) => b.id === blockId);
    const blockStart = block?.startDate
      ? (() => {
          const d = new Date(block.startDate);
          d.setHours(0, 0, 0, 0);
          return d;
        })()
      : null;

    const getAvailableDate = (lec) => {
      if (lec.lectureDate) {
        const d = new Date(lec.lectureDate);
        d.setHours(0, 0, 0, 0);
        return { date: d, source: "explicit" };
      }
      if (lec.weekNumber && lec.dayOfWeek && blockStart) {
        const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
        const startDay = blockStart.getDay();
        const toMonday = startDay === 0 ? -6 : 1 - startDay;
        const weekOneMon = new Date(blockStart);
        weekOneMon.setDate(blockStart.getDate() + toMonday);
        const targetDow = DOW[lec.dayOfWeek] ?? 1;
        const derived = new Date(weekOneMon);
        derived.setDate(
          weekOneMon.getDate() +
            (lec.weekNumber - 1) * 7 +
            (targetDow === 0 ? 6 : targetDow - 1)
        );
        derived.setHours(0, 0, 0, 0);
        return { date: derived, source: "derived" };
      }
      if (lec.weekNumber && blockStart) {
        const derived = new Date(blockStart);
        derived.setDate(blockStart.getDate() + (lec.weekNumber - 1) * 7);
        derived.setHours(0, 0, 0, 0);
        return { date: derived, source: "week-only" };
      }
      return { date: null, source: "unknown" };
    };

    const lecScores = blockLecs.map((lec) => {
      const { date: availableDate } = getAvailableDate(lec);

      const isAvailableToday = availableDate && availableDate <= today;
      const isFuture = availableDate && availableDate > today;
      const daysUntilAvailable = availableDate
        ? Math.max(0, Math.ceil((availableDate - today) / (1000 * 60 * 60 * 24)))
        : null;
      const hasNoDate = !availableDate;

      const perf = getLecPerf(lec, blockId);
      const lecObjs = blockObjs.filter(
        (o) =>
          o.linkedLecId === lec.id ||
          (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
      );
      const struggling = lecObjs.filter((o) => o.status === "struggling").length;
      const untested = lecObjs.filter((o) => o.status === "untested").length;
      const mastered = lecObjs.filter((o) => o.status === "mastered").length;
      const total = lecObjs.length;
      const avgBloom =
        total > 0
          ? lecObjs.reduce((s, o) => s + (o.bloom_level ?? 2), 0) / total
          : 2;
      const lastScore = perf?.lastScore ?? null;
      const confidence = perf?.confidenceLevel || "Low";
      const nextReview = perf?.nextReview ? new Date(perf.nextReview) : null;
      const sessions = perf?.sessions?.length || 0;

      let urgency = 0;
      urgency += struggling * 10;
      urgency += untested * 3;
      urgency += avgBloom * 2;
      if (lastScore !== null && lastScore < 60) urgency += 15;
      if (lastScore !== null && lastScore < 80) urgency += 5;
      if (confidence === "Low") urgency += 8;
      if (confidence === "Medium") urgency += 3;
      if (sessions === 0) {
        urgency += reviewedLectures[`${lec.id}__${blockId}`] ? 8 : 12;
      }
      if (nextReview && nextReview <= today) urgency += 20;

      const recommendedSessions = [];
      if (sessions === 0) {
        recommendedSessions.push({
          type: "deepLearn",
          label: "🧠 First Deep Learn",
          reason: "Never studied",
          duration: 45,
        });
        recommendedSessions.push({
          type: "anki",
          label: "📇 Unsuspend Anki Cards",
          reason: "First pass — unsuspend and review",
          duration: 20,
        });
      } else if (struggling > 0) {
        recommendedSessions.push({
          type: "quiz",
          label: "⚠ Quiz Weak Objectives",
          reason: `${struggling} struggling objective${struggling > 1 ? "s" : ""}`,
          duration: 20,
        });
      } else if (nextReview && nextReview <= today) {
        recommendedSessions.push({
          type: "anki",
          label: "📇 Anki Review Due",
          reason: "Spaced rep due today",
          duration: 15,
        });
        if (lastScore < 80) {
          recommendedSessions.push({
            type: "quiz",
            label: "✅ Quiz Full Lecture",
            reason: `Last score ${lastScore}% — needs review`,
            duration: 20,
          });
        }
      } else if (untested > 0 && total > 0) {
        recommendedSessions.push({
          type: "quiz",
          label: "○ Quiz Untested Objectives",
          reason: `${untested} objectives not yet tested`,
          duration: 15,
        });
      }

      return {
        lec,
        urgency,
        struggling,
        untested,
        mastered,
        total,
        avgBloom,
        lastScore,
        confidence,
        nextReview,
        sessions,
        recommendedSessions,
        availableDate,
        isAvailableToday,
        isFuture,
        daysUntilAvailable,
        hasNoDate,
      };
    });

    lecScores.sort((a, b) => b.urgency - a.urgency);

    const schedule = [];
    const MAX_PER_DAY = 6;
    const scheduled = new Set();

    for (let d = 0; d < daysLeft; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      date.setHours(0, 0, 0, 0);
      const dateStr = date.toISOString().slice(0, 10);

      const dayTasks = [];

      for (const ls of lecScores) {
        if (dayTasks.length >= MAX_PER_DAY) break;
        if (scheduled.has(ls.lec.id)) continue;
        if (!ls.availableDate) continue;

        const lecDateStr = ls.availableDate.toISOString().slice(0, 10);
        if (lecDateStr === dateStr) {
          dayTasks.push({ ...ls, dateStr, matchReason: "scheduled-day" });
          scheduled.add(ls.lec.id);
        }
      }

      for (const ls of lecScores) {
        if (dayTasks.length >= MAX_PER_DAY) break;
        if (scheduled.has(ls.lec.id)) continue;
        if (!ls.isAvailableToday && d === 0) continue;
        if (ls.availableDate > date) continue;

        const isOverdue = ls.nextReview && ls.nextReview < today;
        const isDue =
          ls.nextReview &&
          ls.nextReview.toISOString().slice(0, 10) === dateStr;

        if (isOverdue || isDue) {
          dayTasks.push({ ...ls, dateStr, matchReason: "spaced-rep-due" });
          scheduled.add(ls.lec.id);
        }
      }

      for (const ls of lecScores) {
        if (dayTasks.length >= MAX_PER_DAY) break;
        if (scheduled.has(ls.lec.id)) continue;
        if (!ls.availableDate || ls.availableDate > date) continue;
        if (ls.recommendedSessions.length === 0) continue;

        const scheduleOnDay = Math.floor(
          (lecScores.indexOf(ls) / lecScores.length) * daysLeft
        );
        if (scheduleOnDay <= d) {
          dayTasks.push({ ...ls, dateStr, matchReason: "urgency" });
          scheduled.add(ls.lec.id);
        }
      }

      if (dayTasks.length > 0) {
        schedule.push({
          date,
          dateStr,
          daysFromNow: d,
          dayLabel:
            d === 0
              ? "Today"
              : d === 1
                ? "Tomorrow"
                : date.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  }),
          tasks: dayTasks,
        });
      }
    }

    const upcoming = lecScores
      .filter((ls) => ls.lec.lectureDate && ls.isFuture)
      .sort((a, b) => a.availableDate - b.availableDate)
      .slice(0, 8);

    const undated = lecScores
      .filter(
        (ls) =>
          !ls.lec.lectureDate &&
          !ls.lec.weekNumber &&
          !ls.lec.dayOfWeek
      )
      .sort((a, b) => (a.lec.lectureNumber || 0) - (b.lec.lectureNumber || 0));

    const needsBlockStart = lecScores.some(
      (ls) =>
        (ls.lec.weekNumber || ls.lec.dayOfWeek) &&
        !ls.lec.lectureDate &&
        !block?.startDate
    );

    return { schedule, daysLeft, lecScores, upcoming, undated, needsBlockStart };
  };

  const buildQuestionContext = (blockId, lectureId, questionBanksByFileArg, mode = "quiz", options = {}) => {
    const blockLecs = lectures.filter((l) => l.blockId === blockId);
    const blockObjs = getBlockObjectives(blockId) || [];
    const allUploaded = Object.entries(questionBanksByFileArg || {});
    const relevantQs = allUploaded
      .flatMap(([fname, questions]) => (questions || []).map((q) => ({ ...q, sourceFile: fname })))
      .filter((q) => {
        if (!lectureId) return true;
        const lec = lectures.find((l) => l.id === lectureId);
        if (!lec) return true;
        const fname = (q.sourceFile || "").toLowerCase();
        const topic = (q.topic || q.subject || "").toLowerCase();
        const lecTitle = (lec.lectureTitle || "").toLowerCase().slice(0, 20);
        const lecNum = String(lec.lectureNumber || "");
        return fname.includes(lecNum) || topic.includes(lecTitle) || fname.includes(lecTitle.slice(0, 10));
      });

    const selectedLecIds = options.selectedLecIds || (lectureId ? [lectureId] : []);
    let lectureChunks = "";
    let anyMistralOcr = false;
    if (selectedLecIds.length > 0) {
      const lecsUsed = selectedLecIds.map((id) => lectures.find((l) => l.id === id)).filter(Boolean);
      anyMistralOcr = lecsUsed.some((l) => l.extractionMethod === "mistral-ocr");
      lectureChunks = lecsUsed
        .flatMap((lec) => (lec.chunks || []).map((c) => c.text || c.content || ""))
        .join("\n")
        .slice(0, 6000);
    } else if (lectureId) {
      const lec = lectures.find((l) => l.id === lectureId);
      anyMistralOcr = lec?.extractionMethod === "mistral-ocr";
      lectureChunks = (lec?.chunks || []).map((c) => c.text || c.content || "").join("\n").slice(0, 6000);
    }
    const contentNote = anyMistralOcr
      ? "The following lecture content has been extracted with high-fidelity OCR, preserving tables, headings, and document structure as markdown. Use the structure to identify high-yield topics.\n\n"
      : "";
    if (lectureChunks) lectureChunks = contentNote + lectureChunks;

    const lec = lectures.find((l) => l.id === lectureId);
    const objectives = blockObjs.filter(
      (o) =>
        !lectureId ||
        o.linkedLecId === lectureId ||
        (lec && (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId))
    );

    const styleAnalysis =
      relevantQs.length > 0
        ? {
            avgStemLength: Math.round(relevantQs.reduce((a, q) => a + (q.stem || "").length, 0) / relevantQs.length),
            hasClinicalCases: relevantQs.filter((q) => /year.old|presents|patient/i.test(q.stem || "")).length,
            hasCalculations: relevantQs.filter((q) => /calculate|how many|what is the dose/i.test(q.stem || "")).length,
            hasMechanisms: relevantQs.filter((q) => /mechanism|pathway|why|how does/i.test(q.stem || "")).length,
            sourceFiles: [...new Set(relevantQs.map((q) => q.sourceFile))],
            totalQuestions: relevantQs.length,
          }
        : null;

    const context = {
      relevantQs: relevantQs.slice(0, 8),
      lectureChunks,
      objectives: objectives.slice(0, 20),
      styleAnalysis,
      hasLectureContent: lectureChunks.length > 100,
      hasUploadedQs: relevantQs.length > 0,
      hasObjectives: objectives.length > 0,
      stylePrefs,
    };

    console.log("📚 Question context built:", {
      uploadedQsUsed: context.relevantQs.length,
      fromFiles: styleAnalysis?.sourceFiles || [],
      lectureCharsUsed: lectureChunks.length,
      objectivesUsed: objectives.length,
      stylePatterns: styleAnalysis,
    });

    return context;
  };

  const saveBlockObjectives = (bid, patch) => {
    if (!bid) return;
    console.log("saveBlockObjectives:", bid, "imported:", patch.imported?.length);
    setBlockObjectives((prev) => {
      const blockLectures = lectures.filter((l) => l.blockId === bid);
      let importedAligned = patch.imported ?? prev[bid]?.imported ?? [];
      if (importedAligned.length && blockLectures.length) {
        importedAligned = alignObjectivesToLectures(bid, importedAligned, blockLectures);
        const linked = importedAligned.filter((o) => o.hasLecture).length;
        console.log(`Aligned ${linked}/${importedAligned.length} objectives to lectures in block ${bid}`);
      }
      const updated = {
        ...prev,
        [bid]: {
          ...(prev[bid] || {}),
          ...patch,
          imported: importedAligned,
        },
      };
      try {
        localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const updateObjective = (blockId, objId, patch) => {
    setBlockObjectives((prev) => {
      const blockData = prev[blockId] || { imported: [], extracted: [] };
      const updateArr = (arr) => (arr || []).map((o) => (o.id === objId ? { ...o, ...patch } : o));
      const updated = {
        ...prev,
        [blockId]: {
          ...blockData,
          imported: updateArr(blockData.imported),
          extracted: updateArr(blockData.extracted),
        },
      };
      try {
        localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // ONLY update objective statuses for the target lecture — never by lecture number or topic string.
  const syncSessionToObjectives = (sessionResults, blockId, targetObjectives, targetLecId) => {
    const targetLecIdResolved =
      targetLecId ?? targetObjectives?.[0]?.linkedLecId;
    if (!targetLecIdResolved) {
      console.warn("syncSessionToObjectives: no targetLecId — skipping");
      return { updatedCount: 0, masteredCount: 0, strugglingCount: 0, updates: [] };
    }
    if (!blockId || !sessionResults?.length) return { updatedCount: 0, masteredCount: 0, strugglingCount: 0, updates: [] };

    const blockObjs = getBlockObjectives(blockId) || [];
    const updatesRef = { current: [] };
    let updatedCount = 0;
    let masteredCount = 0;
    let strugglingCount = 0;

    sessionResults.forEach((result) => {
      const obj = blockObjs.find(
        (o) =>
          o.linkedLecId === targetLecIdResolved &&
          (result.objectiveCovered || result.topic || "")
            .toLowerCase()
            .includes((o.objective || "").toLowerCase().slice(0, 20))
      );
      if (obj) {
        const newStatus = result.correct ? "mastered" : "struggling";
        updateObjective(blockId, obj.id, {
          status: newStatus,
          lastTested: new Date().toISOString(),
          quizScore: result?.score ?? obj.quizScore,
        });
        updatedCount++;
        if (newStatus === "mastered") masteredCount++;
        if (newStatus === "struggling") strugglingCount++;
        updatesRef.current.push({ id: obj.id, objective: (obj.objective || "").slice(0, 60), newStatus });
      }
    });

    return { updatedCount, masteredCount, strugglingCount, updates: updatesRef.current };
  };

  useEffect(() => {
    if (!FTM2_DATA?.objectives?.length) return;

    const allBlocks = terms.flatMap((t) => t.blocks || []);
    const currentBlock = allBlocks.find((b) => b.id === blockId);
    if (!currentBlock?.id) return;

    const isFTMBlock = /ftm/i.test(currentBlock.name || "");
    if (!isFTMBlock) return;

    setBlockObjectives((prev) => {
      const storedCount = prev[currentBlock.id]?.imported?.length || 0;
      const blockLectures = lectures.filter((l) => l.blockId === currentBlock.id);

      if (storedCount > 0) {
        if (!blockLectures.length) return prev;
        const aligned = alignObjectivesToLectures(
          currentBlock.id,
          prev[currentBlock.id].imported,
          blockLectures
        );
        const linked = aligned.filter((o) => o.hasLecture).length;
        const prevLinked = (prev[currentBlock.id].imported || []).filter((o) => o.hasLecture).length;
        if (linked === prevLinked) return prev;
        console.log(`Re-alignment: ${linked}/${aligned.length} objectives now linked`);
        const updated = {
          ...prev,
          [currentBlock.id]: { ...prev[currentBlock.id], imported: aligned },
        };
        try {
          localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
        } catch {}
        return updated;
      }

      if (!/ftm\s*2/i.test(currentBlock.name || "") && currentBlock.id !== "ftm2") return prev;
      const aligned = blockLectures.length
        ? alignObjectivesToLectures(currentBlock.id, FTM2_DATA.objectives, blockLectures)
        : FTM2_DATA.objectives;
      const linked = aligned.filter((o) => o.hasLecture).length;
      console.log(`Seeding + aligning: ${linked}/${aligned.length} objectives linked to lectures`);
      const updated = {
        ...prev,
        [currentBlock.id]: {
          imported: aligned,
          extracted: prev[currentBlock.id]?.extracted || [],
        },
      };
      if (prev["ftm1"]?.imported?.length > 0 && currentBlock.id !== "ftm1") {
        delete updated["ftm1"];
      }
      try {
        localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, [blockId, terms, lectures.length]);

  const updatePerformance = (_topicKey, _score, _difficulty, _questionCount, _objectivesCovered = []) => {
    // Session data is written only in finalizeSession — no other writes
  };

  const getTopicDifficulty = (topicKey) => {
    return performanceHistory[topicKey]?.currentDifficulty || "medium";
  };

  const computeWeakAreas = (blockId) => {
    const objs = getBlockObjectives(blockId) || [];
    const perf = performanceHistory;
    const blockLecs = (lectures || []).filter((l) => l.blockId === blockId);
    const resolveActivity = (o) => {
      if ((o.activity || "").trim() && (o.activity || "").trim() !== "Unknown") return o.activity || "Unknown";
      const lec =
        blockLecs.find((l) => l.id === o.linkedLecId) ||
        blockLecs.find(
          (l) =>
            String(l.lectureNumber) === String(o.lectureNumber) &&
            (l.lectureType || "LEC") === (o.lectureType || l.lectureType || "LEC")
        ) ||
        (() => {
          if ((o.lectureTitle || "").trim().length < 5) return null;
          const objTitle = (o.lectureTitle || "").trim().toLowerCase().slice(0, 50);
          const matches = blockLecs.filter((l) => {
            const lecTitle = (l.lectureTitle || l.fileName || "").toLowerCase();
            return lecTitle.includes(objTitle) || objTitle.includes(lecTitle.slice(0, 50));
          });
          return matches.find((l) => (l.lectureType || "").toUpperCase().includes("DLA")) || matches[0] || null;
        })();
      return lec ? `${lec.lectureType || "LEC"} ${lec.lectureNumber ?? ""}`.trim() : "Unknown";
    };
    const weakAreas = [];
    const byLecture = {};
    objs.forEach((o) => {
      const key = resolveActivity(o);
      if (!byLecture[key])
        byLecture[key] = { activity: key, lectureTitle: o.lectureTitle, discipline: o.discipline, objectives: [] };
      byLecture[key].objectives.push(o);
    });
    Object.values(byLecture).forEach((group) => {
      const total = group.objectives.length;
      const struggling = group.objectives.filter((o) => o.status === "struggling").length;
      const untested = group.objectives.filter((o) => o.status === "untested").length;
      const mastered = group.objectives.filter((o) => o.status === "mastered").length;
      const lecPerf = Object.entries(perf)
        .filter(([k]) => k.includes(group.activity))
        .map(([, v]) => v);
      const avgScore =
        lecPerf.length
          ? lecPerf.reduce((a, p) => a + (p.sessions?.slice(-1)[0]?.score || 0), 0) / lecPerf.length
          : null;
      const weaknessScore =
        struggling * 3 +
        untested * 1 +
        (avgScore !== null && avgScore < 60 ? 5 : 0) +
        (avgScore !== null && avgScore < 40 ? 5 : 0);
      if (weaknessScore > 0) {
        weakAreas.push({
          ...group,
          total,
          struggling,
          untested,
          mastered,
          avgScore,
          weaknessScore,
          priority: weaknessScore >= 8 ? "critical" : weaknessScore >= 4 ? "high" : "medium",
        });
      }
    });
    return weakAreas.sort((a, b) => b.weaknessScore - a.weaknessScore);
  };

  const [weakAreas, setWeakAreas] = useState([]);

  const generateTopicVignettes = useCallback(
    (cfg) =>
      genTopicVignettesWithContext(cfg, {
        lectures,
        getBlockObjectives,
        getTopicDifficulty,
        sessions,
        performanceHistory,
        makeTopicKey,
        stylePrefs,
      }),
    [lectures, getBlockObjectives, getTopicDifficulty, sessions, performanceHistory, makeTopicKey, stylePrefs]
  );

  const showPerformanceFeedback = (topicKey, score, justUpgraded = false) => {
    const perf = performanceHistory[topicKey];
    const streak = perf?.streak ?? 0;
    const lastScore = perf?.sessions?.slice(-1)[0]?.score;
    const upgraded = justUpgraded || (score >= 80 && lastScore >= 80 && (perf?.sessions?.length ?? 0) >= 1);

    let toast = null;
    if (score >= 80 && streak >= 1 && upgraded) {
      toast = {
        type: "upgrade",
        title: "Difficulty Increased! 🔥",
        message: "You scored " + score + "% twice in a row. Next session will be " + (perf?.currentDifficulty || "medium").toUpperCase() + " difficulty.",
        color: "#10b981",
      };
    } else if (score >= 80) {
      toast = {
        type: "great",
        title: "Strong Performance! ✓",
        message: score + "% — " + (streak > 1 ? streak + " in a row above 80%!" : "One more above 80% and difficulty increases."),
        color: "#10b981",
      };
    } else if (score >= 60) {
      toast = {
        type: "ok",
        title: "Keep Going",
        message: score + "% — Review weak objectives and try again.",
        color: "#f59e0b",
      };
    } else {
      toast = {
        type: "low",
        title: "Needs Review",
        message: score + "% — Difficulty adjusted. Focus on fundamentals first.",
        color: "#ef4444",
      };
    }
    setPerfToast(toast);
    setTimeout(() => setPerfToast(null), 6000);
  };

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

  // One-time repair: re-detect lectureType/lectureNumber/weekNumber for already-uploaded lectures.
  // dayOfWeek is preserved (user-set only, not overwritten).
  const lectureRepairDoneRef = useRef(false);
  useEffect(() => {
    if (!ready || lectureRepairDoneRef.current) return;
    lectureRepairDoneRef.current = true;
    setLecs((prev) => {
      if (!prev?.length) return prev;
      let changed = false;
      const next = prev.map((lec) => {
        const fileName = lec.fileName || lec.filename || "";
        const title = lec.lectureTitle || "";
        const detectedType = detectLectureType(fileName, title);
        const detectedNum = detectLectureNumber(fileName, title, detectedType);
        const detectedWeek = lec.weekNumber ?? detectWeekNumber(fileName, title);
        const current = (lec.lectureType || "LEC").toUpperCase();
        const currentNorm = current === "LECTURE" || current.startsWith("LECT") ? "LEC" : current.slice(0, 4);
        if (detectedType !== currentNorm || (detectedNum != null && detectedNum !== lec.lectureNumber) || (detectedWeek != null && detectedWeek !== lec.weekNumber)) {
          changed = true;
          return {
            ...lec,
            lectureType: detectedType,
            lectureNumber: detectedNum ?? lec.lectureNumber,
            weekNumber: detectedWeek ?? lec.weekNumber,
          };
        }
        return lec;
      });
      if (changed) {
        const deduped = deduplicateLectures(next);
        saveLectures(deduped);
        return deduped;
      }
      
      const dedupedPrev = deduplicateLectures(prev);
      if (dedupedPrev.length < prev.length) {
        saveLectures(dedupedPrev);
        return dedupedPrev;
      }
      return prev;
    });
  }, [ready]);

  // Sync blockId/termId when terms load: ensure blockId exists in terms
  useEffect(() => {
    if (!ready || !terms?.length) return;
    const allBlocks = terms.flatMap((t) => t.blocks || []);
    const exists = allBlocks.some((b) => b.id === blockId);
    if (exists) return;
    const saved = localStorage.getItem("rxt-current-block");
    if (saved && allBlocks.some((b) => b.id === saved)) {
      setBlockId(saved);
      const term = terms.find((t) => t.blocks?.some((b) => b.id === saved));
      if (term) setTermId(term.id);
      return;
    }
    const inProgress = allBlocks.find((b) => b.status === "inprogress" || b.status === "active");
    const next = inProgress || allBlocks.find((b) => b.status !== "completed" && b.status !== "done" && b.status !== "complete") || allBlocks[allBlocks.length - 1] || allBlocks[0];
    if (next) {
      setBlockId(next.id);
      localStorage.setItem("rxt-current-block", next.id);
      const term = terms.find((t) => t.blocks?.some((b) => b.id === next.id));
      if (term) setTermId(term.id);
    }
  }, [ready, terms, blockId]);

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
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== "undefined") {
      console.log("Theme tokens loaded. Search codebase for hardcoded bg colors if light mode looks wrong.");
    }
  }, []);

  // ── Derived ────────────────────────────────
  const blockLecs   = lectures.filter(l => l.blockId === (activeBlock?.id ?? blockId));
  const sortedLecs = [...blockLecs].sort((a, b) => {
    if (lecSort === "number") {
      if (a.lectureNumber == null && b.lectureNumber == null) return 0;
      if (a.lectureNumber == null) return 1;
      if (b.lectureNumber == null) return -1;
      return a.lectureNumber - b.lectureNumber;
    }
    if (lecSort === "name") {
      return (a.lectureTitle || "").localeCompare(b.lectureTitle || "");
    }
    if (lecSort === "subject") {
      return (a.subject || "").localeCompare(b.subject || "");
    }
    if (lecSort === "score") {
      const aScore = getAvgScore(a.id, sessions);
      const bScore = getAvgScore(b.id, sessions);
      return bScore - aScore;
    }
    if (lecSort === "recent") {
      return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
    }
    return 0;
  });
  const groupedByWeek = blockLecs.reduce((acc, lec) => {
    const wk = lec.weekNumber ?? 0;
    if (!acc[wk]) acc[wk] = [];
    acc[wk].push(lec);
    return acc;
  }, {});
  const sortedWeeks = Object.keys(groupedByWeek)
    .map(Number)
    .sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const tc          = activeTerm?.color || "#ef4444";

  const bScore = (bid) => {
    const bs = sessions.filter(s => s.blockId === bid);
    if (!bs.length) return null;
    return pct(bs.reduce((a,s)=>a+s.correct,0), bs.reduce((a,s)=>a+s.total,0));
  };

  const selectBlock = (bid) => {
    const term = terms.find((t) => t.blocks?.some((b) => b.id === bid));
    if (term) {
      setTermId(term.id);
      setBlockId(bid);
      if (typeof window !== "undefined") localStorage.setItem("rxt-current-block", bid);
    }
    setView("block");
    setTab("lectures");
  };

  // ── Term / Block CRUD ──────────────────────
  const addTerm = () => {
    if (!newTermName.trim()) return;
    setTerms(p => [...p, { id:uid(), name:newTermName.trim(), color: themes[theme]?.blue ?? "#2563eb", blocks:[] }]);
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
  const updateBlock = (bid, patch) => {
    setTerms((p) =>
      p.map((t) => ({
        ...t,
        blocks: (t.blocks || []).map((b) =>
          b.id === bid ? { ...b, ...patch } : b
        ),
      }))
    );
  };

  const setStatus = (tid, bid, status) => {
    setTerms((p) => {
      const updated = p.map((t) =>
        t.id === tid ? { ...t, blocks: t.blocks.map((b) => (b.id === bid ? { ...b, status } : b)) } : t
      );
      const allBlocks = updated.flatMap((t) => t.blocks || []);
      const isComplete = status === "complete" || status === "completed" || status === "done";
      if (isComplete) {
        const nextBlock = allBlocks.find(
          (b) => b.id !== bid && b.status !== "complete" && b.status !== "completed" && b.status !== "done"
        );
        if (nextBlock) {
          setBlockId(nextBlock.id);
          if (typeof window !== "undefined") localStorage.setItem("rxt-current-block", nextBlock.id);
          const nextTerm = updated.find((t) => t.blocks?.some((b) => b.id === nextBlock.id));
          if (nextTerm) setTermId(nextTerm.id);
          console.log("Auto-advanced current block to:", nextBlock.name);
        }
      }
      return updated;
    });
  };
  const updateLec = (id, patch) => {
    setLecs(prev => {
      const updated = prev.map(l => l.id === id ? { ...l, ...patch } : l);
      saveLectures(updated);
      return updated;
    });
  };

  const reanalyzeLecture = useCallback(
    async (lec) => {
      const text = lec?.extractedText || lec?.fullText || "";
      if (!text || text.length < 100) {
        setUpMsg("No lecture text to analyze — re-upload the PDF first.");
        setTimeout(() => setUpMsg(""), 3000);
        return;
      }
      try {
        setUpMsg("Analyzing lecture content with AI...");
        const teachingMap = await analyzeLecture(lec, text);
        updateLec(lec.id, {
          teachingMap: teachingMap || null,
          teachingMapDate: teachingMap ? new Date().toISOString() : undefined,
        });
        if (teachingMap?.sections?.length > 0) {
          const bid = lec.blockId;
          setBlockObjectives((prev) => {
            const data = prev[bid] || { imported: [], extracted: [] };
            const existingExtracted = (data.extracted || []).filter((o) => o.linkedLecId !== lec.id);
            const aiObjectives = teachingMap.sections.flatMap((section, si) =>
              (section.objectives || []).map((objText) => ({
                id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid(),
                text: objText,
                objective: objText,
                linkedLecId: lec.id,
                sourceFile: lec.id,
                lectureType: lec.lectureType,
                lectureNumber: lec.lectureNumber,
                sectionIndex: si,
                status: "untested",
                bloom_level: 2,
                bloom_level_name: "Understand",
              }))
            );
            const next = {
              ...prev,
              [bid]: { ...data, extracted: [...existingExtracted, ...aiObjectives] },
            };
            try {
              localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
            } catch {}
            return next;
          });
        }
        setUpMsg("Done ✓");
      } catch (err) {
        console.error("Re-analyze failed:", err);
        setUpMsg("Analysis failed: " + (err?.message || String(err)));
      }
      setTimeout(() => setUpMsg(""), 4000);
    },
    [updateLec, setBlockObjectives, setUpMsg]
  );

  const getLecPerf = useCallback(
    (lec, bid) => {
      // ONLY use exact key match — never fall back to lecture number matching.
      // Lecture number matching causes LEC1 from one session to bleed into
      // a newly uploaded LEC1.
      const exactKey = makeTopicKey(lec.id, bid);
      if (performanceHistory[exactKey]) return performanceHistory[exactKey];
      // Secondary: startsWith lec.id — catches old key formats for THIS lecture
      const byId = Object.keys(performanceHistory || {}).find((k) =>
        k.startsWith(lec.id + "__")
      );
      if (byId) return performanceHistory[byId];
      // STOP HERE — do not fall back to lecture number matching.
      // A new upload with the same lecture number must start fresh.
      return null;
    },
    [makeTopicKey, performanceHistory]
  );

  const getLectureSubtopicCompletion = useCallback(
    (lec, bid) => {
      if (!lec?.subtopics?.length) {
        const perf = getLecPerf(lec, bid);
        const sessions = perf?.sessions?.length || 0;
        return Math.min(100, sessions * 33);
      }
      const subCompletions = (lec.subtopics || []).map((_, si) => {
        const subKey = makeSubtopicKey(lec.id, si, bid);
        return performanceHistory[subKey]?.completion || 0;
      });
      if (!subCompletions.length) return 0;
      return Math.round(subCompletions.reduce((a, b) => a + b, 0) / subCompletions.length);
    },
    [getLecPerf, makeSubtopicKey, performanceHistory]
  );

  const getLecCompletion = useCallback(
    (lec, blockId) => {
      const blockObjs = getBlockObjectives(blockId) || [];
      const lecObjs = blockObjs.filter(
        (o) =>
          o.linkedLecId === lec.id ||
          (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
      );
      if (lecObjs.length === 0) {
        const perf = getLecPerf(lec, blockId);
        const sessions = perf?.sessions?.length || 0;
        return Math.min(100, sessions * 33);
      }
      const mastered = lecObjs.filter((o) => o.status === "mastered").length;
      const inProgress = lecObjs.filter((o) => o.status === "inprogress").length;
      const total = lecObjs.length;
      return Math.round(((mastered + inProgress * 0.5) / total) * 100);
    },
    [getBlockObjectives, getLecPerf]
  );

  const getSubtopicCompletion = useCallback(
    (lec, si, subName, blockId) => {
      const blockObjs = getBlockObjectives(blockId) || [];
      const lecObjs = blockObjs.filter(
        (o) =>
          o.linkedLecId === lec.id ||
          (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
      );
      if (lecObjs.length === 0) {
        return { pct: 0, mastered: 0, total: 0, sessions: 0, weakness: null };
      }
      const subWords = subName
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const subObjs = lecObjs.filter((o) => {
        const objText = (o.objective || "").toLowerCase();
        return subWords.some((w) => objText.includes(w));
      });
      const totalSubs = lec.subtopics?.length || 1;
      const objsToUse =
        subObjs.length > 0
          ? subObjs
          : lecObjs.slice(
              Math.floor((si / totalSubs) * lecObjs.length),
              Math.floor(((si + 1) / totalSubs) * lecObjs.length)
            );
      if (objsToUse.length === 0) {
        const lecPct = getLecCompletion(lec, blockId);
        return {
          pct: lecPct,
          mastered: 0,
          total: 0,
          sessions: 0,
          weakness: null,
        };
      }
      const mastered = objsToUse.filter((o) => o.status === "mastered").length;
      const inProgress = objsToUse.filter((o) => o.status === "inprogress").length;
      const struggling = objsToUse.filter((o) => o.status === "struggling").length;
      const untested = objsToUse.filter((o) => o.status === "untested").length;
      const total = objsToUse.length;
      const pct = Math.round(((mastered + inProgress * 0.5) / total) * 100);
      const weakness =
        struggling > 0
          ? "critical"
          : pct < 50 && untested > 0
            ? "weak"
            : pct < 80 && total > 0
              ? "review"
              : null;
      const subKey = makeSubtopicKey(lec.id, si, blockId);
      const subPerf = performanceHistory[subKey];
      const sessions = subPerf?.sessions?.length || 0;
      return {
        pct,
        mastered,
        total,
        sessions,
        lastScore: subPerf?.lastScore,
        weakness,
      };
    },
    [getBlockObjectives, getLecCompletion, makeSubtopicKey, performanceHistory]
  );

  const currentWeek = useMemo(() => {
    const bid = activeBlock?.id ?? blockId;
    const plan = buildStudySchedule(bid);
    const todayKey = new Date().toISOString().slice(0, 10);
    const todaySessions = plan?.schedule.find(([d]) => d === todayKey)?.[1] || [];
    if (todaySessions.length > 0) {
      const todayLecId = todaySessions[0]?.lectureId;
      const todayLec = lectures.find((l) => l.id === todayLecId);
      if (todayLec?.weekNumber) return todayLec.weekNumber;
    }
    const blockLecsForWeek = lectures.filter((l) => l.blockId === bid);
    const weekScores = {};
    blockLecsForWeek.forEach((l) => {
      if (!l.weekNumber) return;
      const perf = getLecPerf(l, bid);
      const last = perf?.sessions?.slice(-1)[0];
      if (last) {
        if (!weekScores[l.weekNumber] || new Date(last.date) > new Date(weekScores[l.weekNumber])) {
          weekScores[l.weekNumber] = last.date;
        }
      }
    });
    const mostRecent = Object.entries(weekScores).sort(
      (a, b) => new Date(b[1]) - new Date(a[1])
    )[0];
    if (mostRecent) return parseInt(mostRecent[0], 10);
    const untestedByWeek = {};
    blockLecsForWeek.forEach((l) => {
      if (!l.weekNumber) return;
      const objs = (getBlockObjectives(bid) || []).filter(
        (o) =>
          o.linkedLecId === l.id ||
          (l.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
      );
      const untested = objs.filter((o) => o.status === "untested").length;
      untestedByWeek[l.weekNumber] = (untestedByWeek[l.weekNumber] || 0) + untested;
    });
    const mostUntested = Object.entries(untestedByWeek).sort((a, b) => b[1] - a[1])[0];
    return mostUntested ? parseInt(mostUntested[0], 10) : 1;
  }, [activeBlock?.id, blockId, lectures, performanceHistory, buildStudySchedule, getBlockObjectives, getLecPerf]);

  const [bulkWeekTarget, setBulkWeekTarget] = useState(null);
  const [collapsedCardWeeks, setCollapsedCardWeeks] = useState(() => new Set());
  const toggleCardWeek = useCallback((wk) => {
    setCollapsedCardWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(wk)) next.delete(wk);
      else next.add(wk);
      return next;
    });
  }, []);
  useEffect(() => {
    const unassigned = lectures.filter((l) => l.blockId === (activeBlock?.id ?? blockId) && !l.weekNumber);
    if (unassigned.length === 0) setBulkWeekTarget(null);
  }, [lectures, activeBlock?.id, blockId]);
  useEffect(() => {
    const toCollapse = new Set(sortedWeeks.filter((wk) => wk !== currentWeek && wk !== 0));
    setCollapsedCardWeeks(toCollapse);
  }, [currentWeek, sortedWeeks.join(",")]);
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

  const onMergeToggle = (id) => {
    setMergeSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const executeMerge = (ids) => {
    const toLectures = ids.map(id => lectures.find(l => l.id === id)).filter(Boolean);
    if (toLectures.length < 2) return;
    setMergeConfig({ lectures: toLectures, open: true });
  };

  const confirmMerge = ({ title, subject, lecNum, lecType, strategy, keepOriginals, lectures: toMerge }) => {
    const primary = toMerge[0];
    const secondary = toMerge.slice(1);

    let mergedChunks = [];
    if (strategy === "append") {
      mergedChunks = [
        ...(primary.chunks || []),
        ...secondary.flatMap(l => l.chunks || []),
      ];
    } else if (strategy === "interleave") {
      const maxLen = Math.max(...toMerge.map(l => l.chunks?.length || 0));
      for (let i = 0; i < maxLen; i++) {
        for (const l of toMerge) {
          if (l.chunks?.[i]) mergedChunks.push(l.chunks[i]);
        }
      }
    } else {
      mergedChunks = [...(primary.chunks || [])];
    }

    const mergedSubtopics = [...new Set(toMerge.flatMap(l => l.subtopics || []))];
    const mergedKeyTerms = [...new Set(toMerge.flatMap(l => l.keyTerms || []))];
    const mergedFullText = toMerge.map(l => l.fullText || "").filter(Boolean).join("\n\n---\n\n");

    const mergedId = "merged_" + Date.now();
    const sourceLecIds = new Set(toMerge.map(l => l.id));
    const blockId = primary.blockId;

    const mergedLec = {
      ...primary,
      id: mergedId,
      lectureTitle: title || primary.lectureTitle,
      subject: subject || primary.subject,
      lectureNumber: lecNum,
      lectureType: lecType,
      chunks: mergedChunks,
      fullText: mergedFullText || primary.fullText,
      subtopics: mergedSubtopics,
      keyTerms: mergedKeyTerms,
      isMerged: true,
      mergedFrom: toMerge.map(l => ({
        id: l.id,
        title: l.lectureTitle || l.filename,
        num: l.lectureNumber,
      })),
      uploadedAt: new Date().toISOString(),
    };

    setLecs(prev => {
      const idsToRemove = keepOriginals ? [] : toMerge.map(l => l.id);
      const filtered = prev.filter(l => !idsToRemove.includes(l.id));
      const updated = [...filtered, mergedLec];
      saveLectures(updated);
      return updated;
    });

    // Re-link objectives that belonged to either source lecture to the merged lecture; also link unlinked objectives that match merged lecture by type+number or activity
    const mergedLecTypeNorm = (lecType || "LEC").toString().toUpperCase().replace(/^LECTURE$|^LECT/i, "LEC");
    const mergedLecNumStr = String(lecNum ?? "");
    const mergedActivityNorm = mergedLecNumStr ? (mergedLecTypeNorm + mergedLecNumStr) : "";
    setBlockObjectives(prev => {
      const data = prev[blockId] || { imported: [], extracted: [] };
      const relink = (obj) =>
        sourceLecIds.has(obj.linkedLecId) ? { ...obj, linkedLecId: mergedId, sourceFile: mergedId } : obj;
      const linkToMergedIfMatch = (obj) => {
        const afterRelink = relink(obj);
        if (afterRelink.linkedLecId === mergedId) return afterRelink;
        const objTypeNorm = (obj.lectureType || "LEC").toString().toUpperCase().replace(/^LECTURE$|^LECT/i, "LEC");
        const objNumStr = String(obj.lectureNumber ?? "");
        const matchesTypeNum = objTypeNorm === mergedLecTypeNorm && objNumStr === mergedLecNumStr;
        const objActNorm = (obj.activity || "").toUpperCase().replace(/\s+/g, "").trim();
        const matchesActivity = mergedActivityNorm && (objActNorm === mergedActivityNorm || objActNorm === mergedLecTypeNorm + " " + mergedLecNumStr);
        if (matchesTypeNum || matchesActivity) return { ...afterRelink, linkedLecId: mergedId, sourceFile: mergedId };
        return afterRelink;
      };
      const updatedImported = (data.imported || []).map(linkToMergedIfMatch);
      const updatedExtracted = (data.extracted || []).map(linkToMergedIfMatch);
      const next = { ...prev, [blockId]: { ...data, imported: updatedImported, extracted: updatedExtracted } };
      try {
        localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
      } catch (e) {
        console.warn("Failed to persist objectives after merge:", e);
      }
      return next;
    });

    setMergeConfig({ open: false, lectures: [] });
    setMergeMode(false);
    setMergeSelected([]);
  };

  // ── Upload (single place for all lecture uploads) ────────────────────────
  const onFileParsed = (filename, questions) => {
    if (!questions?.length) return;
    try {
      const next = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
      next[filename] = questions;
      localStorage.setItem("rxt-question-banks", JSON.stringify(next));
    } catch (e) {
      console.warn("Failed to save question bank:", e);
    }
  };

  const handleLectureUpload = async (files, bid, tid) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    let added = 0;
    let failed = 0;
    const addedInBatch = new Set();
    setUploading(true);

    for (const file of fileList) {
      const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
      const existingInBlock = lectures.some((l) => l.blockId === bid && l.filename === file.name);
      const existingInBatch = addedInBatch.has(file.name);
      if ((existingInBlock || existingInBatch) && !window.confirm("A lecture named \"" + file.name + "\" already exists in this block. Replace it?")) {
        failed++;
        continue;
      }

      try {
        if (isPdf) {
          let contentResult;
          if (import.meta.env.VITE_MISTRAL_API_KEY) {
            setUpMsg("🔍 Running OCR...");
            const mistralResult = await extractPDFWithMistralSafe(file);
            if (mistralResult?.markdown?.trim()) {
              contentResult = {
                fullText: mistralResult.markdown.slice(0, 12000),
                chunks: (mistralResult.pages || []).map((p) => ({ text: (p.header ? p.header + "\n\n" : "") + (p.markdown || "") })),
                extractionMethod: "mistral-ocr",
                pageCount: mistralResult.pageCount,
              };
              console.log("✅ Mistral OCR: " + mistralResult.pageCount + " pages extracted");
            }
          }
          if (!contentResult) {
            setUpMsg("📖 Extracting PDF text...");
            const parsed = await parseExamPDF(file, (msg) => setUpMsg(msg));
            contentResult = {
              ...parsed,
              extractionMethod: "pdfplumber",
              pageCount: (parsed.chunks || []).length,
            };
          }
          if (contentResult.chunks?.length > 0) {
            console.log("Chunk sample keys:", Object.keys(contentResult.chunks[0]));
            console.log("Chunk sample:", JSON.stringify(contentResult.chunks[0]).slice(0, 300));
          }
          setUpMsg("🎯 Extracting learning objectives...");
          const extractedObjectives = await extractObjectivesFromLecture(file);

          const lecTitle =
            contentResult.lectureTitle ??
            extractedObjectives[0]?.lectureTitle ??
            file.name.replace(/\.[^.]+$/, "");
          const lectureType = detectLectureType(file.name, lecTitle);
          const lecNum =
            contentResult.lectureNumber ??
            extractedObjectives[0]?.lectureNumber ??
            detectLectureNumber(file.name, lecTitle, lectureType);
          console.log("Detected type/number:", lectureType, lecNum, "from:", file.name);

          const newLec = {
            id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid(),
            blockId: bid,
            termId: tid,
            filename: file.name,
            lectureNumber: lecNum,
            lectureTitle: lecTitle,
            lectureType,
            weekNumber: detectWeekNumber(file.name, lecTitle) || null,
            subject: contentResult.subject || contentResult.discipline || "",
            chunks: contentResult.chunks || contentResult.sections || [],
            subtopics: contentResult.subtopics || contentResult.topics || contentResult.subtopicList || [],
            keyTerms: contentResult.keyTerms || contentResult.terms || contentResult.keywords || [],
            summary: contentResult.summary || "",
            fullText: (contentResult.fullText || "").slice(0, 12000),
            extractionMethod: contentResult.extractionMethod || "pdfplumber",
            pageCount: contentResult.pageCount ?? (contentResult.chunks || []).length,
            uploadedAt: new Date().toISOString(),
            uploadDate: new Date().toISOString(),
          };

          if (!newLec.subtopics?.length) {
            try {
              const allText = (contentResult.chunks || [])
                .map((c) => c.text || "")
                .join("\n")
                .slice(0, 8000);

              if (allText.length > 200) {
                const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
                const res = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      contents: [
                        {
                          parts: [
                            {
                              text:
                                "Extract from this medical lecture:\n" +
                                "- 5-8 subtopics (short phrases)\n" +
                                "- 5-10 key terms\n" +
                                "- lecture number and title\n\n" +
                                "Return ONLY complete valid JSON:\n" +
                                '{"subtopics":["Back anatomy","Vertebral column"],"keyTerms":["lamina","pedicle"],"lectureNumber":1,"lectureTitle":"The Back"}\n\n' +
                                "TEXT:\n" +
                                allText.slice(0, 4000),
                            },
                          ],
                        },
                      ],
                      generationConfig: { maxOutputTokens: 1000, temperature: 0.1 },
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
                const raw = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
                const cleaned = raw
                  .replace(/^```json\s*/i, "")
                  .replace(/^```\s*/i, "")
                  .replace(/\s*```$/, "")
                  .trim();
                console.log("Subtopic cleaned:", cleaned.slice(0, 200));

                let parsed = null;

                try {
                  parsed = JSON.parse(cleaned);
                } catch {}

                if (!parsed?.subtopics?.length) {
                  const items = [];
                  const matches = cleaned.matchAll(/"([^"]{5,80})"/g);
                  for (const m of matches) {
                    const val = m[1].trim();
                    if (["subtopics", "keyTerms", "lectureTitle", "lectureNumber"].includes(val)) continue;
                    if (/^[A-Z]/.test(val) || /^[a-z]/.test(val)) {
                      items.push(val);
                    }
                  }
                  if (items.length > 0) {
                    const firstNumIdx = items.findIndex((i) => /^\d+$/.test(i));
                    const subtopics = firstNumIdx > 0 ? items.slice(0, firstNumIdx) : items.slice(0, 10);
                    parsed = { subtopics };
                  }
                }

                if (parsed?.subtopics?.length) {
                  newLec.subtopics = parsed.subtopics.filter((s) => s.length > 3 && s.length < 100);
                  newLec.keyTerms = parsed.keyTerms || [];
                  if (!newLec.lectureNumber && parsed.lectureNumber) newLec.lectureNumber = parsed.lectureNumber;
                  if ((!newLec.lectureTitle || newLec.lectureTitle === file.name) && parsed.lectureTitle) {
                    newLec.lectureTitle = parsed.lectureTitle;
                  }
                  console.log("Subtopics extracted:", newLec.subtopics);
                }
              }
      } catch (e) {
              console.warn("Subtopic extraction error:", e.message);
            }
          }

          let teachingMap = null;
          try {
            setUpMsg("Analyzing lecture content with AI...");
            teachingMap = await analyzeLecture(newLec, newLec.fullText);
            console.log("Teaching map generated:", teachingMap?.sections?.length, "sections");
          } catch (err) {
            console.error("Teaching map generation failed:", err);
          }

          const lectureToSave = {
            ...newLec,
            teachingMap: teachingMap || null,
            teachingMapDate: teachingMap ? new Date().toISOString() : undefined,
          };

          if (teachingMap?.sections?.length > 0) {
            setUpMsg("Mapping objectives to content...");
            setBlockObjectives((prev) => {
              const data = prev[bid] || { imported: [], extracted: [] };
              const existingExtracted = (data.extracted || []).filter((o) => o.linkedLecId !== lectureToSave.id);
              const aiObjectives = teachingMap.sections.flatMap((section, si) =>
                (section.objectives || []).map((objText) => ({
                  id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid(),
                  text: objText,
                  objective: objText,
                  linkedLecId: lectureToSave.id,
                  sourceFile: lectureToSave.id,
                  lectureType: lectureToSave.lectureType,
                  lectureNumber: lectureToSave.lectureNumber,
                  sectionIndex: si,
                  status: "untested",
                  bloom_level: 2,
                  bloom_level_name: "Understand",
                }))
              );
              const next = {
                ...prev,
                [bid]: {
                  ...data,
                  extracted: [...existingExtracted, ...aiObjectives],
                },
              };
              try {
                localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
              } catch {}
              return next;
            });
          }

          setUpMsg("Saving lecture...");
          setLecs((prev) => {
            const hasNum = lectureToSave.lectureNumber != null && String(lectureToSave.lectureNumber).trim() !== "";
            const filtered = prev.filter(l => {
              if (hasNum) {
                return !(l.blockId === bid &&
                  (l.lectureType || "LEC").trim() === (lectureToSave.lectureType || "LEC").trim() &&
                  String(l.lectureNumber).trim() === String(lectureToSave.lectureNumber).trim());
              }
              return !(l.blockId === bid && l.filename === file.name);
            });
            const updated = [...filtered, lectureToSave];
            saveLectures(updated);
            return updated;
          });
          migratePerformanceOnUpload(lectureToSave, bid, lectures, setPerformanceHistory);
          setUpMsg("Done ✓");
          setTimeout(() => setUpMsg(""), 2000);

          // Re-stamp objectives that match this lecture by type+number but were linked to an old (replaced) lecture id
          setBlockObjectives((prev) => {
            const blockData = prev[bid] || { imported: [], extracted: [] };
            const blockLecs = [...(lectures || []).filter((l) => l.blockId === bid), lectureToSave];
            let repaired = 0;
            const repair = (obj) => {
              const stillLinked = blockLecs.some((l) => l.id === obj.linkedLecId);
              if (
                !stillLinked &&
                String(obj.lectureType) === String(lectureToSave.lectureType) &&
                String(obj.lectureNumber) === String(lectureToSave.lectureNumber)
              ) {
                repaired++;
                return { ...obj, linkedLecId: lectureToSave.id, sourceFile: lectureToSave.id };
              }
              return obj;
            };
            const imported = (blockData.imported || []).map(repair);
            const extracted = (blockData.extracted || []).map(repair);
            if (repaired === 0) return prev;
            const next = { ...prev, [bid]: { ...blockData, imported, extracted } };
            try {
              localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
            } catch {}
            return next;
          });

          if (contentResult.questions?.length) {
            onFileParsed(file.name, contentResult.questions);
          }

          if (extractedObjectives.length > 0) {
            const oldLecId = lectures.find((l) => l.blockId === bid && l.filename === file.name)?.id ?? null;
            setBlockObjectives((prev) => {
              const blockData = prev[bid] || { imported: [], extracted: [] };
              const blockLecs = [...lectures.filter((l) => l.blockId === bid), lectureToSave];
              const isOrphan = (obj) =>
                String(obj.lectureType) === String(lectureToSave.lectureType) &&
                String(obj.lectureNumber) === String(lectureToSave.lectureNumber) &&
                !blockLecs.some((l) => l.id === obj.linkedLecId);
              const cleanedImported = (blockData.imported || []).filter((obj) => !isOrphan(obj));
              const cleanedExtracted = (blockData.extracted || []).filter((obj) => !isOrphan(obj));
              const existing = cleanedExtracted;
              let existingFiltered = existing;
              if (oldLecId) {
                existingFiltered = existing.filter(
                  (obj) => obj.linkedLecId !== oldLecId && obj.sourceFile !== oldLecId
                );
              } else {
                existingFiltered = existing.filter(
                  (obj) =>
                    !(
                      String(obj.lectureType) === String(lectureToSave.lectureType) &&
                      String(obj.lectureNumber) === String(lectureToSave.lectureNumber)
                    )
                );
              }
              const existingKeys = new Set(
                existingFiltered.map((o) => (o.objective || "").slice(0, 55).toLowerCase().replace(/\W/g, ""))
              );
              const newOnes = extractedObjectives
                .filter(
                  (o) => !existingKeys.has((o.objective || "").slice(0, 55).toLowerCase().replace(/\W/g, ""))
                )
                .map((o) => {
                  const enriched = enrichObjectiveWithBloom(o, lectureToSave.lectureType || "LEC");
                  return {
                    ...enriched,
                    id: enriched.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid()),
                    linkedLecId: lectureToSave.id,
                    lectureType: lectureToSave.lectureType,
                    lectureNumber: lectureToSave.lectureNumber,
                    activity: `${lectureToSave.lectureType || "LEC"}${lectureToSave.lectureNumber}`,
                    sourceFile: lectureToSave.id,
                  };
                });
              const updatedExtracted = [...existingFiltered, ...newOnes];
              const allLectures = [...lectures.filter((l) => l.blockId === bid), lectureToSave];
              const alignedImported = alignObjectivesToLectures(bid, cleanedImported, allLectures);
              const updated = {
                ...prev,
                [bid]: { imported: alignedImported, extracted: updatedExtracted },
              };
              try {
                localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
              } catch {}
              return updated;
            });
          } else {
            setBlockObjectives((prev) => {
              const blockData = prev[bid];
              if (!blockData?.imported?.length) return prev;
              const allLectures = [...lectures.filter((l) => l.blockId === bid), lectureToSave];
              const aligned = alignObjectivesToLectures(bid, blockData.imported, allLectures);
              const updated = { ...prev, [bid]: { ...blockData, imported: aligned } };
              try {
                localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
              } catch {}
              return updated;
            });
          }

          const objCount = extractedObjectives.length;
          const qCount = contentResult.questions?.length || 0;
          setUpMsg(
            "Done ✓ — " + file.name +
            (qCount > 0 ? " · " + qCount + " questions" : "") +
            (objCount > 0 ? " · " + objCount + " objectives" : " · objectives aligned")
          );
          added++;
          addedInBatch.add(file.name);
        } else {
          setUpMsg("Reading file...");
          let text = await file.text();
          text = (text || "").trim();
          if (!text || text.length < 50) {
            setUpMsg("⚠ No text in " + file.name);
            failed++;
            continue;
          }
          setUpMsg("🧠 AI parsing...");
          let meta;
          try {
            meta = await detectMeta(text);
          } catch {
            meta = { subject: "Unassigned", subtopics: ["Unknown"], keyTerms: [], lectureTitle: file.name };
          }
          const rawSubject = (meta.subject || "").trim();
          if (["Medicine", "Unknown", "General", ""].includes(rawSubject)) {
            meta = { ...meta, subject: "Unassigned" };
          }
          const lectureType = detectLectureType(file.name, meta.lectureTitle || "");
          const lectureNumber = detectLectureNumber(file.name, meta.lectureTitle || "", lectureType) ?? meta.lectureNumber ?? null;
          const lec = {
            id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid(),
            blockId: bid,
            termId: tid,
            filename: file.name,
            uploadedAt: new Date().toISOString(),
            fullText: text.slice(0, 12000),
            ...meta,
            lectureNumber,
            lectureType,
            weekNumber: detectWeekNumber(file.name, meta.lectureTitle || "") || null,
          };
          setLecs((p) => [...p.filter((l) => !(l.blockId === bid && l.filename === file.name)), lec]);
          setBlockObjectives((prev) => {
            const blockData = prev[bid];
            if (!blockData?.imported?.length) return prev;
            const allLectures = [...lectures.filter((l) => l.blockId === bid), lec];
            const aligned = alignObjectivesToLectures(bid, blockData.imported, allLectures);
            const updated = { ...prev, [bid]: { ...blockData, imported: aligned } };
            try {
              localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
            } catch {}
            return updated;
          });
          setUpMsg("✓ " + file.name);
          added++;
          addedInBatch.add(file.name);
        }
      } catch (e) {
        setUpMsg("✗ " + file.name + ": " + (e.message || String(e)));
        failed++;
        console.error("Upload failed:", e);
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

  const [objectiveQuizLoading, setObjectiveQuizLoading] = useState(false);
  const [blockExamLoading, setBlockExamLoading] = useState(false);
  const [examConfigModal, setExamConfigModal] = useState(null); // { mode: "objectives"|"weak"|"full", blockId, open: true }

  const startRegularBlockExam = () => {
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

  const startBlockExam = async (cfg) => {
    const {
      mode,
      questionCount = 20,
      focusMode,
      selectedGroups = [],
      targetObjectives,
      blockId: cfgBlockId,
    } = typeof cfg === "object" && cfg !== null ? cfg : { mode: cfg, targetObjectives: null, selectedGroups: [], blockId };

    const bid = cfgBlockId ?? blockId;
    let targetObjs = targetObjectives;
    if (!targetObjs?.length) {
      const blockObjs = getBlockObjectives(bid) || [];
      if (mode === "objectives") {
        const priority = [
          ...blockObjs.filter((o) => o.status === "struggling"),
          ...blockObjs.filter((o) => o.status === "untested"),
          ...blockObjs.filter((o) => o.status === "inprogress"),
          ...blockObjs.filter((o) => o.status === "mastered"),
        ];
        targetObjs = priority.slice(0, 40);
      } else if (mode === "weak") {
        targetObjs = blockObjs.filter((o) => o.status === "struggling" || o.status === "untested");
        if (targetObjs.length === 0) targetObjs = blockObjs;
      } else {
        targetObjs = [...blockObjs].sort(() => Math.random() - 0.5);
      }
    }
    if (!targetObjs?.length) {
      startRegularBlockExam();
      return;
    }

    let questionBanksByFile = {};
    try {
      questionBanksByFile = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    } catch {}

    const selectedLecIds = (selectedGroups || []).filter((g) => g.matchedLec).map((g) => g.matchedLec.id);
    const examContext = buildQuestionContext(bid, selectedGroups?.length === 1 ? selectedGroups[0]?.matchedLec?.id : null, questionBanksByFile, "exam", { selectedLecIds });

    setBlockExamLoading(true);
    const topicKey = "block__" + bid;
    const blockDiff = getTopicDifficulty(topicKey);
    const perfData = performanceHistory[topicKey];
    const streak = perfData?.streak || 0;
    const lastScore = perfData?.sessions?.slice(-1)[0]?.score ?? null;
    console.log(`Generating for ${topicKey} at difficulty: ${blockDiff}, streak: ${streak}, lastScore: ${lastScore}`);
    const safetySettings = [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    ];
    const batchSize = 6;
    const batches = Math.ceil(questionCount / batchSize);
    const allQuestions = [];

    try {
      for (let batch = 0; batch < batches; batch++) {
        const batchCount = Math.min(batchSize, questionCount - allQuestions.length);
        setBlockExamLoading(`Generating questions ${allQuestions.length + 1}–${allQuestions.length + batchCount}...`);

        const batchObjs = targetObjs
          .slice(batch * 8, batch * 8 + 15)
          .concat(targetObjs.slice(0, 3));

        const prompt = buildExamPromptFromContext(batchCount, batchObjs, { ...examContext, stylePrefs }, blockDiff);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 16000, temperature: 0.7 },
              safetySettings,
            }),
          }
        );
        const d = await res.json();
        const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const parsed = safeJSON(raw);
        const qs = (parsed.questions || []).map((q, i) => ({
          id: `blockexam_${Date.now()}_${allQuestions.length}_${i}`,
          stem: q.stem || "",
          choices: q.choices || { A: "", B: "", C: "", D: "" },
          correct: q.correct || "A",
          explanation: q.explanation || "",
          topic: q.topic ?? q.objectiveCovered ?? q.lectureRef ?? "Block Review",
          objectiveId: q.objectiveId || null,
          difficulty: q.difficulty || blockDiff || "medium",
          usedUploadedStyle: !!q.usedUploadedStyle || !!examContext.hasUploadedQs,
        }));
        allQuestions.push(...qs);

        if (qs.length < batchSize * 0.5 && allQuestions.length < questionCount) {
          console.log(`Batch ${batch + 1} only got ${qs.length}/${batchSize} — retrying for remainder`);
          const retryCount = Math.min(batchSize - qs.length, questionCount - allQuestions.length);
          try {
            const retryPrompt = buildExamPromptFromContext(retryCount, batchObjs.slice(3), { ...examContext, stylePrefs }, blockDiff);
            const retryRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: retryPrompt }] }],
                  generationConfig: { maxOutputTokens: 16000, temperature: 0.8 },
                  safetySettings,
                }),
              }
            );
            const retryD = await retryRes.json();
            const retryRaw = retryD.candidates?.[0]?.content?.parts?.[0]?.text || "";
            const retryParsed = safeJSON(retryRaw);
            const retryQs = (retryParsed.questions || []).map((q, i) => ({
              id: `blockexam_retry_${Date.now()}_${i}`,
              stem: q.stem || "",
              choices: q.choices || { A: "", B: "", C: "", D: "" },
              correct: q.correct || "A",
              explanation: q.explanation || "",
              topic: q.topic ?? q.objectiveCovered ?? q.lectureRef ?? "Block Review",
              objectiveId: q.objectiveId || null,
              difficulty: q.difficulty || blockDiff || "medium",
              usedUploadedStyle: !!q.usedUploadedStyle,
            }));
            allQuestions.push(...retryQs);
          } catch (e) {
            console.warn("Retry batch failed:", e.message);
          }
        }

        await new Promise((r) => setTimeout(r, 300));
      }

      const questions = allQuestions.slice(0, questionCount);
      const validatedQuestions = validateAndFixQuestions(questions);
      setCurrentSessionMeta({
        blockId: bid,
        topicKey: "block__" + bid,
        difficulty: blockDiff,
        targetObjectives: targetObjs,
      });
      setStudyCfg({
        mode: "objectives",
        vignettes: validatedQuestions,
        subject: "Block Exam",
        subtopic: mode === "weak" ? "Weak Objectives" : mode === "objectives" ? "Objectives Weighted" : "Full Review",
        blockId: bid,
        blockName: activeBlock?.name || bid,
        termColor: tc,
        objectiveBlockId: bid,
      });
    setView("study");
    } catch (e) {
      console.error("Block exam generation failed:", e);
      alert("Exam generation failed: " + (e.message || String(e)));
    } finally {
      setBlockExamLoading(false);
    }
  };

  const startObjectiveQuiz = async (objectives, lectureTitle, optionalBlockId, extraMeta = {}) => {
    if (!objectives?.length) return;
    const bid = optionalBlockId ?? blockId;
    const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
    const topicKey = bid ? "block__" + bid + "__objectives" : "default";
    const diffKey = bid ? "block__" + bid : "default";
    const difficulty = getTopicDifficulty(diffKey);
    const perfData = performanceHistory[diffKey];
    const streak = perfData?.streak || 0;
    const lastScore = perfData?.sessions?.slice(-1)[0]?.score ?? null;
    console.log(`Generating for ${topicKey} at difficulty: ${difficulty}, streak: ${streak}, lastScore: ${lastScore}`);
    setBlockExamLoading(`Generating quiz for ${lectureTitle}...`);
    let questionBanksByFile = {};
    try {
      questionBanksByFile = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    } catch {}
    const lecForQuiz = lectures.find(
      (l) =>
        l.blockId === bid &&
        (l.lectureTitle || l.fileName || "")
          .toLowerCase()
          .includes((lectureTitle || "").slice(0, 20).toLowerCase())
    );
    const lectureIdForContext = lecForQuiz?.id ?? null;
    const quizContext = buildQuestionContext(bid, lectureIdForContext, questionBanksByFile, "quiz");
    const count = Math.min(objectives.length, 10);
    const prompt =
      `Generate ${count} USMLE Step 1 clinical vignette questions for: ${lectureTitle}\n\n` +
      buildExamPromptFromContext(count, objectives, { ...quizContext, stylePrefs }, difficulty).replace(/^Generate exactly \d+ questions\.\n/, "");
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 8000, temperature: 0.8 },
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
      const parsed = safeJSON(raw);
      const questions = (parsed.questions || []).map((q, i) => ({
        ...q,
        id: `objquiz_${Date.now()}_${i}`,
        num: i + 1,
        difficulty: q.difficulty || difficulty || "medium",
        topic: q.topic || lectureTitle,
        usedUploadedStyle: !!q.usedUploadedStyle || !!quizContext.hasUploadedQs,
        objectiveId:
          q.objectiveId ||
          objectives.find((o) =>
            o.objective.toLowerCase().includes((q.objectiveCovered || "").toLowerCase().slice(0, 25))
          )?.id ||
          null,
      }));
      const validated = validateAndFixQuestions(questions);
      setBlockExamLoading(null);
      const lectureIdForMeta = objectives?.[0]?.linkedLecId ?? extraMeta?.lectureId ?? null;
      setCurrentSessionMeta({
        blockId: bid,
        topicKey: makeTopicKey(lectureIdForMeta, bid),
        difficulty,
        targetObjectives: objectives,
        lectureTitle,
        lectureId: lectureIdForMeta,
        sessionType: "quiz",
        ...extraMeta,
      });
      setStudyCfg({
        mode: "objectives",
        vignettes: validated,
        subject: lectureTitle,
        subtopic: "Objectives",
        blockId: bid,
        blockName: activeBlock?.name || bid,
        termColor: tc,
        objectiveBlockId: bid,
      });
      setView("study");
    } catch (e) {
      setBlockExamLoading(null);
      console.error("startObjectiveQuiz failed:", e.message);
      alert("Quiz generation failed: " + (e.message || String(e)));
    }
  };

  const onObjectiveQuizComplete = (results, objectiveBlockId) => {
    if (!results?.length || !objectiveBlockId) return;
    results.forEach((r) => {
      const all = getBlockObjectives(objectiveBlockId);
      const existing = all.find((o) => o.id === r.objectiveId);
      const newStatus = r.correct
        ? (existing?.status === "struggling" ? "inprogress" : "mastered")
        : "struggling";
      updateObjective(objectiveBlockId, r.objectiveId, {
        status: newStatus,
        lastTested: new Date().toISOString(),
        quizScore: r.correct ? 100 : 0,
      });
    });
  };

  const distributeResultsToSubtopics = (_results, _lec, _blockId) => {
    // Session data is written only in finalizeSession — no separate subtopic writes
  };

  const finalizeSession = (results, meta) => {
    const sessionMeta = meta || currentSessionMeta;
    const bid = sessionMeta?.blockId ?? blockId;
    const targetLecId =
      sessionMeta?.lectureId ??
      sessionMeta?.targetObjectives?.[0]?.linkedLecId ??
      (studyCfg?.mode === "lecture" ? studyCfg?.lecture?.id : null);

    if (!targetLecId) {
      console.warn("⚠️ finalizeSession called without lectureId — session not saved");
      return;
    }

    const targetLec = lectures.find((l) => l.id === targetLecId);
    const targetObjectives = sessionMeta?.targetObjectives ?? [];
    const syncStats = syncSessionToObjectives(results, bid, targetObjectives, targetLecId);

    const topicKey = makeTopicKey(targetLecId, bid);
    const now = new Date().toISOString();
    const date = now;
    const correct = results.filter((r) => r.correct).length;
    const total = results.length;

    const sessionRecord = {
      score: Math.round((correct / Math.max(total, 1)) * 100),
      date: now,
      startedAt: sessionMeta?.startedAt || now,
      completedAt: now,
      questionCount: total,
      difficulty: sessionMeta?.difficulty || "medium",
      sessionType: sessionMeta?.sessionType || "quiz",
      lectureId: targetLecId,
      blockId: bid,
      topicKey,
      lectureType: targetLec?.lectureType ?? null,
      lectureNumber: targetLec?.lectureNumber ?? null,
      lectureName: targetLec?.lectureTitle || targetLec?.filename || targetLec?.fileName || null,
      preSAQScore: sessionMeta?.preSAQScore ?? null,
      postMCQScore: sessionMeta?.postMCQScore ?? null,
      confidenceLevel: sessionMeta?.confidenceLevel ?? null,
      nextReview: sessionMeta?.nextReview ?? null,
      ...(sessionMeta?.sessionType === "anki" && {
        cardCount: sessionMeta.cardCount ?? null,
        newCards: sessionMeta.newCards ?? null,
        reviewCards: sessionMeta.reviewCards ?? null,
        retention: sessionMeta.retention ?? null,
        timeSpent: sessionMeta.timeSpent ?? null,
        notes: sessionMeta.notes ?? null,
      }),
    };

    setPerformanceHistory((prev) => {
      const existing = prev[topicKey] || { sessions: [] };
      const updated = {
        ...existing,
        sessions: [...(existing.sessions || []), sessionRecord].slice(-50),
        lastStudied: now,
        firstStudied: existing.firstStudied || now,
        lastScore: sessionRecord.score,
        lectureId: targetLecId,
        blockId: bid,
        lectureType: sessionRecord.lectureType ?? targetLec?.lectureType ?? existing.lectureType,
        lectureNumber: sessionRecord.lectureNumber ?? targetLec?.lectureNumber ?? existing.lectureNumber,
        lectureName: sessionRecord.lectureName ?? (targetLec?.lectureTitle || targetLec?.filename || targetLec?.fileName) ?? existing.lectureName,
        confidenceLevel: sessionRecord.confidenceLevel ?? existing.confidenceLevel,
        nextReview: sessionMeta?.nextReview
          ? (() => {
              const d = new Date();
              d.setDate(d.getDate() + sessionMeta.nextReview);
              return d.toISOString();
            })()
          : existing.nextReview,
        currentDifficulty: sessionMeta?.difficulty || existing.currentDifficulty || "medium",
      };
      const newState = { ...prev, [topicKey]: updated };
      try {
        localStorage.setItem("rxt-performance", JSON.stringify(newState));
      } catch {}
      console.log("✅ Session saved:", topicKey, sessionRecord);
      return newState;
    });

    syncTrackerRow(targetLecId, bid, sessionRecord);

    if (targetLec) {
      distributeResultsToSubtopics(results, targetLec, bid);
    }

    if (syncStats?.updatedCount > 0) {
      setPerfToast({
        type: "sync",
        title: "Objectives Updated ✓",
        message:
          `${syncStats.updatedCount} objectives synced · ` +
          (syncStats.masteredCount > 0 ? `${syncStats.masteredCount} mastered · ` : "") +
          (syncStats.strugglingCount > 0 ? `${syncStats.strugglingCount} need review` : ""),
        color: syncStats.masteredCount > 0 ? "#10b981" : "#f59e0b",
      });
    } else {
      showPerformanceFeedback(topicKey, sessionRecord.score);
    }

    const base = { id: uid(), blockId: bid, termId, correct, total, date };
    const subject = studyCfg?.mode === "lecture" ? studyCfg.subject : studyCfg?.mode === "objectives" ? studyCfg.subject : "Block Exam";
    const subtopic = studyCfg?.mode === "lecture" ? studyCfg.subtopic : studyCfg?.mode === "objectives" ? "Objectives" : "Comprehensive";
    const questions = studyCfg?.vignettes?.map((q) => ({ stem: q.stem })) || [];
    if (studyCfg?.mode === "lecture") {
      setSessions((p) => [...p, { ...base, lectureId: studyCfg.lecture.id, subject, subtopic, questions }]);
    } else {
      setSessions((p) => [...p, { ...base, lectureId: null, subject, subtopic, questions }]);
    }
    syncSessionToTracker({ correct, total }, studyCfg || {});
    setTrackerKey((k) => k + 1);
    setActiveSessions((prev) => {
      const next = { ...prev };
      delete next[topicKey];
      return next;
    });
    let nextProfile = learningProfile;
    for (let i = 0; i < correct; i++) {
      nextProfile = recordAnswer(nextProfile, subject, subtopic, true, "clinicalVignette");
    }
    for (let i = 0; i < total - correct; i++) {
      nextProfile = recordAnswer(nextProfile, subject, subtopic, false, "clinicalVignette");
    }
    setLearningProfile(nextProfile);
    saveProfile(nextProfile);

    setSessionSummary({ correct, total, updates: syncStats?.updates ?? [] });
    setCurrentSessionMeta(null);
    setStudyCfg(null);
    const areas = computeWeakAreas(bid);
    setWeakAreas(areas);
  };

  const handleSessionComplete = (arg1, arg2) => {
    if (sessionSaveInProgress.current) {
      console.warn("handleSessionComplete called while already in progress — skipping");
      return;
    }
    sessionSaveInProgress.current = true;
    try {
      let payload;
      if (Array.isArray(arg1) && arg2 && typeof arg2 === "object") {
        const dlResults = arg1;
        const dlMeta = arg2;
        const correct = dlResults.filter((r) => r.correct).length;
        const total = dlResults.length;
        payload = { correct, total, date: new Date().toISOString(), results: dlResults, meta: dlMeta };
      } else {
        payload = arg1 || {};
      }

      const { correct = 0, total = 0, results = [], meta } = payload;
      const sessionMeta = meta || currentSessionMeta;
      const score = total > 0 ? Math.round((results.filter((r) => r.correct).length / total) * 100) : 0;
      const lec = lectures.find(
        (l) => l.id === (sessionMeta?.lectureId ?? sessionMeta?.targetObjectives?.[0]?.linkedLecId)
      );
      const sessionType = sessionMeta?.sessionType || "quiz";

      if (!["anki", "deepLearn"].includes(sessionType)) {
        setPendingConfidence({
          results,
          meta,
          lectureName: lec?.lectureTitle || lec?.fileName || sessionMeta?.lectureTitle || "Study Session",
          score,
          sessionType,
        });
        return;
      }

      finalizeSession(results, meta);
    } finally {
      setTimeout(() => {
        sessionSaveInProgress.current = false;
      }, 500);
    }
  };

  const handleConfidenceRated = (confidenceLevel) => {
    if (!pendingConfidence) return;
    const { results, meta } = pendingConfidence;
    const bid = meta?.blockId ?? blockId;
    const isCurrentBlock = bid === activeBlock?.id;
    const firstSessionDate = Object.values(performanceHistory)
      .flatMap((p) => p.sessions || [])
      .filter((s) => s.blockId === bid)
      .map((s) => s.date)
      .filter(Boolean)
      .sort()[0];
    const blockAgeMonths = firstSessionDate
      ? (Date.now() - new Date(firstSessionDate)) / (1000 * 60 * 60 * 24 * 30)
      : 0;
    const nextReview = getReviewInterval(confidenceLevel, isCurrentBlock, blockAgeMonths);
    finalizeSession(results, { ...meta, confidenceLevel, nextReview });
    setPendingConfidence(null);
    setView("block");
  };

  const onSessionDone = handleSessionComplete;

  useEffect(() => {
    setPerformanceHistory((prev) => {
      let changed = false;
      const migrated = { ...prev };
      Object.entries(prev).forEach(([key, val]) => {
        if (key.includes("__full") || key.includes("__weak")) {
          const lecId = key.split("__")[0];
          const lec = lectures.find((l) => l.id === lecId);
          if (lec) {
            const newKey = makeTopicKey(lecId, lec.blockId);
            if (!migrated[newKey]) {
              migrated[newKey] = val;
              changed = true;
              console.log("Migrated key:", key, "→", newKey);
            }
          }
        }
      });
      if (changed) {
        try {
          localStorage.setItem("rxt-performance", JSON.stringify(migrated));
        } catch {}
      }
      return changed ? migrated : prev;
    });
  }, [lectures.length]);

  useEffect(() => {
    setPerformanceHistory((prev) => {
      let changed = false;
      const updated = {};
      Object.entries(prev).forEach(([key, entry]) => {
        if (entry?.sessions) {
          const migratedSessions = entry.sessions.map((s) => {
            const raw = (s.topic || "").toString();
            if (raw.includes("__full__") || raw.includes("__weak__")) {
              changed = true;
              return {
                ...s,
                topic: resolveTopicLabel(s.topicKey || key, s, s.blockId),
              };
            }
            return s;
          });
          updated[key] = { ...entry, sessions: migratedSessions };
        } else {
          updated[key] = entry;
        }
      });
      if (changed) {
        try {
          localStorage.setItem("rxt-performance", JSON.stringify(updated));
        } catch {}
      }
      return changed ? updated : prev;
    });
  }, [resolveTopicLabel]);

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
  const BLOCK_STATUS = blockStatus(t);
  const themeValue = { T: t, isDark, setTheme };

  if (!ready) return (
    <ThemeContext.Provider value={themeValue}>
      <div style={{ minHeight:"100vh", background:t.appBg, color:t.text1, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Spinner msg="Loading RxTrack…" />
    </div>
    </ThemeContext.Provider>
  );

  const INPUT = { background:t.inputBg, border:"1px solid "+t.border1, color:t.text1, padding:"12px 16px", borderRadius:10, fontFamily:MONO, fontSize:14, outline:"none", width:"100%" };
  const CARD  = { background:t.cardBg, border:"1px solid "+t.border1, borderRadius:14, padding:24, boxShadow:t.shadowSm };

  return (
    <ThemeContext.Provider value={themeValue}>
    {mergeConfig.open && (
      <MergeModal
        config={mergeConfig}
        T={t}
        tc={tc}
        onConfirm={confirmMerge}
        onCancel={() => setMergeConfig({ open: false, lectures: [] })}
      />
    )}
    {sessionSummary && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#000000bb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
      >
        <div
          style={{
            background: t.cardBg,
            borderRadius: 18,
            padding: "28px 32px",
            maxWidth: 480,
            width: "100%",
            border: "1px solid " + t.border1,
          }}
        >
          <div style={{ fontFamily: SERIF, color: t.text1, fontSize: 24, fontWeight: 900, marginBottom: 4 }}>
            Session Complete 🎯
          </div>
          <div style={{ fontFamily: MONO, color: t.text3, fontSize: 13, marginBottom: 20 }}>
            {sessionSummary.correct}/{sessionSummary.total} correct
            {sessionSummary.total > 0 ? " · " + Math.round((sessionSummary.correct / sessionSummary.total) * 100) + "%" : ""}
          </div>

          {sessionSummary.updates?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: MONO, color: t.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>
                OBJECTIVES UPDATED
              </div>
              <div
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {sessionSummary.updates.map((u, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 7,
                      background: t.inputBg,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        color:
                          u.newStatus === "mastered"
                            ? t.green
                            : u.newStatus === "inprogress"
                              ? t.amber
                              : t.red,
                      }}
                    >
                      {u.newStatus === "mastered" ? "✓" : u.newStatus === "inprogress" ? "◐" : "⚠"}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        color: t.text1,
                        fontSize: 12,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {u.objective}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color:
                          u.newStatus === "mastered"
                            ? t.green
                            : u.newStatus === "inprogress"
                              ? t.amber
                              : t.red,
                      }}
                    >
                      {u.oldStatus} → {u.newStatus}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sessionSummary.updates?.length === 0 && (
            <div style={{ fontFamily: MONO, color: t.text3, fontSize: 13, marginBottom: 20 }}>
              No objective changes — questions weren't linked to specific objectives. Rate yourself manually in the
              Objectives tab.
            </div>
          )}

          <button
            onClick={() => {
              setSessionSummary(null);
              setView("block");
            }}
            style={{
              width: "100%",
              background: tc,
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
            Back to Block →
          </button>
        </div>
      </div>
    )}
    {examConfigModal?.open && (
      <ExamConfigModal
        config={examConfigModal}
        blockObjs={getBlockObjectives(examConfigModal.blockId) || []}
        blockLecs={lectures.filter((l) => l.blockId === examConfigModal.blockId)}
        questionBanksByFile={(() => { try { return JSON.parse(localStorage.getItem("rxt-question-banks") || "{}"); } catch { return {}; } })()}
        performanceHistory={performanceHistory}
        T={t}
        tc={tc}
        buildQuestionContext={buildQuestionContext}
        stylePrefs={stylePrefs}
        updateStylePref={updateStylePref}
        onCancel={() => setExamConfigModal(null)}
        onStart={(cfg) => { setExamConfigModal(null); startBlockExam(cfg); }}
      />
    )}
    {pendingConfidence && (
      <ConfidenceModal
        lectureName={pendingConfidence.lectureName}
        score={pendingConfidence.score}
        sessionType={pendingConfidence.sessionType}
        onRate={handleConfidenceRated}
        T={t}
        tc={tc}
      />
    )}
    {ankiLogTarget && (
      <AnkiLogModal
        lec={ankiLogTarget}
        blockId={activeBlock?.id ?? blockId}
        onSave={handleAnkiLog}
        onClose={() => setAnkiLogTarget(null)}
        T={t}
        tc={tc}
      />
    )}
    <div style={{ minHeight:"100vh", background:t.appBg, color:t.text1, display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
        @keyframes rxt-spin { to { transform:rotate(360deg); } }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:${t.scrollbarTrack}; }
        ::-webkit-scrollbar-thumb { background:${t.scrollbarThumb}; border-radius:2px; }
        input[type=range] { -webkit-appearance:none; height:4px; background:${t.border1}; border-radius:2px; outline:none; cursor:pointer; width:100%; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:${t.red}; cursor:pointer; }
        @keyframes slideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shrink { from { width:100%; } to { width:0%; } }
      `}</style>

      {/* NAV */}
      <nav style={{ height:52, borderBottom:"1px solid "+t.navBorder, boxShadow:t.navShadow, display:"flex", alignItems:"center", padding:"0 20px", gap:12, position:"sticky", top:0, background:t.navBg, color:t.text1, backdropFilter:"blur(14px)", zIndex:300, flexShrink:0 }}>
        <button onClick={() => setSidebar(p=>!p)} style={{ background:"none", border:"none", color:"inherit", cursor:"pointer", fontSize:18, padding:"0 4px" }}>☰</button>

        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke={t.red} strokeWidth="1.5"/>
            <path d="M10 4v6.2l3.2 1.8" stroke={t.red} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontFamily:SERIF, fontWeight:900, fontSize:16, color:"inherit" }}>Rx<span style={{ color:t.red }}>Track</span></span>
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
          <span style={{ fontFamily:MONO, fontSize:11, color:saveMsg==="saved"?t.green:t.amber, marginLeft:8 }}>
            {saveMsg==="saving" ? "⟳ Saving…" : "✓ Saved"}
          </span>
        )}

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          {(() => {
            const providers = getAvailableProviders();
            return (providers.gemini || providers.anthropic) && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginRight: 4 }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: t.text3 }}>AI:</span>
                {providers.gemini && (
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultProvider(AI_PROVIDERS.GEMINI);
                      setAiProvider(AI_PROVIDERS.GEMINI);
                    }}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      padding: "3px 10px",
                      borderRadius: 5,
                      border: "1px solid " + (aiProvider === AI_PROVIDERS.GEMINI ? t.statusProgress : t.border1),
                      background: aiProvider === AI_PROVIDERS.GEMINI ? t.statusProgressBg : t.cardBg,
                      color: aiProvider === AI_PROVIDERS.GEMINI ? t.statusProgress : t.text3,
                      cursor: "pointer",
                    }}
                  >
                    ◆ Gemini
                  </button>
                )}
                {providers.anthropic && (
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultProvider(AI_PROVIDERS.ANTHROPIC);
                      setAiProvider(AI_PROVIDERS.ANTHROPIC);
                    }}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      padding: "3px 10px",
                      borderRadius: 5,
                      border: "1px solid " + (aiProvider === AI_PROVIDERS.ANTHROPIC ? tc : t.border1),
                      background: aiProvider === AI_PROVIDERS.ANTHROPIC ? tc + "15" : t.cardBg,
                      color: aiProvider === AI_PROVIDERS.ANTHROPIC ? tc : t.text3,
                      cursor: "pointer",
                    }}
                  >
                    ◆ Claude
                  </button>
                )}
              </div>
            );
          })()}
          {[["overview","Overview"],["tracker","📋 Tracker"],["learn","🧠 Learn"],["deeplearn","🧬 Deep Learn"],["analytics","Analytics"]].map(([v,l]) => (
            <button
              key={v}
              onClick={() => {
                if (v === "deeplearn") setStudyCfg(null);
                setView(v);
              }}
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
                    <span style={{ fontFamily:MONO, color:t.text2, fontSize:13, fontWeight:600 }}>{term.name}</span>
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
                      onClick={() => selectBlock(block.id)}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background=t.border2; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background="transparent"; }}
                      style={{ padding:"14px 16px 14px 22px", cursor:"pointer", background:isActive?(isDark?term.color+"18":term.color+"26"):"transparent", borderLeft:"2px solid "+(isActive?term.color:"transparent"), display:"flex", alignItems:"center", justifyContent:"space-between", transition:"background 0.1s", gap:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
                        <span style={{ color:st.color, fontSize:11, flexShrink:0 }}>{st.icon}</span>
                        <span style={{ fontFamily:MONO, color:isActive?t.text1:t.text4, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{block.name}</span>
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
                    <button onClick={addTerm} style={{ background:t.blue, border:"none", color:t.cardBg, padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600, flex:1 }}>Add</button>
                    <button onClick={() => { setShowNewTerm(false); setNewTermName(""); }} style={{ background:t.border1, border:"none", color:t.text1, padding:"6px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600 }}>✕</button>
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
                getTopicDifficulty={getTopicDifficulty}
                performanceHistory={performanceHistory}
                makeTopicKey={makeTopicKey}
                onBack={() => setView("block")}
                onStart={(finalCfg) => {
                  const bid = finalCfg.blockId ?? blockId;
                  setCurrentSessionMeta({
                    blockId: bid,
                    topicKey: makeTopicKey(finalCfg.lecture?.id ?? null, bid),
                    difficulty: finalCfg.difficulty ?? getTopicDifficulty(makeTopicKey(null, blockId)),
                    targetObjectives: finalCfg.targetObjectives || [],
                  });
                  setStudyCfg(finalCfg);
                  setView("study");
                }}
              />
            </div>
          )}

          {/* STUDY */}
          {view==="study" && studyCfg && (
            <div style={{ padding:"32px 36px" }}>
              <Session cfg={studyCfg} onDone={onSessionDone} onBack={() => { setView("block"); setStudyCfg(null); }} onGenerateTopicVignettes={generateTopicVignettes} />
            </div>
          )}

          {/* TRACKER */}
          {view==="tracker" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:20, height:"100%" }}>
              <Tracker
                key={trackerKey}
                trackerRows={trackerRows}
                setTrackerRows={setTrackerRows}
                blocks={Object.fromEntries(
                  (terms || []).flatMap((term) =>
                    (term.blocks || []).map((b) => [b.id, { ...b, termColor: term.color }])
                  )
                )}
                lecs={lectures}
                objectives={blockObjectives}
                performanceHistory={performanceHistory}
                reviewedLectures={reviewedLectures}
                activeSessions={activeSessions}
                resolveTopicLabel={resolveTopicLabel}
                getBlockObjectives={getBlockObjectives}
                computeWeakAreas={computeWeakAreas}
                activeBlock={activeBlock}
                termColor={tc}
                examDates={examDates}
                buildStudySchedule={buildStudySchedule}
                generateDailySchedule={generateDailySchedule}
                makeTopicKey={makeTopicKey}
                lecTypeBadge={lecTypeBadge}
                saveExamDate={saveExamDate}
                startObjectiveQuiz={startObjectiveQuiz}
                handleDeepLearnStart={handleDeepLearnStart}
                setAnkiLogTarget={setAnkiLogTarget}
                LEVEL_COLORS={LEVEL_COLORS}
                LEVEL_BG={LEVEL_BG}
                updateBlock={updateBlock}
                onRealignObjectives={handleRealignObjectives}
                onStartScheduleSession={(session) => {
                  setStudyCfg({
                    blockId: session.blockId,
                    lecs: lectures.filter((l) => l.blockId === session.blockId),
                    blockObjectives: getBlockObjectives(session.blockId),
                  });
                  setView("deeplearn");
                }}
                onOpenBlockSchedule={(bid) => setView("tracker")}
                onStudyWeak={(bid, activity) => {
                  selectBlock(bid);
                  setExamConfigModal({
                    open: true,
                    mode: "weak",
                    blockId: bid,
                    preselectedActivity: activity,
                  });
                }}
              />
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
                blocks={terms?.flatMap((t) => t.blocks || []) ?? []}
                blockId={blockId}
                onObjectivesExtracted={(filename, extractedObjectives, bid) => {
                  if (!extractedObjectives?.length || !bid) return;
                  const lec = lectures.find((l) => l.blockId === bid && (l.filename === filename || l.fileName === filename));
                  setBlockObjectives((prev) => {
                    const blockData = prev[bid] || { imported: [], extracted: [] };
                    const existing = blockData.extracted || [];
                    const existingKeys = new Set(existing.map((o) => (o.objective || "").slice(0, 60).toLowerCase()));
                    const newOnes = extractedObjectives
                      .filter((o) => !existingKeys.has((o.objective || "").slice(0, 60).toLowerCase()))
                      .map((o) => {
                        const enriched = enrichObjectiveWithBloom(o, lec?.lectureType || "LEC");
                        return lec
                          ? {
                              ...enriched,
                              id: enriched.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid()),
                              linkedLecId: lec.id,
                              lectureType: lec.lectureType,
                              lectureNumber: lec.lectureNumber,
                              activity: `${lec.lectureType || "LEC"}${lec.lectureNumber}`,
                              sourceFile: lec.id,
                            }
                          : enriched;
                      });
                    const updated = { ...prev, [bid]: { ...blockData, extracted: [...existing, ...newOnes] } };
                    try { localStorage.setItem("rxt-block-objectives", JSON.stringify(updated)); } catch {}
                    return updated;
                  });
                }}
              />
            </div>
          )}

          {/* DEEP LEARN — use studyCfg.blockId so we always use the block that was selected when opening Deep Learn */}
          {view === "deeplearn" && (() => {
            const bid = studyCfg?.blockId ?? activeBlock?.id ?? blockId;
            const blockObjsForDL = getBlockObjectives(bid) || [];
            const selectedLec = studyCfg?.preselectedLecId
              ? lectures.find((l) => l.id === studyCfg.preselectedLecId)
              : null;
            let lecObjectives =
              selectedLec
                ? blockObjsForDL.filter(
                    (o) =>
                      o.linkedLecId === selectedLec.id ||
                      (selectedLec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                  )
                : [];
            if (selectedLec && lecObjectives.length === 0 && blockObjsForDL.length > 0) {
              lecObjectives = blockObjsForDL.map((o) =>
                o.linkedLecId ? o : { ...o, linkedLecId: selectedLec.id, sourceFile: selectedLec.id }
              );
              console.log("DeepLearn: no objectives matched lecture — using all block objectives for this session");
            }
            if (lecObjectives.length === 0 && blockObjsForDL.length > 0) {
              lecObjectives = blockObjsForDL;
              console.log("DeepLearn: no preselected lecture — using all block objectives so session has objectives");
            }

            return (
            <DeepLearn
              blockId={bid}
              lecs={lectures.filter((l) => l.blockId === bid)}
              blockObjectives={blockObjsForDL}
              lecObjectives={lecObjectives}
              getBlockObjectives={getBlockObjectives}
              questionBanksByFile={(() => {
                try {
                  return JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
                } catch {
                  return {};
                }
              })()}
              buildQuestionContext={buildQuestionContext}
              detectStudyMode={detectStudyMode}
              termColor={tc}
              makeTopicKey={makeTopicKey}
              performanceHistory={performanceHistory}
              onBack={(results, meta) => {
                if (Array.isArray(results) && meta) {
                  handleSessionComplete(results, meta);
                } else {
                  const topicKey = studyCfg
                    ? makeTopicKey(studyCfg.preselectedLecId ?? studyCfg.lecture?.id, studyCfg.blockId)
                    : null;
                  if (topicKey) {
                    setActiveSessions((prev) => {
                      const next = { ...prev };
                      delete next[topicKey];
                      return next;
                    });
                  }
                }
                setStudyCfg(null);
                setView("block");
              }}
            />
            );
          })()}

          {/* ANATOMY FLASHCARDS */}
          {/* OVERVIEW */}
          {view==="overview" && (
            <div style={{ padding:"30px 32px", display:"flex", flexDirection:"column", gap:26 }}>
              <div>
                <h1 style={{ fontFamily:SERIF, fontSize:30, fontWeight:900, letterSpacing:-1 }}>Study <span style={{ color:t.red }}>Overview</span></h1>
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
                      { l:"Blocks Active", v:terms.flatMap(tr=>tr.blocks).filter(b=>b.status!=="upcoming").length, c:t.amber },
                      { l:"Lectures", v:lectures.length, c:t.blue },
                      { l:"Questions Done", v:tq, c:t.purple },
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
                    {(() => {
                      const statusOrder = { inprogress: 0, active: 0, pending: 1, upcoming: 1, completed: 2, done: 2, complete: 2 };
                      const sortedBlocks = [...(term.blocks || [])].sort((a, b) => {
                        if (a.id === blockId) return -1;
                        if (b.id === blockId) return 1;
                        const aOrder = statusOrder[a.status] ?? 1;
                        const bOrder = statusOrder[b.status] ?? 1;
                        if (aOrder !== bOrder) return aOrder - bOrder;
                        return (a.order || 0) - (b.order || 0);
                      });
                      return sortedBlocks.map(block => {
                      const sc=bScore(block.id);
                      const m=mastery(sc);
                      const st=BLOCK_STATUS[block.status]||BLOCK_STATUS.upcoming;
                      const lc=lectures.filter(l=>l.blockId===block.id).length;
                      const isCur = blockId === block.id && block.status !== "complete" && block.status !== "completed" && block.status !== "done";
                      const isComplete = block.status === "complete" || block.status === "completed" || block.status === "done";
                      return (
                        <div key={block.id}
                          onClick={() => selectBlock(block.id)}
                          onMouseEnter={e=>{ e.currentTarget.style.borderColor=term.color+"50"; e.currentTarget.style.transform="translateY(-2px)"; }}
                          onMouseLeave={e=>{ e.currentTarget.style.borderColor=isCur?term.color+"40":term.color+"15"; e.currentTarget.style.transform="none"; }}
                          style={{ ...CARD, border:"1px solid "+(isCur?term.color+"40":term.color+"15"), cursor:"pointer", transition:"all 0.15s", position:"relative", boxShadow:isCur?"0 0 24px "+term.color+(isDark?"14":"26"):"none" }}>
                          {isCur && <div style={{ position:"absolute", top:-1, right:10, background:term.color, color:t.text1, fontFamily:MONO, fontSize:11, padding:"2px 8px", borderRadius:"0 0 6px 6px", letterSpacing:1 }}>CURRENT</div>}
                          {isComplete && <div style={{ position:"absolute", top:-1, right:10, fontFamily:MONO, color:t.green, fontSize:10, letterSpacing:1.5, background:t.greenBg, padding:"2px 7px", borderRadius:"0 0 6px 6px", border:"1px solid "+t.greenBorder }}>✓ COMPLETE</div>}
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
                    });
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BLOCK VIEW */}
          {view==="block" && activeBlock && activeTerm && (
            <div style={{ padding:"32px 36px", display:"flex", flexDirection:"column", gap:22 }}>
              {/* Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:14 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:tc }} />
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
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
                    <span style={{ fontFamily:MONO, color:t.text3, fontSize:11 }}>
                      Block start date:
                    </span>
                    <input
                      type="date"
                      value={activeBlock?.startDate || ""}
                      onChange={(e) => updateBlock(activeBlock.id, { startDate: e.target.value })}
                      style={{
                        background: t.inputBg,
                        border: "1px solid " + t.border1,
                        borderRadius: 7,
                        padding: "5px 10px",
                        color: t.text1,
                        fontFamily: MONO,
                        fontSize: 11,
                      }}
                    />
                  </div>
                </div>
                <Ring score={bScore(blockId)} size={80} tint={tc} />
              </div>

              {/* Block Exam Prep */}
              <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:16, padding:"24px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:20, flexWrap:"wrap", boxShadow:t.shadowSm }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:MONO, color:tc, fontSize:11, letterSpacing:2, marginBottom:6 }}>⚡ BLOCK EXAM PREP</div>
                  <div style={{ fontFamily:SERIF, color:t.text2, fontSize:16, fontWeight:700, marginBottom:4 }}>Comprehensive {activeBlock.name} Review</div>
                  <p style={{ fontFamily:MONO, color:t.text3, fontSize:11, lineHeight:1.6 }}>
                    {blockLecs.length>0 ? "Mixed vignettes from all " + blockLecs.length + " lecture" + (blockLecs.length!==1?"s":"") + (sessions.filter(s=>s.blockId===blockId).length>0?" · weak topics weighted higher":"") : "Upload lectures first."}
                  </p>
                  {(() => {
                    const blockObjs = getBlockObjectives(blockId) || [];
                    const total = blockObjs.length;
                    const mastered = blockObjs.filter(o => o.status === "mastered").length;
                    const struggling = blockObjs.filter(o => o.status === "struggling").length;
                    const untested = blockObjs.filter(o => o.status === "untested").length;
                    const inprogress = blockObjs.filter(o => o.status === "inprogress").length;
                    const pct = total > 0 ? Math.round(mastered / total * 100) : 0;
                    if (total === 0) return null;
                    return (
                      <>
                        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
                          <div style={{ height:8, background:t.border1, borderRadius:3 }}>
                            <div style={{ height:"100%", borderRadius:3, width:pct+"%", background:pct===100?t.statusGood:pct>60?t.statusWarn:t.statusBad, transition:"width 0.5s" }} />
                          </div>
                          <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                            {[
                              { label:"Mastered", val:mastered, color:t.statusGood },
                              { label:"In Progress", val:inprogress, color:t.statusProgress },
                              { label:"Struggling", val:struggling, color:t.statusBad },
                              { label:"Untested", val:untested, color:t.statusNeutral },
                            ].filter(s => s.val > 0).map(s => (
                              <div key={s.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                                <div style={{ width:7, height:7, borderRadius:"50%", background:s.color }} />
                                <span style={{ fontFamily:MONO, color:s.color, fontSize:10, fontWeight:700 }}>{s.val}</span>
                                <span style={{ fontFamily:MONO, color:t.text3, fontSize:9 }}>{s.label}</span>
                              </div>
                            ))}
                            <span style={{ fontFamily:MONO, color:t.text3, fontSize:9, marginLeft:"auto" }}>{pct}% objective coverage</span>
                          </div>
                        </div>
                        <BlockWeakObjectivesBreakdown
                          blockObjs={blockObjs}
                          lecs={blockLecs}
                          blockId={blockId}
                          currentBlock={activeBlock}
                          T={t}
                          tc={tc}
                          startObjectiveQuiz={startObjectiveQuiz}
                          updateObjective={updateObjective}
                          lecTypeBadge={lecTypeBadge}
                        />
                      </>
                    );
                  })()}
                </div>
                <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                  {(getBlockObjectives(blockId).length > 0) && (
                    <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:8, padding:"4px 12px", display:"flex", gap:6, alignItems:"center" }}>
                      <span style={{ fontFamily:MONO, color:tc, fontSize:12, fontWeight:700 }}>
                        {getBlockObjectives(blockId).filter(o=>o.status==="mastered").length}/{getBlockObjectives(blockId).length}
                      </span>
                      <span style={{ fontFamily:MONO, color:t.text3, fontSize:9 }}>objectives</span>
                    </div>
                  )}
                  {getBlockObjectives(blockId).filter(o=>o.status!=="mastered").length > 0 && (
                    <button
                      onClick={() => {
                        const weakObjs = getBlockObjectives(blockId).filter(o => o.status === "struggling" || o.status === "untested");
                        if (weakObjs.length === 0) return;
                        startObjectiveQuiz(weakObjs, "Weak & Untested Objectives", blockId);
                      }}
                      style={{ background:t.statusBad, border:"none", color:"#fff", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:10, fontWeight:700 }}
                    >
                      ⚠ Quiz Weak Objectives ({getBlockObjectives(blockId).filter(o=>o.status!=="mastered").length})
                    </button>
                  )}
                  {tab === "lectures" && (
                    <>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontFamily:MONO, color:t.text3, fontSize:9 }}>SORT</span>
                        {[["number","#"],["name","A–Z"],["subject","Subject"],["score","Score"],["recent","Recent"]].map(([v, label]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => { setLecSort(v); if (typeof window !== "undefined") localStorage.setItem("rxt-lec-sort", v); }}
                            style={{
                              background: lecSort === v ? tc + "22" : "none",
                              border: "1px solid " + (lecSort === v ? tc : t.border1),
                              color: lecSort === v ? tc : t.text3,
                              padding: "3px 9px",
                              borderRadius: 5,
                              cursor: "pointer",
                              fontFamily: MONO,
                              fontSize: 12,
                              transition: "all 0.15s",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                    </div>
                      <div style={{ display:"flex", gap:2, background:t.inputBg, borderRadius:8, padding:2, border:"1px solid "+t.border1 }}>
                        {[["card","▦"],["list","☰"]].map(([v, icon]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => toggleLecView(v)}
                            style={{
                              background: lecView === v ? t.cardBg : "none",
                              border: "none",
                              color: lecView === v ? tc : t.text3,
                              width: 30,
                              height: 28,
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 16,
                              boxShadow: lecView === v ? t.shadowSm : "none",
                              transition: "all 0.15s",
                            }}
                          >
                            {icon}
                          </button>
                        ))}
                  </div>
                      <button
                        type="button"
                        onClick={() => { setMergeMode(m => !m); setMergeSelected([]); }}
                        style={{
                          background: mergeMode ? t.amber + "22" : "none",
                          border: "1px solid " + (mergeMode ? t.amber : t.border1),
                          color: mergeMode ? t.amber : t.text3,
                          padding: "3px 10px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontFamily: MONO,
                          fontSize: 12,
                          transition: "all 0.15s",
                        }}
                      >
                        {mergeMode ? "✕ Cancel Merge" : "⊕ Merge"}
                      </button>
                    </>
                  )}
                  <div style={{ display:"flex", flexDirection:"column", gap:8, minWidth:200 }}>
                    <button
                      onClick={() => setExamConfigModal({ mode: "objectives", blockId: activeBlock?.id ?? blockId, open: true })}
                      disabled={blockExamLoading || (!blockLecs.length && !getBlockObjectives(blockId).length)}
                      style={{ background:tc, border:"none", color:"#fff", padding:"11px 20px", borderRadius:9, cursor:blockExamLoading?"wait":"pointer", fontFamily:SERIF, fontSize:14, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, transition:"opacity 0.15s" }}
                      onMouseEnter={e => !blockExamLoading && (e.currentTarget.style.opacity="0.88")}
                      onMouseLeave={e => (e.currentTarget.style.opacity="1")}
                    >
                      {blockExamLoading ? (
                        <>
                          <span>Generating exam...</span>
                          <div style={{ width:14, height:14, border:"2px solid #ffffff40", borderTopColor:"#fff", borderRadius:"50%", animation:"rxt-spin 0.8s linear infinite" }} />
                        </>
                      ) : (
                        <>
                          <span>🎯 Objectives Exam</span>
                          <span style={{ fontSize:11, opacity:0.85 }}>→</span>
                        </>
                      )}
                    </button>
                    <div style={{ display:"flex", gap:6 }}>
                      <button
                        onClick={() => setExamConfigModal({ mode: "weak", blockId: activeBlock?.id ?? blockId, open: true })}
                        disabled={!blockLecs.length && !getBlockObjectives(blockId).length}
                        style={{ flex:1, background:t.redBg, border:"1px solid "+t.redBorder, color:t.red, padding:"8px 10px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:10, fontWeight:700, transition:"all 0.15s" }}
                        onMouseEnter={e => (e.currentTarget.style.background=t.red+"30")}
                        onMouseLeave={e => (e.currentTarget.style.background=t.redBg)}
                      >
                        ⚠ Weak Only
                      </button>
                      <button
                        onClick={() => setExamConfigModal({ mode: "full", blockId: activeBlock?.id ?? blockId, open: true })}
                        disabled={!blockLecs.length && !getBlockObjectives(blockId).length}
                        style={{ flex:1, background:t.inputBg, border:"1px solid "+t.border1, color:t.text2, padding:"8px 10px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:10, transition:"all 0.15s" }}
                        onMouseEnter={e => (e.currentTarget.style.background=t.hoverBg)}
                        onMouseLeave={e => (e.currentTarget.style.background=t.inputBg)}
                      >
                        Full Review
                      </button>
                    </div>
                    {getBlockObjectives(blockId).length > 0 && (
                      <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, textAlign:"center", marginTop:2 }}>
                        Targeting {getBlockObjectives(blockId).filter(o=>o.status==="struggling"||o.status==="untested").length} weak/untested objectives
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const allLecIds = new Set(lectures.map((l) => l.id));
                        setPerformanceHistory((prev) => {
                          const cleaned = {};
                          Object.entries(prev || {}).forEach(([key, entry]) => {
                            const lecId = key.split("__")[0];
                            if (lecId === "block" || allLecIds.has(lecId)) {
                              cleaned[key] = entry;
                            } else {
                              console.log(`🗑 Removed orphaned key: ${key}`);
                            }
                          });
                          try {
                            localStorage.setItem("rxt-performance", JSON.stringify(cleaned));
                          } catch {}
                          return cleaned;
                        });
                      }}
                      style={{
                        background: t.statusBad,
                        border: "none",
                        color: "#fff",
                        padding: "6px 14px",
                        borderRadius: 7,
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 700,
                        marginTop: 8,
                      }}
                    >
                      🗑 Clear Orphaned Sessions
                    </button>
                  </div>
                </div>
              </div>

              {/* Upload */}
              <div
                onDragOver={e=>{ e.preventDefault(); setDrag(true); }}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{ e.preventDefault(); setDrag(false); handleLectureUpload(e.dataTransfer.files,blockId,termId); }}
                style={{ background:drag?t.hoverBg:t.cardBg, border:"1px "+(drag?"solid "+tc:"dashed "+t.border1), borderRadius:12, padding:"16px 20px", transition:"all 0.2s", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div style={{ flex:1 }}>
                  <span style={{ fontFamily:MONO, color:t.text3, fontSize:12 }}>Upload to <span style={{ color:tc, fontWeight:600 }}>{activeBlock.name}</span></span>
                  <span style={{ fontFamily:MONO, color:t.text3, fontSize:11, marginLeft:10 }}>PDF or .txt — drag & drop or click</span>
                </div>
                <label style={{ background:t.inputBg, border:"1px dashed " + t.border1, color:t.text1, padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:600 }}>
                  {uploading ? "Analyzing…" : "+ Upload Files"}
                  <input type="file" accept=".pdf,.txt,.md" multiple onChange={e=>handleLectureUpload(e.target.files,blockId,termId)} style={{ display:"none" }} />
                </label>
                {blockLecs.length > 0 && (
                  <button type="button" onClick={clearBlockLectures} style={{ background:"none", border:"1px solid " + t.text4, color:t.text3, padding:"6px 12px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Clear All</button>
                )}
                {uploading && <div style={{ width:"100%", height:2, background:t.border1, borderRadius:1, overflow:"hidden" }}><div style={{ height:"100%", width:"65%", background:"linear-gradient(90deg,"+tc+","+t.purple+")", borderRadius:1 }} /></div>}
                {upMsg && <div style={{ width:"100%", fontFamily:MONO, color:upMsg.startsWith("✓")?t.green:upMsg.startsWith("✗")||upMsg.startsWith("⚠")?t.red:t.blue, fontSize:11 }}>{upMsg}</div>}
              </div>

              {/* Tabs */}
              <div style={{ display:"flex", borderBottom:"1px solid " + t.border2, background:t.panelBg }}>
                {[["lectures","Lectures ("+blockLecs.length+")"],["heatmap","Heatmap"],["analysis","AI Analysis"],["objectives","🎯 Objectives"]].map(([tKey,label])=>(
                  <button
                    key={tKey}
                    onClick={()=>setTab(tKey)}
                    style={{
                      background:"none",
                      border:"none",
                      borderBottom:"2px solid "+(tab===tKey?tc:"transparent"),
                      color: tab===tKey ? t.text1 : t.text3,
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
                <>
                  {mergeMode && (
                    <div style={{ margin: "0 24px 12px", background: t.amberBg, border: "1px solid " + t.amberBorder, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 18 }}>⊕</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: MONO, color: t.amber, fontSize: 14, fontWeight: 600 }}>Merge Mode — select lectures to combine</div>
                        <div style={{ fontFamily: MONO, color: t.text3, fontSize: 12, marginTop: 2 }}>
                          {mergeSelected.length < 2 ? "Select 2 or more lectures to merge · " + mergeSelected.length + " selected" : mergeSelected.length + " lectures selected — ready to merge"}
                        </div>
                      </div>
                      {mergeSelected.length >= 2 && (
                        <button
                          type="button"
                          onClick={() => executeMerge(mergeSelected)}
                          style={{ background: t.amber, border: "none", color: t.text1, padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontFamily: MONO, fontSize: 14, fontWeight: 700 }}
                        >
                          Merge {mergeSelected.length} Lectures →
                        </button>
                      )}
                    </div>
                  )}
                  {(() => {
                    const unassigned = blockLecs.filter((l) => !l.weekNumber);
                    if (unassigned.length === 0) return null;
                    return (
                      <div style={{ background: t.amberBg, border: "1px solid " + t.amberBorder, borderRadius: 12, padding: "14px 16px", marginBottom: 16, marginLeft: 24, marginRight: 24 }}>
                        <div style={{ fontFamily: MONO, color: t.amber, fontSize: 10, letterSpacing: 1.5, marginBottom: 8 }}>
                          △ {unassigned.length} LECTURES NOT YET ASSIGNED TO A WEEK
                        </div>
                        <div style={{ fontFamily: MONO, color: t.text2, fontSize: 11, marginBottom: 12 }}>
                          Assign each lecture to the week it was taught. Use the <strong>Wk</strong> dropdown on each card, or bulk-assign below.
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((wk) => (
                            <button
                              key={wk}
                              type="button"
                              onClick={() => setBulkWeekTarget((prev) => (prev === wk ? null : wk))}
                              style={{
                                padding: "6px 14px",
                                borderRadius: 7,
                                fontFamily: MONO,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                background: bulkWeekTarget === wk ? tc : t.inputBg,
                                border: "1px solid " + (bulkWeekTarget === wk ? tc : t.border1),
                                color: bulkWeekTarget === wk ? "#fff" : t.text2,
                                transition: "all 0.15s",
                              }}
                            >
                              Wk {wk}
                            </button>
                          ))}
                          {bulkWeekTarget != null && (
                            <span style={{ fontFamily: MONO, color: tc, fontSize: 11, alignSelf: "center", marginLeft: 4 }}>
                              ← now click lectures to assign to Week {bulkWeekTarget}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {lecView === "list" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 24px 24px" }}>
                      {(() => {
                        const bid = activeBlock?.id ?? blockId;
                        const blockObjs = getBlockObjectives(bid) || [];

                        const lecRowProps = {
                          tc,
                          T: t,
                          sessions,
                          onStart: startTopic,
                          onUpdateLec: updateLec,
                          mergeMode,
                          mergeSelected,
                          onMergeToggle,
                          bulkWeekTarget,
                          allObjectives: getBlockObjectives(blockId),
                          allBlockObjectives: getBlockObjectives(activeBlock?.id ?? blockId),
                          getBlockObjectives,
                          updateObjective,
                          currentBlock: activeBlock,
                          startObjectiveQuiz,
                          detectStudyMode,
                          setAnkiLogTarget,
                          handleDeepLearnStart,
                          getLectureSubtopicCompletion,
                          getLecCompletion,
                          makeSubtopicKey,
                          performanceHistory,
                          reanalyzeLecture,
                          onDeepLearn: () => {
                            setStudyCfg({ blockId: bid, lecs: lectures.filter((l) => l.blockId === bid), blockObjectives: getBlockObjectives(bid) });
                            setView("deeplearn");
                          },
                        };

                        return sortedWeeks.map((wk) => {
                          const weekLecs = groupedByWeek[wk] || [];
                          const weekLabel = wk === 0 ? "Unassigned" : `Week ${wk}`;
                          const isCurrentWk = wk !== 0 && currentWeek === wk;
                          const weekObjs = weekLecs.flatMap((l) =>
                            blockObjs.filter(
                              (o) =>
                                o.linkedLecId === l.id ||
                                (l.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                            )
                          );
                          const mastered = weekObjs.filter((o) => o.status === "mastered").length;
                          const inProgress = weekObjs.filter((o) => o.status === "inprogress").length;
                          const struggling = weekObjs.filter((o) => o.status === "struggling").length;
                          const total = weekObjs.length;
                          const pct =
                            total > 0 ? Math.round(((mastered + inProgress * 0.5) / total) * 100) : 0;
                          const weekSessions = weekLecs.flatMap((l) => {
                            const perf = getLecPerf(l, bid);
                            return perf?.sessions || [];
                          });
                          const avgScore =
                            weekSessions.length > 0
                              ? Math.round(weekSessions.reduce((a, s) => a + (s.score ?? 0), 0) / weekSessions.length)
                              : null;

                          return (
                            <WeekGroup
                              key={wk}
                              weekLabel={weekLabel}
                              weekNumber={wk}
                              lecs={weekLecs}
                              isCurrentWeek={isCurrentWk}
                              mastered={mastered}
                              struggling={struggling}
                              total={total}
                              pct={pct}
                              avgScore={avgScore}
                              sessionCount={weekSessions.length}
                              defaultOpen={isCurrentWk || wk === 0 || sortedWeeks.length === 1}
                              expandedLec={expandedLec}
                              setExpandedLec={setExpandedLec}
                              {...lecRowProps}
                            />
                          );
                        });
                      })()}
                    </div>
                  ) : (
                    <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 0 }}>
                      {(() => {
                        const bid = activeBlock?.id ?? blockId;
                        const subjectsInBlock = [...new Set(blockLecs.map((l) => l.subject || l.discipline).filter(Boolean))];
                        const showSubjectOnCards = subjectsInBlock.length > 1;
                        const todayDow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
                        const DOW_ORDER_CARD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
                        let cardIndex = 0;
                        const cardProps = (lec) => ({
                          lec,
                          sessions,
                          accent: PALETTE[cardIndex++ % PALETTE.length],
                          tint: tc,
                          onStudy: startTopic,
                          onDelete: delLec,
                          onUpdateLec: updateLec,
                          mergeMode,
                          mergeSelected,
                          onMergeToggle,
                          bulkWeekTarget,
                          allObjectives: getBlockObjectives(blockId),
                          showSubjectLabel: showSubjectOnCards,
                          setAnkiLogTarget,
                          getBlockObjectives,
                          currentBlock: activeBlock,
                          setBlockObjectives,
                          reviewedLectures,
                          setReviewedLectures,
                          markLectureReviewed,
                          unmarkLectureReviewed,
                          startObjectiveQuiz,
                          detectStudyMode,
                          handleDeepLearnStart,
                          getLectureSubtopicCompletion,
                          getLecCompletion,
                          getSubtopicCompletion,
                          getLecPerf,
                          reanalyzeLecture,
                          onDeepLearn: () => { setStudyCfg({ blockId: bid, lecs: lectures.filter((l) => l.blockId === bid), blockObjectives: getBlockObjectives(bid) }); setView("deeplearn"); },
                        });
                        return sortedWeeks.map((wk) => {
                          const weekLecs = groupedByWeek[wk] || [];
                          const isCurrentWeek = wk !== 0 && currentWeek === wk;
                          const isCollapsed = collapsedCardWeeks.has(wk);
                          const byDay = DOW_ORDER_CARD.reduce((acc, day) => {
                            const dayLecs = weekLecs.filter((l) => l.dayOfWeek === day);
                            if (dayLecs.length > 0) acc[day] = dayLecs;
                            return acc;
                          }, {});
                          const unassigned = weekLecs.filter((l) => !l.dayOfWeek);
                          const blockObjsForWeek = getBlockObjectives(activeBlock?.id ?? blockId) || [];
                          const weekPct = (() => {
                            const allObjs = weekLecs.flatMap((l) =>
                              blockObjsForWeek.filter(
                                (o) =>
                                  o.linkedLecId === l.id ||
                                  (l.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                              )
                            );
                            const mastered = allObjs.filter((o) => o.status === "mastered").length;
                            const inProg = allObjs.filter((o) => o.status === "inprogress").length;
                            const total = allObjs.length;
                            return total > 0 ? Math.round(((mastered + inProg * 0.5) / total) * 100) : 0;
                          })();
                          const struggling = weekLecs.reduce((sum, l) => {
                            const objs = blockObjsForWeek.filter(
                              (o) =>
                                o.linkedLecId === l.id ||
                                (l.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                            );
                            return sum + objs.filter((o) => o.status === "struggling").length;
                          }, 0);
                          return (
                            <div key={wk} style={{ marginBottom: 16 }}>
                              <div
                                onClick={() => toggleCardWeek(wk)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  padding: "12px 16px",
                                  borderRadius: isCollapsed ? 10 : "10px 10px 0 0",
                                  cursor: "pointer",
                                  userSelect: "none",
                                  background: isCurrentWeek ? tc + "12" : t.inputBg,
                                  border: "2px solid " + (isCurrentWeek ? tc : t.border1),
                                  transition: "all 0.15s",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = isCurrentWeek ? tc + "18" : t.hoverBg)}
                                onMouseLeave={(e) => (e.currentTarget.style.background = isCurrentWeek ? tc + "12" : t.inputBg)}
                              >
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    color: isCurrentWeek ? tc : t.text3,
                                    fontSize: 12,
                                    display: "inline-block",
                                    transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                                    transition: "transform 0.2s",
                                    flexShrink: 0,
                                  }}
                                >
                                  ▶
                                </span>
                                <span style={{ fontFamily: SERIF, color: isCurrentWeek ? tc : t.text1, fontSize: 15, fontWeight: 900 }}>
                                  {wk === 0 ? "Unassigned" : `Week ${wk}`}
                                </span>
                                {isCurrentWeek && (
                                  <span style={{ fontFamily: MONO, fontSize: 8, color: "#fff", background: tc, padding: "2px 7px", borderRadius: 3, fontWeight: 700, flexShrink: 0 }}>CURRENT</span>
                                )}
                                {struggling > 0 && (
                                  <span style={{ fontFamily: MONO, fontSize: 9, color: t.statusBad, fontWeight: 700, flexShrink: 0 }}>⚠ {struggling} struggling</span>
                                )}
                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                                  <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>
                                    {weekLecs.length} lecture{weekLecs.length !== 1 ? "s" : ""}
                                  </span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div style={{ width: 60, height: 4, background: t.border1, borderRadius: 2 }}>
                                      <div
                                        style={{
                                          height: "100%",
                                          borderRadius: 2,
                                          width: weekPct + "%",
                                          background: weekPct >= 80 ? t.statusGood : weekPct >= 50 ? t.statusProgress : weekPct > 0 ? t.statusWarn : t.statusNeutral,
                                          transition: "width 0.4s",
                                        }}
                                      />
                                    </div>
                                    <span
                                      style={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        color: weekPct >= 80 ? t.statusGood : weekPct >= 50 ? t.statusProgress : weekPct > 0 ? t.statusWarn : t.statusNeutral,
                                      }}
                                    >
                                      {weekPct}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                              {!isCollapsed && (
                                <div
                                  style={{
                                    border: "2px solid " + (isCurrentWeek ? tc : t.border1),
                                    borderTop: "none",
                                    borderRadius: "0 0 10px 10px",
                                    padding: 16,
                                    background: t.cardBg,
                                  }}
                                >
                                  {DOW_ORDER_CARD.filter((d) => byDay[d]).map((day) => {
                                    const isToday = day === todayDow;
                                    return (
                                      <div key={day} style={{ marginBottom: 16 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                          <div style={{ width: 12, height: 1, background: isToday ? tc : t.border1 }} />
                                          <span style={{ fontFamily: MONO, color: isToday ? tc : t.text3, fontSize: isToday ? 11 : 10, fontWeight: isToday ? 700 : 400, letterSpacing: 1 }}>{day.toUpperCase()}</span>
                                          {isToday && (
                                            <span style={{ fontFamily: MONO, fontSize: 8, color: "#fff", background: tc, padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>TODAY</span>
                                          )}
                                          <div style={{ flex: 1, height: 1, background: isToday ? tc + "40" : t.border2 }} />
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                                          {byDay[day].map((lec) => (
                                            <LecCard key={lec.id} {...cardProps(lec)} />
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {unassigned.length > 0 && (
                                    <div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                        <div style={{ flex: 1, height: 1, background: t.border2 }} />
                                        <span style={{ fontFamily: MONO, color: t.text3, fontSize: 9, letterSpacing: 1 }}>UNSCHEDULED</span>
                                        <div style={{ flex: 1, height: 1, background: t.border2 }} />
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                                        {unassigned.map((lec) => (
                                          <LecCard key={lec.id} {...cardProps(lec)} />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </>
              ))}

              {/* Heatmap */}
              {tab === "heatmap" && (
                <Heatmap
                  lectures={blockLecs}
                  getLecCompletion={getLecCompletion}
                  getSubtopicCompletion={getSubtopicCompletion}
                  getBlockObjectives={getBlockObjectives}
                  startObjectiveQuiz={startObjectiveQuiz}
                  currentBlock={activeBlock}
                  lecTypeBadge={lecTypeBadge}
                  tc={tc}
                />
              )}

              {/* Analysis */}
              {tab==="objectives" && (
                <div style={{ position:"relative" }}>
                  {hasOrphanedPerf && (
                    <div
                      style={{
                        padding: "10px 16px",
                        background: "#fff8ee",
                        border: "1.5px solid " + (t.statusWarn || "#f59e0b"),
                        borderRadius: 10,
                        marginBottom: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 10,
                      }}
                    >
                      <span style={{ fontSize: 13, color: t.statusWarn || "#d97706", fontFamily: MONO }}>
                        △ Previous session data found for re-uploaded lectures
                      </span>
                      <button
                        type="button"
                        onClick={resyncOrphanedPerformance}
                        style={{
                          padding: "6px 14px",
                          fontSize: 12,
                          fontFamily: MONO,
                          background: t.statusProgress || t.tc || "#6366f1",
                          color: "white",
                          border: "none",
                          borderRadius: 8,
                          cursor: "pointer",
                        }}
                      >
                        ⟳ Resync Now
                      </button>
                    </div>
                  )}
                  {showManualResync && orphanedSessionsForManual.length > 0 && (() => {
                    const bid = activeBlock?.id ?? blockId;
                    const blockLecsForManual = (lectures || []).filter((l) => l.blockId === bid);
                    return (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontFamily: MONO, color: t.text3, marginBottom: 8 }}>
                          Map each orphaned session to a current lecture:
                        </div>
                        {orphanedSessionsForManual.map(({ oldKey, sample, sessions }) => {
                          const allSessions = Array.isArray(sessions) ? sessions : [sample];
                          const latest = [...allSessions].sort((a, b) => new Date(b?.date || 0) - new Date(a?.date || 0))[0] || sample;
                          
                          return (
                            <div key={oldKey} style={{
                              padding: "14px 16px",
                              border: "1.5px solid " + (t.border1 || "#e5e7eb"),
                              borderRadius: 10, marginBottom: 10,
                              background: t.cardBg || "white"
                            }}>
                              <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                                {sample?.sessionType && (
                                  <span style={{
                                    background: t.statusProgressBg || "#f0f7ff", color: t.statusProgress || "#2563eb",
                                    border: `1px solid ${t.statusProgress || "#2563eb"}`,
                                    borderRadius: 6, padding: "2px 10px",
                                    fontSize: 11, fontFamily: MONO, fontWeight: "bold"
                                  }}>
                                    {sample.sessionType.toUpperCase()}
                                  </span>
                                )}

                                {(sample?.lectureType || sample?.lectureNumber) && (
                                  <span style={{
                                    background: t.inputBg || "#f5f5f5", color: t.text2 || "#555",
                                    borderRadius: 6, padding: "2px 10px",
                                    fontSize: 11, fontFamily: MONO
                                  }}>
                                    {sample.lectureType}{sample.lectureNumber}
                                  </span>
                                )}

                                <span style={{
                                  fontFamily: MONO, fontSize: 12,
                                  color: sample?.score >= 70 ? (t.statusGood || "#10b981") : (t.statusWarn || "#f59e0b"),
                                  fontWeight: "bold"
                                }}>
                                  {sample?.score != null ? `${sample.score}%` : "No score"}
                                </span>

                                {latest?.date && (
                                  <span style={{ fontSize: 12, color: t.text3 || "#888", fontFamily: MONO }}>
                                    {new Date(latest.date).toLocaleDateString("en-US", { 
                                      weekday: "short", month: "short", day: "numeric" 
                                    })} at {new Date(latest.date).toLocaleTimeString("en-US", { 
                                      hour: "numeric", minute: "2-digit" 
                                    })}
                                  </span>
                                )}

                                {allSessions.length > 1 && (
                                  <span style={{ fontSize: 12, color: t.text3 || "#888", fontFamily: MONO }}>
                                    {allSessions.length} sessions
                                  </span>
                                )}
                              </div>

                              {sample?.lectureName && (
                                <div style={{ 
                                  fontSize: 13, fontWeight: "bold", 
                                  color: t.text1 || "#333", marginBottom: 8 
                                }}>
                                  {sample.lectureName}
                                </div>
                              )}

                              {(sample?.confidenceLevel || sample?.nextReview) && (
                                <div style={{ 
                                  fontSize: 12, color: t.text3 || "#888", 
                                  fontFamily: MONO, marginBottom: 8 
                                }}>
                                  {sample.confidenceLevel && `Confidence: ${sample.confidenceLevel}`}
                                  {sample.confidenceLevel && sample.nextReview && " · "}
                                  {sample.nextReview && `Next review: ${new Date(sample.nextReview).toLocaleDateString()}`}
                                </div>
                              )}

                              <div style={{ 
                                fontSize: 10, color: t.text3 || "#bbb", 
                                fontFamily: MONO, marginBottom: 10,
                                wordBreak: "break-all"
                              }}>
                                key: {oldKey.split("__")[0].slice(0, 40)}…
                              </div>

                              <select
                                onChange={(e) => e.target.value && manuallyMapSession(oldKey, e.target.value)}
                                style={{ 
                                  width: "100%", padding: "8px 10px", 
                                  borderRadius: 8, border: "1.5px solid " + (t.border1 || "#ddd"),
                                  fontFamily: MONO, fontSize: 13,
                                  background: t.inputBg || "white", cursor: "pointer", color: t.text1
                                }}
                              >
                                <option value="">— Select matching lecture —</option>
                                {[...blockLecsForManual]
                                  .sort((a, b) => {
                                    const aMatch = a.lectureType === sample?.lectureType ? 0 : 1;
                                    const bMatch = b.lectureType === sample?.lectureType ? 0 : 1;
                                    return aMatch - bMatch || 
                                      (parseInt(a.lectureNumber) || 0) - (parseInt(b.lectureNumber) || 0);
                                  })
                                  .map(l => (
                                    <option key={l.id} value={l.id}>
                                      {l.lectureType}{l.lectureNumber} — {l.lectureTitle || l.title || l.filename || l.fileName || l.id}
                                    </option>
                                  ))
                                }
                              </select>

                              <button
                                type="button"
                                onClick={() => dismissOrphanedSession(oldKey)}
                                style={{
                                  marginTop: 8, padding: "4px 12px",
                                  background: "none", border: "none",
                                  color: t.text3 || "#bbb", fontSize: 11,
                                  fontFamily: MONO, cursor: "pointer"
                                }}
                              >
                                Skip — discard this session
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {objectiveQuizLoading && (
                    <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", borderRadius:12, zIndex:10 }}>
                      <Spinner msg="Generating objective quiz…" />
                    </div>
                  )}
                  <ObjectivesImporter
                    blockId={activeBlock?.id ?? blockId}
                    T={t}
                    tc={tc}
                    onImport={(objectives) => {
                      const bid = activeBlock?.id ?? blockId;
                      const blockLectures = lectures.filter((l) => l.blockId === bid);
                      const aligned =
                        blockLectures.length
                          ? alignObjectivesToLectures(bid, objectives, blockLectures)
                          : objectives;
                      const linked = aligned.filter((o) => o.hasLecture).length;
                      console.log(`Import aligned: ${linked}/${aligned.length} objectives linked`);
                      saveBlockObjectives(bid, { imported: aligned });
                    }}
                  />
                  {(() => {
                    const bid = activeBlock?.id ?? blockId;
                    const allObjs = getBlockObjectives(bid) || [];
                    const blockLecs = (lectures || []).filter((l) => l.blockId === bid);
                    const linked = allObjs.filter((o) => isObjectiveLinked(o, blockLecs)).length;
                    const unlinked = allObjs.length - linked;
                    if (!allObjs.length) return null;
                    return (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 14px",
                          borderRadius: 8,
                          marginBottom: 12,
                          background: linked === allObjs.length ? t.greenBg : t.amberBg,
                          border: "1px solid " + (linked === allObjs.length ? t.greenBorder : t.amberBorder),
                        }}
                      >
                        <span style={{ fontSize: 16 }}>
                          {linked === allObjs.length ? "✅" : "🔗"}
                        </span>
                        <div style={{ flex: 1 }}>
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 13,
                              fontWeight: 600,
                              color: linked === allObjs.length ? t.green : t.amber,
                            }}
                          >
                            {linked}/{allObjs.length} objectives linked to uploaded lectures
                          </span>
                          {unlinked > 0 && (
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 12,
                                color: t.text3,
                                marginLeft: 8,
                              }}
                            >
                              · {unlinked} unlinked (upload those lectures to connect them)
                            </span>
                          )}
                        </div>
                        {linked === allObjs.length && (
                          <span style={{ fontFamily: MONO, color: t.green, fontSize: 12 }}>
                            All synced ✓
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            repairObjectiveAlignment(activeBlock?.id ?? blockId);
                            setTimeout(() => {
                              const count = repairObjectiveAlignmentRepairedRef.current;
                              alert(
                                count > 0
                                  ? `✅ Fixed ${count} objective alignments`
                                  : "✓ All objectives already correctly aligned"
                              );
                            }, 0);
                          }}
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            padding: "5px 12px",
                            borderRadius: 6,
                            border: "1px solid " + t.border1,
                            background: t.inputBg,
                            color: t.text3,
                            cursor: "pointer",
                          }}
                        >
                          ↻ Fix Objective Alignment
                        </button>
                        <button
                          type="button"
                          onClick={resyncOrphanedPerformance}
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            padding: "5px 12px",
                            borderRadius: 6,
                            border: "none",
                            background: t.statusProgress || t.tc,
                            color: "white",
                            cursor: "pointer",
                          }}
                        >
                          ⟳ Resync Performance History
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              !confirm(
                                "This will clear all objectives for this block. " +
                                  "They will be re-extracted when you re-upload your PDFs. Continue?"
                              )
                            )
                              return;
                            const bid = activeBlock?.id ?? blockId;
                            setBlockObjectives((prev) => {
                              const next = { ...prev, [bid]: { imported: [], extracted: [] } };
                              try {
                                localStorage.setItem("rxt-block-objectives", JSON.stringify(next));
                              } catch {}
                              return next;
                            });
                          }}
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            padding: "5px 12px",
                            borderRadius: 6,
                            border: "1px solid " + t.statusBadBorder,
                            background: t.statusBadBg,
                            color: t.statusBad,
                            cursor: "pointer",
                          }}
                        >
                          🗑 Reset objectives (re-upload to fix alignment)
                        </button>
                      </div>
                    );
                  })()}
                  {(blockObjectives[blockId]?.imported || []).length === 0 && (
                    <div style={{ background:t.amberBg, border:"1px solid "+t.amberBorder, borderRadius:10, padding:"12px 16px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:18 }}>💡</span>
                      <div style={{ flex:1, fontFamily:MONO }}>
                        <div style={{ color:t.amber, fontSize:11, fontWeight:600 }}>Have your module objectives summary PDF?</div>
                        <div style={{ color:t.text3, fontSize:10, marginTop:1 }}>
                          Import it above for complete objective coverage with official codes. Objectives are auto-extracted from lecture PDFs as you upload them.
                        </div>
                      </div>
                    </div>
                  )}
                  <ObjectiveTracker
                    blockId={blockId}
                    blockLectures={blockLecs}
                    objectives={getBlockObjectives(blockId)}
                    onSelfRate={(id, status) => updateObjective(blockId, id, { status, lastTested: new Date().toISOString() })}
                    onStartObjectiveQuiz={startObjectiveQuiz}
                    termColor={tc}
                    T={t}
                  />
                </div>
              )}
              {tab==="analysis" && (
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <p style={{ fontFamily:MONO, color:t.text4, fontSize:12 }}>AI study plan based on your block performance.</p>
                    <Btn onClick={runAnalysis} color={tc} disabled={aLoading}>{aLoading?"Analyzing…":"↺ Run Analysis"}</Btn>
                  </div>
                  {analyses[blockId] ? (
                    <div style={{ background:t.alwaysDark, border:"1px solid " + t.alwaysDarkBorder, borderRadius:14, padding:28 }}>
                      <pre style={{ fontFamily:"Lora, Georgia, serif", color:t.alwaysDarkText, lineHeight:1.95, fontSize:14, whiteSpace:"pre-wrap" }}>{analyses[blockId]}</pre>
                    </div>
                  ) : (
                    <div style={{ ...CARD, border:"1px dashed " + t.border2, padding:50, textAlign:"center" }}>
                      <p style={{ fontFamily:MONO, color:t.text4, fontSize:12 }}>Complete sessions, then run analysis for a personalized study plan.</p>
                    </div>
                  )}
                  <div style={{ marginBottom: 24, padding: 16, background: t.inputBg, border: "1px solid " + t.border1, borderRadius: 10 }}>
                    <div style={{ fontFamily: MONO, color: t.text3, fontSize: 9, letterSpacing: 1.5, marginBottom: 10 }}>QUESTION STYLE PREFERENCES</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 20px" }}>
                      {[
                        { key: "longStems", label: "Long stems" },
                        { key: "hardDistractors", label: "Hard distractors" },
                        { key: "labValues", label: "Include lab values" },
                        { key: "firstAid", label: "First Aid references" },
                        { key: "explainWrong", label: "Explain wrong answers" },
                      ].map(({ key, label }) => (
                        <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 12, color: t.text2, cursor: "pointer" }}>
                          <input type="checkbox" checked={!!stylePrefs[key]} onChange={(e) => updateStylePref(key, e.target.checked)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const blockLecs = lectures.filter((l) => l.blockId === (activeBlock?.id ?? blockId));
                    const lecData = blockLecs.map((lec) => {
                      const perf = getLecPerf(lec, activeBlock?.id ?? blockId);
                      const blockObjs = getBlockObjectives(activeBlock?.id ?? blockId) || [];
                      const lecObjs = blockObjs.filter(
                        (o) =>
                          o.linkedLecId === lec.id ||
                          (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                      );
                      const mastered = lecObjs.filter((o) => o.status === "mastered").length;
                      const struggling = lecObjs.filter((o) => o.status === "struggling").length;
                      const untested = lecObjs.filter((o) => o.status === "untested").length;
                      const total = lecObjs.length;
                      const pct = getLecCompletion(lec, activeBlock?.id ?? blockId);
                      const sessions = perf?.sessions?.length || 0;
                      const lastScore = perf?.lastScore ?? perf?.sessions?.slice(-1)[0]?.score ?? null;
                      const lastStudied = perf?.lastStudied ?? perf?.sessions?.slice(-1)[0]?.date ?? null;
                      const status =
                        struggling > 0
                          ? "struggling"
                          : pct === 100
                            ? "mastered"
                            : sessions === 0
                              ? "untested"
                              : pct >= 70
                                ? "ok"
                                : "weak";
                      return {
                        lec,
                        pct,
                        mastered,
                        struggling,
                        untested,
                        total,
                        sessions,
                        lastScore,
                        lastStudied,
                        status,
                      };
                    }).sort((a, b) => {
                      const order = { struggling: 0, weak: 1, untested: 2, ok: 3, mastered: 4 };
                      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                    });

                    return (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontFamily: MONO, color: t.text3, fontSize: 9, letterSpacing: 1.5, marginBottom: 12 }}>
                          LECTURE PERFORMANCE
                        </div>
                        {lecData.map(({ lec, pct, mastered, struggling, untested, total, sessions, lastScore, lastStudied, status }) => (
                          <div
                            key={lec.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "12px 14px",
                              borderRadius: 10,
                              marginBottom: 6,
                              background:
                                status === "struggling"
                                  ? t.statusBadBg
                                  : status === "weak"
                                    ? t.statusWarnBg
                                    : status === "mastered"
                                      ? t.statusGoodBg
                                      : t.inputBg,
                              border:
                                "1px solid " +
                                (status === "struggling"
                                  ? t.statusBadBorder
                                  : status === "weak"
                                    ? t.statusWarnBorder
                                    : status === "mastered"
                                      ? t.statusGoodBorder
                                      : t.border1),
                            }}
                          >
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background:
                                  status === "struggling"
                                    ? t.statusBad
                                    : status === "weak"
                                      ? t.statusWarn
                                      : status === "mastered"
                                        ? t.statusGood
                                        : status === "untested"
                                          ? t.statusNeutral
                                          : t.statusProgress,
                                color: "#fff",
                                fontSize: 14,
                                fontWeight: 700,
                              }}
                            >
                              {status === "struggling"
                                ? "⚠"
                                : status === "mastered"
                                  ? "✓"
                                  : status === "untested"
                                    ? "○"
                                    : status === "weak"
                                      ? "△"
                                      : "◑"}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                {lecTypeBadge(lec.lectureType || "LEC")}
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    color: t.text1,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {lec.lectureTitle || lec.fileName}
                                </span>
                              </div>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                {total > 0 && (
                                  <>
                                    <span style={{ fontFamily: MONO, color: t.statusGood, fontSize: 10 }}>✓ {mastered}/{total} obj</span>
                                    {struggling > 0 && (
                                      <span style={{ fontFamily: MONO, color: t.statusBad, fontSize: 10 }}>⚠ {struggling} struggling</span>
                                    )}
                                    {untested > 0 && (
                                      <span style={{ fontFamily: MONO, color: t.statusNeutral, fontSize: 10 }}>○ {untested} untested</span>
                                    )}
                                  </>
                                )}
                                {sessions > 0 && (
                                  <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>
                                    {sessions} session{sessions !== 1 ? "s" : ""}
                                  </span>
                                )}
                                {lastStudied && (
                                  <span style={{ fontFamily: MONO, color: t.text3, fontSize: 10 }}>
                                    last {new Date(lastStudied).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              {lastScore != null && (
                                <div
                                  style={{
                                    fontFamily: MONO,
                                    fontWeight: 900,
                                    fontSize: 16,
                                    color:
                                      lastScore >= 80
                                        ? t.statusGood
                                        : lastScore >= 60
                                          ? t.statusProgress
                                          : lastScore >= 40
                                            ? t.statusWarn
                                            : t.statusBad,
                                  }}
                                >
                                  {lastScore}%
                                </div>
                              )}
                              <div
                                style={{
                                  width: 60,
                                  height: 4,
                                  background: t.border1,
                                  borderRadius: 2,
                                  marginTop: 4,
                                }}
                              >
                                <div
                                  style={{
                                    height: "100%",
                                    borderRadius: 2,
                                    width: pct + "%",
                                    background:
                                      pct >= 80
                                        ? t.statusGood
                                        : pct >= 50
                                          ? t.statusProgress
                                          : pct >= 30
                                            ? t.statusWarn
                                            : t.statusBad,
                                    transition: "width 0.4s",
                                  }}
                                />
                              </div>
                              <div style={{ fontFamily: MONO, color: t.text3, fontSize: 9, marginTop: 2 }}>{pct}% done</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              {true && (() => {
                const currentBlock = activeBlock;
                const blockObjs = getBlockObjectives(currentBlock?.id ?? blockId) || [];
                const blockLecsForProgress = lectures.filter((l) => l.blockId === (currentBlock?.id ?? blockId));
                const areas = computeWeakAreas(currentBlock?.id ?? blockId);
                const blockKey = "block__" + (currentBlock?.id ?? blockId);
                const blockPerf = performanceHistory[blockKey];
                const sessions = blockPerf?.sessions || [];
                const totalObjs = blockObjs.length;
                const masteredObjs = blockObjs.filter(o=>o.status==="mastered").length;
                const strugglingObjs = blockObjs.filter(o=>o.status==="struggling").length;
                const untestedObjs = blockObjs.filter(o=>o.status==="untested").length;
                const inprogressObjs = blockObjs.filter(o=>o.status==="inprogress").length;
                const totalSessions = sessions.length;
                const avgScore = sessions.length ? Math.round(sessions.reduce((a,s)=>a+s.score,0)/sessions.length) : 0;
                const trend = blockPerf?.trend || "stable";
                const currentLevel = blockPerf?.currentDifficulty || "medium";
                const blockKeyForLog = "block__" + (currentBlock?.id ?? blockId);
                const studyLog = Object.entries(performanceHistory)
                  .filter(([k]) =>
                    k === blockKeyForLog ||
                    k.startsWith((currentBlock?.id ?? blockId) + "__") ||
                    blockLecsForProgress.some((l) => k.startsWith(l.id))
                  )
                  .flatMap(([key, perf]) =>
                    (perf.sessions || []).map((s) => ({
                      ...s,
                      topicKey: key,
                      label: resolveTopicLabel(key, s, s.blockId ?? currentBlock?.id ?? blockId),
                    }))
                  )
                  .sort((a, b) => new Date(b.date) - new Date(a.date))
                  .slice(0, 15);

                const upcomingReviews = Object.entries(performanceHistory)
                  .filter(([k, v]) => {
                    if (!v.nextReview) return false;
                    const inBlock =
                      k === blockKey ||
                      k === blockKeyForLog ||
                      k.startsWith((currentBlock?.id ?? blockId) + "__") ||
                      blockLecsForProgress.some((lec) => k.startsWith(lec.id));
                    return inBlock;
                  })
                  .map(([key, v]) => {
                    const next = new Date(v.nextReview);
                    const diffMs = next.getTime() - Date.now();
                    const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    const lastSession = v.sessions?.slice(-1)?.[0];
                    return {
                      key,
                      label: resolveTopicLabel(key, lastSession, currentBlock?.id ?? blockId),
                      nextReview: next,
                      daysUntil,
                      confidence: v.confidenceLevel,
                      postScore: v.postMCQScore,
                    };
                  })
                  .filter((r) => !Number.isNaN(r.daysUntil))
                  .sort((a, b) => a.daysUntil - b.daysUntil)
                  .slice(0, 5);
                return (
                  <div style={{ padding:"20px 24px", overflowY:"auto", display:"flex", flexDirection:"column", gap:20 }}>
                    <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                      {[
                        { label:"Sessions", val:totalSessions, color:t.blue },
                        { label:"Avg Score", val:avgScore+"%", color:avgScore>=80?t.green:avgScore>=60?t.amber:t.red },
                        { label:"Level", val:currentLevel.toUpperCase(), color:{easy:t.green,medium:t.amber,hard:t.red,expert:t.purple}[currentLevel] || t.text1 },
                        { label:"Streak", val:"🔥"+(blockPerf?.streak||0), color:t.amber },
                        { label:"Trend", val:trend==="improving"?"↑ Improving":trend==="declining"?"↓ Declining":"→ Stable", color:trend==="improving"?t.green:trend==="declining"?t.red:t.text3 },
                      ].map(kpi => (
                        <div key={kpi.label} style={{ flex:"1 1 100px", background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"14px 16px", textAlign:"center" }}>
                          <div style={{ fontFamily:MONO, color:kpi.color, fontSize:20, fontWeight:900 }}>{kpi.val}</div>
                          <div style={{ fontFamily:MONO, color:t.text3, fontSize:10, marginTop:3 }}>{kpi.label}</div>
                        </div>
                      ))}
                    </div>
                    {sessions.length >= 2 && (
                      <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, letterSpacing:1.5, marginBottom:12 }}>SCORE HISTORY</div>
                        <svg width="100%" height="60" style={{ overflow:"visible" }}>
                          {sessions.slice(-12).map((s, i, arr) => {
                            const x = (i / (arr.length-1||1)) * 100;
                            const y = 55 - (s.score/100)*50;
                            const c = s.score>=80?t.green:s.score>=60?t.amber:t.red;
                            return (
                              <g key={i}>
                                {i>0 && (() => {
                                  const px = ((i-1)/(arr.length-1||1))*100;
                                  const py = 55-(arr[i-1].score/100)*50;
                                  return <line x1={px+"%"} y1={py} x2={x+"%"} y2={y} stroke={t.border1} strokeWidth="2"/>;
                                })()}
                                <circle cx={x+"%"} cy={y} r="5" fill={c}/>
                                <text x={x+"%"} y={y-10} textAnchor="middle" style={{fontFamily:MONO,fontSize:9,fill:t.text3}}>{s.score}%</text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    )}
                    {upcomingReviews.length > 0 && (
                      <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, letterSpacing:1.5, marginBottom:12 }}>DUE FOR REVIEW (DEEP LEARN)</div>
                        {upcomingReviews.map((r, i) => (
                          <div key={r.key} style={{ display:"flex", alignItems:"center", gap:12, padding:"6px 0", borderBottom:i<upcomingReviews.length-1?"1px solid "+t.border2:"none" }}>
                            <div style={{ flex:1, fontFamily:MONO, color:t.text1, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {r.label}
                            </div>
                            <div style={{ fontFamily:MONO, color:t.text3, fontSize:10, minWidth:80, textAlign:"right" }}>
                              {r.daysUntil <= 0 ? "Today" : r.daysUntil === 1 ? "Tomorrow" : `In ${r.daysUntil} days`}
                            </div>
                            {r.postScore != null && (
                              <div style={{ fontFamily:MONO, fontSize:12, fontWeight:700, minWidth:40, textAlign:"right", color:r.postScore>=80?t.green:r.postScore>=60?t.amber:t.red }}>
                                {r.postScore}%
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"16px 20px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                        <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, letterSpacing:1.5 }}>OBJECTIVE MASTERY</div>
                        <div style={{ fontFamily:MONO, color:tc, fontSize:12, fontWeight:700 }}>{totalObjs ? Math.round(masteredObjs/Math.max(totalObjs,1)*100) : 0}% mastered</div>
                      </div>
                      <div style={{ height:12, borderRadius:6, overflow:"hidden", display:"flex", marginBottom:10 }}>
                        {[{val:masteredObjs, color:t.green},{val:inprogressObjs, color:t.amber},{val:strugglingObjs, color:t.red},{val:untestedObjs, color:t.border1}].map((s,i) => (
                          <div key={i} style={{ width:(s.val/Math.max(totalObjs,1)*100)+"%", background:s.color, transition:"width 0.5s" }}/>
                        ))}
                      </div>
                      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                        {[{label:"Mastered", val:masteredObjs, color:t.green},{label:"In Progress", val:inprogressObjs, color:t.amber},{label:"Struggling", val:strugglingObjs, color:t.red},{label:"Untested", val:untestedObjs, color:t.text3}].map(s => (
                          <div key={s.label} style={{display:"flex",alignItems:"center",gap:5}}>
                            <div style={{width:8,height:8,borderRadius:2,background:s.color}}/>
                            <span style={{fontFamily:MONO,color:s.color,fontSize:13,fontWeight:700}}>{s.val}</span>
                            <span style={{fontFamily:MONO,color:t.text3,fontSize:10}}>{s.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {studyLog.length > 0 && (
                      <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, letterSpacing:1.5, marginBottom:12 }}>RECENT STUDY ACTIVITY</div>
                        {studyLog.map((entry, i) => (
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom: i<studyLog.length-1?"1px solid "+t.border2:"none" }}>
                            <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:entry.score>=80?t.green:entry.score>=60?t.amber:t.red }}/>
                            <div style={{ flex:1 }}>
                              <div style={{ fontFamily:MONO, color:t.text1, fontSize:12 }}>{entry.label}</div>
                              <div style={{ fontFamily:MONO, color:t.text3, fontSize:10 }}>{new Date(entry.date).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · {entry.questionCount||"?"} questions · {entry.difficulty||"medium"}</div>
                            </div>
                            <div style={{ fontFamily:MONO, fontWeight:700, fontSize:14, color:entry.score>=80?t.green:entry.score>=60?t.amber:t.red }}>{Math.round(entry.score)}%</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"16px 20px" }}>
                      <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, letterSpacing:1.5, marginBottom:12 }}>LECTURE BREAKDOWN</div>
                      {blockLecsForProgress.map(lec => {
                        const lecObjs = blockObjs.filter(
                          (o) =>
                            o.linkedLecId === lec.id ||
                            (lec.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
                        );
                        const lecPerf = Object.entries(performanceHistory).filter(([k])=>k.startsWith(lec.id)).flatMap(([,v])=>v.sessions||[]);
                        const lastScore = lecPerf.slice(-1)[0]?.score;
                        const mastered = lecObjs.filter(o=>o.status==="mastered").length;
                        const total = lecObjs.length;
                        const pct = total>0 ? Math.round(mastered/total*100) : 0;
                        const sessCount = lecPerf.length;
                        return (
                          <div key={lec.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid "+t.border2 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              {lecTypeBadge(lec.lectureType)}
                              {lec.lectureNumber != null && <span style={{ fontFamily:MONO, color:tc, fontSize:12, fontWeight:700 }}>{lec.lectureNumber}</span>}
                            </div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontFamily:MONO, color:t.text1, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:220 }}>
                                {(() => {
                                  const title = (lec.lectureTitle || "").trim();
                                  const fileName = (lec.fileName || lec.filename || "").replace(/\.pdf$/i, "").trim();
                                  if (title && title.toLowerCase() !== fileName.toLowerCase()) return title;
                                  return title || fileName;
                                })()}
                              </div>
                              <div style={{ height:4, background:t.border1, borderRadius:2, marginTop:4 }}>
                                <div style={{ height:"100%", borderRadius:2, background:pct===100?t.green:tc, width:pct+"%", transition:"width 0.4s" }}/>
                              </div>
                            </div>
                            <div style={{ textAlign:"right", minWidth:60 }}>
                              <div style={{ fontFamily:MONO, fontSize:13, fontWeight:700, color:lastScore>=80?t.green:lastScore>=60?t.amber:lastScore?t.red:t.text3 }}>{lastScore!=null?lastScore+"%":"—"}</div>
                              <div style={{ fontFamily:MONO, color:t.text3, fontSize:10 }}>{sessCount} session{sessCount!==1?"s":""}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
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
              <h1 style={{ fontFamily:SERIF, fontSize:30, fontWeight:900, letterSpacing:-1, color:t.text1 }}>Global <span style={{ color:t.purple }}>Analytics</span></h1>
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
    {perfToast && (
      <div style={{
        position:"fixed", bottom:24, right:24, zIndex:9999,
        background:t.cardBg, border:"1px solid "+perfToast.color, borderLeft:"4px solid "+perfToast.color,
        borderRadius:12, padding:"14px 18px", minWidth:320, maxWidth:360, boxShadow:t.shadowMd,
        animation:"slideUp 0.3s ease",
      }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:SERIF, color:perfToast.color, fontSize:16, fontWeight:700, marginBottom:3 }}>{perfToast.title}</div>
            <div style={{ fontFamily:MONO, color:t.text2, fontSize:13, lineHeight:1.5 }}>{perfToast.message}</div>
          </div>
          <button onClick={() => setPerfToast(null)} style={{ background:"none", border:"none", color:t.text3, cursor:"pointer", fontSize:16, padding:0, flexShrink:0 }}>✕</button>
        </div>
        <div style={{ marginTop:10, height:2, background:t.border1, borderRadius:1 }}>
          <div style={{ height:"100%", background:perfToast.color, borderRadius:1, animation:"shrink 6s linear forwards" }}/>
        </div>
      </div>
    )}
    </ThemeContext.Provider>
  );
}

