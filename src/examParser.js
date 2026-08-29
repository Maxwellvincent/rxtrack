import { callAI, callAIWithImage, callAIWithImages } from "./aiClient.js";
import { extractWithSmartFallback } from "./ingest/pdfText.js";
import { imageForText, isUsableImage } from "./lectureImages.js";

function detectLectureNumber(text) {
  const m =
    (text || "").match(/lecture\s*(\d+)/i) ||
    (text || "").match(/\blec[\s_-]*(\d+)/i) ||
    (text || "").match(/\bL(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : null;
}

export async function loadPDFJS() {
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
    s.onerror = () => rej(new Error("PDF.js failed"));
    document.head.appendChild(s);
  });
}

export function detectFormat(pages, fullText) {
  if (/\bMy Score\b/i.test(fullText || "") && /\bAverage Score\b/i.test(fullText || "")) {
    return "report";
  }
  // ExamSoft answer exports use `Question #: 12` and mark the keyed option
  // with a check. They are continuous documents, not grid slides.
  if ((String(fullText || "").match(/(?:^|\n)\s*Question\s*#\s*:\s*\d+/gi) || []).length >= 3) {
    return "standard";
  }
  // School PowerPoint keys commonly repeat each numbered question on the next
  // slide, adding a highlighted answer and an objective code. Treat those as a
  // paired answer-key deck before the generic "grid" heuristic sees the many
  // A-F labels and misclassifies every slide as several questions.
  const numericPageLabels = (pages || []).map((p) =>
    String(p?.text || "").match(/^\s*(\d+)[.)]\s+/)?.[1] || null
  );
  const pairedNumericSlides = numericPageLabels.filter(
    (n, i) => n && numericPageLabels[i + 1] === n
  ).length;
  if (pairedNumericSlides >= 3) return "pairedkey";
  // Slide deck with numbered QUESTION labels spanning pages
  const slideLabels = fullText.match(/QUESTION\s+\d+/gi) || [];
  const uniqueNums = new Set(slideLabels.map((s) => s.match(/\d+/)[0]));
  const labelsPerPage = pages.map((p) => (p.text.match(/\bQUESTION\s+\d+/gi) || []).length);
  // A continuous ExamSoft export has multiple "Question N" blocks on a page. Treating it as
  // one-question-per-slide merges those blocks and disconnects them from the answer key.
  if (uniqueNums.size >= 3 && labelsPerPage.some((count) => count > 1)) return "standard";
  if (uniqueNums.size > 3) return "slidedeck";

  // Grid format: single page has 3+ question blocks with A. B. C. D. choices
  const gridPages = pages.filter((p) => {
    const choiceMatches = (p.text.match(/\b[A-F]\./g) || []).length;
    return choiceMatches >= 8; // at least 2 questions worth of choices per page
  });
  if (gridPages.length > 0) return "grid";

  // Standard numbered list
  const numbered = fullText.match(/^\s*\d+[.)]\s+\S/mg) || [];
  if (numbered.length > 3) return "standard";

  return "standard";
}

function parseSlideQuestionText(text) {
  const source = String(text || "").replace(/\r/g, "").trim();
  const first = source.match(/^\s*(\d+)[.)]\s+([\s\S]*)$/);
  if (!first) return null;
  const num = Number(first[1]);
  const lines = first[2].split("\n");
  const stemLines = [];
  const choices = {};
  let letter = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^SOM\.[A-Z0-9.]+\s+/i.test(line)) continue;
    const choice = line.match(/^([A-H])[.)]\s*(.*)$/);
    if (choice) {
      letter = choice[1].toUpperCase();
      choices[letter] = choice[2].trim();
    } else if (letter) {
      choices[letter] = `${choices[letter]} ${line}`.trim();
    } else {
      stemLines.push(line);
    }
  }
  return { num, stem: stemLines.join(" ").replace(/\s+/g, " ").trim(), choices };
}

/**
 * Parse paired school answer-key slides such as the ER IMCQ keys. Slide one
 * presents the item; slide two repeats it with a visual answer highlight and
 * a SOM objective. Text alone cannot reliably identify the highlight, so the
 * parser deliberately returns the deduplicated structure and lets the visual
 * AI pass determine `correct` from both rendered pages.
 */
