// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ExamPreparationStatus } from "./ExamPreparationStatus.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("shows accepted-question and generation-stage progress", () => {
 const host = document.createElement("div"), root = createRoot(host);
 act(() => root.render(<ExamPreparationStatus session={{ questions: [{}], targetQuestionCount: 5, fillProgress: { message: "Reviewing accuracy: NB 44", completedLectures: 2, totalLectures: 5, failedLectures: 1, updatedAt: Date.now() } }} />));
 expect(host.textContent).toContain("1/5 questions ready");
 expect(host.textContent).toContain("20% accepted");
 expect(host.textContent).toContain("Reviewing accuracy: NB 44");
 expect(host.textContent).toContain("Lecture sources checked: 2/5 · 1 with a preparation problem");
 expect(host.querySelector("progress")?.value).toBe(1);
 expect(host.querySelector("progress")?.max).toBe(5);
 act(() => root.render(<ExamPreparationStatus session={{ questions: [], targetQuestionCount: 5 }} />));
 expect(host.textContent).toContain("0/5 questions ready");
 expect(host.textContent).toContain("Starting question preparation…");
 act(() => root.unmount());
});
