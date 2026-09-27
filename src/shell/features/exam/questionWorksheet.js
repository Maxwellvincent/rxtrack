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

/** Print-ready HTML for Goodnotes: preserves stem/figure/options, omits answers and feedback. */
export function buildQuestionWorksheetHtml(questions = [], { title = "Missed-question practice" } = {}) {
  const cards = questions.map((question, index) => {
    const image = imageSource(question);
    const lecture = question?.lectureLabel || question?.lectureTitle || question?.lectureId || "";
    const objective = (question?.objectiveLabels || question?.objectiveIds || []).join?.(" · ") || "";
    const meta = [lecture, objective].filter(Boolean).map(escapeHtml).join(" · ");
    const choices = orderedChoiceEntries(question?.choices).map(([letter, value]) =>
      `<li><span class="letter">${escapeHtml(letter)}.</span> ${renderChoice(value)}</li>`
    ).join("");
    return `<article class="question"><div class="number">Question ${index + 1}</div>${meta ? `<div class="meta">${meta}</div>` : ""}<div class="stem">${escapeHtml(question?.stem).replace(/\n/g, "<br>")}</div>${image ? `<img class="figure" src="${escapeHtml(image)}" alt="Question figure">` : ""}<ol class="choices" type="A">${choices}</ol><div class="work-label">My reasoning</div><div class="work"></div><div class="work-label">What I want to review</div><div class="work short"></div></article>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:letter;margin:0.62in}*{box-sizing:border-box}body{font:12pt/1.45 Arial,sans-serif;color:#17252a;margin:0}.head{border-bottom:2px solid #176f6b;padding-bottom:10px;margin-bottom:20px}.head h1{font-size:19pt;margin:0 0 5px}.head p{font-size:9pt;color:#52636a;margin:0}.question{break-inside:avoid;border:1px solid #bac8c7;border-radius:8px;padding:14px 16px;margin:0 0 18px}.number{font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#176f6b;font-weight:bold}.meta{font-size:8pt;color:#52636a;margin:4px 0 9px}.stem{margin:8px 0 12px}.figure{display:block;max-width:100%;max-height:3.1in;object-fit:contain;margin:10px auto}.choices{list-style:none;padding:0;margin:10px 0 14px}.choices li{display:flex;gap:7px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #e1e6e5}.letter{font-weight:bold;min-width:1.3em}.choices table{border-collapse:collapse;font-size:10pt}.choices td,.choices th{border:1px solid #bdc9c8;padding:3px 6px}.work-label{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#52636a;margin:8px 0 4px}.work{height:1.15in;border:1px solid #cbd4d3;border-radius:4px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 25px,#e5e9e8 26px)}.work.short{height:.55in}@media print{.question{page-break-inside:avoid}}
  </style></head><body><header class="head"><h1>${escapeHtml(title)}</h1><p>${questions.length} missed ${questions.length === 1 ? "question" : "questions"} · answer key and explanations intentionally omitted</p></header>${cards}</body></html>`;
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
