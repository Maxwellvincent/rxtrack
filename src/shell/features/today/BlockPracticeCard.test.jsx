import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
const mocks = vi.hoisted(() => ({ list: vi.fn(), stats: {} }));
vi.mock("./SchoolAlignmentPanel.jsx", () => ({ SchoolAlignmentPanel: () => null }));
vi.mock("../../../supabase.js", () => ({ listExamSessions: (...args) => mocks.list(...args) }));
vi.mock("../../hooks/useLectures.js", () => ({ useLectures: () => ({ data: [{ id: "a", blockId: "er" }] }) }));
vi.mock("../../hooks/useLectureQuestionStats.js", () => ({ useLectureQuestionStats: () => ({ data: mocks.stats, loading: false }) }));
import { BlockPracticeCard } from "./BlockPracticeCard.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { installDomStorage(); mocks.list.mockReset(); mocks.list.mockResolvedValue([]); mocks.stats = { a: { answered: 100, correct: 72 } }; });
async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<BlockPracticeCard blockId="er" userId="u" />); });
  return { host, root };
}
describe("Block practice card", () => {
  it("shows the recorded total, weighted accuracy and a separate 74% benchmark", async () => {
    const { host, root } = await mount();
    expect(host.textContent).toContain("72.0%");
    expect(host.textContent).toContain("72 correct of 100 answered");
    expect(host.textContent).toContain("2.0 percentage points below");
    expect(host.textContent).toContain("not a predicted school-exam grade");
    expect(host.querySelector("details").open).toBe(false);
    await act(async () => { root.unmount(); });
  });
  it("explicitly labels partial results when exam history fails and allows retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    const { host, root } = await mount();
    expect(host.querySelector('[role="alert"]').textContent).toContain("lecture totals only");
    await act(async () => { host.querySelector("button").click(); });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBe(null);
    await act(async () => { root.unmount(); });
  });
});
