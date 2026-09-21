import { describe, it, expect, vi } from "vitest";
import { extractTypedHighYield, buildExtractionWindows } from "./extractHighYield.js";

const longText = "Endocrine physiology. ".repeat(30); // > 200 chars

describe("extractTypedHighYield", () => {
  it("preserves lecturer qualifiers and small testable details", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ atoms: [{
      type: "relationship",
      term: "Rate-limiting step",
      content: "Controls pathway flux.",
      testableDetails: ["Occurs in the committed step"],
      exceptions: ["Not necessarily the first enzymatic step"],
      quantitativeDetails: ["Activated after 2 hours"],
    }] });
    const r = await extractTypedHighYield(longText, {}, { callAIJSON });
    expect(r.atoms[0]).toMatchObject({
      testableDetails: ["Occurs in the committed step"],
      exceptions: ["Not necessarily the first enzymatic step"],
      quantitativeDetails: ["Activated after 2 hours"],
    });
  });

  it("passes block and slide-local objectives into extraction", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ atoms: [] });
    await extractTypedHighYield(longText, {
      lectureTitle: "Heme",
      objectives: [{ code: "SOM.1267", objective: "Explain heme synthesis" }],
      slideObjectiveCodes: ["SOM.1267"],
    }, { callAIJSON });
    expect(callAIJSON.mock.calls[0][1]).toContain("Explain heme synthesis");
    expect(callAIJSON.mock.calls[0][1]).toContain("SOM.1267");
    expect(callAIJSON.mock.calls[0][1]).toContain("OBJECTIVE COVERAGE CONTRACT");
  });

  it("covers long decks with overlapping segment windows", () => {
    const windows = buildExtractionWindows("A".repeat(30000), 6000, 8);
    expect(windows.length).toBeGreaterThan(3);
    expect(windows[0]).toContain("LECTURE SEGMENT 1");
    expect(windows.at(-1)).toContain("LECTURE SEGMENT");
  });
  it("preserves provider errors rather than calling them empty lectures", async () => {
    const callAIJSON = vi.fn().mockRejectedValue(new Error("AI usage limit reached"));
    const result = await extractTypedHighYield(longText, {}, { callAIJSON });
    expect(result.error).toContain("usage limit");
    expect(callAIJSON.mock.calls[0][6]).toMatchObject({
      throwOnError: true,
      bridgeTimeoutMs: 90_000,
      signal: expect.any(AbortSignal),
    });
    expect(callAIJSON).toHaveBeenCalledOnce();
  });
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
    expect(callAIJSON).toHaveBeenCalledTimes(2);
  });

  it("accepts alternate and grouped atom response shapes", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      high_yield_atoms: {
        definitions: [{ term: "Gravidity", content: "The number of pregnancies." }],
        mechanisms: [{ name: "Placental transfer", detail: "Small lipophilic molecules cross readily." }],
      },
    });
    const r = await extractTypedHighYield(longText, {}, { callAIJSON });
    expect(r.atoms.map((a) => a.type)).toEqual(["definition", "mechanism"]);
    expect(callAIJSON).toHaveBeenCalledOnce();
  });

  it("retries the end of a long deck when the opening window is empty", async () => {
    const callAIJSON = vi.fn()
      .mockResolvedValueOnce({ atoms: [] })
      .mockResolvedValueOnce({ atoms: [{ type: "result", term: "Late deceleration", content: "Suggests uteroplacental insufficiency." }] });
    const text = `ADMIN ${"x".repeat(13000)} PREGNANCY TAIL`;
    const r = await extractTypedHighYield(text, {}, { callAIJSON });
    expect(r.atoms).toHaveLength(1);
    expect(callAIJSON.mock.calls[1][1]).toContain("PREGNANCY TAIL");
  });

  it("bounds both extraction windows with one deadline", async () => {
    vi.useFakeTimers();
    const callAIJSON = vi.fn((_system, _user, _fallback, _tokens, _provider, _temperature, options) => (
      new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)))
    ));
    const pending = extractTypedHighYield(longText, {}, { callAIJSON, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.error).toMatch(/Lecture extraction timed out/i);
    expect(callAIJSON).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
