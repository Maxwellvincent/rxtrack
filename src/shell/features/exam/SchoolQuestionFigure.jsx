import { useState } from "react";

export function SchoolQuestionFigure({ question }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (!question?.hasImage) return null;
  const url = question.sourceImageUrl;
  if (!url || failedUrl === url) return (
    <p role="status" className="mb-3 rounded-lg border border-border p-3 text-sm text-text-2">
      This question needs its original figure. It could not be loaded; do not answer from incomplete information.
    </p>
  );
  return (
    <figure className="mb-4">
      <img src={url} alt="Original school question slide, including its figure and labels; answer key not shown"
        className="h-auto w-full rounded-lg border border-border" onError={() => setFailedUrl(url)} />
      <figcaption className="mt-1 text-xs text-text-3">Original question slide · {question.sourceFile} · page {question.sourcePage}</figcaption>
    </figure>
  );
}
