// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ExamPreparationStatus } from "./ExamPreparationStatus.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("keeps logistics and duplicate counters off the active quiz", () => {
 const host = document.createElement("div"), root = createRoot(host);
 act(() => root.render(<ExamPreparationStatus session={{ questions: [{}], targetQuestionCount: 30, fillProgress: { message: "Loading NB07", updatedAt: Date.now() } }} />));
 expect(host.textContent).toBe("More questions are preparing in the background.");
 expect(host.querySelector("progress")).toBeNull();
 act(() => root.render(<ExamPreparationStatus session={{ questions: [] }} />));
 expect(host.textContent).toBe("Preparing your first questions…");
 act(() => root.unmount());
});