export function groupPairedKeySlides(pages) {
  const groups = [];
  for (let i = 0; i < (pages || []).length; i++) {
    const parsed = parseSlideQuestionText(pages[i]?.text);
    if (!parsed || Object.keys(parsed.choices).length < 2) continue;
    const next = parseSlideQuestionText(pages[i + 1]?.text);
    const answerPage = next?.num === parsed.num ? pages[i + 1] : null;
    const objectiveMatch = String(answerPage?.text || pages[i]?.text || "").match(
      /\b(SOM\.[A-Z0-9.]+)\s+([^\n]+)/i
    );
    groups.push({
      ...parsed,
      questionPage: pages[i],
      answerPage,
      schoolObjectiveCode: objectiveMatch?.[1] || null,
      schoolObjective: objectiveMatch?.[2]?.trim() || null,
    });
    if (answerPage) i++;
  }
  return groups;
}

async function parsePairedKeyFormat(pages, onProgress, examTitle = "") {
  const groups = groupPairedKeySlides(pages);
  onProgress?.(`🔑 Found ${groups.length} paired school-key questions…`);
  const questions = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const renderB64 = async (pdfPage) => {
      const vp = pdfPage.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      return canvas.toDataURL("image/png").split(",")[1];
    };
    const images = [];
    if (group.answerPage?.pdfPage) images.push({ base64: await renderB64(group.answerPage.pdfPage), mimeType: "image/png" });
    if (group.questionPage?.pdfPage) images.push({ base64: await renderB64(group.questionPage.pdfPage), mimeType: "image/png" });
    const prompt =
      "Extract this one medical-school multiple-choice question. The first image is the keyed answer slide; the second is the unmarked question when supplied. Identify the visibly highlighted/checked correct option. Return ONLY JSON: " +
      '{"correct":"A","explanation":"brief reason or null","topic":"specific topic","type":"clinicalVignette|mechanismBased|laboratory|anatomy"}. ' +
      "Do not infer a different key from medical knowledge when the slide visibly marks one.";
    let visual = {};
    try {
      const raw = (await callAIWithImages(null, prompt, images, 1200, 0.1)).trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      visual = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    } catch (e) {
      console.warn(`Paired key question ${group.num} visual parse failed:`, e.message);
    }
    questions.push({
      id: `q${group.num}`,
      num: group.num,
      type: visual.type || "clinicalVignette",
      imageQuestion: group.questionPage?.imgCount > 0,
      subject: "Uploaded",
      topic: visual.topic || examTitle || "School review",
      stem: group.stem,
      choices: group.choices,
      correct: visual.correct && group.choices[visual.correct] ? visual.correct : null,
      explanation: visual.explanation || null,
      difficulty: "hard",
      hasImage: group.questionPage?.imgCount > 0,
      schoolObjectiveCode: group.schoolObjectiveCode,
      schoolObjective: group.schoolObjective,
    });
    onProgress?.(`🔑 Reading school key ${i + 1} of ${groups.length}…`);
  }
  return questions;
}

/**
 * Parse a continuous ExamSoft-style bank without an AI round trip.
 *
 * Expected shape: repeated `Question N` blocks followed by an `Answer Key` whose entries begin
 * `QN: A - explanation`. The parser intentionally requires several blocks before claiming the
 * document so unrelated prose containing one "Question 1" falls through to the AI parser.
 */
