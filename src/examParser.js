let pdfLib = null;

async function getPdf() {
  if (pdfLib) return pdfLib;
  if (typeof window !== "undefined" && window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfLib = window.pdfjsLib;
    return pdfLib;
  }
  return new Promise((res, rej) => {
    if (typeof document === "undefined") {
      rej(new Error("PDF.js can only be loaded in a browser environment"));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        pdfLib = window.pdfjsLib;
        res(pdfLib);
      } catch (e) {
        rej(e);
      }
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
    text += "\n[Page " + i + "]\n" + ct.items.map(x => x.str).join(" ");
  }
  return text.trim();
}

async function claude(rawPrompt, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens || 6000,
      messages: [{ role: "user", content: rawPrompt }],
    }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const d = await res.json();
  return (d.content || []).map(b => b.text || "").join("");
}

function safeJSON(raw) {
  return JSON.parse(
    raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()
  );
}

export async function parseQuestionsWithClaude(rawText) {
  const prompt =
    "You are parsing a medical school exam PDF. Extract every question.\n" +
    "Return ONLY valid JSON with no markdown:\n" +
    '{ "questions": [ { "stem": "string", "choices": { "A": "string", "B": "string", "C": "string", "D": "string" }, "correct": "A|B|C|D", "explanation": "string", "topic": "string", "subtopic": "string", "difficulty": "easy|medium|hard", "type": "clinicalVignette|mechanismBased|pharmacology|laboratory" } ] }\n\n' +
    "Only extract questions that actually exist in the text, do not invent any.\n\n" +
    "TEXT START:\n" +
    rawText;

  const raw = await claude(prompt, 6000);
  const parsed = safeJSON(raw);
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return { questions };
}

export async function parseExamPDF(file) {
  const rawText = await readPDF(file);
  let questions = [];
  try {
    const parsed = await parseQuestionsWithClaude(rawText);
    questions = parsed.questions || [];
  } catch {
    questions = [];
  }

  const firstLine =
    rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) || "";

  const examTitle = firstLine.slice(0, 120) || "Imported Exam";

  return {
    questions,
    examTitle,
    totalQuestions: questions.length,
  };
}

