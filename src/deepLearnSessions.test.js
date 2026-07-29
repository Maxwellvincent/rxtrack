import { describe, expect, it } from "vitest";
import {
  OFFLOAD_BYTES,
  hydrateSession,
  isStub,
  localCopyOf,
  shrinkSessionMap,
  toSessionStub,
} from "./deepLearnSessions.js";

const big = (id = "s1") => ({
  blockId: "cpr1",
  lecId: "lec9",
  lectureTitle: "Shock",
  phase: "selftest",
  lastSaved: "2026-04-05T18:30:32.579Z",
  isCrossLecture: false,
  saqQuestions: Array.from({ length: 700 }, (_, i) => ({ q: "x".repeat(200), i, id })),
});

const small = {
  blockId: "cpr2",
  lecId: "lec30",
  lectureTitle: "Renal",
  phase: "prime",
  lastSaved: "2026-04-25T04:25:53.698Z",
  recallAnswer: "short",
};

describe("toSessionStub", () => {
  it("keeps what the resume list shows and drops the body", () => {
    const stub = toSessionStub(big());
    expect(stub).toMatchObject({
      payloadInCloud: true,
      blockId: "cpr1",
      lecId: "lec9",
      lectureTitle: "Shock",
      phase: "selftest",
      lastSaved: "2026-04-05T18:30:32.579Z",
    });
    expect(stub.saqQuestions).toBeUndefined();
    expect(JSON.stringify(stub).length).toBeLessThan(400);
  });

  it("omits fields the session never had rather than writing undefined", () => {
    expect("crossLectureIds" in toSessionStub({ blockId: "b" })).toBe(false);
  });
});

describe("localCopyOf", () => {
  it("reduces a session over the threshold", () => {
    expect(isStub(localCopyOf(big()))).toBe(true);
  });

  it("keeps a small session whole, so resuming it needs no fetch", () => {
    expect(localCopyOf(small)).toBe(small);
    expect(isStub(localCopyOf(small))).toBe(false);
  });

  it("does not re-stub something already reduced", () => {
    const stub = toSessionStub(big());
    expect(localCopyOf(stub)).toBe(stub);
  });

  it("respects a caller's own threshold", () => {
    expect(isStub(localCopyOf(small, 10))).toBe(true);
    expect(isStub(localCopyOf(big(), 10 * OFFLOAD_BYTES))).toBe(false);
  });
});

describe("shrinkSessionMap", () => {
  it("reduces only the sessions that need it", () => {
    const out = shrinkSessionMap({ a: big("a"), b: small });
    expect(isStub(out.a)).toBe(true);
    expect(isStub(out.b)).toBe(false);
    expect(Object.keys(out)).toEqual(["a", "b"]);
  });

  it("survives an empty map", () => {
    expect(shrinkSessionMap(null)).toEqual({});
  });
});

describe("hydrateSession", () => {
  it("puts the body back under the stub", () => {
    const body = big();
    const merged = hydrateSession(toSessionStub(body), body);
    expect(merged.saqQuestions).toHaveLength(700);
    expect(merged.payloadInCloud).toBeUndefined();
  });

  it("lets the stub win where they disagree — the device wrote it last", () => {
    const body = { ...big(), phase: "prime", lastSaved: "2026-01-01T00:00:00.000Z" };
    const stub = toSessionStub(big());
    const merged = hydrateSession(stub, body);
    expect(merged.phase).toBe("selftest");
    expect(merged.lastSaved).toBe("2026-04-05T18:30:32.579Z");
    expect(merged.saqQuestions).toHaveLength(700);
  });

  it("returns the stub untouched when the fetch came back empty", () => {
    const stub = toSessionStub(big());
    expect(hydrateSession(stub, null)).toBe(stub);
  });
});
