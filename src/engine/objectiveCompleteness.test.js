import { describe, expect, it } from "vitest";
import { objectiveCompleteness } from "./objectiveCompleteness.js";

const slides = `Learning Objectives
SOM.MK.I.BPM2.4.NB.1.NSCI.0302 Describe hypotheses regarding the role of sleep.
SOM.MK.I.BPM2.4.NB.1.NSCI.0304 Contrast sleep stages through the use of electroencephalography.
\fSleep stages
Stage 2 shows sleep spindles and K-complexes.`;
const lecture = { id: "nb61", lectureTitle: "NB 61 Sleep" };

describe("objectiveCompleteness", () => {
  it("reports complete when every slide objective code is stored", () => {
    const stored = [{ code: "SOM.MK.I.BPM2.4.NB.1.NSCI.0302" }, { code: "SOM.MK.I.BPM2.4.NB.1.NSCI.0304" }];
    expect(objectiveCompleteness(slides, lecture, stored, "b")).toMatchObject({ status: "complete", slideCount: 2, storedCount: 2, missing: [] });
  });

  it("lists slide objectives that were never stored", () => {
    const result = objectiveCompleteness(slides, lecture, [{ code: "SOM.MK.I.BPM2.4.NB.1.NSCI.0302" }], "b");
    expect(result.status).toBe("missing");
    expect(result.missing.map(o => o.code)).toEqual(["SOM.MK.I.BPM2.4.NB.1.NSCI.0304"]);
    expect(result.missing[0].text).toMatch(/electroencephalography/);
  });

  it("does not claim completeness when no objective slide was found", () => {
    expect(objectiveCompleteness("Sleep stages only.", lecture, [{ code: "X.1" }], "b")).toMatchObject({ status: "no-slide-objectives", storedCount: 1 });
  });

  it("does not run before the lecture text has loaded", () => {
    expect(objectiveCompleteness("", lecture, [], "b").status).toBe("unknown");
  });
});
