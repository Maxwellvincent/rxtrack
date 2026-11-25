// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TodayPlan } from "./TodayPlan.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fp = (complete) => ({ complete, covered: 0, total: 3 });
const row = (id, number, extra = {}) => ({ id, number, type: "LEC", title: `NB ${number} Topic ${id}`, firstPass: fp(false), ...extra });

it("runs the day in order: Start opens the first pass, then Continue opens the review quiz", () => {
  const host = document.createElement("div"), root = createRoot(host);
  const onStudy = vi.fn(), onReview = vi.fn(), onSkim = vi.fn();
  const day = { given: [row("a", 67)], catchUp: [], reviews: [row("r", 63, { firstPass: fp(true), strength: { accuracy: 0.56 } })] };
  const render = (done) => act(() => root.render(<TodayPlan day={day} cap={6} unscheduled={[row("s", 70)]} doneIds={new Set(done)} onStudy={onStudy} onReview={onReview} onSkim={onSkim} />));
  render([]);
  expect(host.textContent).toContain("0 of 2 done today");
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("▸ Start today")).click());
  expect(onStudy).toHaveBeenCalledWith("a");
  render(["a"]);
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("▸ Continue")).click());
  expect(onReview).toHaveBeenCalledWith(day.reviews[0]);
  expect(host.textContent).toContain("56%");
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Skim LEC 70").click());
  expect(onSkim).toHaveBeenCalled();
  act(() => root.unmount());
});
