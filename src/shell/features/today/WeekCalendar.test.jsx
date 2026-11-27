// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WeekCalendar } from "./WeekCalendar.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const local = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

it("lists the week's lectures by day, opens one, and pages to last week", () => {
  const host = document.createElement("div"), root = createRoot(host), onStudy = vi.fn();
  const lecScores = [
    { lec: { id: "a", lectureTitle: "Brainstem", lectureNumber: 59 }, availableDate: local("2026-11-23") },
    { lec: { id: "c", lectureTitle: "Thalamus", lectureNumber: 61 }, availableDate: local("2026-11-18") },
  ];
  act(() => root.render(<WeekCalendar lecScores={lecScores} blockId="b" examDate="2026-12-01" objectivesFor={() => []} onStudy={onStudy} now={local("2026-11-25").getTime()} />));
  expect(host.textContent).toContain("Brainstem");
  expect(host.textContent).not.toContain("Thalamus");
  expect(host.querySelector('[aria-current="date"]').textContent).toContain("Today");
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Brainstem")).click());
  expect(onStudy).toHaveBeenCalledWith("a");
  act(() => host.querySelector('[aria-label="Previous week"]').click());
  expect(host.textContent).toContain("Thalamus");
  expect(host.textContent).toContain("This week");
  act(() => root.unmount());
});

it("shows today's frozen plan with done items checked and a done/planned count", () => {
  const host = document.createElement("div"), root = createRoot(host), onStudy = vi.fn(), onReview = vi.fn();
  const row = (id, title, number, extra = {}) => ({ id, title, type: "LEC", number, firstPass: { complete: false, covered: 1, total: 4 }, ...extra });
  const todayQueue = [
    { row: row("a", "Sleep", 61), kind: "first" },
    { row: row("b", "Consciousness", 63, { firstPass: { complete: true, covered: 4, total: 4 } }), kind: "first" },
    { row: row("c", "Obsessive", 57), kind: "review" },
  ];
  const render = (doneIds) => act(() => root.render(<WeekCalendar lecScores={[]} blockId="b" examDate="2026-12-01" objectivesFor={() => []} onStudy={onStudy} onReview={onReview} now={local("2026-11-25").getTime() + 9 * 3600000} todayQueue={todayQueue} doneIds={doneIds} />));
  render(new Set());
  const today = () => host.querySelector('[aria-current="date"]');
  expect(today().textContent).toContain("1/3 done");
  expect(today().textContent).toContain("First pass complete · done today");
  act(() => [...today().querySelectorAll("button")].find((b) => b.textContent.includes("Continue")).click());
  expect(onStudy).toHaveBeenCalledWith("a");
  render(new Set(["a", "c"]));
  expect(today().textContent).toContain("✓ 3/3 done");
  expect(today().textContent).toContain("Today's plan is done");
  act(() => root.unmount());
});
