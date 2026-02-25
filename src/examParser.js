async function loadPDFJS() {
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

function detectFormat(pages, fullText) {
  // Slide deck with numbered QUESTION labels spanning pages
  const slideLabels = fullText.match(/QUESTION\s+\d+/gi) || [];
  const uniqueNums = new Set(slideLabels.map((s) => s.match(/\d+/)[0]));
  if (uniqueNums.size > 3) return "slidedeck";

  // Grid format: single page has 3+ question blocks with A. B. C. D. choices
  const gridPages = pages.filter((p) => {
    const choiceMatches = (p.text.match(/\b[A-D]\./g) || []).length;
    return choiceMatches >= 8; // at least 2 questions worth of choices per page
  });
  if (gridPages.length > 0) return "grid";

  // Standard numbered list
  const numbered = fullText.match(/^\s*\d+[.)]\s+\S/mg) || [];
  if (numbered.length > 3) return "standard";

  return "standard";
}

async function parseWithAI(fullText, format, onProgress) {
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
  if (!GEMINI_KEY) throw new Error("No API key configured (VITE_GEMINI_API_KEY)");

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

    const prompt =
      "Extract ALL medical exam questions from this text. Return ONLY valid JSON, no markdown:\n" +
      '{"questions":[{' +
      '"stem":"complete question text ending with ?",' +
      '"choices":{"A":"...","B":"...","C":"...","D":"..."},' +
      '"correct":"A",' +
      '"explanation":"explanation text or null",' +
      '"topic":"medical topic",' +
      '"difficulty":"easy|medium|hard",' +
      '"type":"clinicalVignette|mechanismBased|pharmacology|laboratory"' +
      "}]}\n\n" +
      "Rules: Only extract questions actually present. If answer key shows correct answer include it. " +
      "If no explanation exists set to null. Detect question type from content.\n\n" +
      "TEXT:\n" +
      chunks[ci];

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 8000, temperature: 0.1 },
            safetySettings: [
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            ],
          }),
        }
      );
      if (!res.ok) throw new Error("API " + res.status);
      const d = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const first = Math.min(
        text.indexOf("{") === -1 ? Infinity : text.indexOf("{"),
        text.indexOf("[") === -1 ? Infinity : text.indexOf("[")
      );
      const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (first === Infinity || last === -1) continue;
      const parsed = JSON.parse(text.slice(first, last + 1));
      const qs = Array.isArray(parsed) ? parsed : parsed.questions || [];

      for (const q of qs) {
        const key = (q.stem || "").slice(0, 60);
        if (!seenStems.has(key) && q.stem && q.stem.length > 20) {
          seenStems.add(key);
          allQuestions.push({
            id: "q" + (allQuestions.length + 1),
            num: allQuestions.length + 1,
            type: q.type || "clinicalVignette",
            imageQuestion: false,
            subject: "Uploaded",
            topic: q.topic || "Exam Review",
            stem: q.stem,
            choices: q.choices || {},
            correct: q.correct || null,
            explanation: q.explanation || null,
            difficulty: q.difficulty || "medium",
          });
        }
      }
    } catch (e) {
      console.warn("Chunk " + (ci + 1) + " parse error:", e.message);
    }
  }

  return allQuestions;
}

async function parseGridFormat(pages, onProgress, options = {}) {
  const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
  const minChoiceCount = options.minChoiceCount ?? 6;
  const allQuestions = [];
  const seenStems = new Set();

  const gridPageGroups = [];
  let i = 0;

  while (i < pages.length) {
    const p = pages[i];
    const choiceCount = (p.text.match(/\b[A-D]\./g) || []).length;

    if (choiceCount >= minChoiceCount) {
      const group = { questionPage: p, answerPage: null };

      if (i + 1 < pages.length) {
        const next = pages[i + 1];
        const nextChoices = (next.text.match(/\b[A-D]\./g) || []).length;
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
      '  "choices": {"A": "...", "B": "...", "C": "...", "D": "..."},\n' +
      '  "correct": "B",\n' +
      '  "explanation": "why this is correct based on answer page, or null",\n' +
      '  "topic": "medical topic from the lecture title on the slide",\n' +
      '  "difficulty": "easy|medium|hard",\n' +
      '  "type": "clinicalVignette|mechanismBased|pharmacology|laboratory"\n' +
      "}]}\n\n" +
      "Rules:\n" +
      "- Extract ALL questions visible, even if 6 questions are on one slide\n" +
      "- If the answer page shows which answer is correct (highlighted, marked, or labeled), use it\n" +
      "- Set correct to null if you cannot determine the answer\n" +
      "- The topic should come from the lecture title shown on the slide (e.g. 'Lecture 50: Introduction to Nutrition')\n\n" +
      "EXTRACTED TEXT FROM SLIDE:\n" +
      combinedText.slice(0, 4000);

    try {
      const requestBody = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "image/png",
                  data: questionImg,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 6000, temperature: 0.1 },
        safetySettings: [
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        ],
      };

      if (answerImg) {
        requestBody.contents[0].parts.unshift({
          inline_data: { mime_type: "image/png", data: answerImg },
        });
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      const d = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";

      const first = Math.min(
        text.indexOf("{") === -1 ? Infinity : text.indexOf("{"),
        text.indexOf("[") === -1 ? Infinity : text.indexOf("[")
      );
      const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (first === Infinity || last === -1) continue;

      const parsed = JSON.parse(text.slice(first, last + 1));
      const qs = parsed.questions || parsed;

      for (const q of qs) {
        const key = (q.stem || "").slice(0, 50);
        if (!seenStems.has(key) && q.stem && q.stem.length > 10) {
          seenStems.add(key);
          allQuestions.push({
            id: "q" + (allQuestions.length + 1),
            num: allQuestions.length + 1,
            type: q.type || "clinicalVignette",
            imageQuestion: false,
            subject: "Uploaded",
            topic: q.topic || "Exam Review",
            stem: q.stem,
            choices: q.choices || {},
            correct: q.correct || null,
            explanation: q.explanation || null,
            difficulty: q.difficulty || "medium",
          });
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
    const choiceCount = (p.text.match(/\b[A-D]\./g) || []).length;
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

export async function parseExamPDF(file, onProgress) {
  await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  onProgress?.("📄 Reading " + pdf.numPages + " pages...");

  const pages = [];
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

  const fullText = pages.map((p) => p.text).join("\n\n[PAGE_BREAK]\n\n");

  const format = detectFormat(pages, fullText);
  const formatLabels = {
    grid: "Grid/table slide format",
    slidedeck: "Slide deck format",
    standard: "Standard question bank format",
    nbme: "NBME style format",
  };
  onProgress?.("🔍 Detected: " + (formatLabels[format] || format));

  let questions = [];

  if (format === "grid") {
    questions = await parseGridFormat(pages, onProgress);
  } else if (format === "slidedeck") {
    questions = await parseSlidedeckFormat(pages, pdf, onProgress);
  } else {
    onProgress?.("🧠 AI parsing questions...");
    questions = await parseWithAI(fullText, format, onProgress);
  }

  onProgress?.("✓ Extracted " + questions.length + " questions");
  return {
    questions,
    examTitle: file.name.replace(/\.pdf$/i, ""),
    totalQuestions: questions.length,
    format,
  };
}
