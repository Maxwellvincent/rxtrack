/**
 * Persist upload queue PDFs in IndexedDB so a tab refresh can resume processing.
 * Falls back to an in-memory Map when IndexedDB is unavailable (tests/SSR).
 */

const DB_NAME = "rxt-upload-queue-blobs";
const STORE = "blobs";
const DB_VERSION = 1;

/** @type {Map<string, File>} */
const memoryFallback = new Map();

function idbUnavailable() {
  return typeof indexedDB === "undefined";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {string} queueId
 * @param {File} file
 */
export async function putUploadQueueBlob(queueId, file) {
  if (!queueId || !file) return;
  if (idbUnavailable()) {
    memoryFallback.set(queueId, file);
    return;
  }
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return;
  }
  const payload = {
    name: file.name,
    type: file.type || "application/pdf",
    buffer,
  };
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.objectStore(STORE).put(payload, queueId);
  });
}

/**
 * @param {string} queueId
 * @returns {Promise<File | null>}
 */
export async function getUploadQueueBlob(queueId) {
  if (!queueId) return null;
  if (idbUnavailable()) {
    return memoryFallback.get(queueId) || null;
  }
  const db = await openDb();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    const req = tx.objectStore(STORE).get(queueId);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
  if (!row?.buffer) return null;
  try {
    return new File([row.buffer], row.name, { type: row.type || "application/pdf" });
  } catch {
    return null;
  }
}

/**
 * @param {string} queueId
 */
export async function deleteUploadQueueBlob(queueId) {
  if (!queueId) return;
  memoryFallback.delete(queueId);
  if (idbUnavailable()) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.objectStore(STORE).delete(queueId);
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {string[]} queueIds
 */
export async function deleteUploadQueueBlobs(queueIds) {
  if (!queueIds?.length) return;
  await Promise.all(queueIds.map((id) => deleteUploadQueueBlob(id)));
}

/** Dev/tests: clear memory fallback */
export function __resetUploadBlobMemoryForTests() {
  memoryFallback.clear();
}
