import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { __setLectureQuizBackendForTests, hydrate, isHydrated, read, remove, save } from "./lectureQuizSessions.js";

function makeBackend(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([id, value]) => [`users/user/lectureQuizSessions/${id}`, value]));
  const listeners = new Map();
  const snapshot = (path) => ({ docs: [...docs].filter(([ref]) => ref.startsWith(`${path}/`)).map(([ref, data]) => ({ id: ref.split("/").at(-1), data: () => data })) });
  const publish = () => listeners.forEach((callback, path) => callback(snapshot(path)));
  return {
    docs,
    api: {
      collection: (_db, ...path) => path.join("/"),
      doc: (_db, ...path) => path.join("/"),
      onSnapshot: (path, next) => { listeners.set(path, next); queueMicrotask(() => next(snapshot(path))); return () => listeners.delete(path); },
      setDoc: (ref, value) => { docs.set(ref, value); queueMicrotask(publish); return Promise.resolve(); },
      deleteDoc: (ref) => { docs.delete(ref); queueMicrotask(publish); return Promise.resolve(); },
      serverTimestamp: () => "server-time",
    },
  };
}

describe("lecture quiz checkpoints", () => {
  beforeEach(() => { installDomStorage(); __setLectureQuizBackendForTests(null); });
  afterEach(() => __setLectureQuizBackendForTests(null));

  it("hydrates unfinished quizzes and restores their exact questions and position", async () => {
    const backend = makeBackend({
      "quiz%2Fone": { session: { id: "quiz/one", lectureId: "lec-1", blockId: "b1", questions: [{ stem: "exact saved stem" }], progress: { i: 2, records: [{ correct: false }] } } },
    });
    __setLectureQuizBackendForTests(backend.api);
    expect(isHydrated("user")).toBe(false);
    await hydrate("user");
    expect(read("user", "lec-1", "b1")[0]).toMatchObject({ id: "quiz/one", questions: [{ stem: "exact saved stem" }], progress: { i: 2 } });
  });

  it("checkpoints and deletes one quiz without disturbing another lecture", async () => {
    const backend = makeBackend();
    __setLectureQuizBackendForTests(backend.api);
    await hydrate("user");
    await save("user", { id: "q1", lectureId: "lec-1", blockId: "b1", questions: [{ stem: "saved" }], progress: { i: 1 } });
    await save("user", { id: "q2", lectureId: "lec-2", blockId: "b1", questions: [{ stem: "other" }], progress: { i: 0 } });
    expect(read("user", "lec-1", "b1")).toHaveLength(1);
    await remove("user", "q1");
    expect(read("user", "lec-1", "b1")).toHaveLength(0);
    expect(read("user", "lec-2", "b1")).toHaveLength(1);
    expect(backend.docs.has("users/user/lectureQuizSessions/q1")).toBe(false);
  });
});
