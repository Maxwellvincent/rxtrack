import { describe, it, expect, beforeEach } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import {
  readRoundProgress,
  saveRoundProgress,
  clearRoundProgress,
  resumeRound,
  PROGRESS_KEY,
} from "./lectureProgress.js";

installDomStorage();
beforeEach(() => localStorage.clear());

describe("round progress", () => {
  it("starts a lecture that was never studied at the beginning", () => {
    expect(readRoundProgress("lec1")).toBe(0);
  });

  it("remembers how far you got", () => {
    saveRoundProgress("lec1", 3);
    expect(readRoundProgress("lec1")).toBe(3);
  });

  it("keeps lectures apart", () => {
    saveRoundProgress("lec1", 3);
    saveRoundProgress("lec2", 1);
    expect(readRoundProgress("lec1")).toBe(3);
    expect(readRoundProgress("lec2")).toBe(1);
  });

  it("never moves backwards — finishing round 2 again does not undo round 5", () => {
    saveRoundProgress("lec1", 5);
    saveRoundProgress("lec1", 2);
    expect(readRoundProgress("lec1")).toBe(5);
  });

  it("forgets a lecture on request, for starting over", () => {
    saveRoundProgress("lec1", 4);
    clearRoundProgress("lec1");
    expect(readRoundProgress("lec1")).toBe(0);
  });

  it("survives corrupt storage rather than taking the screen down with it", () => {
    localStorage.setItem(PROGRESS_KEY, "{not json");
    expect(readRoundProgress("lec1")).toBe(0);
    saveRoundProgress("lec1", 2);
    expect(readRoundProgress("lec1")).toBe(2);
  });

  it("ignores a missing lecture id instead of writing a junk entry", () => {
    saveRoundProgress("", 3);
    expect(localStorage.getItem(PROGRESS_KEY)).toBe(null);
  });
});

describe("resumeRound", () => {
  it("picks up where you stopped", () => {
    expect(resumeRound(3, 10)).toBe(3);
  });

  it("starts over once the lecture is finished — there is nothing left to resume", () => {
    expect(resumeRound(10, 10)).toBe(0);
  });

  it("clamps when the lecture shrank under it, after a re-extraction", () => {
    expect(resumeRound(9, 4)).toBe(0);
  });

  it("handles a lecture with no rounds at all", () => {
    expect(resumeRound(0, 0)).toBe(0);
  });
});
