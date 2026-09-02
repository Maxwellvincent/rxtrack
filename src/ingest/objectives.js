/**
 * SP1 T6.1 — extracting learning objectives from a lecture, lifted out of App.jsx.
 *
 * This is the half of App's upload pipeline that carries the curriculum: the
 * SOM-coded objectives in a lecture PDF, whether they sit in an objectives
 * table, as inline codes on the slides, or only in prose a model has to read.
 * It ran at App's module scope and never touched App state, so it moves whole.
 *
 * Order of attack (extractObjectivesFromLecture):
 *   1. an objectives table in the chunks, parsed without AI where it can be
 *   2. AI over the table chunk, with the context it references pulled in
 *   3. AI over sequential slices of the whole lecture
 *   4. CPR blocks only: inline SOM codes on the slides
 * Nothing is guessed — a pass that finds nothing returns nothing.
 */
import { callAI, callAIJSON } from "../aiClient.js";
import { LECTURE_MARKDOWN_CONTEXT_FOR_AI, LECTURE_MARKDOWN_SYSTEM_INSTRUCTION } from "../aiPromptSnippets.js";
import { getChunkBody } from "../lectureText.js";
import { safeJSON } from "../lib/aiJson.js";
import {
  prepareTextForObjectiveExtraction,
  buildFullTextForObjectiveAi,
  getSequentialObjectiveSlices,
  OBJECTIVE_AI_MAX_SECTION,
} from "../objectiveTextForAi.js";

/** App's id fallback, for engines without crypto.randomUUID. */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** Parse trailing (SG), (TBL), (DLA), (LEC), (LAB) tags into a dedicated activity field. */
export function parseObjectiveActivityTag(text) {
  const tagMatch = String(text || "").match(/\((SG|TBL|DLA|LEC|LAB)\s*\)\s*$/i);
  if (!tagMatch) return { text: String(text || "").trim(), activity: null };
  const tag = tagMatch[1].toUpperCase();
  return {
    text: String(text || "")
      .replace(/\((SG|TBL|DLA|LEC|LAB)\s*\)\s*$/i, "")
      .trim(),
    activity: tag,
  };
}

export const MAX_OBJECTIVE_CHARS = 320;

const OBJECTIVE_START_RE = /(?:^|\s)(summarize|outline|discuss|describe|identify|explain|list|compare|contrast|define|classify|distinguish|differentiate|evaluate|analyze|apply|demonstrate|calculate|interpret|relate|state|give|name|recognize|predict|determine|illustrate|formulate|recall|review|assess|examine|draw|characterize|diagnose|select|solve|use|construct|develop|derive|match|label|locate|perform|understand|appraise|highlight|indicate|justify)\b/i;

/** Remove curriculum-export furniture without rewriting the school's objective. */
export function stripObjectiveDocumentBoilerplate(value) {
  return String(value || "")
    .replace(/^\s*(?:learning objectives?\s+for\s+module\b|school of medicine\b|university\b|campus\b|address\b|term\s+(?:spring|summer|fall|winter|august|january)\b|page\s+\d+\s*(?:of\s+\d+)?\b|confidential\b|copyright\b).*$/gim, "")
    .replace(/^\s*(?:Lecture|DLA|TBL|Small group|Lab)\s+[A-Z][A-Z0-9;&/ -]*\s{2,}.*$/gm, "")
    .replace(/^\s*\|?\s*-{3,}(?:\s*\|\s*-{3,})+\s*\|?\s*$/gm, "");
}

