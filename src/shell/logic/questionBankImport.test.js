import { describe, expect, it, vi } from "vitest";
import { parseClickerImage, questionBankTitleForImages } from "./questionBankImport.js";

function imageFile(name = "clicker.jpeg", relative = "Week 3 Clicker Questions/clicker.jpeg") {
  return {
    name,
    type: "image/jpeg",
    webkitRelativePath: relative,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
  };
}

describe("clicker image question import", () => {
  it("keeps a visibly keyed question and its original image provenance", async () => {
    const result = await parseClickerImage(imageFile(), 4, {
      callAIWithImage: vi.fn().mockResolvedValue(JSON.stringify({
        isQuestion: true,
        questionNumber: 12,
        stem: "A patient has a low glucose level. Which hepatic enzyme state is expected?",
        choices: { A: "Dephosphorylated", B: "Phosphorylated" },
        correct: "B",
        answerKeyVerified: true,
        answerKeyEvidence: "Choice B is highlighted yellow.",
        explanation: "Fasting glucagon activates PKA.",
        hasImage: false,
        imageDependent: false,
      })),
    });

    expect(result).toMatchObject({
      num: 12,
      correct: "B",
      answerKeyVerified: true,
      sourceKeyStatus: "present",
      sourcePage: 5,
      sourceImageMimeType: "image/jpeg",
    });
    expect(result.sourceImageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("withholds an inferred key and drops incomplete continuation slides", async () => {
    const result = await parseClickerImage(imageFile("continuation.jpeg"), 1, {
      callAIWithImage: vi.fn().mockResolvedValue(JSON.stringify({
        isQuestion: false,
        stem: "",
        choices: {},
      })),
    });
    expect(result).toBeNull();
  });

  it("groups folder-selected clickers by their containing folder", () => {
    expect(questionBankTitleForImages([imageFile()])).toBe("Week 3 Clicker Questions");
    expect(questionBankTitleForImages([{ name: "one.jpeg" }])).toBe("In-class Clicker Examples");
  });
});
