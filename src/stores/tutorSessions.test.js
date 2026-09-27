import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { __setTutorBackendForTests, get, hydrate, isHydrated, key, save, syncStatus } from "./tutorSessions.js";

function makeBackend(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([id, value]) => [`users/user/tutorSessions/${id}`, value]));
  const listeners = new Map();
  const snapshot = (path) => ({ docs: [...docs].filter(([ref]) => ref.startsWith(`${path}/`)).map(([ref, data]) => ({ id: ref.split("/").at(-1), data: () => data })) });
  const publish = () => listeners.forEach((callback, path) => callback(snapshot(path)));
  const backend = {
    collection: (_db, ...path) => path.join("/"),
    doc: (_db, ...path) => path.join("/"),
    onSnapshot: (path, next) => { listeners.set(path, next); queueMicrotask(() => next(snapshot(path))); return () => { listeners.delete(path); }; },
    setDoc: (ref, value) => { docs.set(ref, value); queueMicrotask(publish); return Promise.resolve(); },
    deleteDoc: (ref) => { docs.delete(ref); return Promise.resolve(); },
    serverTimestamp: () => "server-time",
  };
  return { backend, docs };
}

describe("Firestore tutor checkpoints", () => {
  beforeEach(() => { installDomStorage(); __setTutorBackendForTests(null); });

  it("hydrates per-lecture conversation documents into the in-memory cache", async () => {
    const { backend } = makeBackend({
      "lec%2E1": { session: { lectureId: "lec.1", status: "paused", turns: [] } },
    });
    __setTutorBackendForTests(backend);
    expect(isHydrated("user")).toBe(false);
    await hydrate("user");
    expect(get("user", "lec.1")).toMatchObject({ lectureId: "lec.1", status: "paused" });
    expect(isHydrated("user")).toBe(true);
  });

  it("writes a compact checkpoint asynchronously without putting tutor data in localStorage", async () => {
    const { backend, docs } = makeBackend();
    __setTutorBackendForTests(backend);
    const session = {
      lectureId: "lec-2",
      objectiveStartedIds: [],
      turns: Array.from({ length: 24 }, (_, index) => ({ objectiveId: "o1", response: `answer-${index}-${"x".repeat(1000)}` })),
      learnerProfile: { confirmedAnchors: [], recentMisses: [], confidenceEvents: [], reasoningSkillEvidence: [] },
    };
    await save("user", session);
    expect(docs.get("users/user/tutorSessions/lec-2").session.turns).toHaveLength(16);
    expect(docs.get("users/user/tutorSessions/lec-2").session.turns.at(-1).response.length).toBeLessThan(1000);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(`rxt:user:${key}`)).toBeNull();
    expect(syncStatus("user", "lec-2")).toBe("saved");
  });

  it("archives previous conversation turns and reuses their learner signals in later sessions", async () => {
    const { backend, docs } = makeBackend();
    __setTutorBackendForTests(backend);
    const learnerProfile = {
      confirmedAnchors: [{ objectiveId: "o1", response: "I can explain the pathway", at: 10 }],
      recentMisses: [], confidenceEvents: [], reasoningSkillEvidence: [{ objectiveId: "o1", skill: "causal-chain", at: 10 }],
    };
    await save("user", { lectureId: "lec-archive", sessionId: "old-session", startedAt: 10, turns: [{ response: "prior case answer" }], learnerProfile });
    await save("user", { lectureId: "lec-archive", sessionId: "new-session", startedAt: 20, turns: [], learnerProfile: {} });
    await vi.waitFor(() => expect(docs.has("users/user/tutorHistory/old-session")).toBe(true));
    expect(docs.get("users/user/tutorHistory/old-session").session.turns[0].response).toBe("prior case answer");
    expect((await import("./tutorSessions.js")).getLearnerProfile("user").confirmedAnchors).toContainEqual(expect.objectContaining({ response: "I can explain the pathway" }));
  });

  it("migrates legacy local checkpoints and removes them only after cloud acknowledgement", async () => {
    const { backend, docs } = makeBackend();
    localStorage.setItem(`rxt:user:${key}`, JSON.stringify({ lec3: { lectureId: "lec3", turns: [] } }));
    __setTutorBackendForTests(backend);
    await hydrate("user");
    await vi.waitFor(() => expect(docs.has("users/user/tutorSessions/lec3")).toBe(true));
    await vi.waitFor(() => expect(localStorage.getItem(`rxt:user:${key}`)).toBeNull());
    expect(get("user", "lec3")).toMatchObject({ lectureId: "lec3" });
  });

  it("keeps unsynced progress in memory and exposes a retryable error state", async () => {
    const { backend } = makeBackend();
    backend.setDoc = () => Promise.reject(new Error("offline"));
    __setTutorBackendForTests(backend);
    const session = { lectureId: "lec4", turns: [] };
    expect(await save("user", session)).toBe(false);
    expect(get("user", "lec4")).toMatchObject(session);
    expect(syncStatus("user", "lec4")).toBe("error");
  });
});
