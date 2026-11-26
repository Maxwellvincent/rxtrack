import { describe, expect, it } from "vitest";
import { categoryPracticeSet, keywordHits, matchCategoryTarget, normalizeReportTargets, questionFormat, questionMatchesTarget, reportTargetRows, targetPracticeSince, withReportTarget } from "./reportTargets.js";
import { mapReportTargets } from "./mapReportTargets.js";

const lectures = [
  { id: "lesion", lectureTitle: "Principles of Lesion Localization", chunks: [{ text: "A lacunar infarct of the internal capsule; middle cerebral artery stroke causes aphasia; hemorrhage" }] },
  { id: "eye", lectureTitle: "NB 41 Eye Movements", chunks: [{ text: "MLF lesion, internuclear ophthalmoplegia" }] },
  { id: "dla", lectureTitle: "Stroke syndromes DLA", chunks: [] },
];
const objectives = [
  { id: "o1", linkedLecId: "lesion", objective: "Localize a lacunar infarct from motor findings" },
  { id: "o2", linkedLecId: "lesion", objective: "Describe the somatotopy of the motor cortex" },
  { id: "o3", linkedLecId: "eye", objective: "Explain internuclear ophthalmoplegia" },
];
const cerebro = { broad: false, keywords: ["stroke", "infarct", "lacunar", "hemorrhage", "middle cerebral artery"], lectureIds: [] };

describe("report targets", () => {
  it("keeps only listed lectures and drops keywords for broad categories", () => {
    const map = normalizeReportTargets({ targets: [
      { category: "Cerebrovascular disease", broad: false, keywords: ["Stroke", "TIA", "stroke"], lectureIds: ["lesion", "nope"] },
      { category: "Patient Care: Diagnosis", broad: true, keywords: ["diagnosis"], lectureIds: ["eye"] },
    ] }, lectures);
    expect(map.get("cerebrovascular disease")).toEqual({ broad: false, keywords: ["stroke", "tia"], lectureIds: ["lesion"] });
    expect(map.get("patient care diagnosis")).toEqual({ broad: true, keywords: [], lectureIds: [] });
  });

  it("finds lectures by title or 3+ keywords in text, and objectives that mention a keyword", () => {
    const match = matchCategoryTarget(cerebro, { lectures, objectives });
    expect(match.lectureIds.sort()).toEqual(["dla", "lesion"]);
    expect(match.objectiveIds).toEqual(["o1"]);
    expect(keywordHits("Middle cerebral artery stroke.", cerebro.keywords)).toEqual(["stroke", "middle cerebral artery"]);
  });

  it("matches school questions by link or by two keywords in the stem, and labels the format", () => {
    const target = { ...cerebro, lectureIds: ["lesion"], objectiveIds: ["o1"] };
    expect(questionMatchesTarget({ lectureId: "lesion" }, target)).toBe(true);
    expect(questionMatchesTarget({ objectiveIds: ["o1"] }, target)).toBe(true);
    expect(questionMatchesTarget({ stem: "Sudden hemiparesis; CT shows a lacunar infarct." }, target)).toBe(true);
    expect(questionMatchesTarget({ stem: "A stroke survivor asks about diet." }, target)).toBe(false);
    expect(questionFormat({ sourceFile: "NB IMCQ 7 Answer Explanations" })).toBe("imcq");
    expect(questionFormat({ sourceFile: "BPM2 ESOFT QUIZ7" })).toBe("esoft");
    expect(questionFormat({ sourceFile: "Week 12 homework" })).toBe("homework");
  });

  it("counts a category as improved only after 10+ answers at 80% on 2+ days after the report", () => {
    const entry = withReportTarget({ concept: "Cerebrovascular disease", tags: ["exam-report"], reportDate: "2026-11-16" }, { ...cerebro, lectureIds: ["lesion"], objectiveIds: [] });
    const day = d => `2026-11-${d}T10:00:00Z`;
    const calibration = { nb2: [
      ...Array.from({ length: 6 }, (_, i) => ({ ts: day(20) .replace("10:", `1${i}:`), lectureId: "lesion", correct: true, concept: `a${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ ts: day(22).replace("10:", `1${i}:`), lectureId: "lesion", correct: i !== 0, concept: `b${i}` })),
      { ts: day(10), lectureId: "lesion", correct: false, concept: "before report" },
    ] };
    const progress = targetPracticeSince(entry, { calibration });
    expect(progress).toMatchObject({ answered: 11, correct: 10, days: 2, improved: true });
    expect(targetPracticeSince(entry, { calibration: { nb2: calibration.nb2.slice(0, 6) } }).improved).toBe(false);
  });

  it("ranks open targets by gap and sample size, improved ones last, with a launchable set", () => {
    const mk = (concept, gap, n) => withReportTarget({ concept, tags: ["exam-report"], reportGap: gap, reportSampleSize: n }, { ...cerebro, lectureIds: [concept === "big" ? "lesion" : "eye"], objectiveIds: [] });
    const rows = reportTargetRows({
      weakConcepts: { nb2: [mk("small", 30, 4), mk("big", 25, 22), { concept: "not a report", tags: [] }] },
      pool: [{ questionId: "q1", lectureId: "lesion", sourceFile: "NB IMCQ 8" }, { questionId: "q2", lectureId: "lesion", sourceFile: "BPM2 ESOFT QUIZ7" }],
      generated: [{ questionId: "g1", lectureId: "lesion", sourceKind: "generated" }],
    });
    expect(rows.map(row => row.entry.concept)).toEqual(["big", "small"]);
    expect(rows[0].formats).toMatchObject({ imcq: 1, esoft: 1 });
    expect(categoryPracticeSet(rows[0], { itemHistory: new Map([["q2", { correct: false }]]), random: () => 0 }).map(q => q.questionId)).toEqual(["q2", "q1", "g1"]);
  });

  it("maps a block's report entries with one AI call and keeps other concepts", async () => {
    let store = { nb2: [{ concept: "Cerebrovascular disease", tags: ["exam-report"] }, { concept: "Patient Care: Diagnosis", tags: ["exam-report"] }, { concept: "missed MLF", tags: [] }], nb3: [{ concept: "x" }] };
    const calls = [];
    const result = await mapReportTargets({ userId: "u", blockId: "nb2", now: "2026-11-26" }, {
      readWeak: () => store, writeWeak: async (_u, value) => { store = value; },
      lectures, objectives, report: { name: "BPM2_NB2_GD_main_F26", date: "2026-11-16", kind: "exam" },
      fetchLectureContent: async () => null,
      callAIJSON: async (...args) => { calls.push(args); return { targets: [
        { category: "Cerebrovascular disease", broad: false, keywords: cerebro.keywords, lectureIds: ["lesion"] },
        { category: "Patient Care: Diagnosis", broad: true } ] }; },
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ mapped: 2, broad: 1, total: 2 });
    expect(store.nb2[0]).toMatchObject({ linkedLecIds: ["lesion", "dla"], objectiveIds: ["o1"], reportName: "BPM2_NB2_GD_main_F26", reportTarget: { broad: false } });
    expect(store.nb2[1].reportTarget).toMatchObject({ broad: true, lectureIds: [] });
    expect(store.nb2[2]).toEqual({ concept: "missed MLF", tags: [] });
    expect(store.nb3).toEqual([{ concept: "x" }]);
  });
});
