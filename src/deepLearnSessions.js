/**
 * Paused DeepLearn sessions: small stub on the device, body in Firestore.
 *
 * A session accumulates everything it generated — one held 684 SAQs and 640
 * structure SAQs, 844KB on its own. Three of them pushed the rxt-dl-sessions
 * map past the 900KB document guard, so the sync skipped the whole key and the
 * sessions had no cloud copy at all for months.
 *
 * Now each session is its own Firestore doc and localStorage keeps only what
 * the resume list renders. The body is fetched when a session is actually
 * resumed, which is once, deliberately, and worth a round trip.
 */

/** Everything the paused-session list and the resume prompt read. */
export const STUB_FIELDS = [
  "blockId",
  "lecId",
  "lectureTitle",
  "lectureType",
  "lectureNumber",
  "phase",
  "lastSaved",
  "sessionType",
  "isCrossLecture",
  "crossLectureIds",
  "topic",
];

/** Bodies above this stay in the cloud only. Small sessions are not worth a fetch. */
export const OFFLOAD_BYTES = 60_000;

export function sessionBytes(session) {
  try {
    return JSON.stringify(session ?? null).length;
  } catch {
    return 0;
  }
}

/** A session already reduced to its stub has nothing more to give. */
export function isStub(session) {
  return !!session?.payloadInCloud;
}

/** What gets written to localStorage for a session whose body lives in the cloud. */
export function toSessionStub(session) {
  const stub = { payloadInCloud: true };
  for (const field of STUB_FIELDS) {
    if (session?.[field] !== undefined) stub[field] = session[field];
  }
  return stub;
}

/**
 * Decide what to keep locally. Small sessions stay whole so resuming them costs
 * nothing; big ones are reduced to a stub.
 */
export function localCopyOf(session, maxBytes = OFFLOAD_BYTES) {
  if (!session || isStub(session)) return session;
  return sessionBytes(session) > maxBytes ? toSessionStub(session) : session;
}

/** Apply that rule across the whole map, for a one-off repair or a migration. */
export function shrinkSessionMap(map, maxBytes = OFFLOAD_BYTES) {
  const out = {};
  for (const [id, session] of Object.entries(map || {})) out[id] = localCopyOf(session, maxBytes);
  return out;
}

/**
 * Fold a fetched body back over its stub.
 *
 * The stub is authoritative for the fields it carries: it is what the device
 * last wrote, and the cloud copy could be older if a push failed.
 */
export function hydrateSession(stub, body) {
  if (!body) return stub;
  const merged = { ...body };
  for (const field of STUB_FIELDS) {
    if (stub?.[field] !== undefined) merged[field] = stub[field];
  }
  delete merged.payloadInCloud;
  return merged;
}
