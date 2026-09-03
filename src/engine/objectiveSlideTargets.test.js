import { describe, expect, it } from "vitest";
import { formatSlideTargets, indexObjectiveSlides, slideTargetsForObjectiveIds } from "./objectiveSlideTargets.js";

describe("objective slide targets", () => {
  const chunks = [
    { markdown: "Intro" },
    { markdown: "SOM.MK.I.DM.BCHM.1084\nGlycolysis produces pyruvate." },
    { pageNumber: 8, text: "SOM.MK.I.DM.BCHM.1084 Regulation of glycolysis" },
  ];

  it("indexes exact SOM codes using explicit pages or chunk order", () => {
    expect(indexObjectiveSlides(chunks).get("SOM.MK.I.DM.BCHM.1084")).toEqual([2, 8]);
  });

  it("resolves atom objective ids to supporting slides", () => {
    const targets = slideTargetsForObjectiveIds(["obj-1"], [{ id: "obj-1", code: "SOM.MK.I.DM.BCHM.1084" }], chunks);
    expect(formatSlideTargets(targets)).toBe("slides 2, 8");
  });
});
