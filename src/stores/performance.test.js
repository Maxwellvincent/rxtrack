import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as performance from "./performance.js";

describe("performance store", () => {
  beforeEach(() => installDomStorage());

  it("round-trips and merges session history by lecture key", () => {
    performance.merge("u1", {
      "l1__b1": { sessions: [{ date: "2026-01-01T00:00:00Z", lectureId: "l1", sessionType: "quiz", score: 60 }] },
    });
    performance.merge("u1", {
      "l1__b1": { sessions: [{ date: "2026-01-02T00:00:00Z", lectureId: "l1", sessionType: "quiz", score: 100 }] },
    });

    expect(performance.read("u1")["l1__b1"].sessions).toHaveLength(2);
    expect(performance.read("u1")["l1__b1"].score).toBe(80);
  });
});
