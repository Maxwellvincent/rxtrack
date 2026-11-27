import { describe, expect, it } from "vitest";
import { reserveWithCrossSlots } from "./lectureQuizPartner.js";

const q = (n, extra = {}) => ({ stem: `q${n}`, ...extra });
describe("reserveWithCrossSlots", () => {
  it("frees cross-lecture slots in a full reserve", () => {
    const reserve = Array.from({ length: 10 }, (_, i) => q(i));
    const out = reserveWithCrossSlots(reserve, { count: 10, crossSlots: 2 });
    expect(out.reserve).toHaveLength(8);
    expect(out.crossNeeded).toBe(2);
  });
  it("counts cross-lecture items already in the reserve", () => {
    const reserve = [q(0, { crossLecture: { partnerLectureId: "p" } }), ...Array.from({ length: 9 }, (_, i) => q(i + 1))];
    expect(reserveWithCrossSlots(reserve, { count: 10, crossSlots: 2 })).toMatchObject({ crossNeeded: 1 });
    expect(reserveWithCrossSlots(reserve, { count: 10, crossSlots: 1 }).reserve).toBe(reserve);
  });
  it("never drops seed questions and leaves a short reserve alone", () => {
    const reserve = Array.from({ length: 10 }, (_, i) => q(i));
    expect(reserveWithCrossSlots(reserve, { count: 10, crossSlots: 2, seedCount: 10 })).toMatchObject({ crossNeeded: 0 });
    const short = [q(1), q(2)];
    expect(reserveWithCrossSlots(short, { count: 10, crossSlots: 2 })).toEqual({ reserve: short, crossNeeded: 2 });
  });
});
