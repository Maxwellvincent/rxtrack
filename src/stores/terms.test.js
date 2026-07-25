import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as terms from "./terms.js";

describe("terms store", () => {
  beforeEach(() => installDomStorage());

  it("round-trips JSON data through its codec", () => {
    const value = [{ id: "t1", name: "Term 1", blocks: [{ id: "b1", name: "Block 1" }] }];
    terms.write("u1", value);
    expect(terms.read("u1")).toEqual(value);
  });

  it("merges by term id and preserves distinct blocks", () => {
    terms.write("u1", [{ id: "t1", name: "Old", blocks: [{ id: "b1" }] }]);
    terms.write("u1", [{ id: "t1", name: "New", blocks: [{ id: "b2" }] }]);

    expect(terms.read("u1")).toEqual([{ id: "t1", name: "New", blocks: [{ id: "b1" }, { id: "b2" }] }]);
  });
});
