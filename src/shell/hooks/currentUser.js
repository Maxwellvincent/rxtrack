let currentUserId = null;
const listeners = new Set();

export function setStoreHookUserId(userId) {
  currentUserId = userId ?? null;
  listeners.forEach((cb) => cb());
}

export function getStoreHookUserId() {
  return currentUserId;
}

export function subscribeStoreHookUser(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
