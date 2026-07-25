import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as objectives from "./blockObjectives.js";

describe("block objectives store", () => {
  beforeEach(() => installDomStorage());

  it("round-trips objective maps", () => {
    const value = { b1: { imported: [{ id: "o1", drillCount: 1 }], extracted: [] } };
    objectives.write("u1", value);
    expect(objectives.read("u1")).toEqual(value);
  });

  it("merges per block and prefers the objective with more drill evidence", () => {
    objectives.merge("u1", { b1: { imported: [{ id: "o1", score: 20, drillCount: 1 }], extracted: [{ id: "e1" }] } });
    objectives.merge("u1", { b1: { imported: [{ id: "o1", score: 90, drillCount: 3 }], extracted: [{ id: "e2" }] } });

    expect(objectives.read("u1").b1).toEqual({
      imported: [{ id: "o1", score: 90, drillCount: 3 }],
      extracted: [{ id: "e1" }, { id: "e2" }],
    });
  });
});