/** Keep one curriculum objective; never let the rest of a slide or deck become its text. */
export function sanitizeObjectiveText(value) {
  let text = stripObjectiveDocumentBoilerplate(value)
    .replace(/^\s*SOM(?:\.\s?[A-Za-z0-9]+)+\.\s?\d{4}\s*/i, "")
    .split(/\s+\|\s*(?:#{1,6}\s+|recommended reading|images?:|other resources?:|the big picture|copyright\b)/i)[0]
    .replace(/\|\s*\|[-:|\s]{3,}[\s\S]*$/i, "")
    .split(/\n\s*(?:#{1,6}\s+|\*\*|recommended reading|images?:|other resources?:|the big picture|copyright\b|!\[)/i)[0]
    .replace(/\s*\|\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // A malformed table row can put a school heading or metadata before the
  // actual objective. Keep the authoritative verb-led sentence, not the
  // document furniture. Do not alter already-clean objectives.
  if (text && !OBJECTIVE_START_RE.test(text.slice(0, 24))) {
    const firstObjective = text.search(OBJECTIVE_START_RE);
    if (firstObjective >= 0 && firstObjective <= 180) text = text.slice(firstObjective).trim();
  }

  if (text.length > MAX_OBJECTIVE_CHARS) {
    const sentence = text.slice(0, MAX_OBJECTIVE_CHARS + 1).match(/^(.{20,320}?[.!?])(?:\s|$)/)?.[1];
    if (sentence) text = sentence;
    else {
      const clipped = text.slice(0, MAX_OBJECTIVE_CHARS);
      const boundary = Math.max(clipped.lastIndexOf(";"), clipped.lastIndexOf(","), clipped.lastIndexOf(" "));
      text = clipped.slice(0, boundary >= 40 ? boundary : MAX_OBJECTIVE_CHARS).trim();
    }
  }
  return text;
}

export function chunkText(text, maxCharsPerChunk = 3000) {
  const chunks = [];
  let remaining = (text || "").trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxCharsPerChunk) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf("\n", maxCharsPerChunk);
    if (breakAt < maxCharsPerChunk * 0.5) breakAt = maxCharsPerChunk;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trim();
  }
  return chunks;
}

export function tryParseObjectivesJSON(raw) {
  if (!raw) return null;
  try {
    return safeJSON(raw);
  } catch {
    try {
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first === -1 || last === -1) return null;
      return safeJSON(raw.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

export function deduplicateExtractedObjectives(objs) {
  const seen = new Map();
  objs.forEach((obj) => {
    const key = (obj.objective || obj.text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (key.length < 10) return;
    if (!seen.has(key)) {
      seen.set(key, obj);
    } else {
      const existing = seen.get(key);
      if (obj.code && !existing.code) {
        seen.set(key, { ...obj });
      }
    }
  });
  return [...seen.values()];
}

const OBJECTIVE_VERBS = [
  "summarize",
  "outline",
  "discuss",
  "describe",
  "identify",
  "explain",
  "list",
  "compare",
  "contrast",
  "define",
  "classify",
  "distinguish",
  "differentiate",
  "evaluate",
  "analyze",
  "apply",
  "demonstrate",
  "calculate",
  "interpret",
  "relate",
  "state",
  "give",
  "name",
  "recognize",
  "predict",
  "determine",
  "illustrate",
  "formulate",
  "recall",
  "review",
  "assess",
  "examine",
  "draw",
  "characterize",
  "diagnose",
  "select",
  "solve",
  "use",
  "construct",
  "develop",
  "derive",
  "match",
  "label",
  "locate",
  "perform",
  "understand",
];

export function isValidObjective(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < 10) return false;
  if (t.length > MAX_OBJECTIVE_CHARS) return false;
  if (t.startsWith("SOM.")) return false;
  if (t.includes("—") && t.length < 30) return false;
  const lower = t.toLowerCase();
  return OBJECTIVE_VERBS.some((v) => lower.startsWith(v));
}

export function filterExtractedObjectivesQuality(objs, lec) {
  if (!Array.isArray(objs) || !objs.length) return [];
  const getText = (o) => (o.text || o.objective || "").trim();
  // Trust SOM-coded objectives even if they don't open with a whitelisted verb —
  // the authoritative code itself is evidence this is a real objective.
  const hasCode = (o) => {
    const c = (o?.code || o?.objectiveCode || "").trim();
    return c.startsWith("SOM.");
  };
  const valid = objs.filter((o) => hasCode(o) || isValidObjective(getText(o)));
  const rejected = objs.filter((o) => !hasCode(o) && !isValidObjective(getText(o)));
  const title = lec?.lectureTitle || lec?.id || "lecture";
  if (rejected.length > 0) {
    console.warn(
      `⚠ ${title}: filtered ${rejected.length} objectives (not verb-led or invalid):`,
      rejected.map((o) => getText(o).slice(0, 50))
    );
  }
  if (valid.length > 0 && valid.length < 3) {
    console.warn(
      `⚠ ${title}: only ${valid.length} objective(s) passed validation — extraction may be incomplete`
    );
  }
  return valid;
}

function chunkHasTableFileReference(text) {
  if (!text || typeof text !== "string") return false;
  return text.includes("[tbl-") || text.includes(".md]");
}

// PDF text extraction (pdftotext / pdf.js) frequently inserts whitespace
// between a SOM code's dotted prefix and its trailing 4-digit suffix, e.g.
// "SOM.MK.I.BPM1.3.CPR.1.INTG. 0024" instead of "SOM.MK.I.BPM1.3.CPR.1.INTG.0024".
// It also splits chained codes with semicolons/commas like "0018; 0024".
// All downstream regexes assume the canonical compact form, so we normalize
// once at every extraction entry point.
export function normalizeSomCodesInText(text) {
  if (!text || typeof text !== "string") return text;
  let out = text;
  // Character class allows LOWERCASE: a real code is SOM.1ai.BMP2.2.ER.1.ANAT.RP.0705,
  // and [A-Z0-9.] stops at the "a". That made this function a no-op for the codes
  // it most needed to repair — 31 of 46 codes in one lecture kept a stray space
  // before their four-digit tail and were therefore never matched downstream.
  out = out.replace(/\[(SOM\.[A-Za-z0-9.]+)\]\(https?:\/\/[^)]+\)/gi, "$1");
  // Collapse whitespace anywhere inside a code: OCR and pdf text layers break
  // them after any dot, not only before the suffix.
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/(SOM\.[A-Za-z0-9.]*)\s+([A-Za-z0-9]+\.)/g, "$1$2")
      .replace(/(SOM\.[A-Za-z0-9.]+\.)\s+(\d{4})\b/g, "$1$2");
    if (next === out) break;
    out = next;
  }
  // Convert "; NNNN" or ", NNNN" continuations directly after a SOM code into
  // the "//NNNN" syntax that existing expansion logic understands.
  out = out.replace(
    /(SOM\.[A-Za-z0-9.]+\.\d{4})((?:\s*[;,]\s*\d{4})+)/g,
    (_, head, tail) => head + tail.replace(/\s*[;,]\s*(\d{4})/g, "//$1")
  );
  return out;
}

function matchesObjectivesTablePattern(text) {
  if (!text || typeof text !== "string") return false;
  return (
    text.includes("[tbl-") ||
    (text.includes("SOM.") &&
      (/\bsummarize\b/i.test(text) || /\boutline\b/i.test(text) || /\bdiscuss\b/i.test(text))) ||
    (/\bobjectives\b/i.test(text) && text.includes("SOM."))
  );
}

/** Scans every chunk; preferLast picks the last match (Part B objectives on merged A+B PDFs). */
export function findObjectivesTableChunk(chunks, { preferLast } = {}) {
  const list = chunks || [];
  const matches = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const body = getChunkBody(c);
    if (matchesObjectivesTablePattern(body)) matches.push(c);
  }
  if (matches.length === 0) return null;
  return preferLast ? matches[matches.length - 1] : matches[0];
}

function chunkOrNeighborsMentionObjectives(chunk, chunks) {
  const idx = chunks.indexOf(chunk);
  if (idx < 0) return false;
  const win = chunks.slice(Math.max(0, idx - 1), Math.min(chunks.length, idx + 2));
  return win.some((c) => /\bobjectives\b/i.test(getChunkBody(c) || ""));
}

export function buildObjEntry(code, objText, lec, blockId) {
  const bloomVerbs = {
    1: ["list", "recall", "name", "state", "identify", "define"],
    2: ["describe", "explain", "summarize", "classify", "outline"],
    3: ["apply", "demonstrate", "use", "solve", "calculate"],
    4: ["analyze", "compare", "contrast", "differentiate"],
    5: ["evaluate", "justify", "critique", "assess"],
    6: ["design", "create", "construct", "develop", "synthesize"],
  };

  const rawText = sanitizeObjectiveText(objText);
  const { text: cleanText, activity: parsedActivity } = parseObjectiveActivityTag(rawText);
  const text = cleanText;
  const firstWord = (text.split(/\s+/)[0] || "").toLowerCase();
  let bloomLevel = 2;
  for (const [level, verbs] of Object.entries(bloomVerbs)) {
    if (verbs.some((v) => firstWord.startsWith(v))) {
      bloomLevel = parseInt(level, 10);
      break;
    }
  }

  const newId =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid();
  const codeTrim = (code || "").toString().trim();

  return {
    id: newId,
    blockId,
    linkedLecId: lec.id,
    sourceFile: lec.id,
    objective: text,
    text,
    activity: parsedActivity || lec.lectureType,
    code: codeTrim,
    objectiveCode: codeTrim,
    lectureType: lec.lectureType,
    lectureNumber: lec.lectureNumber,
    bloom_level: bloomLevel,
    bloom_level_name: ["", "Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"][bloomLevel],
    status: "untested",
    manuallyAligned: false,
    aiAligned: false,
  };
}

/**
 * The real shape of a SOM code, lowercase segments and all.
 *
 * The older patterns in this file use `SOM\.[A-Z0-9.]+`, which stops dead at the
 * first lowercase letter. Against a real code — SOM.1ai.BMP2.2.ER.1.ANAT.RP.0705
 * — that matches only "SOM.1", so every code on the page collapses to the same
 * string, the de-dupe keeps one, and the rest of the objectives are lost. A
 * Pelvis and Perineum lecture with 46 codes yielded exactly 1.
 */
const SOM_CODE = /SOM(?:\.\s?[A-Za-z0-9]+)+\.\s?\d{4}/g;

/**
 * Objectives listed as `CODE text`, one after another.
 *
 * Rather than guess at column spacing — the decks use a single space, the older
 * pattern demanded two — this takes each code's position and treats everything
 * up to the next code as that objective's text. Wrapped lines come along with
 * it, which is what the source actually looks like.
 */
export function extractCodeDelimited(text, lec, blockId) {
  if (!text) return [];
  const src = normalizeSomCodesInText(text.toString());
  const matches = [...src.matchAll(SOM_CODE)];
  if (!matches.length) return [];

  const results = [];
  const seen = new Set();
  let pendingPrefix = "";
  for (let i = 0; i < matches.length; i++) {
    // The match may still carry a space the normaliser could not reach; the
    // stored code never should.
    const code = matches[i][0].replace(/\s/g, "");
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(src.length, start + 600);
    let segment = src.slice(start, end);
    const prefixForCurrent = pendingPrefix;
    pendingPrefix = "";

    // In Excel-exported curriculum PDFs a long objective can wrap above the
    // SOM code in its row. pdftotext then places that verb-led prefix at the
    // end of the previous code's segment. Move only that final, indented block
    // forward to the code it belongs to.
    if (i + 1 < matches.length) {
      const hanging = segment.match(/\n([ \t]{12,}(?:Summarize|Outline|Discuss|Describe|Identify|Explain|List|Compare|Contrast|Define|Classify|Distinguish|Differentiate|Evaluate|Analyze|Apply|Demonstrate|Calculate|Interpret|Relate|State|Recognize|Predict|Determine|Review|Assess|Examine|Characterize|Select|Use|Appraise|Highlight|Indicate|Justify)\b[^\n]*(?:\n[ \t]{12,}[^\n]*)*)\s*$/i);
      if (hanging) {
        pendingPrefix = hanging[1].replace(/\s+/g, " ").trim();
        segment = segment.slice(0, hanging.index);
      }
    }

    const body = sanitizeObjectiveText(`${prefixForCurrent} ${segment}`
      .replace(/^[\s:.\-–—|]+/, "")
      .trim());

    if (seen.has(code) || body.length < 10) continue;
    seen.add(code);
    results.push(buildObjEntry(code, body, lec, blockId));
  }
  return results;
}

/** Prefer explicitly labelled objective slides over codes in unrelated DLA slides/footers. */
export function extractScopedLectureObjectives(text, lec, blockId) {
  // PDF page breaks are not JavaScript multiline anchors. Keep the boundary
  // while allowing headings immediately after it to match as their own line.
  const src = String(text || "").replace(/\f/g, "\n\f\n");
  const headings = [...src.matchAll(/^[ \t#*]*(Lecture|DLA|TBL|LAB|SG)\b[^\n\f]{0,120}\bObjectives\b[^\n\f]*$/gim)];
  const activity = String(lec?.lectureType || "LEC").toUpperCase();
  const selected = headings.filter((h) => (h[1].toLowerCase() === "lecture" ? "LEC" : h[1].toUpperCase()) === activity);
  if (!selected.length) return null;
  const objectives = selected.flatMap((heading) => {
    const start = heading.index + heading[0].length;
    const following = headings.find((h) => h.index > heading.index)?.index ?? src.length;
    const pageEnd = src.indexOf("\f", start);
    const nextMarkdownHeading = src.slice(start).search(/\n[ \t]*(?:#{1,6}[ \t]+|---[ \t]*(?:\n|$))/);
    const end = Math.min(following, pageEnd < 0 ? src.length : pageEnd,
      nextMarkdownHeading < 0 ? src.length : start + nextMarkdownHeading);
    return extractCodeDelimited(src.slice(start, end), lec, blockId);
  });
  return deduplicateExtractedObjectives(objectives);
}

export function extractFromTableText(text, lec, blockId) {
  if (!text) return [];
  const src = normalizeSomCodesInText(text.toString());

  // Code-delimited first: it handles the format the decks actually use, and the
  // patterns below only ever matched a subset of it.
  const delimited = extractCodeDelimited(src, lec, blockId);
  if (delimited.length) return delimited;

  const results = [];
  const seen = new Set();

  const skipBadObjectiveText = (objText) => {
    const t = (objText || "").trim();
    return !t || t.startsWith("SOM.") || t.length < 10;
  };

  // Pattern 1: "SOM.CODE   Objective text" on the same line
  const linePattern = /(SOM\.[A-Z0-9.]+)\s{2,}([A-Z][^\n]{10,})/g;
  let match;
  while ((match = linePattern.exec(src)) !== null) {
    const code = match[1].trim();
    const objText = match[2].trim();
    if (!code || seen.has(code) || skipBadObjectiveText(objText)) continue;
    seen.add(code);
    results.push(buildObjEntry(code, objText, lec, blockId));
  }
  if (results.length >= 3) return results;

  // Pattern 2: code and text on separate lines (or embedded code with trailing text)
  const lines = src
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const pipeRow = line.match(/^(SOM\.[A-Z0-9.]+)\s*\|\s*(.*)$/);
    if (pipeRow) {
      const code = pipeRow[1].trim();
      const objText = pipeRow[2].replace(/^\|+\s*/, "").trim();
      if (!code || seen.has(code) || skipBadObjectiveText(objText)) continue;
      seen.add(code);
      results.push(buildObjEntry(code, objText, lec, blockId));
      continue;
    }

    const codeOnly = line.match(/^(SOM\.[A-Z0-9.]+(?:\s*\|\s*\d+)?)\s*$/);
    if (codeOnly) {
      const code = codeOnly[1].replace(/\s*\|\s*\d+$/, "").trim();
      if (!code || seen.has(code)) continue;

      let objText = "";
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j];
        if (/^SOM\./.test(next)) break;
        if (/^BPM1\s*\|/i.test(next)) continue;
        if (next.length > 15 && /^[A-Z]/.test(next)) {
          objText = next;
          break;
        }
      }

      if (!skipBadObjectiveText(objText)) {
        seen.add(code);
        results.push(buildObjEntry(code, objText.trim(), lec, blockId));
      }
      continue;
    }

    const embeddedCode = line.match(/SOM\.[A-Z0-9.]+/)?.[0] || null;
    if (embeddedCode && !seen.has(embeddedCode)) {
      const afterCode = line.replace(embeddedCode, "").trim().replace(/^\|+\s*/, "").trim();
      if (!skipBadObjectiveText(afterCode)) {
        seen.add(embeddedCode);
        results.push(buildObjEntry(embeddedCode, afterCode, lec, blockId));
      }
    }
  }

  return results;
}

export function findAllSOMCodesForLecture(chunks, lec) {
  const allText = normalizeSomCodesInText(
    (chunks || [])
      .map((c) => getChunkBody(c) || c.markdown || c.text || "")
      .join("\n")
  );

  // Strategy 1: Find fully qualified codes (most reliable)
  const fullCodes = [
    ...new Set((allText.match(/SOM\.[A-Z0-9]+(?:\.[A-Z0-9]+){4,}\.\d{4}/g) || [])),
  ];

  // Strategy 2: Find codes with // expansion
  const expandedCodes = [];
  const multiCodes = allText.match(/SOM\.[A-Z0-9.]+\d{4}(?:\/\/\d{4})+/g) || [];
  multiCodes.forEach((match) => {
    const parts = match.split("//");
    const base = parts[0];
    const prefix = base.split(".").slice(0, -1).join(".");
    parts.forEach((p, i) => {
      expandedCodes.push(i === 0 ? base : `${prefix}.${p.trim()}`);
    });
  });

  // Strategy 3: Find consecutive code sequences (fill range between min/max known codes)
  const consecutiveCodes = [];
  const baseNums = fullCodes.map((c) => {
    const num = parseInt(c.split(".").pop(), 10);
    const prefix = c.split(".").slice(0, -1).join(".");
    return { num, prefix, code: c };
  });

  if (baseNums.length > 0) {
    const nums = baseNums.map((b) => b.num).sort((a, b) => a - b);
    const prefix = baseNums[0].prefix;
    const min = nums[0];
    const max = nums[nums.length - 1];
    for (let n = min; n <= max; n++) {
      consecutiveCodes.push(`${prefix}.${n}`);
    }
  }

  // Merge all strategies, dedupe, filter valid
  const allCodes = [...new Set([...fullCodes, ...expandedCodes, ...consecutiveCodes])].filter((c) => {
    const parts = c.split(".");
    return parts.length >= 6 && /^\d{4}$/.test(parts[parts.length - 1]);
  });

  console.log(`SOM code discovery for ${lec?.lectureTitle || lec?.id || "lecture"}:`, {
    fullCodes: fullCodes.length,
    expandedCodes: expandedCodes.length,
    consecutiveCodes: consecutiveCodes.length,
    total: allCodes.length,
  });

  return allCodes.sort();
}

/** When OCR leaves [tbl-0.md] instead of table cells, recover objectives via AI using codes + surrounding chunks. */
async function extractObjectivesFromTblReferenceContext(objectivesChunk, chunks, lec, blockId) {
  const bid = blockId ?? lec?.blockId;
  const idx = chunks.indexOf(objectivesChunk);
  if (idx < 0) return [];

  const allChunkText = (chunks || []).map((c) => getChunkBody(c) || "").join("\n");

  const uniqueCodes = findAllSOMCodesForLecture(chunks, lec);
  if (uniqueCodes.length === 0) {
    console.warn(
      `No SOM codes found in ${lec?.lectureTitle || lec?.id || "lecture"} chunks — trying to infer from block context`
    );
    const inferred = await callAIJSON(
      `You extract learning objectives from medical lecture content.
Return ONLY a JSON array.`,
      `Lecture: ${lec.lectureTitle || ""}

Generate 3-8 specific learning objectives for this lecture 
based on the content below. Each must start with an action 
verb (Summarize, Outline, Discuss, Describe, Identify, etc).

Content:
${allChunkText.slice(0, 3000)}

JSON only: [{"text": "Summarize the..."}]`,
      [],
      2000
    );
    let rows = Array.isArray(inferred) ? inferred : Array.isArray(inferred?.objectives) ? inferred.objectives : null;
    if (!rows) rows = [];
    return rows
      .filter((o) => o && o.text && String(o.text).trim().length > 10)
      .map((o) => ({
        ...buildObjEntry("", String(o.text).trim(), lec, bid),
        code: null,
        objectiveCode: null,
        extractionMethod: "ai-inferred",
      }));
  }

  const codeContextMap = {};
  uniqueCodes.forEach((code) => {
    const codeNum = code.split(".").pop();
    const idxSet = new Set();
    (chunks || []).forEach((c, i) => {
      const text = getChunkBody(c) || c.markdown || c.text || "";
      if (text.includes(codeNum) || text.includes(code)) {
        idxSet.add(i);
        if (i > 0) idxSet.add(i - 1);
        if (i < chunks.length - 1) idxSet.add(i + 1);
      }
    });
    const sortedIdx = [...idxSet].sort((a, b) => a - b);
    const merged = sortedIdx
      .map((i) => getChunkBody(chunks[i]) || chunks[i]?.markdown || chunks[i]?.text || "")
      .join("\n");
    codeContextMap[code] = merged.slice(0, 500);
  });

  const codeContextStr = uniqueCodes
    .map((code) => `${code}:\n${codeContextMap[code] || "(no specific content found)"}`)
    .join("\n\n");

  const systemPrompt =
    "You extract learning objectives from medical lectures. Respond ONLY with a JSON array. No markdown, no explanation.";
  const userPrompt = `Lecture: ${lec.lectureTitle || ""}

Generate one learning objective per SOM code below.
Use the content shown under each code as context.
Start each objective with an action verb.
Return the FULL code exactly as shown.

${codeContextStr}

Also use this general lecture content:
${allChunkText.slice(0, 2000)}

JSON only, one entry per code:
[{"code":"FULL.SOM.CODE.HERE","text":"Describe..."}]`;

  const fallback = uniqueCodes.map((c) => ({ code: c, text: c }));
  const result = await callAIJSON(systemPrompt, userPrompt, fallback, 4000);

  let rows = Array.isArray(result) ? result : Array.isArray(result?.objectives) ? result.objectives : null;
  if (!rows) rows = fallback;

  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const t = String(row.text || "").trim();
    const c = String(row.code || "").trim();
    if (!c || !t || t.startsWith("SOM.") || t.length < 10) continue;
    out.push({
      ...buildObjEntry(c, t, lec, bid),
      extractionMethod: "tbl-ref-ai",
    });
  }
  return out;
}

const INLINE_SOM_CONTEXT_MAX = 1500;

/** When multiple codes share a chunk, prefer later chunks that reference only that code; else the shared chunk. */
function getInlineSOMCodeContext(code, allChunks) {
  const codeNum = String(code).split(".").pop()?.split("//")[0]?.trim() || "";
  if (!codeNum) return "";

  const bodyOf = (c) => normalizeSomCodesInText(getChunkBody(c) || "");

  const dedicated = (allChunks || []).filter((c) => {
    const text = bodyOf(c);
    const raw = text.match(/SOM\.[A-Z0-9.]+(?:\/\/\d+)*/g) || [];
    const normalized = [...new Set(raw.map((m) => m.split("//")[0].trim()))];
    if (normalized.length !== 1) return false;
    const only = normalized[0];
    return only === code || only.endsWith("." + codeNum);
  });

  if (dedicated.length > 0) {
    return dedicated.map((c) => bodyOf(c).slice(0, INLINE_SOM_CONTEXT_MAX)).join("\n\n");
  }

  const shared = (allChunks || []).find((c) => bodyOf(c).includes(code));
  return shared ? bodyOf(shared).slice(0, INLINE_SOM_CONTEXT_MAX) : "";
}

export async function extractInlineSOMCodes(chunks, lec, blockId, alreadyFound) {
  const allResults = [];
  const seen = new Set(alreadyFound || []);
  const bid = blockId ?? lec?.blockId;

  for (let idx = 0; idx < (chunks || []).length; idx++) {
    const chunk = chunks[idx];
    const rawText = getChunkBody(chunk);
    if (!rawText) continue;

    if (chunkHasTableFileReference(rawText)) {
      console.log(`Chunk ${idx}: table reference detected, skipping for extraction`);
      continue;
    }

    const text = normalizeSomCodesInText(rawText);
    const somPattern = /SOM\.[A-Z0-9.]+(?:\/\/\d+)*/g;
    const matches = text.match(somPattern) || [];
    if (matches.length === 0) continue;

    const codesOrdered = [];
    const pushCode = (c) => {
      if (c && !codesOrdered.includes(c)) codesOrdered.push(c);
    };

    matches.forEach((match) => {
      const parts = match.split("//").map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) return;
      const base = parts[0];
      if (!base || !/^SOM\./.test(base)) return;
      const segments = base.split(".");
      if (segments.length < 2) return;
      const prefix = segments.slice(0, -1).join(".");
      parts.forEach((p, i) => {
        const fullCode = i === 0 ? base : `${prefix}.${p.trim()}`;
        pushCode(fullCode);
      });
    });

    const newCodes = codesOrdered.filter((c) => !seen.has(c));
    if (newCodes.length === 0) continue;

    const chunkFallbackEntries = newCodes.map((c) => {
      const lines = text
        .split("\n")
        .map((l) =>
          l
            .replace(/^#+\s*/, "")
            .replace(/^[-•*]\s*/, "")
            .replace(/!\[.*?\]\(.*?\)/g, "")
            .trim()
        )
        .filter(
          (l) =>
            l.length > 15 &&
            !l.startsWith("SOM.") &&
            !l.startsWith("http") &&
            !l.includes(".md]")
        );
      const slideText = lines.slice(0, 2).join(" — ");
      return {
        code: c,
        text: slideText || `Objective ${c.split(".").pop()}`,
      };
    });
    const fallbackForCode = (c) =>
      chunkFallbackEntries.find((e) => e.code === c)?.text || `Objective ${c.split(".").pop()}`;

    const codeSections = newCodes
      .map((c) => {
        const ctx = getInlineSOMCodeContext(c, chunks).replace(/!\[.*?\]\(.*?\)/g, "");
        return `### ${c}\nLecture excerpt for this code only (may include a later slide that lists only this code when several codes shared one header):\n${ctx}`;
      })
      .join("\n\n");

    const systemPrompt =
      "You are extracting medical learning objectives. Respond ONLY with a JSON array. No markdown, no explanation.";
    const userPrompt = `This medical lecture includes these learning objectives (SOM codes): ${newCodes.join(", ")}

Each code has its own excerpt below. When several codes shared one slide or section title, use that code's excerpt — not only the shared title — so each objective reflects the material specific to that code.

${codeSections}

Write one specific learning objective per SOM code.
Use each code's excerpt to make that objective specific and meaningful — NOT generic like "Objectives" or "Describe the topic", and NOT the same wording for different codes unless the excerpts are truly identical.
Start each with a verb: List, Describe, Identify, State, Explain, Compare, Distinguish, Define.

JSON array only:
[{"code":"SOM.XX","text":"Describe the three layers..."}]`;

    const result = await callAIJSON(systemPrompt, userPrompt, chunkFallbackEntries, 3000);

    let rows = Array.isArray(result) ? result : Array.isArray(result?.objectives) ? result.objectives : null;
    if (!rows) {
      console.warn("extractInlineSOMCodes: AI did not return a JSON array, using fallback");
      rows = chunkFallbackEntries;
    }

    const textByCode = new Map();
    for (const obj of rows) {
      if (!obj || typeof obj !== "object") continue;
      const t = String(obj.text || "").trim();
      const c = String(obj.code || "").trim();
      if (c && t && t !== "Objectives" && t.length > 5 && newCodes.includes(c)) {
        textByCode.set(c, t);
      }
    }

    for (const fullCode of newCodes) {
      seen.add(fullCode);
      const objectiveText = textByCode.get(fullCode) || fallbackForCode(fullCode);
      allResults.push({
        ...buildObjEntry(fullCode, objectiveText, lec, bid),
        extractionMethod: "inline-som-ai",
      });
    }
  }

  const deduped = Object.values(
    allResults.reduce((acc, obj) => {
      const code = obj?.code;
      if (!code) return acc;
      const existing = acc[code];
      const t = String(obj.text ?? "");
      const isCode = t.startsWith("SOM.") || t.length < 15;
      if (!existing || isCode === false) {
        acc[code] = obj;
      }
      return acc;
    }, {})
  );

  const GENERIC_RESPONSES = [
    "objectives",
    "describe the topic",
    "explain the content",
    "learning objective",
    "see slide",
    "refer to slide",
  ];

  const filtered = deduped.filter((obj) => {
    const lower = (obj.text || "").toLowerCase();
    return (
      !GENERIC_RESPONSES.some((g) => lower === g || lower.startsWith(g)) && (obj.text || "").length > 15
    );
  });

  return filtered.length > 0 ? filtered : deduped;
}

export async function extractObjectivesChunk(rawTextInput, lec, blockId) {
  const text = normalizeSomCodesInText(rawTextInput);
  const systemPrompt = `${LECTURE_MARKDOWN_SYSTEM_INSTRUCTION}

Extract ALL learning objectives from this medical lecture text.
Return JSON only. No markdown. Start with {
{"objectives":[{"text":"full objective text","code":"SOM.XX if present or null","bloom_level":3}]}
Extract EVERY objective you find. Do not summarize. Do not skip any.
Include the complete text of each objective.
bloom_level: 1=Remember, 2=Understand, 3=Apply, 4=Analyze, 5=Evaluate, 6=Create

${LECTURE_MARKDOWN_CONTEXT_FOR_AI}`;

  const userPrompt = `Lecture: ${lec.lectureType} ${lec.lectureNumber} — ${lec.lectureTitle || ""}

Extract all learning objectives from this text. Include every single one:

${text}`;

  const newId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ext_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  try {
    const raw = await callAI(systemPrompt, userPrompt, 4000);
    const parsed = tryParseObjectivesJSON(raw);
    if (!parsed?.objectives) return [];
    const rows = [];
    for (const item of parsed.objectives) {
      if (typeof item === "string") {
        const raw = item.trim();
        if (raw.length > 10) {
          const { text: t, activity: actTag } = parseObjectiveActivityTag(raw);
          rows.push({
            id: newId(),
            blockId,
            linkedLecId: lec.id,
            sourceFile: lec.id,
            objective: t,
            text: t,
            activity: actTag || lec.lectureType,
            code: null,
            objectiveCode: null,
            lectureType: lec.lectureType,
            lectureNumber: lec.lectureNumber,
            bloom_level: null,
            status: "untested",
          });
        }
      } else if (item && typeof item === "object") {
        const raw = (item.text || item.objective || "").trim();
        if (raw.length > 10) {
          const { text: t, activity: actTag } = parseObjectiveActivityTag(raw);
          rows.push({
            id: newId(),
            blockId,
            linkedLecId: lec.id,
            sourceFile: lec.id,
            objective: t,
            text: t,
            activity: actTag || lec.lectureType,
            code: item.code || null,
            objectiveCode: item.code || null,
            lectureType: lec.lectureType,
            lectureNumber: lec.lectureNumber,
            bloom_level: item.bloom_level ?? null,
            status: "untested",
          });
        }
      }
    }
    return rows;
  } catch (e) {
    console.error("extractObjectivesChunk failed:", e);
    return [];
  }
}

export async function extractObjectivesFromLecture(rawText, lec, blockId) {
  const bid = blockId ?? lec?.blockId;
  const fullText = prepareTextForObjectiveExtraction(rawText || "");
  const isCprBlock = typeof bid === "string" && bid.toLowerCase().startsWith("cpr");
  if (!fullText.trim() && !(isCprBlock && lec?.chunks?.length)) {
    return [];
  }

  const primary = await _extractObjectivesFromLectureCore(rawText, lec, blockId, fullText);
  const primaryFiltered = filterExtractedObjectivesQuality(primary, lec);
  if (primaryFiltered.length > 0) return primaryFiltered;
  if (isCprBlock && lec?.chunks?.length) {
    console.log("All extraction methods returned 0 — trying inline SOM code extraction");
    const inlineFallback = await extractInlineSOMCodes(lec.chunks, lec, bid, new Set());
    console.log(`Inline SOM fallback found: ${inlineFallback.length}`);
    return filterExtractedObjectivesQuality(deduplicateExtractedObjectives(inlineFallback), lec);
  }
  return primaryFiltered;
}

/**
 * Extract learning objectives from a standalone objectives document (not lecture slides).
 * The document lists objectives grouped by lecture / DLA / TBL / lab.
 * Auto-matches each objective to a lecture in blockLectures by lecture number or title keywords.
 */
/** "Lecture PHYS" → LEC, "Small group HCB;ANAT" → SG. The discipline is noise here. */
export function normalizeSectionActivity(label) {
  const l = String(label || "").toLowerCase();
  if (l.startsWith("small group") || /\bsg\b/.test(l)) return "SG";
  if (l.startsWith("dla")) return "DLA";
  if (l.startsWith("tbl")) return "TBL";
  if (l.startsWith("lab")) return "LAB";
  return "LEC";
}

/**
 * Split the objectives document into its `activity :: title` sections.
 *
 * The document is one table per session, and each session's header row carries
 * the activity in the first cell and the title in the second — the same cell
 * positions the objective rows use for code and text.
 */
export function parseObjectiveDocSections(text) {
  const src = String(text || "");
  const headers = [];
  // Markdown converters produce pipe-delimited tables, while PDF.js and
  // pdftotext preserve the original Excel columns as runs of whitespace.
  // Accept both: the official curriculum PDF should not require AI cleanup
  // simply because its table is an Excel export.
  const headerRe = /^\|?[^\S\n]*((?:Lecture|DLA|TBL|Small group|Lab)\b[^|\n]*?)(?:[^\S\n]*\|[^\S\n]*|\s{2,})([^|\n]+?)[^\S\n]*\|?[^\S\n]*$/gim;
  for (const m of src.matchAll(headerRe)) {
    if (/^SOM\./i.test(m[1].trim())) continue;
    headers.push({
      pos: m.index,
      end: m.index + m[0].length,
      activity: normalizeSectionActivity(m[1]),
      // A header cell can carry stray codes when the row wraps; they are not the title.
      title: m[2].replace(/SOM(?:\.\s?[A-Za-z0-9]+)+\.\s?\d{4}/g, "").trim(),
    });
  }
  if (!headers.length) return [{ activity: null, title: "", body: src }];

  const sections = [];
  if (headers[0].pos > 0) sections.push({ activity: null, title: "", body: src.slice(0, headers[0].pos) });
  headers.forEach((h, i) => {
    const stop = i + 1 < headers.length ? headers[i + 1].pos : src.length;
    sections.push({ activity: h.activity, title: h.title, body: src.slice(h.end, stop) });
  });
  return sections;
}

/**
 * The lecture a section belongs to, matched on title — but only among lectures
 * of the same activity.
 *
 * Without the activity gate a single shared word decides it: "DLA Nutrition &
 * Aging" scores a hit on "Nutritional Aspects of Pregnancy, Lactation and Infant
 * Nutrition" through `nutrition` alone and every aging objective lands on that
 * lecture instead of the DLA.
 */
export function matchLectureToSection(section, blockLectures) {
  const lectures = blockLectures || [];
  const activity = section?.activity || null;
  const pool = activity ? lectures.filter((l) => (l.lectureType || "LEC") === activity) : lectures;
  if (!pool.length) return null;

  const title = String(section?.title || "");
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3);
  if (!tokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const lec of pool) {
    const lecTitle = String(lec.lectureTitle || "").toLowerCase();
    const score = tokens.filter((t) => lecTitle.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = lec; }
  }
  return bestScore > 0 ? best : null;
}

/**
 * The SOM codes in an objectives document, read directly.
 *
 * The document is the school's own curriculum, printed as `CODE text` rows, so
 * the codes are already in the text verbatim — the same reasoning that moved the
 * lecture path off the model. Reading them here also removes the prompt's
 * `slice(0, 14000)` ceiling: against the ER module that window held 104 of 459
 * objectives, and the other 355 were never sent.
 */
export function extractCodedObjectivesFromDoc(text, blockLectures, blockId) {
  const out = [];
  for (const section of parseObjectiveDocSections(text)) {
    const matched = matchLectureToSection(section, blockLectures);
    const sectionLec = {
      id: matched?.id || "imported",
      lectureType: section.activity || matched?.lectureType || "LEC",
      lectureNumber: matched?.lectureNumber ?? null,
    };
    for (const entry of extractCodeDelimited(section.body, sectionLec, blockId)) {
      out.push({ ...entry, lectureHint: section.title || undefined, extractionMethod: "standalone-doc" });
    }
  }

  // Sections repeat their header across page breaks, so the same code can appear twice.
  const seen = new Set();
  return out.filter((o) => {
    if (!o.code || seen.has(o.code)) return !o.code;
    seen.add(o.code);
    return true;
  });
}

export async function extractObjectivesFromStandaloneDoc(text, blockLectures, blockId) {
  const coded = extractCodedObjectivesFromDoc(text, blockLectures, blockId);
  if (coded.length >= 3) {
    console.log(`Extracted ${coded.length} coded objectives from the objectives doc without AI`);
    return coded;
  }

  const systemPrompt =
    "You extract learning objectives from medical school curriculum documents. Return ONLY valid JSON — no markdown, no prose.";

  const userPrompt = `You are reading a standalone objectives document (not lecture slides). It lists objectives grouped by lecture, DLA, TBL, or lab.

Extract EVERY learning objective. For each, identify:
- "objective": the full objective text (start with action verb, strip numbering)
- "lectureHint": the section header this objective falls under (e.g. "Lecture 3", "DLA 2", "Histology Lab", "Week 1 TBL")
- "lectureNumber": a number if identifiable from the hint (null if not)
- "activity": one of LEC/DLA/TBL/SG/LAB (infer from hint or text; default LEC)
- "code": SOM code if present (e.g. "SOM.1.BMP.1"), else null
- "bloom_level": 1-6 based on verb (1=recall/identify, 2=describe/explain, 3=apply/demonstrate, 4=analyze/compare, 5=evaluate/critique, 6=design/synthesize)

Return ONLY valid JSON:
{"objectives":[{"objective":"Describe...","lectureHint":"Lecture 3","lectureNumber":3,"activity":"LEC","code":null,"bloom_level":2}]}

DOCUMENT:
${text.slice(0, 14000)}`;

  const fallback = { objectives: [] };
  const result = await callAIJSON(systemPrompt, userPrompt, fallback, 6000);
  const rows = Array.isArray(result) ? result : Array.isArray(result?.objectives) ? result.objectives : [];

  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const objective = (row.objective || "").trim();
    if (!objective || objective.length < 10) continue;

    const lectureNumber = row.lectureNumber != null ? parseInt(row.lectureNumber, 10) : null;
    const lectureHint = (row.lectureHint || "").trim();

    let matchedLecId = "imported";
    let matchedLecNumber = null;

    // 1. Exact lecture number match
    if (lectureNumber != null && !isNaN(lectureNumber)) {
      const exact = (blockLectures || []).find(
        (lec) => parseInt(lec.lectureNumber, 10) === lectureNumber
      );
      if (exact) {
        matchedLecId = exact.id;
        matchedLecNumber = exact.lectureNumber;
      }
    }

    // 2. Keyword match against lecture titles
    if (matchedLecId === "imported" && lectureHint) {
      const tokens = lectureHint.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
      let bestScore = 0;
      let bestLec = null;
      for (const lec of (blockLectures || [])) {
        const title = (lec.lectureTitle || "").toLowerCase();
        const score = tokens.filter((t) => title.includes(t)).length;
        if (score > bestScore) { bestScore = score; bestLec = lec; }
      }
      if (bestLec && bestScore > 0) {
        matchedLecId = bestLec.id;
        matchedLecNumber = bestLec.lectureNumber;
      }
    }

    const fakeMinimalLec = {
      id: matchedLecId,
      lectureType: row.activity || "LEC",
      lectureNumber: matchedLecNumber,
    };

    const entry = {
      ...buildObjEntry(row.code || "", objective, fakeMinimalLec, blockId),
      bloom_level: row.bloom_level ?? undefined,
      extractionMethod: "standalone-doc",
    };
    out.push(entry);
  }

  return out;
}

/** Primary + AI extraction only; inline SOM fallback is applied in extractObjectivesFromLecture after this returns. */
async function _extractObjectivesFromLectureCore(rawText, lec, blockId, fullText) {
  const bid = blockId ?? lec?.blockId;
  const isCPR = typeof bid === "string" && bid.toLowerCase().startsWith("cpr");

  for (const source of [(lec?.chunks || []).map(getChunkBody).join("\f"), rawText]) {
    const scoped = extractScopedLectureObjectives(source, lec, bid);
    if (scoped?.length) return scoped;
  }

  /**
   * Coded objectives come first, for EVERY block.
   *
   * All of the parsing below used to sit behind `isCPR`, so a Term 2 block —
   * whose id is a generated string like "mrspx2sg9go" — never reached it and
   * got its objectives purely from AI slices. Measured on the 24 imported
   * Endocrine lectures that recovered 258 of 455 codes; parsing them directly
   * recovers 454. The codes are the school's own curriculum, they are in the
   * text verbatim, and a model is the wrong tool for copying them out.
   */
  const codedText = [rawText, fullText, (lec?.chunks || []).map(getChunkBody).join("\n\n")]
    .filter(Boolean)
    .join("\n\n");
  const coded = extractCodeDelimited(codedText, lec, bid);
  if (coded.length >= 3) {
    console.log(`Extracted ${coded.length} coded objectives without AI`);
    return deduplicateExtractedObjectives(coded);
  }
  if (isCPR && lec?.chunks?.length) {
    // Part A+B merged PDFs: objectives may live in Part B — prefer last matching objectives-table chunk.
    const preferLast = !!lec.partABMerged;
    const objChunk = findObjectivesTableChunk(lec.chunks, { preferLast });
    if (objChunk) {
      const objChunkText = getChunkBody(objChunk);
      const tblNeedsAi =
        chunkHasTableFileReference(objChunkText) && chunkOrNeighborsMentionObjectives(objChunk, lec.chunks);
      if (tblNeedsAi) {
        console.log("Objectives chunk: table reference + Objectives context — AI recovery");
        const tblAi = await extractObjectivesFromTblReferenceContext(objChunk, lec.chunks, lec, bid);
        if (tblAi.length > 0) {
          console.log("Extracted", tblAi.length, "objectives from table-ref AI");
          return deduplicateExtractedObjectives(tblAi);
        }
      }
      if (!chunkHasTableFileReference(objChunkText)) {
        console.log("Found objectives chunk, extracting...");
        const fromChunk = extractFromTableText(objChunkText, lec, bid);
        if (fromChunk.length >= 3) {
          const inlineObjs = await extractInlineSOMCodes(
            lec.chunks,
            lec,
            bid,
            new Set(fromChunk.map((o) => o.code).filter(Boolean))
          );
          const all = [...fromChunk, ...inlineObjs];
          console.log("Extracted", all.length, "objectives from chunks");
          return deduplicateExtractedObjectives(all);
        }
      } else {
        console.log("Objectives chunk: table reference detected, skipping table-cell extraction");
      }
    }

    const allChunkText = lec.chunks
      .map((c, idx) => {
        const t = getChunkBody(c);
        if (chunkHasTableFileReference(t)) {
          console.log(`Chunk ${idx}: table reference detected, skipping for extraction`);
          return "";
        }
        return t;
      })
      .filter(Boolean)
      .join("\n");
    const fromAllChunks = extractFromTableText(allChunkText, lec, bid);
    if (fromAllChunks.length >= 3) return deduplicateExtractedObjectives(fromAllChunks);
  }

  const fullTextForAi = buildFullTextForObjectiveAi(fullText, lec?.chunks, getChunkBody);

  // Fallback: use AI on full lecture text (prefer chunk-joined content — never first-N-only truncation)
  if (fullTextForAi.length <= OBJECTIVE_AI_MAX_SECTION) {
    return deduplicateExtractedObjectives(await extractObjectivesChunk(fullTextForAi, lec, bid));
  }
  const slices = getSequentialObjectiveSlices(fullTextForAi);
  const allObjs = [];
  for (const slice of slices) {
    const part = await extractObjectivesChunk(slice, lec, bid);
    allObjs.push(...part);
  }
  return deduplicateExtractedObjectives(allObjs);
}
