import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Tracker from "./Tracker";
import LearningModel from "./LearningModel.jsx";
import DeepLearn from "./DeepLearn";
import ObjectiveTracker from "./ObjectiveTracker";
import { loadPDFJS, parseExamPDF } from "./examParser";
import { loadProfile, saveProfile, recordAnswer } from "./learningModel";
import { ThemeContext, useTheme, themes } from "./theme";
import FTM2_DATA from "./ftm2_objectives_full.json";

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
    const matched = lectures.find((lec) => {
      if (obj.lectureNumber && lec.lectureNumber) {
        if (String(obj.lectureNumber) === String(lec.lectureNumber)) return true;
      }
      if (obj.activity && lec.lectureNumber) {
        const actNum = parseInt((obj.activity || "").replace(/\D/g, ""), 10);
        if (actNum && actNum === lec.lectureNumber) return true;
      }
      if (obj.lectureTitle && (lec.lectureTitle || lec.filename)) {
        const objTitle = (obj.lectureTitle || "").toLowerCase().slice(0, 25);
        const lecTitle = (lec.lectureTitle || lec.filename || "").toLowerCase();
        if (objTitle.length > 5 && lecTitle.includes(objTitle)) return true;
      }
      if (obj.lectureNumber && (lec.filename || lec.fileName)) {
        const fn = (lec.filename || lec.fileName || "").toLowerCase();
        const n = String(obj.lectureNumber);
        if (
          fn.includes("lecture" + n) ||
          fn.includes("lec" + n) ||
          fn.includes("lec_" + n) ||
          fn.includes("l" + n + "_") ||
          fn.includes("_" + n + "_")
        )
          return true;
      }
      return false;
    });

    return {
      ...obj,
      linkedLecId: matched?.id || obj.linkedLecId || null,
      linkedLecName: matched?.lectureTitle || matched?.filename || matched?.fileName || obj.linkedLecName || null,
      hasLecture: !!matched,
    };
  });
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
    `{"questions":[{"stem":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveId":"...","topic":"...","difficulty":"${difficulty || "medium"}"}]}`
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

async function extractObjectivesFromLecture(file) {
  if (!GEMINI_KEY) return [];
  try {
    await loadPDFJS();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
    const lecNum = parsed.lectureNumber ?? null;
    const lecTitle = parsed.lectureTitle || file.name;
    const discipline = parsed.discipline || "Unknown";
    return (parsed.objectives || [])
      .filter((o) => typeof o === "string" && o.length > 10)
      .map((obj, i) => ({
        id: `extracted_${Date.now()}_${i}`,
        activity: lecNum ? "Lec" + lecNum : "Unknown",
        lectureNumber: lecNum,
        lectureType: "Lecture",
        discipline,
        lectureTitle: lecTitle,
        code: null,
        objective: obj.trim(),
        status: "untested",
        confidence: 0,
        lastTested: null,
        quizScore: null,
        source: "extracted",
      }));
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
  const lectureContent = (fromChunks || lec.fullText || "")
    .slice(0, 8000);

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
      o.lectureNumber === lec.lectureNumber ||
      (o.lectureTitle || "").toLowerCase().includes((lec.lectureTitle || "").toLowerCase().slice(0, 20))
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
  const { lectures = [], getBlockObjectives, getTopicDifficulty, sessions = [], performanceHistory: perfHistory = {} } = deps || {};
  const { lectureContent, questionExamples, objectives, patterns, lec } = buildLectureContext(
    lectureId,
    subtopic,
    blockId,
    { lecs: lectures, getBlockObjectives }
  );

  const topicKey = (lectureId || blockId) + "__" + (subtopic || "full");
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

  const prompt =
    `Generate ${count} questions on "${subtopic}" from ${lec?.lectureTitle || subtopic}.\n\n` +
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
  if (!T) return { fg: "#6b7280", bg: "#0d1829", border: "#1a2a3a", label: "Untested" };
  if (p === null) return { fg: T.text4, bg: T.border2, border: T.border1, label: "Untested" };
  if (p >= 80) return { fg: T.green, bg: T.greenBg, border: T.greenBorder, label: "Strong" };
  if (p >= 60) return { fg: T.amber, bg: T.amberBg, border: T.amberBorder, label: "Moderate" };
  return { fg: T.red, bg: T.redBg, border: T.redBorder, label: "Weak" };
}

function blockStatus(T) {
  return {
    complete: { color: T.green, icon: "✓", label: "Completed" },
    active: { color: T.amber, icon: "◉", label: "In Progress" },
    upcoming: { color: T.text4, icon: "○", label: "Upcoming" },
  };
}

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
      <div style={{ width:44, height:44, border:"3px solid " + T.border1, borderTopColor:T.red, borderRadius:"50%", animation:"rxt-spin 0.85s linear infinite" }} />
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
function SessionConfig({ cfg, onStart, onBack, termColor, getTopicDifficulty, performanceHistory = {} }) {
  const { T } = useTheme();
  const topicKey = cfg.mode === "lecture" && cfg.lecture ? cfg.lecture.id + "__" + (cfg.subtopic || "full") : "block__" + (cfg.blockId || "");
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
    { value: "easy", label: "Easy", desc: "Foundational concepts", color: T.green },
    { value: "medium", label: "Medium", desc: "Standard Step 1 level", color: T.amber },
    { value: "hard", label: "Hard", desc: "Challenging distractors", color: T.red },
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
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14, color: storedDiff === "expert" ? "#a78bfa" : storedDiff === "hard" ? T.red : storedDiff === "medium" ? T.amber : T.green }}>
                  {storedDiff.toUpperCase()}
                </span>
                {storedPerf.streak >= 1 && (
                  <span style={{ fontFamily: MONO, color: T.amber, fontSize: 12 }}>🔥 {storedPerf.streak} streak</span>
                )}
                {storedPerf.trend === "improving" && (
                  <span style={{ fontFamily: MONO, color: T.green, fontSize: 12 }}>↑ improving</span>
                )}
                {storedPerf.trend === "declining" && (
                  <span style={{ fontFamily: MONO, color: T.red, fontSize: 12 }}>↓ needs work</span>
                )}
              </div>
            </div>
            <svg width="80" height="28" style={{ flexShrink: 0 }}>
              {storedPerf.sessions.slice(-5).map((s, i, arr) => {
                const x = (i / (arr.length - 1 || 1)) * 72 + 4;
                const y = 24 - (s.score / 100) * 20;
                const c = s.score >= 80 ? T.green : s.score >= 60 ? T.amber : T.red;
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
              background: T.redBg,
              color: T.red,
              border: "1px solid " + T.redBorder,
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
              background: T.greenBg,
              color: T.green,
              border: "1px solid " + T.greenBorder,
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
                  border: "1px solid " + (isCorrect ? T.green : isYours ? T.red : T.border1),
                  background: isCorrect ? T.greenBg : isYours ? T.redBg : T.cardBg,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 15,
                    flexShrink: 0,
                    marginTop: 1,
                    color: isCorrect ? T.green : isYours ? T.red : T.text3,
                  }}
                >
                  {letter} {isCorrect ? "✓" : isYours ? "✗" : ""}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 15,
                    color: isCorrect ? T.green : isYours ? T.red : T.text2,
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
            <div style={{ fontFamily: MONO, color: T.green, fontSize: 11, letterSpacing: 2, marginBottom: 10 }}>
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
      <div style={{ fontFamily: MONO, color: T.red, fontSize: 15, marginBottom: 16, fontWeight: 600 }}>
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
            <div key={i} style={{ width: 38, height: 38, borderRadius: 9, background: r.ok ? T.greenBg : T.redBg, border: "2px solid " + (r.ok ? T.green : T.red), display: "flex", alignItems: "center", justifyContent: "center", color: r.ok ? T.green : T.red, fontSize: 17 }}>
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
                border: "1px solid " + T.red,
                color: T.red,
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
  const dColor = { easy: T.green, medium: T.amber, hard: T.red, expert: "#a78bfa" };
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
                <div style={{ fontFamily:MONO, color:T.green, fontSize:11, marginBottom:8, letterSpacing:1 }}>
                  ✓ ANSWER — ANNOTATED SLIDE
                </div>
                <div style={{ background: T.cardBg, borderRadius: 12, overflow: "hidden", border: "1px solid " + T.greenBorder }}>
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
            if (letter === v.correct)     { bg = T.greenBg; border = T.green; color = T.green; }
            else if (letter === sel)      { bg = T.redBg; border = T.red; color = T.red; }
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
                    background: "none", border: "1px solid " + T.border1, color: isEliminated ? T.red : T.text3,
                    cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.red; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = isEliminated ? T.red : T.border1; }}
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
                {shown && letter === v.correct && <span style={{ color: T.green }}>✓</span>}
                {shown && letter === sel && letter !== v.correct && <span style={{ color: T.red }}>✗</span>}
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
          : <Btn onClick={next} color={T.green}>{idx+1>=vigs.length ? "Finish ✓" : "Next →"}</Btn>
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
  const TYPES = ["Lecture", "DLA", "Lab"];
  const MONO = "'DM Mono','Courier New',monospace";
  const cycle = (e) => {
    e.stopPropagation();
    const next = TYPES[(TYPES.indexOf(value || "Lecture") + 1) % TYPES.length];
    onChange(next);
  };
  const colors = { Lecture: tc, DLA: T.green, Lab: T.amber };
  const c = colors[value || "Lecture"] || tc;
  return (
    <span
      onClick={cycle}
      title="Click to change type"
      style={{
        fontFamily: MONO,
        color: c,
        background: c + "18",
        border: "1px solid " + c + "30",
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 3,
        cursor: "pointer",
        flexShrink: 0,
        letterSpacing: 0.5,
        transition: "all 0.15s",
      }}
    >
      {(value || "LEC").slice(0, 3).toUpperCase()}
    </span>
  );
}

