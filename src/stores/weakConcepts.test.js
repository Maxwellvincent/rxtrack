import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as weakConcepts from "./weakConcepts.js";

describe("weak concepts store", () => {
  beforeEach(() => installDomStorage());

  it("keeps the highest missCount per concept", () => {
    weakConcepts.write("u1", { b1: [{ id: "c1", missCount: 1 }] });
    weakConcepts.write("u1", { b1: [{ id: "c1", missCount: 4 }, { id: "c2", missCount: 1 }] });
    expect(weakConcepts.read("u1").b1).toEqual([{ id: "c1", missCount: 4 }, { id: "c2", missCount: 1 }]);
  });
});
