const key = (userId, blockId) => `masterGuide:${userId}:${blockId}`;

export function read(userId, blockId) {
  try { return JSON.parse(localStorage.getItem(key(userId, blockId)) || "null"); }
  catch { return null; }
}

export function write(userId, blockId, data) {
  try { localStorage.setItem(key(userId, blockId), JSON.stringify(data)); }
  catch { /* storage full */ }
}

/** Check/uncheck a topic in the master guide. Returns updated guide. */
export function setTopicChecked(userId, blockId, groupId, topicId, checked) {
  const guide = read(userId, blockId);
  if (!guide) return null;
  const groups = guide.groups.map((g) =>
    g.id !== groupId ? g : {
      ...g,
      topics: g.topics.map((t) => t.id === topicId ? { ...t, checked } : t),
    }
  );
  const next = { ...guide, groups };
  write(userId, blockId, next);
  return next;
}

/**
 * Called when a lecture-level study guide topic is checked.
 * Finds master topics whose sourceIds include `${lectureId}:${topicId}` and
 * marks them checked/unchecked accordingly, then returns source topic IDs
 * from matching master topics so LectureStudyFlow can sync the other lecture guides.
 */
export function syncFromLectureTopic(userId, blockId, lectureId, topicId, checked) {
  const guide = read(userId, blockId);
  if (!guide) return [];

  const sourceKey = `${lectureId}:${topicId}`;
  let changed = false;
  const groups = guide.groups.map((g) => ({
    ...g,
    topics: g.topics.map((t) => {
      if (!t.sourceIds?.includes(sourceKey)) return t;
      changed = true;
      return { ...t, checked };
    }),
  }));
  if (!changed) return [];
  write(userId, blockId, { ...guide, groups });
  return [];
}

/**
 * Called when a master topic is checked — returns all sourceIds so the caller
 * can propagate the check to the individual lecture study guides.
 */
export function getSourceIds(userId, blockId, groupId, topicId) {
  const guide = read(userId, blockId);
  if (!guide) return [];
  const group = guide.groups.find((g) => g.id === groupId);
  const topic = group?.topics.find((t) => t.id === topicId);
  return topic?.sourceIds || [];
}
