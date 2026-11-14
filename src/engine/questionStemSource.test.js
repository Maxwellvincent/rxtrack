import { expect, it } from "vitest";
import { splitQuestionStemSource } from "./questionStemSource.js";

it("moves a trailing textbook figure attribution out of the tested stem", () => {
  const text = "Which labeled tract carries pain? Underlying schematic from Siegel and Sapru, Essential Neuroscience, 4e. Figure 8.5";
  expect(splitQuestionStemSource(text)).toEqual({
    stem: "Which labeled tract carries pain?",
    sourceNote: "Underlying schematic from Siegel and Sapru, Essential Neuroscience, 4e. Figure 8.5",
  });
});

it("leaves ordinary question wording unchanged", () => {
  expect(splitQuestionStemSource("Which structure is affected?")).toEqual({ stem: "Which structure is affected?", sourceNote: "" });
});
