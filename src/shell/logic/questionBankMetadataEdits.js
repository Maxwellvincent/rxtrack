function findOrCreateEntry(userId, bank, store) {
  let metadata = store.read(userId) || {};
  let found = Object.entries(metadata).find(([, entry]) => entry?.filename === bank.filename);
  if (!found) {
    metadata = store.withRecordedUpload(metadata, {
      filename: bank.filename,
      blockId: bank.blockId || null,
      sourceKind: bank.sourceKind || "school",
    });
    found = Object.entries(metadata).find(([, entry]) => entry?.filename === bank.filename);
  }
  if (!found) throw new Error("Could not find this question bank’s metadata.");
  return { metadata, id: found[0], entry: found[1] };
}

/** Persist one question-bank name/date edit to its Firestore metadata document. */
export async function updateQuestionBankMetadata(userId, bank, patch, store) {
  if (!bank?.filename) throw new Error("Question bank not found.");
  const { metadata, id, entry } = findOrCreateEntry(userId, bank, store);
  const next = { ...metadata, [id]: { ...entry, ...patch } };
  try {
    await store.writeAwait(userId, next);
  } catch (error) {
    // Cloud-backed stores optimistically update their cache; restore the last
    // known value so a failed save is not shown as if it had stuck.
    store.write(userId, metadata);
    throw error;
  }
  return next[id];
}
