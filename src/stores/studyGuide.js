const key = (userId, lectureId) => `studyGuide:${userId}:${lectureId}`;

export function read(userId, lectureId) {
  try { return JSON.parse(localStorage.getItem(key(userId, lectureId)) || "null"); }
  catch { return null; }
}

export function write(userId, lectureId, data) {
  try { localStorage.setItem(key(userId, lectureId), JSON.stringify(data)); }
  catch { /* storage full */ }
}

export function setTopicChecked(userId, lectureId, topicId, checked) {
  const guide = read(userId, lectureId) || { topics: [] };
  const topics = guide.topics.map((t) => t.id === topicId ? { ...t, checked } : t);
  const next = { ...guide, topics };
  write(userId, lectureId, next);
  return next;
}
