import { describe, expect, it } from "vitest";
import { buildQuestionWorksheetHtml } from "./questionWorksheet.js";

describe("buildQuestionWorksheetHtml", () => {
  it("exports saved selections, key, rationale, objective, and post-exam classification", () => {
    const html = buildQuestionWorksheetHtml([{
      stem: "A <patient> has findings.\nWhat is the mechanism?",
      choices: { B: "Option B", A: "Option A" },
      correct: "A", explanation: "This is the answer rationale.",
      selectedAnswer: "B", errorClassification: "Content gap",
      reviewDiagnostic: { patient: "A patient has findings", bridge: "Connect the findings to the mechanism" },
      hasImage: true, sourceImageUrl: "https://example.test/figure.png",
      lectureLabel: "LEC 4 · Metabolism", objectiveIds: ["OBJ.1"],
    }], { title: "Quiz misses" });
    expect(html).toContain("A &lt;patient&gt; has findings.");
    expect(html).toContain("https://example.test/figure.png");
    expect(html).toContain("LEC 4 · Metabolism · OBJ.1");
    expect(html.indexOf("A.</span> Option A")).toBeLessThan(html.indexOf("B.</span> Option B"));
    expect(html).toContain("This is the answer rationale");
    expect(html).toContain("My selected answer");expect(html).toContain("B — Option B");
    expect(html).toContain("Correct answer");expect(html).toContain("A — Option A");
    expect(html).toContain("Content gap");expect(html).toContain("Connect the findings to the mechanism");
  });

  it("renders structured table choices", () => {
    const html = buildQuestionWorksheetHtml([{ stem: "Compare", choices: { A: { Finding: "Low", Patient: "High" } } }]);
    expect(html).toContain("<th>Finding</th><td>Low</td>");
    expect(html).toContain("<th>Patient</th><td>High</td>");
  });
});
