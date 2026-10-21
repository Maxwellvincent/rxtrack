import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { LectureProgressDashboard, lectureReviewCount } from "./LectureProgressDashboard.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("renders selectable vertical lecture bars, separates review logs, and launches the selected lecture", () => {
 installDomStorage(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
 const onStudy = vi.fn(), onQuiz = vi.fn();
 const rows = [{ lec: { id: "a", lectureType: "LEC", lectureNumber: 1, lectureTitle: "Pathways" }, total: 4, tested: 2, coverage: 50, m: 1, ip: 0, st: 1, ut: 2 }, { lec: { id: "b", lectureNumber: 2, lectureTitle: "Eye" }, total: 2, tested: 0, coverage: 0, m: 0, ip: 0, st: 0, ut: 2 }];
 act(() => root.render(<LectureProgressDashboard rows={rows} blockId="NB" completion={{ a__NB: { activityLog: [{ id: "review", activityType: "review" }] } }} objectives={[{ id: "o", linkedLecId: "a" }]} onStudy={onStudy} onQuiz={onQuiz} />));
 expect(host.textContent).toContain("1 logged reviews");
 const bar = host.querySelector('[aria-label^="LEC 1"]'); expect(bar.querySelector('.h-48')).not.toBeNull();
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent.includes("Review lecture →")).click()); expect(onStudy).toHaveBeenCalledWith("a");
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent.includes("Quiz lecture →")).click()); expect(onQuiz).toHaveBeenCalledWith([{ id: "o", linkedLecId: "a" }], expect.any(String), "NB", { lectureId: "a" });
 act(() => host.querySelector('[aria-label^="Lecture 2"]').click()); expect(host.textContent).toContain("0/2 objectives covered");
 act(() => root.unmount()); host.remove();
});
it("does not double-count a review retained under merged lecture aliases", () => {
 const review = { id: "r", activityType: "review" };
 expect(lectureReviewCount({ id: "a", mergedFrom: [{ id: "a" }, { id: "b" }] }, "NB", { a__NB: { activityLog: [review] }, b__NB: { activityLog: [review] } })).toBe(1);
});
it("puts the highest untested percentage first when that filter is selected", () => {
 installDomStorage(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
 const rows = [{ lec: { id: "16", lectureNumber: 16 }, total: 19, tested: 12, coverage: 63, m: 1, ip: 3, st: 8, ut: 7 }, { lec: { id: "11", lectureNumber: 11 }, total: 11, tested: 2, coverage: 18, m: 0, ip: 1, st: 1, ut: 9 }];
 act(() => root.render(<LectureProgressDashboard rows={rows} />));
 const bars = () => [...host.querySelectorAll('[aria-label*="objectives covered"]')];
 expect(bars()[0].getAttribute("aria-label")).toContain("Lecture 16");
 act(() => bars()[0].click());
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Not yet tested").click());
 expect(bars()[0].getAttribute("aria-label")).toContain("Lecture 11");
 expect(bars()[0].getAttribute("aria-pressed")).toBe("true");
 expect(host.textContent).toContain("Top 2 of 2 lectures");
 expect(host.textContent).toContain("highest percentage of untested objectives first");
 act(() => root.unmount()); host.remove();
});
it("shows six priorities without sideways scrolling and resets pagination when filtering", () => {
 installDomStorage(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
 const rows = Array.from({ length: 14 }, (_, index) => ({ lec: { id: `l${index}`, lectureNumber: index + 1 }, total: 20, tested: index, coverage: index * 5, m: 0, ip: index, st: 0, ut: 20 - index }));
 act(() => root.render(<LectureProgressDashboard rows={rows} />));
 const bars = () => [...host.querySelectorAll('[aria-label*="objectives covered"]')];
 expect(bars()).toHaveLength(6); expect(host.textContent).toContain("Top 6 of 14 lectures");
 expect(host.querySelector('.overflow-x-auto')).toBeNull();
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Next six →").click());
 expect(bars()).toHaveLength(6); expect(host.textContent).toContain("Priorities 7–12 of 14");
 expect(bars()[0].getAttribute("aria-pressed")).toBe("true");
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Next six →").click());
 expect(bars()).toHaveLength(2); expect([...host.querySelectorAll("button")].find(button => button.textContent === "Next six →").disabled).toBe(true);
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Not yet tested").click());
 expect(host.textContent).toContain("Top 6 of 14 lectures"); expect(bars()[0].getAttribute("aria-label")).toContain("Lecture 1");
 act(() => root.unmount()); host.remove();
});

it("counts a 15-answer quiz once, keeps other blocks out, and avoids history double counting", () => {
 const evidence = { evidenceJournal: [...Array.from({length: 15}, (_, i) => ({lectureId: "a", blockId: "NB", sessionKey: "quiz-1", questionKey: `q${i}`})), {lectureId: "a", blockId: "DM", sessionKey: "other"}] };
 expect(lectureReviewCount({id: "a"}, "NB", {}, evidence, () => ({sessions: [{at: 1}]}))).toBe(1);
 expect(lectureReviewCount({id: "a"}, "NB", {}, { lectures: {a: {attempts: 15}} })).toBe(1);
});
it("shows quiz reviews in the Reviewed filter and exposes status counts without color", () => {
 installDomStorage(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
 const rows = [{lec: {id: "a", lectureNumber: 1}, total: 4, tested: 3, coverage: 75, m: 1, ip: 1, st: 1, ut: 1}];
 act(() => root.render(<LectureProgressDashboard rows={rows} blockId="NB" evidence={{evidenceJournal: [{lectureId: "a", blockId: "NB", sessionKey: "quiz"}]}} />));
 act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Reviewed").click());
 expect(host.textContent).toContain("1 review session");
 expect(host.textContent).toContain("Needs review: 1");
 expect(host.textContent).toContain("Learning: 1");
 expect(host.textContent).toContain("Not yet tested: 1");
 expect(host.querySelector('[aria-label="Vertical lecture priority chart"]').innerHTML).toContain("repeating-linear-gradient");
 act(() => root.unmount()); host.remove();
});
