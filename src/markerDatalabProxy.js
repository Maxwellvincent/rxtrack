// markerDatalabProxy.js — Datalab marker OCR through our own Cloud Function.
//
// The direct browser call in markerDatalab.js cannot work: datalab.to sends no
// CORS headers, so every attempt fails as "TypeError: Failed to fetch" and the
// OCR chain silently degrades to pdf.js text extraction. The PDF goes up to
// Storage (callable payloads cap out ~10MB; slide decks are 30MB+), the function
// converts it and deletes the upload.

import { ref, uploadBytesResumable } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, storage } from "./firebase";
import { normalizeMarkerResult } from "./ocrShared";

/** Storage is only reachable when Firebase is configured and someone is signed in. */
export function canUseDatalabProxy(userId) {
  return !!userId && !!storage;
}

/**
 * OCR a file via the proxy.
 * @param {File} file
 * @param {object} opts - { userId, onProgress, forceOcr, useLlm }
 * @returns { markdown, chunks, slideImages, pageCount, method }
 */
export async function extractWithDatalabProxy(file, opts = {}) {
  const { userId, onProgress, forceOcr = true, useLlm = false } = opts;
  if (!userId) throw new Error("Datalab proxy needs a signed-in user");

  // Namespaced by uid because the function refuses any path outside the
  // caller's own prefix.
  const safeName = String(file.name || "lecture.pdf").replace(/[^\w.\-() ]+/g, "_");
  const path = `users/${userId}/ocr-inbox/${Date.now()}_${safeName}`;

  onProgress?.("☁️ Uploading for OCR…");
  const task = uploadBytesResumable(ref(storage, path), file, {
    contentType: file.type || "application/pdf",
  });
  await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / (snap.totalBytes || 1)) * 100);
        onProgress?.(`☁️ Uploading for OCR… ${pct}%`);
      },
      reject,
      resolve
    );
  });

  onProgress?.("🔍 Datalab marker — this takes a few minutes on a big deck…");
  const call = httpsCallable(getFunctions(app), "datalabConvert", { timeout: 9 * 60 * 1000 });
  const { data } = await call({ storagePath: path, forceOcr, useLlm });

  if (!data?.markdown) throw new Error("Datalab returned no markdown");
  return normalizeMarkerResult(data.markdown, data.images || {}, { method: "marker-datalab" });
}
