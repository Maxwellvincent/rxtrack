import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import * as progress from "../../../stores/atomProgress.js";
import { repairEvidenceStore } from "../../../stores/modelRepairEvidence.js";
const bridgeCompleteMock = vi.hoisted(() => vi.fn());
vi.mock("../../../llmBridge.js", () => ({ bridgeComplete: (...args) => bridgeCompleteMock(...args) }));
import { ModelRepairs, selectModelRepairs, modelRepairPrompt, ankiWeakPointBrief } from "./ModelRepairs.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { installDomStorage(); bridgeCompleteMock.mockReset(); });
const question = { topic: "Concept A", stem: "Which connection is missing?", choices: { A: "First", B: "Second" }, picked: "A", correct: "B", explanation: "The causal connection distinguishes them.", confidence: 5 };

describe("Model repairs", () => {
  it("retains miss context across store reads, deduplicates, and clears on correct retest", () => {
    progress.recordAtomAnswer(null, "lec", "a", false, question);
    progress.recordAtomAnswer(null, "lec", "a", false, question);
    const evidence = repairEvidenceStore("lec").read(null);
    const { topic, ...details } = question;
    expect(evidence.a).toMatchObject({ ...details, concept: topic });
    expect(selectModelRepairs(progress.progressForLecture(null, "lec"), [], evidence)).toHaveLength(1);
    progress.recordAtomAnswer(null, "lec", "a", true);
    expect(selectModelRepairs(progress.progressForLecture(null, "lec"))).toHaveLength(0);
    progress.recordAtomAnswer(null, "lec", "a", false, { ...question, picked: "C" });
    expect(repairEvidenceStore("lec").read(null).a.picked).toBe("C");
  });
  it("supports earlier misses without inventing question context", () => {
    const repairs = selectModelRepairs({ a: { status: "needs-review" } }, [{ term: "A", content: "Existing fact" }]);
    expect(modelRepairPrompt("Lecture", repairs)).toContain("question details were not saved");
  });
  it("copies full question context and scaffolding rather than a replacement summary", () => {
    const prompt = modelRepairPrompt("Lecture", [{ key: "a", repair: question }]);
    expect(prompt).toContain(question.stem);
    expect(prompt).toContain("My answer: A");
    expect(prompt).toContain("Keyed answer: B");
    expect(prompt).toContain(question.explanation);
    expect(prompt).toContain("Ask me to share my current model first");
  });
  it('builds a pre-Anki brief from only the weak points and requires an existing-card search',()=>{const brief=ankiWeakPointBrief('Lecture',[{key:'a',atom:{term:'Target',content:'A causes B'},repair:question}]);expect(brief).toContain('Target');expect(brief).toContain('A causes B');expect(brief).toContain('Existing card searched');expect(brief).toContain('Do not create cards yet');});
  it("starts collapsed and copies from the saved records", async () => {
    progress.recordAtomAnswer(null, "lec", "a", false, question);
    const copy = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ModelRepairs userId={null} lectureId="lec" title="Lecture" />); });
    expect(host.querySelector("details").open).toBe(false);
    expect(host.textContent).toContain("1 to revisit");
    await act(async () => { host.querySelector("button").click(); });
    expect(copy).toHaveBeenCalledWith(expect.stringContaining(question.stem));
    expect(host.textContent).toContain("Copied.");
    await act(async () => { root.unmount(); });
  });
  it("continues a repair session through the local LLM bridge", async () => {
    progress.recordAtomAnswer(null, "lec", "a", false, question);
    bridgeCompleteMock.mockResolvedValue("Where does this connection sit in your current model?");
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ModelRepairs userId={null} lectureId="lec" title="Lecture" />); });
    const localButton = [...host.querySelectorAll("button")].find(button => button.textContent === "Study with local AI");
    await act(async () => { localButton.click(); });
    expect(bridgeCompleteMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(question.stem),
      timeoutMs: 300_000,
    }));
    expect(host.textContent).toContain("Where does this connection sit in your current model?");
    expect(host.querySelector('[aria-label="Reply to local AI"]')).not.toBeNull();
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
