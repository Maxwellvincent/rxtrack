// functions/handlers.test.js — in-process unit tests for Task 7a Cloud Functions.
//
// No emulator, no real secrets. Firestore is a tiny in-memory fake injected via
// index.js's `__setFirestoreForTests` seam (vi.mock("firebase-admin") does not
// reliably intercept require() calls from inside a CJS module loaded via ESM
// import in this Vitest setup — confirmed empirically, factory never runs — so
// this is the reliable alternative). Provider `fetch` calls are stubbed on
// `global.fetch`. Handlers are imported and invoked directly with a fake `req`
// (`{ auth, data }`), exactly as firebase-functions v2 `onCall` would construct one.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildRecognitionBankHandler, aiCompleteHandler, __setFirestoreForTests } from "./index.js";

// ── Fake Admin Firestore (subset used by functions/index.js) ───────────────
function makeFakeFirestore() {
  const store = {}; // collectionPath -> { docId: data }

  function ensure(path) {
    if (!store[path]) store[path] = {};
    return store[path];
  }

  function matchFilter(data, f) {
    if (f.op !== "==") throw new Error(`unsupported operator ${f.op}`);
    return data[f.field] === f.val;
  }

  function makeQuery(path, filters) {
    return {
      where(field, op, val) {
        return makeQuery(path, [...filters, { field, op, val }]);
      },
      async get() {
        const coll = ensure(path);
        const docs = Object.entries(coll)
          .filter(([, data]) => filters.every((f) => matchFilter(data, f)))
          .map(([id, data]) => ({ id, data: () => data }));
        return { docs, size: docs.length };
      },
      count() {
        return {
          async get() {
            const snap = await makeQuery(path, filters).get();
            return { data: () => ({ count: snap.size }) };
          },
        };
      },
    };
  }

  function collectionRef(path) {
    const rootQuery = makeQuery(path, []);
    return {
      doc(id) {
        return {
          id,
          path: `${path}/${id}`,
          collection(name) {
            return collectionRef(`${path}/${id}/${name}`);
          },
        };
      },
      where: rootQuery.where,
      get: rootQuery.get,
      count: rootQuery.count,
    };
  }

  return {
    collection(name) {
      return collectionRef(name);
    },
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) {
          ops.push(() => {
            const collPath = ref.path.split("/").slice(0, -1).join("/");
            const coll = ensure(collPath);
            const existing = opts?.merge ? coll[ref.id] || {} : {};
            coll[ref.id] = { ...existing, ...data };
          });
        },
        delete(ref) {
          ops.push(() => {
            const collPath = ref.path.split("/").slice(0, -1).join("/");
            const coll = ensure(collPath);
            delete coll[ref.id];
          });
        },
        async commit() {
          ops.forEach((op) => op());
        },
      };
    },
    // test helper — not part of the real Admin SDK surface
    seed(path, id, data) {
      ensure(path)[id] = data;
    },
    dump(path) {
      return ensure(path);
    },
  };
}

let fakeDb;

function geminiTextResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    text: async () => text,
  };
}

function vignettePayload(n = 1) {
  const vignettes = Array.from({ length: n }, (_, i) => ({
    vignette: `A patient presents with finding ${i}.`,
    leadIn: "What is the most likely diagnosis?",
    correctDiagnosis: "Diagnosis X",
    mechanism: "Mechanism X",
    keyDifferentiator: "Differentiator X",
    options: [
      { letter: "A", text: "Diagnosis X", isCorrect: true, whyWrong: "" },
      { letter: "B", text: "Diagnosis Y", isCorrect: false, whyWrong: "wrong because..." },
    ],
  }));
  return JSON.stringify({ vignettes });
}

beforeEach(() => {
  fakeDb = makeFakeFirestore();
  __setFirestoreForTests(fakeDb);
  process.env.GEMINI_API_KEY = "fake-gemini-key";
  process.env.ANTHROPIC_API_KEY = "fake-anthropic-key";
  process.env.ALLOWED_UIDS = "u1";
  global.fetch = vi.fn();
});

describe("aiComplete", () => {
  it("returns { text } for a plain-text gemini request from an allowlisted uid", async () => {
    global.fetch.mockResolvedValueOnce(geminiTextResponse("hello from gemini"));

    const req = { auth: { uid: "u1" }, data: { system: "sys", prompt: "hi", model: "gemini" } };
    const result = await aiCompleteHandler(req);

    expect(result).toEqual({ text: "hello from gemini" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
  });

  it("returns { data } and parses JSON when json:true", async () => {
    global.fetch.mockResolvedValueOnce(geminiTextResponse(JSON.stringify({ foo: "bar" })));

    const req = { auth: { uid: "u1" }, data: { prompt: "give me json", json: true, model: "gemini" } };
    const result = await aiCompleteHandler(req);

    expect(result).toEqual({ data: { foo: "bar" } });
  });

  it("throws permission-denied for a non-allowlisted uid", async () => {
    const req = { auth: { uid: "intruder" }, data: { prompt: "hi" } };
    await expect(aiCompleteHandler(req)).rejects.toMatchObject({ code: "permission-denied" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when req.auth is missing", async () => {
    const req = { data: { prompt: "hi" } };
    await expect(aiCompleteHandler(req)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("falls back to the secondary provider when the primary fails", async () => {
    // primary (claude requested -> anthropic) fails, falls back to gemini
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "anthropic down" })
      .mockResolvedValueOnce(geminiTextResponse("fallback text"));

    const req = { auth: { uid: "u1" }, data: { prompt: "hi", model: "claude" } };
    const result = await aiCompleteHandler(req);

    expect(result).toEqual({ text: "fallback text" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("buildRecognitionBank", () => {
  it("returns { generated, processed, remaining, provider } and writes recognitionItems", async () => {
    fakeDb.seed("users/u1/ungeneratedCards", "card1", {
      card_id: "card1",
      block_id: "B1",
      subject: "Cardio",
      text: "Fact A",
    });
    fakeDb.seed("users/u1/ungeneratedCards", "card2", {
      card_id: "card2",
      block_id: "B1",
      subject: "Renal",
      text: "Fact B",
    });

    global.fetch
      .mockResolvedValueOnce(geminiTextResponse(vignettePayload(1)))
      .mockResolvedValueOnce(geminiTextResponse(vignettePayload(1)));

    const req = {
      auth: { uid: "u1" },
      data: { userId: "u1", blockId: "B1", perCard: 1, batch: 10, weakSubjects: ["Renal"] },
    };
    const result = await buildRecognitionBankHandler(req);

    expect(result).toEqual({ generated: 2, processed: 2, remaining: 0, provider: "gemini" });

    const items = fakeDb.dump("users/u1/recognitionItems");
    expect(Object.keys(items)).toHaveLength(2);
    expect(Object.values(items)[0]).toMatchObject({ kind: "vignette", block_id: "B1" });

    const remainingUngenerated = fakeDb.dump("users/u1/ungeneratedCards");
    expect(Object.keys(remainingUngenerated)).toHaveLength(0);
  });

  it("throws permission-denied when data.userId does not match the caller's uid", async () => {
    const req = { auth: { uid: "u1" }, data: { userId: "someone-else", blockId: "B1" } };
    await expect(buildRecognitionBankHandler(req)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws unauthenticated when req.auth is missing", async () => {
    const req = { data: { blockId: "B1" } };
    await expect(buildRecognitionBankHandler(req)).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
