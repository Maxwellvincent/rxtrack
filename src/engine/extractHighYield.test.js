import { describe, it, expect, vi } from "vitest";
import { extractTypedHighYield } from "./extractHighYield.js";

const longText = "Endocrine physiology. ".repeat(30); // > 200 chars

describe("extractTypedHighYield", () => {
  it("calls the injected AI with the lecture text and normalizes the atoms", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      atoms: [
        { type: "definition", term: "Insulin", content: "Anabolic hormone from beta cells." },
        { type: "MOA", term: "Insulin signaling", content: "RTK → GLUT4." },
        { type: "fluff", term: "History", content: "Discovered 1921." },
      ],
    });
    const r = await extractTypedHighYield(longText, { lectureTitle: "ER 01" }, { callAIJSON });
    expect(callAIJSON).toHaveBeenCalledOnce();
    const userPrompt = callAIJSON.mock.calls[0][1];
    expect(userPrompt).toContain("Endocrine physiology");
    expect(r.atoms.map((a) => a.type)).toEqual(["definition", "mechanism"]); // fluff dropped, typed
  });

  it("returns an error (no AI call) when the text is too short", async () => {
    const callAIJSON = vi.fn();
    const r = await extractTypedHighYield("too short", {}, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.error).toMatch(/text/i);
  });

  it("surfaces an empty result when the model returns nothing usable", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ atoms: [] });
    const r = await extractTypedHighYield(longText, {}, { callAIJSON });
    expect(r.atoms).toEqual([]);
  });
});
