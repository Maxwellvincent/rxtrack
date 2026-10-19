import { useStoreResource } from "../../hooks/useStoreResource.js";
import * as questionFigures from "../../../stores/questionFigures.js";
import { fetchQuestionBankSourceBytes, uploadQuestionBankPage } from "../../../supabase.js";
import * as questionBankMeta from "../../../stores/questionBankMeta.js";
import { useEffect, useRef, useState } from "react";

export { questionReferencesVisual } from "../../../engine/questionVisual.js";
import { questionReferencesVisual } from "../../../engine/questionVisual.js";

function cropKey(question) {
  return `rxtrack-school-figure-crop:${question?.sourceFile || "source"}:${question?.id || question?.questionId || question?.num || question?.sourcePage || 0}`;
}

/** A source PDF page can include the answer key. Let the learner isolate only the exhibit. */
export function SchoolQuestionFigure({ question, userId }) {
  const meta = useStoreResource(questionBankMeta, userId);
  const [selectedPage, setSelectedPage] = useState(null);
  const [pageUrl, setPageUrl] = useState(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const pdfRef = useRef(null);
  const pageRequest = useRef(0);
  const [failedUrl, setFailedUrl] = useState(null);
  const [cropUrl, setCropUrl] = useState(null);
  const [imageReady, setImageReady] = useState(false);
  const [cropError, setCropError] = useState("");
  const [cropping, setCropping] = useState(false);
  const [savingCrop, setSavingCrop] = useState(false);
  const [cropNotice, setCropNotice] = useState("");
  const [selection, setSelection] = useState(null);
  const imageRef = useRef(null);
  const dragStart = useRef(null);
  const referencesVisual = questionReferencesVisual(question?.stem);
  const originalUrl = question?.originalSourceImageUrl || question?.sourceImageUrl || question?.sourceImageDataUrl || (typeof question?.image === "string" ? question.image : question?.image?.url);
  const key = cropKey(question || {});
  const originalPage = Number(question?.sourceVisualPage || question?.sourcePage) || 1;
  const visualPage = selectedPage || originalPage;
  const url = pageUrl || originalUrl;
  const sourcePath = question?.sourceStoragePath || Object.values(meta.data || {}).find(entry => entry.filename === question?.sourceFile || entry.aliases?.includes(question?.sourceFile))?.sourceStoragePath;

  useEffect(() => {
    pageRequest.current++;
    pdfRef.current?.destroy?.(); pdfRef.current = null;
    setSelectedPage(null); setPageUrl(null); setPageBusy(false); setPageError("");
    setFailedUrl(null); setImageReady(false); setCropError("");
    setCropping(false);
    setSelection(null);
    try { setCropUrl((question?.sourceFigureCropped ? question.sourceImageUrl : null) || localStorage.getItem(`${userId || "local"}:${key}`) || localStorage.getItem(key)); const savedPage = Number(localStorage.getItem(`${key}:page`)); if (savedPage > 0) setSelectedPage(savedPage); } catch { setCropUrl(null); }
  }, [key, originalUrl, userId, question?.sourceFigureCropped, question?.sourceImageUrl]);

  useEffect(() => {
    const update = () => {
      const saved = questionFigures.read(userId, question?.sourceFile)?.[questionFigures.figureIdentity(question)];
      if (saved?.url) { setCropUrl(saved.url); setSelectedPage(saved.page || null); }
    };
    update();
    return questionFigures.subscribe(question?.sourceFile, update);
  }, [userId, question, key]);

  const changePage = async pageNumber => {
    if (!sourcePath || pageBusy || pageNumber < 1) return;
    const request = ++pageRequest.current;
    setPageBusy(true); setPageError("");
    try {
      if (!pdfRef.current) {
        const sourceBytes = await fetchQuestionBankSourceBytes(sourcePath);
        if (!sourceBytes) throw new Error("Original PDF unavailable. Re-upload the source PDF to enable page navigation.");
        const { loadPDFJS } = await import("../../../examParser.js");
        await loadPDFJS();
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(sourceBytes) }).promise;
        if (request !== pageRequest.current) { pdf.destroy(); return; }
        pdfRef.current = pdf;
      }
      if (pageNumber > pdfRef.current.numPages) throw new Error("This is the last source page.");
      const page = await pdfRef.current.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (request !== pageRequest.current) return;
      setImageReady(false); setCropError("");
      setPageUrl(canvas.toDataURL("image/jpeg", 0.85)); setSelectedPage(pageNumber);
      setCropping(true); setSelection(null); setFailedUrl(null);
    } catch (error) { if (request === pageRequest.current) setPageError(error.message === "Failed to fetch" ? "Could not reach the original PDF. Retry loading the page; if it persists, re-upload the bank to restore its source PDF." : error.message || "Could not load the source page."); }
    finally { if (request === pageRequest.current) setPageBusy(false); }
  };
  useEffect(() => () => { pageRequest.current++; pdfRef.current?.destroy?.(); }, []);

  if (!question?.hasImage && !referencesVisual && !originalUrl) return null;
  if ((!url || failedUrl === url) && !sourcePath && !cropUrl) return (
    <p role="status" className="mb-3 rounded-lg border border-border p-3 text-sm text-text-2">
      This question refers to a source visual, but it is not available here. Do not answer from incomplete information; flag the item for repair.
    </p>
  );

  const startSelection = (event) => {
    if (!imageReady) return;
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
  const saveCrop = async () => {
    const image = imageRef.current;
    if (!imageReady || !image || !selection || selection.w < 0.02 || selection.h < 0.02) return;
    const canvas = document.createElement("canvas");
    const left = Math.round(selection.x * image.naturalWidth);
    const top = Math.round(selection.y * image.naturalHeight);
    canvas.width = Math.max(1, Math.round(selection.w * image.naturalWidth));
    canvas.height = Math.max(1, Math.round(selection.h * image.naturalHeight));
    try {
    canvas.getContext("2d").drawImage(image, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const next = canvas.toDataURL("image/jpeg", 0.9);
    setSavingCrop(true); setCropNotice("");
    try {
      const savedUrl = userId ? await uploadQuestionBankPage(userId, question.sourceFile || "source", `crop-${questionFigures.figureIdentity(question)}-${Date.now()}`, next) : next;
      if (!savedUrl) throw new Error("No saved figure URL was returned.");
      await questionFigures.save(userId, question, { url: savedUrl, page: visualPage, selection });
      try { localStorage.setItem(`${userId || "local"}:${key}`, savedUrl); localStorage.setItem(`${key}:page`, String(visualPage)); } catch { /* Cloud copy is authoritative. */ }
      setCropUrl(savedUrl);
      setCropNotice(userId ? "Figure saved to your account for this source question and future repeats." : "Figure saved on this device.");
    } catch (error) {
      setCropUrl(next);
      setCropNotice(`Using the crop here, but it could not sync to your account: ${error?.message || "Please retry."}`);
    } finally { setSavingCrop(false); }
    setCropping(false);
    setSelection(null);
    } catch { setCropError("This image could not be cropped. Open the original PDF page using the page controls, then select the figure again."); }
  };

  return (
    <details open={cropUrl || (referencesVisual && !originalUrl) ? true : undefined} className="mb-3 rounded-lg border border-border bg-bg-elevated p-2">
      <summary className="cursor-pointer px-1 py-1 text-sm font-medium text-text-2">Show source figure{visualPage ? ` · page ${visualPage}` : ""}</summary>
      <figure className="mt-2">
        {sourcePath ? <div className="mb-2 flex gap-2 text-xs">
          <button type="button" disabled={pageBusy || visualPage <= 1} className="rounded border border-border px-2 py-1" onClick={() => changePage(visualPage - 1)}>Previous source page</button>
          <button type="button" disabled={pageBusy} className="rounded border border-border px-2 py-1" onClick={() => changePage(visualPage + 1)}>Next source page</button>
          {pageBusy && <span role="status">Loading page…</span>}
        </div> : <p className="mb-2 text-xs text-text-3">Only this saved page is available. Re-upload the original PDF if the figure is on another page.</p>}
        {pageError && <p role="status" className="mb-2 text-xs text-bad">{pageError}</p>}

        {cropUrl && !cropping ? (
          <>
            <img src={cropUrl} alt="Cropped question figure" className="h-auto max-h-[75vh] w-auto max-w-full rounded-lg border border-border" />
            <button type="button" className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-2" onClick={() => { setSelection(null); setCropping(true); if (selectedPage && !pageUrl && selectedPage !== originalPage) changePage(selectedPage); }}>Adjust figure crop</button>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-text-2">This source page may include the answer choices or key. Drag a rectangle around only the figure to enable “Use cropped figure.”</p>
            {(!url || failedUrl === url) && <div role="status" className="mb-2 text-sm">No figure loaded. <button type="button" disabled={pageBusy} className="underline" onClick={() => changePage(visualPage)}>Load original question page</button></div>}
            {url && failedUrl !== url && <div className="relative inline-block max-w-full touch-none select-none" onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={finishSelection} onPointerCancel={finishSelection}>
              <img ref={imageRef} crossOrigin="anonymous" src={url} alt="Source page to crop; may contain answer choices or key" className="block h-auto max-h-[75vh] w-auto max-w-full rounded-lg border border-border" onLoad={() => setImageReady(true)} onError={() => { setFailedUrl(url); setImageReady(false); }} draggable="false" />
              {selection && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.w * 100}%`, height: `${selection.h * 100}%` }} />}
            </div>}
            {cropError && <p role="status" className="mt-2 text-xs text-bad">{cropError}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={savingCrop || !imageReady || !selection || selection.w < 0.02 || selection.h < 0.02} onClick={saveCrop}>{savingCrop ? "Saving figure…" : "Use cropped figure"}</button>
              {(!selection || selection.w < 0.02 || selection.h < 0.02) && <span className="text-xs text-text-3">Select a figure area first.</span>}
              {cropUrl && <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs text-text-2" onClick={() => setCropping(false)}>Cancel</button>}
            </div>
          </>
        )}
        {cropNotice && <p role="status" className="mt-2 text-xs text-text-2">{cropNotice}</p>}
        <figcaption className="mt-1 text-xs text-text-3">{question.sourceFile || "Uploaded source"}{visualPage ? ` · visual page ${visualPage}` : ""}{question.sourcePage && visualPage && Number(question.sourcePage) !== Number(visualPage) ? ` · question page ${question.sourcePage}` : ""}</figcaption>
      </figure>
    </details>
  );
}
