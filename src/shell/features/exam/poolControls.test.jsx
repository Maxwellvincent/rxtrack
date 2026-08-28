import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { ExamLaunchModal } from "./ExamLaunchModal.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { installDomStorage(); });
it("prepares the selected count without launching an exam", () => {
  const host = document.createElement("div"), root = createRoot(host);
  const onPrepare = vi.fn(), onLaunch = vi.fn();
  act(() => root.render(<ExamLaunchModal eligibleLectures={[{ lectureId: "l", objectiveCount: 30 }]} defaultQuestionCount={30} onPrepare={onPrepare} onLaunch={onLaunch} />));
  const prepare = [...host.querySelectorAll("button")].find(b => b.textContent === "Prepare questions for later");
  act(() => prepare.click());
  expect(onPrepare).toHaveBeenCalledWith({ format: "exam", questionCount: 30, durationMinutes: 45 });
  expect(onLaunch).not.toHaveBeenCalled();
  act(() => root.unmount());
});
