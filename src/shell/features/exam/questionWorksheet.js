import { orderedChoiceEntries } from "./choiceOrder.js";

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function imageSource(question) {
  const source = question?.sourceImageUrl || question?.sourceImageDataUrl
    || (typeof question?.image === "string" ? question.image : question?.image?.url);
  return /^(https?:\/\/|data:image\/)/i.test(String(source || "")) ? source : "";
}

function renderChoice(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return `<table><tbody>${Object.entries(value).map(([key, cell]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(cell)}</td></tr>`).join("")}</tbody></table>`;
  }
  return escapeHtml(value);
}

function answerText(question, letter) {
  if (!letter) return "Not answered";
  const value = question?.choices?.[letter];
  const rendered = value && typeof value === "object" ? JSON.stringify(value) : String(value || "");
  return `${letter}${rendered ? ` — ${rendered}` : ""}`;
}

function diagnosticText(diagnostic) {
  if (!diagnostic || diagnostic.skipped) return "Not entered";
  return [
    diagnostic.patient && `Patient: ${diagnostic.patient}`,
    diagnostic.asksFor && `Question target: ${diagnostic.asksFor}`,
    diagnostic.breakPoint && `Reasoning break: ${diagnostic.breakPoint}`,
    diagnostic.bridge && `Repair: ${diagnostic.bridge}`,
    diagnostic.choiceTrap && `Distractor trap: ${diagnostic.choiceTrap}`,
  ].filter(Boolean).join(" · ") || "Not entered";
}

/** Print-ready missed-question review with the learner's saved answer and post-exam analysis. */
export function buildQuestionWorksheetHtml(questions = [], { title = "Missed-question practice" } = {}) {
  const cards = questions.map((question, index) => {
    const image = imageSource(question);
    const lecture = question?.lectureLabel || question?.lectureTitle || question?.lectureId || "";
    const objective = (question?.objectiveLabels || question?.objectiveIds || []).join?.(" · ") || "";
    const meta = [lecture, objective].filter(Boolean).map(escapeHtml).join(" · ");
    const choices = orderedChoiceEntries(question?.choices).map(([letter, value]) =>
      `<li><span class="letter">${escapeHtml(letter)}.</span> ${renderChoice(value)}</li>`
    ).join("");
    const selected = answerText(question, question?.selectedAnswer || question?.selectedChoice);
    const correct = answerText(question, question?.correct);
    const explanation = question?.explanation || question?.rationale || "No explanation was saved with this question.";
    const classification = question?.errorClassification || "Not classified";
    const reasoning = diagnosticText(question?.reviewDiagnostic);
    return `<article class="question"><div class="number">Question ${index + 1}</div>${meta ? `<div class="meta">${meta}</div>` : ""}<div class="stem">${escapeHtml(question?.stem).replace(/\n/g, "<br>")}</div>${image ? `<img class="figure" src="${escapeHtml(image)}" alt="Question figure">` : ""}<ol class="choices" type="A">${choices}</ol><section class="review"><div><b>My selected answer</b><span>${escapeHtml(selected)}</span></div><div><b>Correct answer</b><span>${escapeHtml(correct)}</span></div><div><b>Error classification</b><span>${escapeHtml(classification)}</span></div><div><b>Learning objective</b><span>${escapeHtml(objective || "Not linked")}</span></div></section><div class="review-label">Explanation</div><p class="review-copy">${escapeHtml(explanation).replace(/\n/g, "<br>")}</p><div class="review-label">Optional post-exam reasoning</div><p class="review-copy">${escapeHtml(reasoning)}</p></article>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:letter;margin:0.62in}*{box-sizing:border-box}body{font:12pt/1.45 Arial,sans-serif;color:#17252a;margin:0}.head{border-bottom:2px solid #176f6b;padding-bottom:10px;margin-bottom:20px}.head h1{font-size:19pt;margin:0 0 5px}.head p{font-size:9pt;color:#52636a;margin:0}.question{break-inside:avoid;border:1px solid #bac8c7;border-radius:8px;padding:14px 16px;margin:0 0 18px}.number{font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#176f6b;font-weight:bold}.meta{font-size:8pt;color:#52636a;margin:4px 0 9px}.stem{margin:8px 0 12px}.figure{display:block;max-width:100%;max-height:3.1in;object-fit:contain;margin:10px auto}.choices{list-style:none;padding:0;margin:10px 0 14px}.choices li{display:flex;gap:7px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #e1e6e5}.letter{font-weight:bold;min-width:1.3em}.choices table{border-collapse:collapse;font-size:10pt}.choices td,.choices th{border:1px solid #bdc9c8;padding:3px 6px}.review{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.review>div{border:1px solid #cbd4d3;border-radius:4px;padding:8px}.review b,.review span{display:block}.review b,.review-label{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#52636a}.review-label{font-weight:bold;margin:10px 0 3px}.review-copy{margin:0;border-left:3px solid #d8e3e1;padding:6px 9px;background:#f5f8f7}@media print{.question{page-break-inside:avoid}}
  </style></head><body><header class="head"><h1>${escapeHtml(title)}</h1><p>${questions.length} missed ${questions.length === 1 ? "question" : "questions"} · selected answers, key, explanations, objectives, and post-exam error review</p></header>${cards}</body></html>`;
}

export function printQuestionWorksheet(questions, options) {
  if (typeof window === "undefined") return { ok: false, error: "Printing is only available in a browser." };
  const printWindow = window.open("", "_blank");
  if (!printWindow) return { ok: false, error: "Allow pop-ups to print or save the worksheet as a PDF." };
  printWindow.document.open();
  printWindow.document.write(buildQuestionWorksheetHtml(questions, options));
  printWindow.document.close();
  const printWhenReady = () => {
    const images = [...printWindow.document.images];
    Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
    }))).then(() => {
      printWindow.focus();
      printWindow.print();
    });
  };
  if (printWindow.document.readyState === "complete") printWhenReady();
  else printWindow.addEventListener("load", printWhenReady, { once: true });
  return { ok: true };
}
