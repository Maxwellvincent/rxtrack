import { describe, it, expect } from "vitest";
import { parseEventLine, isMine } from "./scheduleParser.js";

// Fixtures are real lines from the BPM 2 Fall 2026 schedule md.
describe("parseEventLine", () => {
  it("extracts a lecture (ABCD, Charter Hall)", () => {
    const e = parseEventLine("8:00am - 8:50am ABCD: BPM2 ER 01 (Charter Hall)");
    expect(e).toMatchObject({
      start: "8:00am", end: "8:50am", cohort: "ABCD", iti: false,
      system: "ER", activity: "lecture", number: 1, location: "Charter Hall",
    });
  });
  it("flags ITI lectures", () => {
    const e = parseEventLine("8:00am - 9:20am ITI ABCD: BPM2 ER 01 (Flipped Class) (Belford 2 (East & Middle))");
    expect(e).toMatchObject({ cohort: "ABCD", iti: true, system: "ER", activity: "lecture", number: 1 });
  });
  it("extracts a small group with subgroup", () => {
    const e = parseEventLine("1:00pm - 2:45pm A (Curie): BPM2 ER Lab (Anatomy Lab)");
    expect(e).toMatchObject({ cohort: "A", subgroup: "Curie", system: "ER", activity: "Lab" });
  });
  it("extracts an SG", () => {
    const e = parseEventLine("1:00pm - 2:45pm A: BPM2 ER SG 01 - HPWP 01 (Belford 2 (East & Middle))");
    expect(e).toMatchObject({ cohort: "A", activity: "SG", number: 1, system: "ER" });
  });
  it("extracts a no-cohort exam (everyone)", () => {
    const e = parseEventLine("7:50am - 8:20am BPM2 ER Exam 01 - CHECK IN (Modica & Taylor Study Halls)");
    expect(e).toMatchObject({ cohort: null, system: "ER", activity: "Exam", number: 1 });
  });
  it("extracts a no-cohort ESoft Quiz with a single time", () => {
    const e = parseEventLine("8:00am BPM2 ER ESoft Quiz 01 (Online Quiz)");
    expect(e).toMatchObject({ cohort: null, system: "ER", activity: "ESoft Quiz", number: 1, start: "8:00am" });
  });
});

describe("isMine", () => {
  const mine = (line) => isMine(parseEventLine(line));
  it("keeps ABCD lectures", () => {
    expect(mine("8:00am - 8:50am ABCD: BPM2 ER 01 (Charter Hall)")).toBe(true);
    expect(mine("9:00am - 9:50am ABCD: BPM2 ER 02 (Charter Hall)")).toBe(true);
  });
  it("drops ITI (even ITI ABCD)", () => {
    expect(mine("8:00am - 9:20am ITI ABCD: BPM2 ER 01 (Flipped Class) (Belford 2 (East & Middle))")).toBe(false);
  });
  it("keeps bare A: (small groups)", () => {
    expect(mine("1:00pm - 2:45pm A: BPM2 ER SG 01 - HPWP 01 (Belford 2 (East & Middle))")).toBe(true);
  });
  it("drops B/C/D-only", () => {
    expect(mine("3:00pm - 4:45pm B: BPM2 ER SG 01 - HPWP 01 (Belford 2 (East & Middle))")).toBe(false);
    expect(mine("1:00pm - 2:45pm C: BPM2 ER SG 03 (Belford 2 (East & Middle))")).toBe(false);
  });
  it("keeps A (Curie) but drops A (Galen&Taylor)", () => {
    expect(mine("1:00pm - 2:45pm A (Curie): BPM2 ER Lab (Anatomy Lab)")).toBe(true);
    expect(mine("1:00pm - 2:45pm A (Galen&Taylor): BPM2 ER Lab (Anatomy Lab)")).toBe(false);
    expect(mine("3:00pm - 4:45pm A (Galen & Taylor): BPM2 ER Lab (Anatomy Lab)")).toBe(false);
  });
  it("keeps no-cohort everyone-events (Exam, ESoft Quiz, IMCQ)", () => {
    expect(mine("7:50am - 8:20am BPM2 ER Exam 01 - CHECK IN (Modica & Taylor Study Halls)")).toBe(true);
    expect(mine("8:00am BPM2 ER ESoft Quiz 01 (Online Quiz)")).toBe(true);
    expect(mine("11:00am - 11:50am ABCD: BPM2 ER IMCQ 01 (Charter Hall)")).toBe(true);
  });
  it("drops CR Students ONLY", () => {
    expect(mine("9:00am - BPM2 CR Final Assessment (CR Students ONLY) CHECK IN (Charter Hall)")).toBe(false);
  });
});
