/**
 * SP1 T6.1 — the teaching map, lifted out of App.jsx.
 *
 * One model call turns a lecture into the structure DeepLearn teaches from:
 * a clinical hook, sections with core content and anchor questions, and the
 * big-picture takeaway. DeepLearn reads `lec.teachingMap.clinicalHook` as the
 * case it opens with, so a lecture without a map teaches with no patient.
 *
 * The model is not trusted to answer in one shape: sections have been returned
 * under `sections`, `map`, `content`, and as a bare array. All four are
 * accepted, and a response with no sections at all falls back to the lecture's
 * subtopics rather than leaving the lecture unteachable.
 */
import { callAI } from "../aiClient.js";
import { LECTURE_MARKDOWN_CONTEXT_FOR_AI } from "../aiPromptSnippets.js";
import { tryParseJSON } from "../lib/aiJson.js";

const EMPTY_MAP = { summary: "", clinicalHook: "", sections: [], bigPicture: "" };

export const TEACHING_MAP_SYSTEM_PROMPT = `Return only valid JSON. No markdown. No code fences.
No explanation text. Start with { or [.

You are an expert medical educator analyzing a lecture for a medical student study app.
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

/** The lecture half of the prompt. Separate so a test can read it. */
export function buildTeachingMapUserPrompt(lec, extractedText) {
  return `Lecture title: ${lec.lectureTitle || ""}
Lecture type: ${lec.lectureType || ""} ${lec.lectureNumber ?? ""}

${LECTURE_MARKDOWN_CONTEXT_FOR_AI}

Full lecture content:
${(extractedText || "").slice(0, 6000)}`;
}

/** Sections from whichever key the model used this time. */
function sectionsFrom(result) {
  return (
    (Array.isArray(result?.sections) ? result.sections : null) ||
    (Array.isArray(result?.map) ? result.map : null) ||
    (Array.isArray(result?.content) ? result.content : null) ||
    (Array.isArray(result) ? result : null)
  );
}

/** One section per subtopic, so a failed analysis still leaves something to study. */
function fallbackSections(subtopics) {
  if (subtopics.length > 0) {
    return subtopics.map((topic) => ({
      title: String(topic),
      coreContent: `Study the key concepts related to: ${topic}`,
      objectives: [],
    }));
  }
  return [
    {
      title: "Overview",
      coreContent: "Study the key concepts from this lecture using the source material.",
      objectives: [],
    },
  ];
}

export async function analyzeLecture(lec, extractedText) {
  const subtopics = Array.isArray(lec?.subtopics) ? lec.subtopics : [];

  try {
    const raw = await callAI(
      TEACHING_MAP_SYSTEM_PROMPT,
      buildTeachingMapUserPrompt(lec, extractedText),
      2500
    );
    const result = tryParseJSON(raw) || EMPTY_MAP;
    const sections = sectionsFrom(result);

    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      console.log("analyzeLecture: subtopic fallback,", "keys:", Object.keys(result || {}).join(", "));
      return {
        summary: result?.summary || "",
        clinicalHook: result?.clinicalHook || "",
        bigPicture: result?.bigPicture || "",
        sections: fallbackSections(subtopics),
      };
    }

    if (Array.isArray(result) && !result.sections) {
      return { summary: "", clinicalHook: "", bigPicture: "", sections };
    }

    return { ...result, sections };
  } catch (e) {
    console.warn("analyzeLecture failed:", e?.message || e);
    return { ...EMPTY_MAP };
  }
}