export function parseNumberedQuestionBankText(fullText, examTitle = "") {
  const source = String(fullText || "").replace(/\r/g, "");
  const answerHeading = source.search(/\n\s*Answer Key\s*\n/i);
  const questionText = answerHeading >= 0 ? source.slice(0, answerHeading) : source;
  const answerText = answerHeading >= 0 ? source.slice(answerHeading) : "";
  const answers = new Map();
  const answerRe = /(?:^|\n)\s*Q(\d+)\s*:\s*([A-H])\s*(?:[—–-])\s*([\s\S]*?)(?=(?:\n\s*Q\d+\s*:)|$)/gi;
  for (const match of answerText.matchAll(answerRe)) {
    answers.set(Number(match[1]), { correct: match[2].toUpperCase(), explanation: match[3].trim() });
  }

  const blocks = [];
  // Marker/LLM cleanup sometimes changes `Question 12` into `12.`. Accept
  // both while still requiring a line-leading integer, so option letters can
  // never start a false question block.
  const questionRe = /(?:^|\n)\s*(?:Question\s*(?:#\s*:)?\s*)?(\d+)[.)]?\s*\n([\s\S]*?)(?=(?:\n\s*(?:Question\s*(?:#\s*:)?\s*)?\d+[.)]?\s*\n)|$)/gi;
  for (const match of questionText.matchAll(questionRe)) blocks.push({ num: Number(match[1]), body: match[2] });
  if (blocks.length < 3) return [];

  return blocks.map(({ num, body }) => {
    const lines = body.split("\n");
    const stemLines = [];
    const choices = {};
    let letter = null;
    let inlineCorrect = null;
    const rationaleLines = [];
    let inRationale = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === "[PAGE_BREAK]") continue;
      const rationale = line.match(/^Rationale\s*:\s*(.*)$/i);
      if (rationale) {
        inRationale = true;
        letter = null;
        if (rationale[1]) rationaleLines.push(rationale[1]);
        continue;
      }
      if (inRationale) {
        if (!/^Attachment\s*:/i.test(line) && !/^_+$/.test(line)) rationaleLines.push(line);
        continue;
      }
      const choice = line.match(/^([✓✔])?\s*([A-H])[.)]\s*(.*)$/);
      if (choice) {
        letter = choice[2].toUpperCase();
        choices[letter] = choice[3].trim();
        if (choice[1]) inlineCorrect = letter;
      } else if (letter) {
        choices[letter] = `${choices[letter]} ${line}`.trim();
      } else {
        stemLines.push(line);
      }
    }
    const answer = answers.get(num);
    const stem = stemLines.join(" ").replace(/\s+/g, " ").trim();
    return {
      id: `q${num}`,
      num,
      type: "clinicalVignette",
      imageQuestion: false,
      subject: "Uploaded",
      topic: examTitle || "Exam Review",
      stem,
      choices,
      correct: answer?.correct || inlineCorrect || null,
      explanation: answer?.explanation || rationaleLines.join(" ").replace(/\s+/g, " ").trim() || null,
      difficulty: "medium",
      choiceLayout: null,
      choiceColumns: null,
      hasImage: /\b(?:figure|image|photomicrograph|graph|pathway)\b/i.test(stem),
    };
  }).filter((q) => q.stem.length > 20 && Object.keys(q.choices).length >= 2);
}

