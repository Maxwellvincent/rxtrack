import { useEffect, useRef, useState } from "react";

export function questionReferencesVisual(stem = "") {
  return /\b(?:figure|image|graph|chart|table|photomicrograph|radiograph|x[- ]ray|ultrasound)\b.{0,90}\b(?:shown|below|above|provided|attached|following|numbered|labeled)\b|\b(?:shown|below|above|provided|attached|following)\b.{0,70}\b(?:figure|image|graph|chart|table|photomicrograph|radiograph|x[- ]ray|ultrasound)\b/i.test(String(stem));
}

function cropKey(question) {
  return `rxtrack-school-figure-crop:${question?.sourceFile || "source"}:${question?.id || question?.questionId || question?.num || question?.sourcePage || 0}`;
}

/** A source PDF page can include the answer key. Let the learner isolate only the exhibit. */
export function SchoolQuestionFigure({ question }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [cropUrl, setCropUrl] = useState(null);
  const [cropping, setCropping] = useState(false);
  const [selection, setSelection] = useState(null);
  const imageRef = useRef(null);
  const dragStart = useRef(null);
  const referencesVisual = questionReferencesVisual(question?.stem);
  const url = question?.sourceImageUrl || question?.sourceImageDataUrl || (typeof question?.image === "string" ? question.image : question?.image?.url);
  const key = cropKey(question || {});

  useEffect(() => {
    setFailedUrl(null);
    setCropping(false);
    setSelection(null);
    try { setCropUrl(localStorage.getItem(key)); } catch { setCropUrl(null); }
  }, [key, url]);

  if (!question?.hasImage && !referencesVisual) return null;
  if (!url || failedUrl === url) return (
    <p role="status" className="mb-3 rounded-lg border border-border p-3 text-sm text-text-2">
      This question refers to a source visual, but it is not available here. Do not answer from incomplete information; flag the item for repair.
    </p>
  );

  const startSelection = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
    dragStart.current = point;
    setSelection({ x: point.x, y: point.y, w: 0, h: 0 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveSelection = (event) => {
    if (!dragStart.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const start = dragStart.current;
    setSelection({ x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) });
  };
  const finishSelection = () => { dragStart.current = null; };
  const saveCrop = () => {
    const image = imageRef.current;
    if (!image || !selection || selection.w < 0.02 || selection.h < 0.02) return;
    const canvas = document.createElement("canvas");
    const left = Math.round(selection.x * image.naturalWidth);
    const top = Math.round(selection.y * image.naturalHeight);
    canvas.width = Math.max(1, Math.round(selection.w * image.naturalWidth));
    canvas.height = Math.max(1, Math.round(selection.h * image.naturalHeight));
    canvas.getContext("2d").drawImage(image, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const next = canvas.toDataURL("image/jpeg", 0.9);
    try { localStorage.setItem(key, next); } catch { /* Still apply the crop for this session if storage is full. */ }
    setCropUrl(next);
    setCropping(false);
    setSelection(null);
  };

  return (
    <details className="mb-3 rounded-lg border border-border bg-bg-elevated p-2">
      <summary className="cursor-pointer px-1 py-1 text-sm font-medium text-text-2">Show source figure{question.sourcePage ? ` · page ${question.sourcePage}` : ""}</summary>
      <figure className="mt-2">
        {cropUrl && !cropping ? (
          <>
            <img src={cropUrl} alt="Cropped question figure" className="h-auto max-h-[75vh] w-auto max-w-full rounded-lg border border-border" />
            <button type="button" className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-2" onClick={() => { setSelection(null); setCropping(true); }}>Adjust figure crop</button>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-text-2">This source page may include the answer choices or key. Drag around only the figure, then choose “Use cropped figure.” The crop is remembered on this device.</p>
            <div className="relative inline-block max-w-full touch-none select-none" onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={finishSelection} onPointerCancel={finishSelection}>
              <img ref={imageRef} src={url} alt="Source page to crop; may contain answer choices or key" className="block h-auto max-h-[75vh] w-auto max-w-full rounded-lg border border-border" onError={() => setFailedUrl(url)} draggable="false" />
              {selection && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.w * 100}%`, height: `${selection.h * 100}%` }} />}
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={!selection || selection.w < 0.02 || selection.h < 0.02} onClick={saveCrop}>Use cropped figure</button>
              {cropUrl && <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs text-text-2" onClick={() => setCropping(false)}>Cancel</button>}
            </div>
          </>
        )}
        <figcaption className="mt-1 text-xs text-text-3">{question.sourceFile || "Uploaded source"}{question.sourcePage ? ` · page ${question.sourcePage}` : ""}</figcaption>
      </figure>
    </details>
  );
}