// ─────────────────────────────────────────────
// LECTURE LIST ROW (compact list view)
// ─────────────────────────────────────────────
function LecListRow({ lec, index, tc, T, sessions, onOpen, isExpanded, onClose, onStart, onDeepLearn, onUpdateLec, mergeMode, mergeSelected = [], onMergeToggle, allObjectives, allBlockObjectives, updateObjective, currentBlock, startObjectiveQuiz }) {
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'Playfair Display',Georgia,serif";
  const [quizLoading, setQuizLoading] = useState(false);

  const lecSessions = (sessions || []).filter(s => s.lectureId === lec.id);
  const overall = getScore(sessions, s => s.lectureId === lec.id);
  const sessionCount = lecSessions.length;
  const isMergeSelected = mergeSelected.includes(lec.id);
  const objectivesList = allBlockObjectives ?? allObjectives ?? [];
  const lecObjs = objectivesList.filter((o) =>
    o.lectureNumber === lec.lectureNumber ||
    (o.lectureTitle && lec.lectureTitle && lec.lectureTitle.toLowerCase().includes((o.lectureTitle || "").toLowerCase().slice(0, 15))) ||
    o.linkedLecId === lec.id ||
    (o.activity && lec.lectureNumber && (o.activity || "").replace(/\D/g, "") === String(lec.lectureNumber))
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
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: tc, flexShrink: 0 }} />
        <span style={{ fontFamily: MONO, color: T.text1, fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {lec.lectureTitle || lec.filename}
        </span>
        {lec.isMerged && (
          <span title={"Merged from: " + (lec.mergedFrom || []).map(m => m.title).join(", ")} style={{ fontFamily: MONO, color: T.amber, background: T.amberBg, border: "1px solid " + T.amberBorder, fontSize: 10, padding: "1px 7px", borderRadius: 3, letterSpacing: 0.5, flexShrink: 0 }}>MERGED</span>
        )}
        {lec.subject && (
          <span style={{ fontFamily: MONO, color: tc, background: tc + "18", border: "1px solid " + tc + "30", fontSize: 11, padding: "2px 8px", borderRadius: 4, flexShrink: 0 }}>
            {lec.subject}
          </span>
        )}
        {sessionCount > 0 && (
          <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, flexShrink: 0 }}>
            {sessionCount} session{sessionCount !== 1 ? "s" : ""}
          </span>
        )}
        {overall !== null && (
          <span style={{ fontFamily: MONO, fontSize: 12, flexShrink: 0, fontWeight: 700, color: overall >= 80 ? T.green : overall >= 65 ? T.amber : T.red }}>
            {overall}%
          </span>
        )}
        {lecObjs.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <div style={{ width: 40, height: 5, background: T.border1, borderRadius: 2 }}>
              <div style={{ width: (masteredObjs / lecObjs.length) * 100 + "%", height: "100%", background: masteredObjs === lecObjs.length ? T.green : tc, borderRadius: 2 }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11, color: masteredObjs === lecObjs.length ? T.green : T.text3 }}>
              {masteredObjs}/{lecObjs.length}
            </span>
            {strugglingObjs > 0 && (
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.red }}>⚠{strugglingObjs}</span>
            )}
          </div>
        )}
        <span style={{ color: T.text3, fontSize: 13, flexShrink: 0, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>
          ▾
        </span>
      </div>

      {isExpanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid " + T.border1 }}>
          <div style={{ padding: "12px 0 10px" }}>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>SUBTOPICS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(lec.subtopics || []).map((sub, si) => (
                <button
                  key={si}
                  type="button"
                  onClick={() => onStart(lec, sub)}
                  style={{
                    background: T.inputBg,
                    border: "1px solid " + T.border1,
                    color: T.text2,
                    padding: "5px 12px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontFamily: MONO,
                    fontSize: 13,
                    transition: "all 0.15s",
                    textAlign: "left",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = tc; e.currentTarget.style.color = tc; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border1; e.currentTarget.style.color = T.text2; }}
                >
                  ▶ {sub}
                </button>
              ))}
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
                String(o.lectureNumber) === String(lec.lectureNumber) ||
                o.linkedLecId === lec.id ||
                (o.activity && lec.lectureNumber && (o.activity || "").replace(/\D/g, "") === String(lec.lectureNumber))
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
                    {mastered > 0 && <span style={{ fontFamily: MONO, color: T.green, fontSize: 11 }}>✓ {mastered}</span>}
                    {struggling > 0 && <span style={{ fontFamily: MONO, color: T.red, fontSize: 11 }}>⚠ {struggling}</span>}
                    {untested > 0 && <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>○ {untested}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {expandedObjs.map((obj, i) => {
                    const statusColor = { mastered: T.green, struggling: T.red, inprogress: T.amber, untested: T.text3 }[obj.status] || T.text3;
                    const statusIcon = { mastered: "✓", struggling: "⚠", inprogress: "◐", untested: "○" }[obj.status] || "○";
                    return (
                      <div
                        key={obj.id || i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "6px 10px",
                          borderRadius: 7,
                          background: T.inputBg,
                          border: "1px solid " + T.border2,
                        }}
                      >
                        <span
                          onClick={() => {
                            if (!updateObjective || !currentBlock?.id) return;
                            const next = { untested: "inprogress", inprogress: "mastered", mastered: "struggling", struggling: "untested" }[obj.status] || "inprogress";
                            updateObjective(currentBlock.id, obj.id, { status: next });
                          }}
                          title="Click to cycle status"
                          style={{ color: statusColor, fontSize: 15, flexShrink: 0, cursor: updateObjective ? "pointer" : "default", paddingTop: 1, transition: "transform 0.1s" }}
                          onMouseEnter={(e) => updateObjective && (e.currentTarget.style.transform = "scale(1.3)")}
                          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                        >
                          {statusIcon}
                        </span>
                        <span style={{ fontFamily: MONO, color: T.text1, fontSize: 12, lineHeight: 1.55, flex: 1 }}>{obj.objective}</span>
                        {obj.code && (
                          <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, flexShrink: 0, paddingTop: 3, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {obj.code}
                          </span>
                        )}
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
                      style={{ background: T.greenBg, border: "1px solid " + T.greenBorder, color: T.green, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: 12 }}
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
            <button
              type="button"
              onClick={onDeepLearn}
              style={{ flex: 1, background: "none", border: "1px solid " + tc + "40", color: tc, padding: "7px 0", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: 12, transition: "all 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.background = tc + "12")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              🧬 Deep Learn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// LECTURE CARD
// ─────────────────────────────────────────────
function LecCard({ lec, sessions, accent, tint, onStudy, onDelete, onUpdateLec, onDeepLearn, mergeMode, mergeSelected = [], onMergeToggle, allObjectives }) {
  const { T } = useTheme();
  const tc = tint || accent || "#ef4444";
  const [confirming, setConfirming] = useState(false);
  const confirmTimeoutRef = useRef(null);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicDraft, setNewTopicDraft] = useState("");
  const addTopicRef = useRef();
  const isMergeSelected = mergeSelected.includes(lec.id);
  const lecObjs = (allObjectives || []).filter((o) =>
    o.lectureNumber === lec.lectureNumber ||
    (o.lectureTitle && lec.lectureTitle && lec.lectureTitle.toLowerCase().includes((o.lectureTitle || "").toLowerCase().slice(0, 15)))
  );
  const masteredObjs = lecObjs.filter((o) => o.status === "mastered").length;
  const strugglingObjs = lecObjs.filter((o) => o.status === "struggling").length;

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
            <button onClick={doDelete} style={{ background:T.redBg, border:"1px solid "+T.redBorder, color:T.red, padding:"4px 10px", borderRadius:6, cursor:"pointer", fontFamily:MONO, fontSize:11 }}>Delete</button>
          </>
        ) : (
          <button onClick={startConfirm} style={{ background:T.border1, border:"1px solid " + T.text5, color:T.text5, cursor:"pointer", fontSize:12, width:24, height:24, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center" }} title="Delete lecture">✕</button>
        )}
      </div>

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
        </div>
          <div style={{ marginBottom: 2 }}>
            <EditableText
              value={lec.subject}
              onChange={newSubject => onUpdateLec(lec.id, { subject: newSubject })}
              style={{ fontFamily: SERIF, color: tc, fontWeight: 700, fontSize: 16 }}
              placeholder="Click to set subject"
            />
          </div>
          <div style={{ marginBottom: 2 }}>
            <EditableText
              value={lec.lectureTitle}
              onChange={newTitle => onUpdateLec(lec.id, { lectureTitle: newTitle })}
              style={{ fontFamily: MONO, color: T.text1, fontSize: 14 }}
              placeholder="Click to set title"
            />
          </div>
          <div style={{ fontFamily: MONO, color: T.text3, fontSize: 14, marginTop: 2 }}>{lec.filename}</div>
        </div>
        <Ring score={overall} size={52} tint={tc} />
      </div>

      {overall !== null && (
        <div style={{ height: 5, background: T.border1, borderRadius: 2 }}>
          <div style={{ width: overall + "%", height: "100%", background: tc, borderRadius: 2, transition: "width 1s" }} />
        </div>
      )}

      {lecObjs.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 40, height: 5, background: T.border1, borderRadius: 2 }}>
            <div style={{ width: (masteredObjs / lecObjs.length) * 100 + "%", height: "100%", background: masteredObjs === lecObjs.length ? T.green : tc, borderRadius: 2 }} />
          </div>
          <span style={{ fontFamily: MONO, fontSize: 11, color: masteredObjs === lecObjs.length ? T.green : T.text3 }}>
            {masteredObjs}/{lecObjs.length}
          </span>
          {strugglingObjs > 0 && (
            <span style={{ fontFamily: MONO, fontSize: 11, color: T.red }}>⚠{strugglingObjs}</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {(lec.keyTerms || []).slice(0, 5).map(kt => (
          <span key={kt} style={{ fontFamily: MONO, background: T.border1, color: T.text2, fontSize: 13, padding: "2px 8px", borderRadius: 20 }}>{kt}</span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {(lec.subtopics || []).map(sub => {
          const sp = getScore(sessions, s => s.lectureId === lec.id && s.subtopic === sub);
          const m = mastery(sp, T);
          return (
            <div
              key={sub}
              onClick={() => onStudy(lec, sub)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: T.cardBg,
                border: "1px solid " + T.border1,
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                transition: "padding-left 0.1s, border-color 0.1s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = tc;
                e.currentTarget.style.paddingLeft = "16px";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = T.border1;
                e.currentTarget.style.paddingLeft = "12px";
              }}
            >
              <span style={{ fontFamily: MONO, color: T.text1, fontSize: 14 }}>{sub}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: MONO, color: m.fg, fontWeight: 700, fontSize: 16 }}>{sp !== null ? sp + "%" : "—"}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onUpdateLec(lec.id, { subtopics: (lec.subtopics || []).filter(s => s !== sub) }); }}
                  style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 14, padding: 2, lineHeight: 1 }}
                  title="Remove topic"
                >
                  ✕
                </button>
                <span style={{ color: T.text3, fontSize: 13 }}>▶</span>
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
            <button type="button" onClick={() => { const t = newTopicDraft.trim(); if (t) { onUpdateLec(lec.id, { subtopics: [...(lec.subtopics || []), t] }); setNewTopicDraft(""); } setAddingTopic(false); }} style={{ background: tc, border: "none", color: T.text1, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: MONO, fontSize: 13 }}>Add</button>
      </div>
        ) : (
          <button type="button" onClick={() => setAddingTopic(true)} style={{ background:T.border1, border:"1px dashed "+T.text5, color:T.text5, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontFamily:MONO, fontSize:11, textAlign:"left" }}>+ Add Topic</button>
        )}
      </div>
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
      {onDeepLearn && (
        <button
          type="button"
          onClick={() => onDeepLearn(lec)}
          style={{
            marginTop: 6,
            width: "100%",
            background: tc + "12",
            border: "1px solid " + tc + "40",
            color: tc,
            padding: "7px 0",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 13,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = tc + "22")}
          onMouseLeave={(e) => (e.currentTarget.style.background = tc + "12")}
        >
          🧬 Deep Learn
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// HEATMAP
// ─────────────────────────────────────────────
function Heatmap({ lectures, sessions, onStudy }) {
  const { T } = useTheme();
  if (!lectures.length) return (
    <div style={{ background:T.cardBg, border:"1px dashed " + T.border1, borderRadius:14, padding:50, textAlign:"center", boxShadow:T.shadowSm }}>
      <p style={{ fontFamily:MONO, color:T.text3, fontSize:12 }}>Upload lectures to see the heatmap.</p>
    </div>
  );
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {lectures.map((lec, li) => {
        const overall = getScore(sessions, s => s.lectureId===lec.id);
        const m = mastery(overall, T);
        const ac = PALETTE[li % PALETTE.length];
        return (
          <div key={lec.id} style={{ background:T.cardBg, border:"1px solid "+T.border1, borderRadius:12, padding:16, boxShadow:T.shadowSm }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div>
                <span style={{ fontFamily:MONO, color:ac, fontSize:12, fontWeight:600 }}>{lec.lectureTitle}</span>
                <span style={{ fontFamily:MONO, color:T.text3, fontSize:12, marginLeft:8 }}>{lec.subject}</span>
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
                    style={{ background:T.cardBg, border:"1px solid "+T.border1, borderRadius:7, padding:"7px 11px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color 0.1s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=ac; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=T.border1; }}>
                    <span style={{ fontFamily:MONO, color:T.text1, fontSize:11 }}>{sub}</span>
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
// EXAM CONFIG MODAL
// ─────────────────────────────────────────────
function ExamConfigModal({ config, blockObjs, blockLecs, questionBanksByFile, performanceHistory, onStart, onCancel, T, tc }) {
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

  const defaultSelected = useMemo(() => {
    if (mode === "weak") {
      return lectureGroups.filter((g) => g.objectives.some((o) => o.status === "struggling" || o.status === "untested")).map((g) => g.activity);
    }
    return lectureGroups.map((g) => g.activity);
  }, [lectureGroups, mode]);

  const [selectedLectures, setSelectedLectures] = useState(defaultSelected);
  const [questionCount, setQuestionCount] = useState(20);
  const [focusMode, setFocusMode] = useState(mode === "weak" ? "weak" : "all");

  useEffect(() => {
    setSelectedLectures(defaultSelected);
    setFocusMode(mode === "weak" ? "weak" : "all");
  }, [mode, defaultSelected]);

  const toggleLecture = (activity) => {
    setSelectedLectures((prev) => (prev.includes(activity) ? prev.filter((a) => a !== activity) : [...prev, activity]));
  };

  const selectedGroups = lectureGroups.filter((g) => selectedLectures.includes(g.activity));
  const totalObjs = selectedGroups.flatMap((g) => g.objectives);
  const weakObjs = totalObjs.filter((o) => o.status === "struggling" || o.status === "untested");
  const masteredObjs = totalObjs.filter((o) => o.status === "mastered");
  const hasUploadedQs = selectedGroups.some((g) => g.uploadedQCount > 0);
  const hasUploadedLecs = selectedGroups.some((g) => g.matchedLec);
  const totalUploadedQs = selectedGroups.reduce((a, g) => a + g.uploadedQCount, 0);

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
              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5 }}>SELECT LECTURES ({selectedLectures.length}/{lectureGroups.length})</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelectedLectures(lectureGroups.map((g) => g.activity))} style={{ fontFamily: MONO, fontSize: 11, color: tc, background: "none", border: "none", cursor: "pointer" }}>All</button>
                <button onClick={() => setSelectedLectures(lectureGroups.filter((g) => g.objectives.some((o) => o.status === "struggling" || o.status === "untested")).map((g) => g.activity))} style={{ fontFamily: MONO, fontSize: 11, color: T.red, background: "none", border: "none", cursor: "pointer" }}>Weak only</button>
                <button onClick={() => setSelectedLectures([])} style={{ fontFamily: MONO, fontSize: 11, color: T.text3, background: "none", border: "none", cursor: "pointer" }}>None</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {lectureGroups.map((group) => {
                const selected = selectedLectures.includes(group.activity);
                const groupWeak = group.objectives.filter((o) => o.status === "struggling" || o.status === "untested").length;
                const groupTotal = group.objectives.length;
                const groupPct = Math.round((group.objectives.filter((o) => o.status === "mastered").length / groupTotal) * 100) || 0;
                const perf = group.perfKey ? performanceHistory[group.perfKey] : null;
                const diff = perf?.currentDifficulty;
                const diffC = { easy: "#10b981", medium: "#f59e0b", hard: "#ef4444", expert: "#a78bfa" }[diff || "medium"];
                return (
                  <div
                    key={group.activity}
                    onClick={() => toggleLecture(group.activity)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      transition: "all 0.12s",
                      border: "1px solid " + (selected ? tc + "60" : T.border1),
                      background: selected ? tc + "0e" : T.inputBg,
                    }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: "2px solid " + (selected ? tc : T.border1), background: selected ? tc : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{selected && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}</div>
                    <span style={{ fontFamily: MONO, color: selected ? tc : T.text3, fontSize: 12, fontWeight: 700, minWidth: 44, flexShrink: 0 }}>{group.activity}</span>
                    <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10, background: T.pillBg, padding: "1px 6px", borderRadius: 3, flexShrink: 0 }}>{group.discipline}</span>
                    <span style={{ fontFamily: MONO, color: T.text1, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.lectureTitle}</span>
                    {groupWeak > 0 && <span style={{ fontFamily: MONO, color: T.red, fontSize: 11, flexShrink: 0 }}>⚠{groupWeak}</span>}
                    <div style={{ width: 36, height: 5, background: T.border1, borderRadius: 2, flexShrink: 0 }}>
                      <div style={{ width: groupPct + "%", height: "100%", background: groupPct === 100 ? T.green : tc, borderRadius: 2 }} />
                    </div>
                    {diff && <span style={{ fontFamily: MONO, color: diffC, fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 34 }}>{(diff || "").toUpperCase()}</span>}
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {group.matchedLec ? (
                        <span title="Lecture uploaded + objectives linked" style={{ fontFamily: MONO, color: T.green, fontSize: 11 }}>📖 linked</span>
                      ) : (
                        <span title="No lecture uploaded for these objectives" style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>📭 upload needed</span>
                      )}
                      {group.uploadedQCount > 0 && <span title={group.uploadedQCount + " uploaded questions"} style={{ fontFamily: MONO, color: T.green, fontSize: 11 }}>+{group.uploadedQCount}Q</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: T.inputBg, border: "1px solid " + T.border1, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontFamily: MONO, color: T.text3, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>SESSION PREVIEW</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {[
                { label: "Questions", val: questionCount },
                { label: "Lectures", val: selectedLectures.length },
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
              <span style={{ fontFamily: MONO, fontSize: 11, color: hasUploadedLecs ? T.green : T.text3, background: hasUploadedLecs ? T.greenBg : T.pillBg, border: "1px solid " + (hasUploadedLecs ? T.greenBorder : T.border1), padding: "2px 8px", borderRadius: 4 }}>{hasUploadedLecs ? "📖 Using lecture slides" : "📭 No slides uploaded"}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: hasUploadedQs ? T.green : T.text3, background: hasUploadedQs ? T.greenBg : T.pillBg, border: "1px solid " + (hasUploadedQs ? T.greenBorder : T.border1), padding: "2px 8px", borderRadius: 4 }}>{hasUploadedQs ? "📝 " + totalUploadedQs + " uploaded questions as style guide" : "📝 No uploaded questions"}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.amber, background: T.amberBg, border: "1px solid " + T.amberBorder, padding: "2px 8px", borderRadius: 4 }}>🎯 {focusMode === "weak" ? weakObjs.length + " weak objectives targeted" : totalObjs.length + " objectives targeted"}</span>
            </div>
          </div>

          <button
            disabled={selectedLectures.length === 0}
            onClick={() =>
              onStart({
                mode,
                questionCount,
                focusMode,
                selectedActivities: selectedLectures,
                selectedGroups,
                targetObjectives: focusMode === "weak" ? weakObjs : focusMode === "untested" ? totalObjs.filter((o) => o.status === "untested") : focusMode === "mastered" ? masteredObjs : totalObjs,
                blockId,
              })
            }
            style={{
              background: selectedLectures.length === 0 ? T.border1 : tc,
              border: "none",
              color: "#fff",
              padding: "14px 0",
              borderRadius: 11,
              cursor: selectedLectures.length === 0 ? "not-allowed" : "pointer",
              fontFamily: SERIF,
              fontSize: 18,
              fontWeight: 900,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { if (selectedLectures.length > 0) e.currentTarget.style.opacity = "0.88"; }}
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
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
        <div style={{ background: importing ? (tc || T.red) + "22" : (T.greenBg || T.inputBg), border: "1px solid " + (importing ? (tc || T.red) : (T.green || "#10b981")), borderRadius: 6, padding: "2px 10px" }}>
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
  const [tab,     setTab]     = useState("lectures");
  const [studyCfg, setStudyCfg] = useState(null);
  const [trackerKey, setTrackerKey] = useState(0);
  const [performanceHistory, setPerformanceHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-performance") || "{}");
    } catch {
      return {};
    }
  });
  const [perfToast, setPerfToast] = useState(null);
  const [currentSessionMeta, setCurrentSessionMeta] = useState(null);
  const [sessionSummary, setSessionSummary] = useState(null);

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

  const [blockObjectives, setBlockObjectives] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");

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

  const syncSessionToObjectives = (sessionResults, blockId, targetObjectives) => {
    if (!blockId || !sessionResults?.length) return { updatedCount: 0, masteredCount: 0, strugglingCount: 0, updates: [] };

    const updatesRef = { current: [] };
    let updatedCount = 0;
    let masteredCount = 0;
    let strugglingCount = 0;

    setBlockObjectives((prev) => {
      const blockData = prev[blockId];
      if (!blockData) return prev;

      const imported = [...(blockData.imported || [])];
      const extracted = [...(blockData.extracted || [])];

      const resultMap = {};
      sessionResults.forEach((r) => {
        if (r.objectiveId) resultMap[r.objectiveId] = r;
      });

      const updateObjectiveInArray = (arr) =>
        arr.map((obj) => {
          const result =
            resultMap[obj.id] ||
            resultMap[obj.code] ||
            sessionResults.find(
              (r) =>
                r.topic?.toLowerCase().includes((obj.lectureTitle || "").slice(0, 15).toLowerCase()) ||
                r.lectureRef === obj.activity ||
                (r.objectiveCovered && obj.objective?.toLowerCase().includes(r.objectiveCovered.toLowerCase().slice(0, 20)))
            );

          const wasTargeted = targetObjectives?.some((o) => o.id === obj.id || o.code === obj.code);

          if (!result && !wasTargeted) return obj;

          const correct = result?.correct ?? result?.isCorrect ?? null;
          const current = obj.status;

          let newStatus = current;
          if (correct === true) {
            newStatus =
              current === "struggling" ? "inprogress" : current === "inprogress" ? "mastered" : "mastered";
          } else if (correct === false) {
            newStatus = current === "mastered" ? "inprogress" : "struggling";
          } else if (wasTargeted && current === "untested") {
            newStatus = "inprogress";
          }

          if (newStatus !== current) {
            updatedCount++;
            updatesRef.current.push({
              id: obj.id,
              objective: (obj.objective || "").slice(0, 60),
              oldStatus: current,
              newStatus,
            });
          }
          if (newStatus === "mastered") masteredCount++;
          if (newStatus === "struggling") strugglingCount++;

          return {
            ...obj,
            status: newStatus,
            lastTested: new Date().toISOString(),
            quizScore: result?.score ?? obj.quizScore,
          };
        });

      const updatedImported = updateObjectiveInArray(imported);
      const updatedExtracted = updateObjectiveInArray(extracted);

      const updated = {
        ...prev,
        [blockId]: { imported: updatedImported, extracted: updatedExtracted },
      };
      try {
        localStorage.setItem("rxt-block-objectives", JSON.stringify(updated));
      } catch {}
      return updated;
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

  const updatePerformance = (topicKey, score, difficulty, questionCount, objectivesCovered = []) => {
    setPerformanceHistory((prev) => {
      const existing = prev[topicKey] || {
        sessions: [],
        currentDifficulty: "medium",
        streak: 0,
        bestScore: 0,
        trend: "stable",
      };
      const newSession = {
        date: new Date().toISOString(),
        score,
        difficulty: difficulty || existing.currentDifficulty,
        questionCount,
        objectivesCovered,
      };
      const sessions = [...existing.sessions, newSession].slice(-20);
      const recentScores = sessions.slice(-5).map((s) => s.score);
      let streak = 0;
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions[i].score >= 80) streak++;
        else break;
      }
      const currentIdx = DIFFICULTY_LADDER.indexOf(existing.currentDifficulty);
      let newIdx = currentIdx;
      if (score >= 80 && streak >= 2) {
        newIdx = Math.min(DIFFICULTY_LADDER.length - 1, currentIdx + 1);
      } else if (score < 50) {
        newIdx = Math.max(0, currentIdx - 1);
      }
      const newDifficulty = DIFFICULTY_LADDER[newIdx];
      const upgraded = newIdx > currentIdx;
      const downgraded = newIdx < currentIdx;
      let trend = "stable";
      if (sessions.length >= 6) {
        const recent3 = sessions.slice(-3).map((s) => s.score);
        const prev3 = sessions.slice(-6, -3).map((s) => s.score);
        const recentAvg = recent3.reduce((a, b) => a + b, 0) / 3;
        const prevAvg = prev3.reduce((a, b) => a + b, 0) / 3;
        if (recentAvg - prevAvg > 8) trend = "improving";
        else if (prevAvg - recentAvg > 8) trend = "declining";
      } else if (sessions.length >= 2) {
        const last = sessions[sessions.length - 1].score;
        const prev = sessions[sessions.length - 2].score;
        if (last - prev > 10) trend = "improving";
        else if (prev - last > 10) trend = "declining";
      }
      const updated = {
        ...prev,
        [topicKey]: {
          sessions,
          currentDifficulty: newDifficulty,
          streak,
          bestScore: Math.max(existing.bestScore || 0, score),
          trend,
          lastUpgraded: upgraded ? new Date().toISOString() : existing.lastUpgraded,
          lastDowngraded: downgraded ? new Date().toISOString() : existing.lastDowngraded,
        },
      };
      try {
        localStorage.setItem("rxt-performance", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const getTopicDifficulty = (topicKey) => {
    return performanceHistory[topicKey]?.currentDifficulty || "medium";
  };

  const computeWeakAreas = (blockId) => {
    const objs = getBlockObjectives(blockId) || [];
    const perf = performanceHistory;
    const weakAreas = [];
    const byLecture = {};
    objs.forEach((o) => {
      const key = o.activity || "Unknown";
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
      }),
    [lectures, getBlockObjectives, getTopicDifficulty, sessions, performanceHistory]
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
  const activeTerm  = terms.find(t => t.id === termId);
  const activeBlock = activeTerm?.blocks.find(b => b.id === blockId);
  const blockLecs   = lectures.filter(l => l.blockId === blockId);
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

    const mergedLec = {
      ...primary,
      id: "merged_" + Date.now(),
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
          setUpMsg("📖 Parsing lecture content...");
          const contentResult = await parseExamPDF(file, (msg) => setUpMsg(msg));
          if (contentResult.chunks?.length > 0) {
            console.log("Chunk sample keys:", Object.keys(contentResult.chunks[0]));
            console.log("Chunk sample:", JSON.stringify(contentResult.chunks[0]).slice(0, 300));
          }
          setUpMsg("🎯 Extracting learning objectives...");
          const extractedObjectives = await extractObjectivesFromLecture(file);

          const lecNum =
            contentResult.lectureNumber ??
            extractedObjectives[0]?.lectureNumber ??
            extractLecNumberFromFilename(file.name);
          const lecTitle =
            contentResult.lectureTitle ??
            extractedObjectives[0]?.lectureTitle ??
            file.name.replace(/\.[^.]+$/, "");

          const newLec = {
            id: uid(),
            blockId: bid,
            termId: tid,
            filename: file.name,
            lectureNumber: lecNum,
            lectureTitle: lecTitle,
            lectureType: contentResult.lectureType || "Lecture",
            subject: contentResult.subject || contentResult.discipline || "",
            chunks: contentResult.chunks || contentResult.sections || [],
            subtopics: contentResult.subtopics || contentResult.topics || contentResult.subtopicList || [],
            keyTerms: contentResult.keyTerms || contentResult.terms || contentResult.keywords || [],
            summary: contentResult.summary || "",
            fullText: (contentResult.fullText || "").slice(0, 12000),
            uploadedAt: new Date().toISOString(),
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

          setLecs((prev) => {
            const updated = [...prev.filter((l) => !(l.blockId === bid && l.filename === file.name)), newLec];
            saveLectures(updated);
            return updated;
          });

          if (contentResult.questions?.length) {
            onFileParsed(file.name, contentResult.questions);
          }

          if (extractedObjectives.length > 0) {
            setBlockObjectives((prev) => {
              const blockData = prev[bid] || { imported: [], extracted: [] };
              const existing = blockData.extracted || [];
              const existingKeys = new Set(
                existing.map((o) => (o.objective || "").slice(0, 55).toLowerCase().replace(/\W/g, ""))
              );
              const newOnes = extractedObjectives.filter(
                (o) => !existingKeys.has((o.objective || "").slice(0, 55).toLowerCase().replace(/\W/g, ""))
              );
              const updatedExtracted = [...existing, ...newOnes];
              const allLectures = [...lectures.filter((l) => l.blockId === bid), newLec];
              const alignedImported = alignObjectivesToLectures(bid, blockData.imported || [], allLectures);
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
              const allLectures = [...lectures.filter((l) => l.blockId === bid), newLec];
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
            "✓ " + file.name + " — " + qCount + " questions" +
            (objCount > 0 ? " · " + objCount + " objectives extracted" : " · objectives aligned")
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
          const lectureNumber = extractLecNumberFromFilename(file.name) ?? meta.lectureNumber ?? null;
          const lectureType = meta.lectureType || "Lecture";
          const lec = {
            id: uid(),
            blockId: bid,
            termId: tid,
            filename: file.name,
            uploadedAt: new Date().toISOString(),
            fullText: text.slice(0, 12000),
            ...meta,
            lectureNumber,
            lectureType,
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

    const allContent = (selectedGroups || [])
      .filter((g) => g.matchedLec)
      .flatMap((g) => (g.matchedLec.chunks || []).map((c) => c.text || c.content || ""))
      .join("\n")
      .slice(0, 10000);

    const allUploadedQs = (selectedGroups || [])
      .flatMap((g) =>
        Object.values(questionBanksByFile || {})
          .flat()
          .filter(
            (q) =>
              (q.topic || "").toLowerCase().includes((g.lectureTitle || "").slice(0, 15).toLowerCase()) ||
              (g.lectureNumber != null && (q.topic || "").includes(String(g.lectureNumber)))
          )
      )
      .slice(0, 10);

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

        const prompt = buildExamPrompt(batchCount, batchObjs, allContent, allUploadedQs, mode, blockDiff);

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
        }));
        allQuestions.push(...qs);

        if (qs.length < batchSize * 0.5 && allQuestions.length < questionCount) {
          console.log(`Batch ${batch + 1} only got ${qs.length}/${batchSize} — retrying for remainder`);
          const retryCount = Math.min(batchSize - qs.length, questionCount - allQuestions.length);
          try {
            const retryPrompt = buildExamPrompt(retryCount, batchObjs.slice(3), allContent, allUploadedQs, mode, blockDiff);
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

  const startObjectiveQuiz = async (objectives, lectureTitle, optionalBlockId) => {
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
    const styleExamples = Object.values(questionBanksByFile || {})
      .flat()
      .filter((q) =>
        (q.topic || "").toLowerCase().includes((lectureTitle || "").slice(0, 15).toLowerCase())
      )
      .slice(0, 4);
    const objList = objectives
      .slice(0, 20)
      .map((o, i) => `${i + 1}. ${o.objective}`)
      .join("\n");
    const styleRef =
      styleExamples.length > 0
        ? "\n\nEXAM STYLE REFERENCE (match this format exactly):\n" +
          styleExamples
            .map(
              (q) =>
                `Q: ${q.stem}\nA: ${q.choices?.A}  B: ${q.choices?.B}  C: ${q.choices?.C}  D: ${q.choices?.D}\nCorrect: ${q.correct}`
            )
            .join("\n\n")
        : "";
    const prompt =
      `Generate ${Math.min(objectives.length, 10)} USMLE Step 1 clinical vignette questions for: ${lectureTitle}\n\n` +
      `Difficulty: ${difficulty.toUpperCase()}\n\n` +
      `LEARNING OBJECTIVES — every question must test one of these:\n${objList}\n` +
      styleRef +
      `\n\nCRITICAL RULES:\n` +
      `- Every stem MUST end with a question sentence ending in "?"\n` +
      `- Format: [Clinical scenario]. [Question ending in ?]\n` +
      `- Each question maps to exactly one objective from the list above\n` +
      `- Keep explanations under 60 words\n` +
      `- Vary patient demographics and clinical settings\n\n` +
      `Return ONLY complete valid JSON:\n` +
      `{"questions":[{"stem":"A 45-year-old male presents with... Which of the following is most likely?","choices":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"...","objectiveId":"","objectiveCovered":"objective text this tests","topic":"${(lectureTitle || "").replace(/"/g, '\\"')}","difficulty":"${difficulty}"}]}`;
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
        objectiveId:
          q.objectiveId ||
          objectives.find((o) =>
            o.objective.toLowerCase().includes((q.objectiveCovered || "").toLowerCase().slice(0, 25))
          )?.id ||
          null,
      }));
      const validated = validateAndFixQuestions(questions);
      setBlockExamLoading(null);
      setCurrentSessionMeta({
        blockId: bid,
        topicKey: bid ? "block__" + bid + "__objectives" : topicKey,
        difficulty,
        targetObjectives: objectives,
        lectureTitle,
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

  const handleSessionComplete = (payload) => {
    const { correct, total, date, results: objectiveResults = [] } = payload;
    const meta = currentSessionMeta;
    const bid = meta?.blockId ?? blockId;
    const targetObjectives = meta?.targetObjectives ?? [];

    const syncStats = syncSessionToObjectives(
      Array.isArray(objectiveResults) ? objectiveResults : [],
      bid,
      targetObjectives
    );

    const score = total > 0 ? pct(correct, total) : 0;
    const difficulty = meta?.difficulty ?? studyCfg?.difficulty ?? getTopicDifficulty("block__" + blockId);
    const topicKey =
      meta?.topicKey ?? (studyCfg?.mode === "lecture" && studyCfg?.lecture
        ? studyCfg.lecture.id + "__" + (studyCfg.subtopic || "full")
        : "block__" + bid);
    const blockKey = "block__" + bid;

    updatePerformance(topicKey, score, difficulty, total, objectiveResults?.map((r) => r.objectiveId).filter(Boolean) || []);
    updatePerformance(blockKey, score, difficulty, total, []);

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
      showPerformanceFeedback(topicKey, score);
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
    let nextProfile = learningProfile;
    for (let i = 0; i < correct; i++) {
      nextProfile = recordAnswer(nextProfile, subject, subtopic, true, "clinicalVignette");
    }
    for (let i = 0; i < total - correct; i++) {
      nextProfile = recordAnswer(nextProfile, subject, subtopic, false, "clinicalVignette");
    }
    setLearningProfile(nextProfile);
    saveProfile(nextProfile);

    setSessionSummary({
      correct,
      total,
      updates: syncStats?.updates ?? [],
    });
    setCurrentSessionMeta(null);
    setStudyCfg(null);
    const areas = computeWeakAreas(bid);
    setWeakAreas(areas);
  };

  const onSessionDone = handleSessionComplete;

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
        onCancel={() => setExamConfigModal(null)}
        onStart={(cfg) => { setExamConfigModal(null); startBlockExam(cfg); }}
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
                onBack={() => setView("block")}
                onStart={(finalCfg) => {
                  const bid = finalCfg.blockId ?? blockId;
                  setCurrentSessionMeta({
                    blockId: bid,
                    topicKey: "block__" + bid,
                    difficulty: finalCfg.difficulty ?? getTopicDifficulty("block__" + blockId),
                    targetObjectives: [],
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
                blockId={blockId}
                onObjectivesExtracted={(filename, extractedObjectives, bid) => {
                  if (!extractedObjectives?.length || !bid) return;
                  setBlockObjectives((prev) => {
                    const blockData = prev[bid] || { imported: [], extracted: [] };
                    const existing = blockData.extracted || [];
                    const existingKeys = new Set(existing.map((o) => (o.objective || "").slice(0, 60).toLowerCase()));
                    const newOnes = extractedObjectives.filter((o) => !existingKeys.has((o.objective || "").slice(0, 60).toLowerCase()));
                    const updated = { ...prev, [bid]: { ...blockData, extracted: [...existing, ...newOnes] } };
                    try { localStorage.setItem("rxt-block-objectives", JSON.stringify(updated)); } catch {}
                    return updated;
                  });
                }}
              />
            </div>
          )}

          {/* DEEP LEARN */}
          {view === "deeplearn" && (
            <DeepLearn
              blockId={studyCfg?.blockId}
              lecs={studyCfg?.lecs ?? []}
              blockObjectives={studyCfg?.blockObjectives ?? []}
              questionBanksByFile={(() => {
                try {
                  return JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
                } catch {
                  return {};
                }
              })()}
              termColor={tc}
              onBack={() => setView("block")}
            />
          )}

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
                      <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ height:8, background:t.border1, borderRadius:3 }}>
                          <div style={{ height:"100%", borderRadius:3, width:pct+"%", background:pct===100?t.green:pct>60?t.amber:t.red, transition:"width 0.5s" }} />
                        </div>
                        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                          {[
                            { label:"Mastered", val:mastered, color:t.green },
                            { label:"In Progress", val:inprogress, color:t.amber },
                            { label:"Struggling", val:struggling, color:t.red },
                            { label:"Untested", val:untested, color:t.text3 },
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
                        startObjectiveQuiz(weakObjs, "Weak & Untested Objectives");
                      }}
                      style={{ background:t.red, border:"none", color:"#fff", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:10, fontWeight:700 }}
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
                {[["lectures","Lectures ("+blockLecs.length+")"],["heatmap","Heatmap"],["analysis","AI Analysis"],["objectives","🎯 Objectives"],["progress","📈 Progress"]].map(([tKey,label])=>(
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
                  {lecView === "list" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 24px 24px" }}>
                      {sortedLecs.map((lec, i) => (
                        <LecListRow
                          key={lec.id}
                          lec={lec}
                          index={i}
                          tc={tc}
                          T={t}
                          sessions={sessions}
                          onOpen={() => setExpandedLec(lec.id)}
                          isExpanded={expandedLec === lec.id}
                          onClose={() => setExpandedLec(null)}
                          onStart={startTopic}
                          onUpdateLec={updateLec}
                          mergeMode={mergeMode}
                          mergeSelected={mergeSelected}
                          onMergeToggle={onMergeToggle}
                          allObjectives={getBlockObjectives(blockId)}
                          allBlockObjectives={getBlockObjectives(activeBlock?.id ?? blockId)}
                          updateObjective={updateObjective}
                          currentBlock={activeBlock}
                          startObjectiveQuiz={startObjectiveQuiz}
                          onDeepLearn={() => {
                            setStudyCfg({ blockId, lecs: lectures.filter((l) => l.blockId === blockId), blockObjectives: getBlockObjectives(blockId) });
                            setView("deeplearn");
                          }}
                        />
                  ))}
                </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
                      {sortedLecs.map((lec, li) => (
                        <LecCard key={lec.id} lec={lec} sessions={sessions} accent={PALETTE[li % PALETTE.length]} tint={tc} onStudy={startTopic} onDelete={delLec} onUpdateLec={updateLec} mergeMode={mergeMode} mergeSelected={mergeSelected} onMergeToggle={onMergeToggle} allObjectives={getBlockObjectives(blockId)} onDeepLearn={() => { setStudyCfg({ blockId, lecs: lectures.filter((l) => l.blockId === blockId), blockObjectives: getBlockObjectives(blockId) }); setView("deeplearn"); }} />
                      ))}
                    </div>
                  )}
                </>
              ))}

              {/* Heatmap */}
              {tab==="heatmap" && <Heatmap lectures={blockLecs} sessions={sessions} onStudy={startTopic} />}

              {/* Analysis */}
              {tab==="objectives" && (
                <div style={{ position:"relative" }}>
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
                    const allObjs = getBlockObjectives(activeBlock?.id ?? blockId) || [];
                    const linked = allObjs.filter((o) => o.hasLecture).length;
                    const unlinked = allObjs.filter((o) => !o.hasLecture).length;
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
                </div>
              )}
              {tab==="progress" && (() => {
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
                  .filter(([k]) => k === blockKeyForLog || k.startsWith((currentBlock?.id ?? blockId) + "__") || blockLecsForProgress.some((l) => k.startsWith(l.id)))
                  .flatMap(([key, perf]) =>
                    (perf.sessions || []).map((s) => ({
                      ...s,
                      topicKey: key,
                      label: key === blockKeyForLog ? "Full Block Exam" : blockLecsForProgress.find((l) => key.startsWith(l.id))?.lectureTitle || key,
                    }))
                  )
                  .sort((a,b) => new Date(b.date) - new Date(a.date))
                  .slice(0, 15);
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
                    {areas.length > 0 && (
                      <div style={{ background:t.cardBg, border:"1px solid "+t.border1, borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontFamily:MONO, color:t.text3, fontSize:9, letterSpacing:1.5, marginBottom:12 }}>WEAK AREAS — STUDY THESE NEXT</div>
                        {areas.slice(0,6).map((area, i) => {
                          const priorityColor = {critical:t.red,high:t.amber,medium:t.text3}[area.priority];
                          return (
                            <div key={area.activity} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:9, marginBottom:6, background:t.inputBg, border:"1px solid "+t.border1 }}>
                              <div style={{ fontFamily:MONO, color:priorityColor, fontSize:11, fontWeight:700, minWidth:20 }}>{i+1}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ fontFamily:MONO, color:t.text1, fontSize:13 }}>{area.lectureTitle || area.activity}</div>
                                <div style={{ display:"flex", gap:8, marginTop:2 }}>
                                  {area.struggling>0 && <span style={{fontFamily:MONO,color:t.red,fontSize:10}}>⚠ {area.struggling} struggling</span>}
                                  {area.untested>0 && <span style={{fontFamily:MONO,color:t.text3,fontSize:10}}>○ {area.untested} untested</span>}
                                  {area.avgScore!=null && <span style={{fontFamily:MONO,color:area.avgScore<60?t.red:t.amber,fontSize:10}}>avg {Math.round(area.avgScore)}%</span>}
                                </div>
                              </div>
                              <button onClick={() => setExamConfigModal({ mode:"weak", blockId:currentBlock?.id ?? blockId, preselectedActivity: area.activity, open:true })} style={{ background:tc, border:"none", color:"#fff", padding:"7px 14px", borderRadius:7, cursor:"pointer", fontFamily:MONO, fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}>Study Now →</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
                        const lecObjs = blockObjs.filter(o => String(o.lectureNumber)===String(lec.lectureNumber) || o.linkedLecId===lec.id);
                        const lecPerf = Object.entries(performanceHistory).filter(([k])=>k.startsWith(lec.id)).flatMap(([,v])=>v.sessions||[]);
                        const lastScore = lecPerf.slice(-1)[0]?.score;
                        const mastered = lecObjs.filter(o=>o.status==="mastered").length;
                        const total = lecObjs.length;
                        const pct = total>0 ? Math.round(mastered/total*100) : 0;
                        const sessCount = lecPerf.length;
                        return (
                          <div key={lec.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid "+t.border2 }}>
                            <div style={{ fontFamily:MONO, color:tc, fontSize:12, fontWeight:700, minWidth:48 }}>{(lec.lectureType||"Lec")}{lec.lectureNumber}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontFamily:MONO, color:t.text1, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:220 }}>{lec.lectureTitle || lec.filename}</div>
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

