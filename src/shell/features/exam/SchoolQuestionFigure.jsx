import { useState } from "react";

export function questionReferencesVisual(stem = "") {
  return /\b(?:figure|image|graph|chart|table|photomicrograph|radiograph|x[- ]ray|ultrasound)\b.{0,90}\b(?:shown|below|above|provided|attached|following|numbered|labeled)\b|\b(?:shown|below|above|provided|attached|following)\b.{0,70}\b(?:figure|image|graph|chart|table|photomicrograph|radiograph|x[- ]ray|ultrasound)\b/i.test(String(stem));
}

export function SchoolQuestionFigure({ question }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const referencesVisual = questionReferencesVisual(question?.stem);
  if (!question?.hasImage && !referencesVisual) return null;
  const url = question.sourceImageUrl || question.sourceImageDataUrl || (typeof question.image === "string" ? question.image : question.image?.url);
  if (!url || failedUrl === url) return (
    <p role="status" className="mb-3 rounded-lg border border-border p-3 text-sm text-text-2">
      This question refers to a source visual, but it is not available here. Do not answer from incomplete information; flag the item for repair.
    </p>
  );
  return (
    <details className="mb-3 rounded-lg border border-border bg-bg-elevated p-2">
      <summary className="cursor-pointer px-1 py-1 text-sm font-medium text-text-2">Show source figure / page{question.sourcePage ? ` · page ${question.sourcePage}` : ""}</summary>
      <figure className="mt-2">
        <img src={url} alt="Original school question source page, including its figure and labels; answer key not shown"
          className="h-auto w-full rounded-lg border border-border" onError={() => setFailedUrl(url)} />
        <figcaption className="mt-1 text-xs text-text-3">Original source page may repeat the question text · {question.sourceFile || "uploaded source"}{question.sourcePage ? ` · page ${question.sourcePage}` : ""}</figcaption>
      </figure>
    </details>
  );
}
