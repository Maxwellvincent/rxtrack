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
 expect(host.textContent).toContain("highest percentage of untested objectives first");
 act(() => root.unmount()); host.remove();
});
