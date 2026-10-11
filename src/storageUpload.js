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
