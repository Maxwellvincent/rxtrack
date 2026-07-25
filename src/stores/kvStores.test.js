import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as lectures from "./lectures.js";
import * as examDates from "./examDates.js";
import * as calibration from "./calibration.js";

describe("remaining Phase 0 stores", () => {
  beforeEach(() => installDomStorage());

  it("lectures round-trip and merge by lecture id", () => {
    lectures.write("u1", [{ id: "l1", title: "Old" }]);
    lectures.write("u1", [{ id: "l1", title: "New" }, { id: "l2", title: "Two" }]);
    expect(lectures.read("u1")).toEqual([{ id: "l1", title: "New" }, { id: "l2", title: "Two" }]);
  });

  it("exam dates shallow-merge by block id", () => {
    examDates.write("u1", { b1: "2026-08-01" });
    examDates.write("u1", { b2: "2026-09-01" });
    expect(examDates.read("u1")).toEqual({ b1: "2026-08-01", b2: "2026-09-01" });
  });

  it("calibration log appends unique records", () => {
    calibration.write("u1", [{ concept: "A", ts: 1 }]);
    calibration.write("u1", [{ concept: "A", ts: 1 }, { concept: "B", ts: 2 }]);
    expect(calibration.read("u1")).toEqual([{ concept: "A", ts: 1 }, { concept: "B", ts: 2 }]);
  });
});
