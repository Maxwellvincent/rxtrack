import { describe, expect, it } from "vitest";
import { acceptedChoiceNotes, buildOtherChoicesPrompt } from "./explainOtherChoices.js";
describe("explain other choices", () => {
  const question = { stem: "A woman with GAD symptoms for 6 months. Best initial treatment?", choices: { A: "Benzodiazepines", B: "Antipsychotics", D: "CBT" }, correct: "D", explanation: "CBT is first line." };
  it("asks only about the unexplained wrong choices and anchors to the key and source", () => {
    const prompt = buildOtherChoicesPrompt(question, ["B"], { A: "Addiction risk." });
    expect(prompt).toMatch(/For each of these choices: B,/);
    expect(prompt).toMatch(/Keyed correct answer: D/);
    expect(prompt).toMatch(/CBT is first line/);
  });
  it("keeps only usable notes for the requested letters", () => {
    expect(acceptedChoiceNotes({ notes: { B: "Antipsychotics treat psychosis, which she does not have.", D: "should be ignored", C: "x" } }, ["B", "C"])).toEqual({ B: "Antipsychotics treat psychosis, which she does not have." });
    expect(acceptedChoiceNotes(null, ["B"])).toEqual({});
  });
});
