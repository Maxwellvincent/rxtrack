/** Bound Firebase's retries and cancel the actual upload, not just its waiter. */
export function awaitStorageUpload(task, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("School source upload timed out after 45 seconds. Check your connection and retry the source upload.");
      error.code = "storage/upload-timeout";
      reject(error);
      task.cancel();
    }, timeoutMs);
    Promise.resolve(task).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Original PDF archiving is optional; parsed questions and required exhibits are not. */
export async function archiveQuestionSource(upload, onWarning) {
  try { return await upload(); }
  catch (error) {
    onWarning?.(`Original PDF not archived (${error?.code || "storage/upload-failed"}). Parsed questions are retained; adjacent source pages need a successful PDF re-upload.`);
    return null;
  }
}

/** One authenticated multipart request; avoid the SDK's opaque retry loop. */
export async function uploadSchoolFile({ auth, userId, bucket, path, blob, metadata = {}, fetchImpl = fetch, timeoutMs = 45000, baseUrl = "https://firebasestorage.googleapis.com" }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error("Firebase upload timed out. The browser could not complete the storage request."), { code: "storage/upload-timeout" });
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      await auth.authStateReady();
      if (!auth.currentUser || auth.currentUser.uid !== userId) {
        throw Object.assign(new Error("Sign in again before uploading school files."), { code: "storage/unauthenticated" });
      }
      const token = await auth.currentUser.getIdToken(true);
      controller.signal.throwIfAborted();
      const boundary = `rxtrack-${crypto.randomUUID()}`;
      const contentType = metadata.contentType || blob.type || "application/octet-stream";
      const resource = { name: path, contentType, ...(metadata.customMetadata ? { metadata: metadata.customMetadata } : {}) };
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(resource)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        blob, `\r\n--${boundary}--`,
      ]);
      const response = await fetchImpl(`${baseUrl}/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(path)}`, {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Firebase ${token}`, "X-Goog-Upload-Protocol": "multipart", "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!response.ok) {
        const code = response.status === 401 ? "storage/unauthenticated" : response.status === 403 ? "storage/unauthorized" : response.status === 404 ? "storage/bucket-not-found" : "storage/server-error";
        throw Object.assign(new Error(`Firebase rejected the upload (HTTP ${response.status}). ${response.status === 403 ? "Check file permissions and size limits." : "Retry after checking storage connectivity."}`), { code });
      }
      const result = await response.json();
      if (result.name !== path || result.bucket !== bucket) throw Object.assign(new Error("Firebase did not confirm the uploaded file."), { code: "storage/invalid-response" });
      return result;
    })()]);
  } catch (error) {
    if (error instanceof TypeError) throw Object.assign(new Error("The browser could not reach Firebase Storage. Check whether a browser extension or network filter is blocking firebasestorage.googleapis.com."), { code: "storage/network-error" });
    throw error;
  } finally { clearTimeout(timer); }
}