export function expectedQuestionCountFromAnswerKey(fullText) {
  const ids = [...String(fullText || "").matchAll(/(?:^|\n)\s*Q(\d+)\s*:\s*[A-H]\b/gim)]
    .map((m) => Number(m[1]))
    .filter(Number.isFinite);
  if (ids.length) return new Set(ids).size;
  const source = String(fullText || "");
  const inlineIds = [...source.matchAll(/(?:^|\n)\s*Question\s*#\s*:\s*(\d+)/gim)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const checkedChoices = (source.match(/(?:^|\n)\s*[✓✔]\s*[A-H][.)]/gim) || []).length;
  return inlineIds.length >= 3 && checkedChoices >= inlineIds.length
    ? new Set(inlineIds).size
    : null;
}

/**
 * Extraction prompt for the standard/AI parse path.
 *
 * Pulled out as a pure function so option-count and table/image handling can be
 * tested without a live model or pdf.js.
 */
export function buildExamExtractionPrompt(text) {
  return (
    "Extract ALL medical exam questions from this text. Return ONLY valid JSON, no markdown:\n" +
    '{"questions":[{' +
    '"stem":"complete question text ending with ?",' +
    '"choices":{"A":"...","B":"...", "...": "as many lettered choices as the source offers"},' +
    '"correct":"A",' +
    '"explanation":"explanation text or null",' +
    '"topic":"medical topic",' +
    '"difficulty":"easy|medium|hard",' +
    '"type":"clinicalVignette|mechanismBased|pharmacology|laboratory",' +
    '"choiceLayout":"table (omit this field entirely if choices are plain text)",' +
    '"choiceColumns":["ordered column headers — only when choiceLayout is table"],' +
    '"hasImage":true' +
    "}]}\n\n" +
    "Rules: Only extract questions actually present. Extract EXACTLY as many lettered choices (A, B, C, D, E, F, and beyond) " +
    "as the source offers for that question — do not force every question to exactly 4, and do not drop extra options past D or E.\n" +
    "If the answer choices are laid out as a table/grid — each option is a full row of values across several columns, not a plain " +
    "sentence — set choiceLayout to \"table\", set choiceColumns to that table's ordered column headers, and represent each option's " +
    "choice as an OBJECT mapping each column header to that row's value (not a flattened sentence).\n" +
    "If a question's stem references a figure, image, photomicrograph, X-ray, or graph that this text extraction cannot reproduce, " +
    "still extract the full stem, choices, and answer, and set hasImage to true — do not fabricate a description of what the image " +
    "shows, and do not drop the question.\n" +
    "If answer key shows correct answer include it. If no explanation exists set to null. Detect question type from content.\n\n" +
    "TEXT:\n" +
    text
  );
}

/**
 * Validate + shape one AI-extracted question. Pure — no network, no pdf.js.
 *
 * `num`/`id` are 1-based and assigned by the caller across all chunks, since a
 * single chunk doesn't know its offset into the full question list.
 */
export function normalizeParsedExamQuestion(raw, num, { examTitle = "" } = {}) {
  if (!raw || typeof raw !== "object" || !raw.stem) return null;
  return {
    id: "q" + num,
    num,
    type: raw.type || "clinicalVignette",
    imageQuestion: false,
    subject: "Uploaded",
    topic: raw.topic || examTitle || "Exam Review",
    stem: raw.stem,
    choices: raw.choices || {},
    correct: raw.correct || null,
    explanation: raw.explanation || null,
    difficulty: raw.difficulty || "medium",
    choiceLayout: raw.choiceLayout === "table" ? "table" : null,
    choiceColumns: Array.isArray(raw.choiceColumns) ? raw.choiceColumns.map(String) : null,
    hasImage: !!raw.hasImage,
  };
}

/**
 * Hang each hasImage question's figure off the question object. Pure — no network.
 *
 * Mirrors `attachImagesToQuestions` in lectureImages.js: a wrong picture is worse than no
 * picture (it reads as a clue), so a question with no scoring match stays imageless.
 */
export function attachImagesToExamQuestions(questions, slideImages) {
  const list = (Array.isArray(slideImages) ? slideImages : []).filter(isUsableImage);
  const qs = Array.isArray(questions) ? questions : [];
  if (!qs.length || !list.length) return qs;
  return qs.map((q) => {
    if (!q?.hasImage || q.image) return q;
    const image = imageForText(`${q.topic || ""} ${q.stem || ""}`, list);
    return image ? { ...q, image } : q;
  });
}

async function parseWithAI(fullText, format, onProgress, examTitle = "") {
  const chunkSize = 10000;
  const overlap = 500;
  const chunks = [];
  for (let i = 0; i < fullText.length; i += chunkSize - overlap) {
    chunks.push(fullText.slice(i, i + chunkSize));
  }

  onProgress?.("🧠 Processing " + chunks.length + " section(s) with AI...");

  const allQuestions = [];
  const seenStems = new Set();

  for (let ci = 0; ci < chunks.length; ci++) {
    onProgress?.("🧠 Section " + (ci + 1) + " of " + chunks.length + "...");

    const prompt = buildExamExtractionPrompt(chunks[ci]);

    try {
      const text = (await callAI(null, prompt, 8000, undefined, 0.1)).trim();
      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const first = Math.min(
        cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
        cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("[")
      );
      const last = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
      if (first === Infinity || last === -1) continue;
      const parsed = JSON.parse(cleaned.slice(first, last + 1));
      const qs = Array.isArray(parsed) ? parsed : parsed.questions || [];

      for (const q of qs) {
        const key = (q.stem || "").slice(0, 60);
        if (!seenStems.has(key) && q.stem && q.stem.length > 20) {
          seenStems.add(key);
          const normalized = normalizeParsedExamQuestion(q, allQuestions.length + 1, { examTitle });
          if (normalized) allQuestions.push(normalized);
        }
      }
    } catch (e) {
      console.warn("Chunk " + (ci + 1) + " parse error:", e.message);
    }
  }

  return allQuestions;
}

async function parseGridFormat(pages, onProgress, options = {}) {
  const minChoiceCount = options.minChoiceCount ?? 6;
  const allQuestions = [];
  const seenStems = new Set();

  const gridPageGroups = [];
  let i = 0;

  while (i < pages.length) {
    const p = pages[i];
    const choiceCount = (p.text.match(/\b[A-F]\./g) || []).length;

    if (choiceCount >= minChoiceCount) {
      const group = { questionPage: p, answerPage: null };

      if (i + 1 < pages.length) {
        const next = pages[i + 1];
        const nextChoices = (next.text.match(/\b[A-F]\./g) || []).length;
        if (
          nextChoices >= 4 ||
          next.text.toLowerCase().includes("answer") ||
          next.text.toLowerCase().includes("correct")
        ) {
          group.answerPage = next;
          i++;
        }
      }
      gridPageGroups.push(group);
    }
    i++;
  }

  onProgress?.("📊 Found " + gridPageGroups.length + " grid question slides...");

  for (let gi = 0; gi < gridPageGroups.length; gi++) {
    const group = gridPageGroups[gi];
    onProgress?.("🧠 Parsing grid slide " + (gi + 1) + " of " + gridPageGroups.length + "...");

    const renderB64 = async (pdfPage) => {
      const vp = pdfPage.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await pdfPage.render({
        canvasContext: canvas.getContext("2d"),
        viewport: vp,
      }).promise;
      return canvas.toDataURL("image/png").split(",")[1];
    };

    const questionImg = await renderB64(group.questionPage.pdfPage);
    const answerImg = group.answerPage ? await renderB64(group.answerPage.pdfPage) : null;

    const combinedText =
      group.questionPage.text +
      (group.answerPage ? "\n\nANSWER PAGE:\n" + group.answerPage.text : "");

    const prompt =
      "This is a medical exam slide with multiple questions arranged in a grid/table layout.\n" +
      "Each cell in the grid contains one complete question with answer choices A, B, C, D.\n\n" +
      "Extract EVERY question from this slide. There should be multiple questions per slide.\n\n" +
      "If an answer page is provided, use it to determine the correct answer for each question.\n\n" +
      "Return ONLY valid JSON with no markdown:\n" +
      '{"questions":[{\n' +
      '  "stem": "complete question text ending with ?",\n' +
      '  "choices": {"A": "...", "B": "...", "...": "as many lettered choices as that question offers"},\n' +
      '  "correct": "B",\n' +
      '  "explanation": "why this is correct based on answer page, or null",\n' +
      '  "topic": "medical topic from the lecture title on the slide",\n' +
      '  "difficulty": "easy|medium|hard",\n' +
      '  "type": "clinicalVignette|mechanismBased|pharmacology|laboratory"\n' +
      "}]}\n\n" +
      "Rules:\n" +
      "- Extract ALL questions visible, even if 6 questions are on one slide\n" +
      "- Extract EXACTLY as many lettered choices as each question offers — do not force every question to exactly 4, some run to E or F\n" +
      "- If the answer page shows which answer is correct (highlighted, marked, or labeled), use it\n" +
      "- Set correct to null if you cannot determine the answer\n" +
      "- The topic should come from the lecture title shown on the slide (e.g. 'Lecture 50: Introduction to Nutrition')\n\n" +
      "EXTRACTED TEXT FROM SLIDE:\n" +
      combinedText.slice(0, 4000);

    try {
      const images = [];
      if (answerImg) images.push({ base64: answerImg, mimeType: "image/png" });
      images.push({ base64: questionImg, mimeType: "image/png" });

      const text = (await callAIWithImages(null, prompt, images, 6000, 0.1)).trim();
      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      const first = Math.min(
        cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
        cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("[")
      );
      const last = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
      if (first === Infinity || last === -1) continue;

      const parsed = JSON.parse(cleaned.slice(first, last + 1));
      const qs = parsed.questions || parsed;

      for (const q of qs) {
        const key = (q.stem || "").slice(0, 50);
        if (!seenStems.has(key) && q.stem && q.stem.length > 10) {
          seenStems.add(key);
          const normalized = normalizeParsedExamQuestion(q, allQuestions.length + 1);
          if (normalized) allQuestions.push(normalized);
        }
      }
    } catch (e) {
      console.warn("Grid slide " + (gi + 1) + " parse error:", e.message);
    }
  }

  return allQuestions;
}

async function parseSlidedeckFormat(pages, pdf, onProgress) {
  const groups = {};
  for (const p of pages) {
    const m = p.text.match(/^QUESTION\s+(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!groups[n]) groups[n] = [];
      groups[n].push(p);
    }
  }

  const questions = [];
  const usedPageIndices = new Set();

  const sorted = Object.entries(groups).sort(
    (a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)
  );

  for (const [nStr, group] of sorted) {
    for (const p of group) {
      const idx = pages.indexOf(p);
      if (idx !== -1) usedPageIndices.add(idx);
    }
    const n = parseInt(nStr, 10);
    const first = group[0];
    const isImage = first.imgCount > 5 && first.text.length < 200;

    if (isImage) {
      const renderB64 = async (pdfPage) => {
        const vp = pdfPage.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        await pdfPage.render({
          canvasContext: canvas.getContext("2d"),
          viewport: vp,
        }).promise;
        return canvas.toDataURL("image/png").split(",")[1];
      };
      const qImg = await renderB64(first.pdfPage);
      const aImg =
        group.length > 1 ? await renderB64(group[1].pdfPage) : null;
      const topic =
        first.text.replace(/^QUESTION\s+\d+\s*/i, "").split(/\s{2,}/)[0] ||
        "Histology";
      questions.push({
        id: "q" + n,
        num: n,
        type: "image",
        imageQuestion: true,
        subject: "Histology",
        topic,
        stem:
          "Examine the histological slide. Identify the labeled structures or answer the question.",
        questionPageImage: qImg,
        answerPageImage: aImg,
        choices: {
          A: "(See image)",
          B: "(See image)",
          C: "(See image)",
          D: "(See image)",
        },
        correct: null,
        explanation: "See annotated answer slide.",
        difficulty: "medium",
      });
    } else {
      const raw = first.text.replace(/^QUESTION\s+\d+\s*/i, "");
      const lines = raw.split(/\n/);
      const stemL = [];
      const ch = {};
      let cur = null;
      let inCh = false;
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (/^(Lecture|DLA)\s+\d+/.test(t)) continue;
        const cm = t.match(/^([A-E])[.)]\s*(.*)/);
        if (cm) {
          inCh = true;
          cur = cm[1];
          ch[cur] = cm[2];
        } else if (inCh && cur) ch[cur] += " " + t;
        else if (!inCh) stemL.push(t);
      }
      const expl =
        group.length > 1
          ? group[group.length - 1].text.replace(/^QUESTION\s+\d+\s*/i, "")
          : "";
      let correct = null;
      const ep = [];
      let inE = false;
      for (const line of expl.split(/\n/)) {
        const t = line.trim();
        if (!t) continue;
        const cm = t.match(/^([A-E])[.)]\s*(.*)/);
        if (cm) {
          const c = cm[2];
          if (
            /[Cc]orrect/.test(c) &&
            !/[Ii]ncorrect/.test(c.slice(0, 40))
          )
            correct = cm[1];
          inE = false;
        } else if (/^[Ee]xplanation[:\s]/.test(t)) {
          inE = true;
          const r = t.replace(/^[Ee]xplanation[:\s]*/, "");
          if (r) ep.push(r);
        } else if (inE) ep.push(t);
      }
      const lm = first.text.match(/Lecture\s+\d+[^\n]*/);
      questions.push({
        id: "q" + n,
        num: n,
        type: "clinical",
        imageQuestion: false,
        subject: "FTM2",
        topic: lm ? lm[0].trim().slice(0, 60) : "Review",
        stem: stemL.join(" ").trim(),
        choices: ch,
        correct,
        explanation: ep.join(" ").trim() || null,
        difficulty: "medium",
      });
    }
  }

  // Fallback: scan remaining pages for unlabeled question slides (4+ choices)
  const remainingPages = pages.filter((p, idx) => {
    if (usedPageIndices.has(idx)) return false;
    const choiceCount = (p.text.match(/\b[A-F]\./g) || []).length;
    return choiceCount >= 4;
  });
  if (remainingPages.length > 0) {
    onProgress?.("📄 Parsing " + remainingPages.length + " unlabeled question slide(s)...");
    const extra = await parseGridFormat(remainingPages, onProgress, { minChoiceCount: 4 });
    const baseNum = questions.length;
    for (let ei = 0; ei < extra.length; ei++) {
      const q = extra[ei];
      questions.push({
        ...q,
        id: "q" + (baseNum + ei + 1),
        num: baseNum + ei + 1,
      });
    }
  }

  return questions;
}

