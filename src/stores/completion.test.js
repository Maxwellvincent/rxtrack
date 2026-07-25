import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as completion from "./completion.js";

describe("completion store", () => {
  beforeEach(() => installDomStorage());

  it("keeps max completion level and unions activity logs", () => {
    completion.merge("u1", {
      "l1__b1": { completionLevel: 1, lastActivityDate: "2026-01-01", reviewDates: ["old"], activityLog: [{ id: "a", date: "2026-01-01" }] },
    });
    completion.merge("u1", {
      "l1__b1": { completionLevel: 3, lastActivityDate: "2026-01-02", reviewDates: ["new"], activityLog: [{ id: "b", date: "2026-01-02" }] },
    });

    const entry = completion.read("u1")["l1__b1"];
    expect(entry.completionLevel).toBe(3);
    expect(entry.reviewDates).toEqual(["new"]);
    expect(entry.activityLog.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
