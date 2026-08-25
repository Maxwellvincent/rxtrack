const key = (userId, lectureId) => `mentalModel:${userId}:${lectureId}`;

export function read(userId, lectureId) {
  try { return JSON.parse(localStorage.getItem(key(userId, lectureId)) || "null"); }
  catch { return null; }
}

export function write(userId, lectureId, data) {
  try { localStorage.setItem(key(userId, lectureId), JSON.stringify(data)); }
  catch { /* storage full */ }
}