export async function extractLectureObjectives(pdfFile, onProgress) {
  await loadPDFJS();
  const arrayBuffer = await pdfFile.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;

  onProgress?.("🎯 Scanning for learning objectives...");

  const pagesToScan = Math.min(8, pdf.numPages);
  let combinedText = "";
  const pageImages = [];

  for (let i = 1; i <= pagesToScan; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((x) => x.str).join(" ").trim();
    combinedText += `\n--- PAGE ${i} ---\n${text}`;

    if (i <= 4) {
      const vp = page.getViewport({ scale: 1.2 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      pageImages.push(canvas.toDataURL("image/png").split(",")[1]);
    }
  }

  const prompt =
    "This is the beginning of a medical school lecture PDF.\n\n" +
    "Find and extract ALL learning objectives/goals listed in this document.\n" +
    "Learning objectives are usually on a slide titled 'Learning Objectives', 'Objectives', 'Goals', or 'By the end of this lecture'.\n" +
    "They typically start with action verbs like: Describe, Explain, List, Define, Compare, Identify, Discuss, Analyze, Predict, etc.\n\n" +
    "Also extract:\n" +
    "- The lecture number (e.g. Lecture 50, Lec 50, L50)\n" +
    "- The lecture title\n" +
    "- The discipline (BCHM, GNET, HCB, PHAR, PHYS, ANAT, etc.)\n\n" +
    "Return ONLY valid JSON with no markdown:\n" +
    "{\n" +
    '  "lectureNumber": 50,\n' +
    '  "lectureTitle": "Nutrition in Health and Disease",\n' +
    '  "discipline": "BCHM",\n' +
    '  "objectives": [\n' +
    '    "Describe the general structure of proteoglycans",\n' +
    '    "Discuss the functions of hyaluronic acid and heparin"\n' +
    "  ]\n" +
    "}\n\n" +
    'If no objectives are found, return {"objectives": [], "lectureNumber": null, "lectureTitle": null, "discipline": null}\n\n' +
    "EXTRACTED TEXT:\n" +
    combinedText.slice(0, 6000);

  try {
    const text = (
      pageImages[0]
        ? await callAIWithImage(null, prompt, pageImages[0], "image/png", 3000, 0.1)
        : await callAI(null, prompt, 3000, undefined, 0.1)
    ).trim();
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) return [];

    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    const fileName = (pdfFile.name || "").toLowerCase();
    const lectureTitle = (parsed.lectureTitle || "").trim();
    const titleActMatch = lectureTitle.match(/(dla|sg|tbl|lec|l)\s*(\d+)/i);
    let actType = /dla\b/i.test(fileName)
      ? "DLA"
      : /sg\b|small\s*group/i.test(fileName)
        ? "SG"
        : /tbl\b/i.test(fileName)
          ? "TBL"
          : "LEC";
    let lectureNum = parsed.lectureNumber != null ? parsed.lectureNumber : null;
    if (titleActMatch) {
      const typeFromTitle = titleActMatch[1].toUpperCase().replace(/^LEC$|^L$/, "LEC");
      if (/DLA/.test(typeFromTitle)) actType = "DLA";
      else if (/SG/.test(typeFromTitle)) actType = "SG";
      else if (/TBL/.test(typeFromTitle)) actType = "TBL";
      else actType = "LEC";
      lectureNum = parseInt(titleActMatch[2], 10);
    } else if (lectureNum == null) {
      const numFromFilename = (pdfFile.name || "").match(/(?:lecture|lec|dla|sg|tbl|l)\s*(\d+)/i)?.[1] || lectureTitle.match(/(?:lecture|lec|dla|sg|tbl|l)\s*(\d+)/i)?.[1];
      lectureNum = numFromFilename != null ? parseInt(numFromFilename, 10) : null;
    }
    const activityStr = lectureNum != null ? `${actType} ${lectureNum}` : "Unknown";

    return (parsed.objectives || []).map((obj, i) => ({
      id: "auto_" + Date.now() + "_" + i,
      activity: activityStr,
      discipline: parsed.discipline || "Unknown",
      lectureTitle: parsed.lectureTitle || pdfFile.name,
      lectureNumber: parsed.lectureNumber ?? lectureNum ?? null,
      lectureType: actType,
      objective: typeof obj === "string" ? obj : obj.text || obj.objective || String(obj),
      status: "untested",
      confidence: 0,
      lastTested: null,
      quizScore: null,
      source: "extracted",
    }));
  } catch (e) {
    console.warn("Objective extraction failed:", e.message);
    return [];
  }
}

export async function parseExamPDF(file, onProgress, opts = {}) {
  // Markdown/text upload (e.g. pre-verified marker OCR output) — skip pdfjs entirely.
  // No per-page images, so force the standard AI-parse path (grid/slidedeck need PDF pages).
  const _n = (file?.name || "").toLowerCase();
  const _isText =
    _n.endsWith(".md") ||
    _n.endsWith(".markdown") ||
    _n.endsWith(".txt") ||
    file?.type === "text/markdown" ||
    file?.type === "text/plain";

  let pages = [];
  let pdf = null;
  let fullText = "";
  let slideImages = [];

  if (_isText) {
    onProgress?.("📄 Reading markdown/text…");
    const text = await file.text();
    if (!text || text.trim().length < 50) {
      throw new Error("Markdown/text file is empty or too short (< 50 chars)");
    }
    pages = [{ num: 1, text, imgCount: 0, pdfPage: null }];
    fullText = text;
  } else if (opts?.useLlm) {
    onProgress?.("🔍 OCR chain (LLM cleanup)…");
    const { contentResult } = await extractWithSmartFallback(file, onProgress, { useLlm: true });
    fullText = contentResult?.fullText || "";
    if (!fullText.trim()) throw new Error("OCR chain returned no text");
    // Marker already pulled every figure out during OCR (same pipeline lecture ingest
    // uses) — carry them through so hasImage questions get a real image, not just a flag.
    slideImages = (contentResult?.slideImages || []).filter(isUsableImage);
    pages = [{ num: 1, text: fullText, imgCount: 0, pdfPage: null }];
  } else {
    await loadPDFJS();
    const arrayBuffer = await file.arrayBuffer();
    pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;

    onProgress?.("📄 Reading " + pdf.numPages + " pages...");

    const OPS = window.pdfjsLib.OPS || {};
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((x) => x.str + (x.hasEOL ? "\n" : " "))
        .join("")
        .trim();
      let imgCount = 0;
      try {
        const ops = await page.getOperatorList();
        if (ops && ops.fnArray) {
          imgCount = ops.fnArray.filter(
            (fn) =>
              fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject
          ).length;
        }
      } catch (e) {
        // ignore
      }
      pages.push({ num: i, text, imgCount, pdfPage: page });
    }

    fullText = pages.map((p) => p.text).join("\n\n[PAGE_BREAK]\n\n");
  }

  const format = _isText ? "standard" : detectFormat(pages, fullText);
  const formatLabels = {
    grid: "Grid/table slide format",
    slidedeck: "Slide deck format",
    standard: "Standard question bank format",
    nbme: "NBME style format",
    pairedkey: "Paired school answer-key slides",
    report: "Exam performance report",
  };
  onProgress?.("🔍 Detected: " + (formatLabels[format] || format));

  const examTitle = file.name.replace(/\.(pdf|md|markdown|txt)$/i, "");
  let questions = [];

  if (format === "report") {
    onProgress?.("✓ Detected score report; saving grade and category evidence");
    questions = [];
  } else if (format === "pairedkey") {
    questions = await parsePairedKeyFormat(pages, onProgress, examTitle);
  } else if (format === "grid") {
    questions = await parseGridFormat(pages, onProgress);
  } else if (format === "slidedeck") {
    questions = await parseSlidedeckFormat(pages, pdf, onProgress);
  } else {
    const deterministic = parseNumberedQuestionBankText(fullText, examTitle);
    if (deterministic.length >= 3) {
      onProgress?.("✓ Parsed numbered question bank and answer key");
      questions = deterministic;
    } else {
      onProgress?.("🧠 AI parsing questions...");
      questions = await parseWithAI(fullText, format, onProgress, examTitle);
    }
  }

  questions = attachImagesToExamQuestions(questions, slideImages);

  // A numbered answer key is a stronger completeness signal than an AI
  // parser's self-reported output. Never overwrite a good bank with a silent
  // partial import (the 30-question ExamSoft file previously landed as 17).
  const expectedFromKey = expectedQuestionCountFromAnswerKey(fullText);
  if (expectedFromKey && questions.length < expectedFromKey) {
    const recovered = parseNumberedQuestionBankText(fullText, examTitle);
    if (recovered.length >= expectedFromKey) {
      questions = attachImagesToExamQuestions(recovered, slideImages);
      onProgress?.(`✓ Recovered all ${expectedFromKey} questions from the answer key`);
    } else {
      throw new Error(
        `Partial import blocked: the answer key contains ${expectedFromKey} questions, but only ${questions.length} were extracted. ` +
        "Turn off LLM cleanup for this text-based PDF and try again."
      );
    }
  }

  onProgress?.("✓ Extracted " + questions.length + " questions");

  const chunks = pages.map((p) => ({ text: p.text }));

  return {
    questions,
    examTitle,
    totalQuestions: questions.length,
    expectedQuestions: expectedFromKey,
    format,
    fullText,
    chunks,
    lectureNumber: detectLectureNumber(examTitle || ""),
    lectureTitle: examTitle || "",
  };
}
