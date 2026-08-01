import { describe, it, expect } from "vitest";
import { ROUND_SIZE, atomRounds, roundLabel } from "./lectureStudy.js";

const atoms = (n) => Array.from({ length: n }, (_, i) => ({ type: "definition", term: `t${i}`, content: "c" }));

describe("atomRounds", () => {
  it("keeps a round small enough to finish", () => {
    expect(ROUND_SIZE).toBeLessThanOrEqual(5);
  });

  it("splits a full lecture into rounds of five", () => {
    const rounds = atomRounds(atoms(48));
    expect(rounds).toHaveLength(10);
    expect(rounds[0]).toHaveLength(5);
    expect(rounds[9]).toHaveLength(3);
  });

  it("preserves atom order across rounds", () => {
    const rounds = atomRounds(atoms(12));
    expect(rounds[0][0].term).toBe("t0");
    expect(rounds[2][1].term).toBe("t11");
  });

  it("handles empty, short, and junk input", () => {
    expect(atomRounds([])).toEqual([]);
    expect(atomRounds(atoms(3))).toHaveLength(1);
    expect(atomRounds(null)).toEqual([]);
    expect(atomRounds([null, undefined, ...atoms(1)])).toHaveLength(1);
  });

  it("never loops forever on a zero size", () => {
    expect(atomRounds(atoms(4), 0)).toHaveLength(4);
  });
});

describe("roundLabel", () => {
  it("names the span you are working through", () => {
    const rounds = atomRounds(atoms(48));
    expect(roundLabel(0, rounds, 48)).toBe("atoms 1–5 of 48");
    expect(roundLabel(9, rounds, 48)).toBe("atoms 46–48 of 48");
  });

  it("says nothing when there is nothing to label", () => {
    expect(roundLabel(0, [], 0)).toBe("");
  });
});
