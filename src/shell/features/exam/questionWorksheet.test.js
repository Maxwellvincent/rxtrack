import { describe, expect, it } from "vitest";
import { buildQuestionWorksheetHtml } from "./questionWorksheet.js";

describe("buildQuestionWorksheetHtml", () => {
  it("exports stems, figures, and complete choices but never the key or rationale", () => {
    const html = buildQuestionWorksheetHtml([{
      stem: "A <patient> has findings.\nWhat is the mechanism?",
      choices: { B: "Option B", A: "Option A" },
      correct: "A", explanation: "This is the answer rationale.",
      hasImage: true, sourceImageUrl: "https://example.test/figure.png",
      lectureLabel: "LEC 4 · Metabolism", objectiveIds: ["OBJ.1"],
    }], { title: "Quiz misses" });
    expect(html).toContain("A &lt;patient&gt; has findings.");
    expect(html).toContain("https://example.test/figure.png");
    expect(html).toContain("LEC 4 · Metabolism · OBJ.1");
    expect(html.indexOf("A.</span> Option A")).toBeLessThan(html.indexOf("B.</span> Option B"));
    expect(html).not.toContain("This is the answer rationale");
    expect(html).not.toContain("Correct answer");
    expect(html).toContain("My reasoning");
  });

  it("renders structured table choices", () => {
    const html = buildQuestionWorksheetHtml([{ stem: "Compare", choices: { A: { Finding: "Low", Patient: "High" } } }]);
    expect(html).toContain("<th>Finding</th><td>Low</td>");
    expect(html).toContain("<th>Patient</th><td>High</td>");
  });
});
