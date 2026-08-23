import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Task 12, Part B2 — focusLectureId addition. This repo has no existing
// LectureList render test, so this file mocks its data hooks (useToday,
// useLectures, useLectureQuestionStats) to keep it a scoped render test over
// the new prop, not a re-test of lectureRows.js's scoring (covered by
// tracker.test.js already).
const BLOCK = "b1";

function makeLecture(id, title) {
  return { id, blockId: BLOCK, lectureTitle: title, lectureType: "LEC", lectureNumber: 1 };
}

const useTodayMock = vi.fn();
vi.mock("../today/useToday.js", () => ({
  useToday: (...args) => useTodayMock(...args),
}));

vi.mock("../../hooks/useLectures.js", () => ({
  useLectures: () => ({ data: [], mutate: vi.fn() }),
}));

vi.mock("../../hooks/useLectureQuestionStats.js", () => ({
  useLectureQuestionStats: () => ({ data: {} }),
}));

const { LectureList } = await import("./LectureList.jsx");

function render(ui) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    rerender: (nextUi) => act(() => root.render(nextUi)),
    unmount: () => act(() => root.unmount()),
  };
}

function baseTodayReturn() {
  return {
    context: {
      blockId: BLOCK,
      lectures: [makeLecture("lec-1", "Lecture One"), makeLecture("lec-2", "Lecture Two")],
      objectives: [],
      completion: {},
      reviewedLectures: {},
      lecturePerformance: {},
      weakConcepts: {},
    },
    logActivity: vi.fn(),
    logPreRead: vi.fn(),
    objectivesForTask: () => [],
  };
}

beforeEach(() => {
  installDomStorage();
  useTodayMock.mockReset();
  useTodayMock.mockReturnValue(baseTodayReturn());
});

describe("LectureList focusLectureId (Task 12, Part B2)", () => {
  it("with no focusLectureId, renders normally and highlights nothing", () => {
    const { host, unmount } = render(
      <LectureList blockId={BLOCK} userId="u1" onStudyLecture={vi.fn()} onStartObjectiveQuiz={vi.fn()} onBack={vi.fn()} />
    );

    expect(host.textContent).toMatch(/Lecture One/);
    expect(host.textContent).toMatch(/Lecture Two/);
    expect(host.querySelector(".bg-accent\\/10")).toBeFalsy();

    unmount();
  });

  it("with focusLectureId set, applies a highlight class to that lecture's row on mount", () => {
    const { host, unmount } = render(
      <LectureList
        blockId={BLOCK}
        userId="u1"
        onStudyLecture={vi.fn()}
        onStartObjectiveQuiz={vi.fn()}
        onBack={vi.fn()}
        focusLectureId="lec-2"
      />
    );

    const highlighted = host.querySelector(".bg-accent\\/10");
    expect(highlighted).toBeTruthy();
    expect(highlighted.textContent).toMatch(/Lecture Two/);

    unmount();
  });

  it("calls scrollIntoView on the focused row's element when present", () => {
    const scrollIntoViewSpy = vi.fn();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const { unmount } = render(
      <LectureList
        blockId={BLOCK}
        userId="u1"
        onStudyLecture={vi.fn()}
        onStartObjectiveQuiz={vi.fn()}
        onBack={vi.fn()}
        focusLectureId="lec-1"
      />
    );

    expect(scrollIntoViewSpy).toHaveBeenCalled();

    unmount();
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("does not throw when scrollIntoView is unavailable on the element (jsdom-like env)", () => {
    const { unmount } = render(
      <LectureList
        blockId={BLOCK}
        userId="u1"
        onStudyLecture={vi.fn()}
        onStartObjectiveQuiz={vi.fn()}
        onBack={vi.fn()}
        focusLectureId="lec-1"
      />
    );

    unmount();
  });

  it("review fix #4: scrollIntoView fires once per focusLectureId, not on every unrelated row recomputation (e.g. typing in search)", () => {
    const scrollIntoViewSpy = vi.fn();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const { host, unmount } = render(
      <LectureList
        blockId={BLOCK}
        userId="u1"
        onStudyLecture={vi.fn()}
        onStartObjectiveQuiz={vi.fn()}
        onBack={vi.fn()}
        focusLectureId="lec-1"
      />
    );

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

    // Typing in search recomputes `rows` (a dependency of the scroll
    // effect) without focusLectureId itself changing — this must not
    // re-trigger the scroll.
    const searchInput = host.querySelector('input[placeholder="search…"]');
    const propsKey = Object.keys(searchInput).find((k) => k.startsWith("__reactProps$"));
    act(() => searchInput[propsKey].onChange({ target: { value: "One" } }));

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

    unmount();
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("focusLectureId absent is fully additive: no highlight class, no crash", () => {
    const { host, unmount } = render(
      <LectureList blockId={BLOCK} userId="u1" onStudyLecture={vi.fn()} onStartObjectiveQuiz={vi.fn()} onBack={vi.fn()} focusLectureId={null} />
    );

    expect(host.querySelector(".bg-accent\\/10")).toBeFalsy();
    unmount();
  });
});
