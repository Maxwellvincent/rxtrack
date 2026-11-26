import { describe, expect, it, vi } from "vitest";
import {
  buildObjectivePartsPrompt, normalizeObjectiveParts, inventoryIsCurrent, partCoverage, withPartTargets,
  objectivePartsPrompt, validatedPartId, answeredForParts, nextParts, quoteSupported,
  combineInventories, sourceMatches, legacyPartsSourceVersion,
} from "./objectiveParts.js";
import { generateExamQuestions } from "../shell/features/exam/generation.js";
import { cbseProgress } from "../shell/features/cbse/cbsePrep.js";
import { ladderForObjective } from "./masteryLadder.js";
import { objectivePracticePlan } from "./objectivePractice.js";
import { mergeInventory } from "../stores/objectiveParts.js";
import { prepareObjectiveQuiz } from "../shell/features/objectives/quizLaunch.js";

const pages = [
  { page: 3, text: "Brief psychotic disorder lasts at least 1 day but less than 1 month. Schizophreniform disorder lasts 1 to 6 months." },
  { page: 5, text: "In schizoaffective disorder, psychosis persists for 2 weeks without a mood episode. Catatonia presents with stupor, mutism and posturing." },
];
const objective = { id: "o115", objective: "Clinically differentiate the psychotic disorders from other conditions" };
const raw = {
  objectives: [{ objectiveId: "o115", parts: [
    { label: "Brief psychotic vs schizophreniform: duration", quote: "Brief psychotic disorder lasts at least 1 day but less than 1 month", page: 3 },
    { label: "Schizoaffective vs mood disorder", quote: "psychosis persists for 2 weeks without a mood episode", page: 5 },
    { label: "Catatonia", quote: "Catatonia presents with stupor, mutism and posturing", page: 4 }, // wrong page, quote exists
    { label: "Invented part", quote: "Delusional disorder requires one month of delusions", page: 3 }, // not in lecture
  ] }, { objectiveId: "unknown", parts: [{ label: "x", quote: "Brief psychotic disorder lasts", page: 3 }] }],
  history: [{ questionKey: "q-old", objectiveId: "o115", partIndex: 0 }, { questionKey: "q-stranger", objectiveId: "o115", partIndex: 1 }],
};
const answered = [{ questionKey: "q-old", objectiveId: "o115", stem: "A man has hallucinations for 10 days.", keyed: "Brief psychotic disorder" }];
const inventory = normalizeObjectiveParts(raw, { lectureId: "L67", objectives: [objective], pages, answered, now: 1 });
const [duration, schizoaffective, catatonia] = inventory.objectives.o115.parts;

describe("objective parts inventory", () => {
  it("keeps only parts whose quotation occurs in the lecture, for known objectives", () => {
    expect(inventory.objectives.o115.parts.map(part => part.label)).toEqual(["Brief psychotic vs schizophreniform: duration", "Schizoaffective vs mood disorder", "Catatonia"]);
    expect(inventory.objectives.unknown).toBeUndefined();
    expect(new Set(inventory.objectives.o115.parts.map(part => part.id)).size).toBe(3);
  });

  it("credits a past question only when it was really answered on that objective", () => {
    expect(Object.values(inventory.questionParts)).toEqual([duration.id]);
  });

  it("is current for the same lecture text and stale once the text changes", () => {
    expect(inventoryIsCurrent(inventory, { pages, objectives: [objective] })).toBe(true);
    expect(inventoryIsCurrent(inventory, { pages: [{ page: 3, text: "changed" }], objectives: [objective] })).toBe(false);
    expect(inventoryIsCurrent(inventory, { pages, objectives: [objective, { id: "new" }] })).toBe(false);
  });

  it("asks the model to split groups into the lecture's members and to map old questions", () => {
    const prompt = buildObjectivePartsPrompt({ objectives: [objective], pages, answered });
    expect(prompt).toMatch(/covers each member or contrast THIS lecture teaches/);
    expect(prompt).toContain("q-old");
    expect(prompt).toContain("[page 5]");
  });

  it("keeps stored part ids when the same lecture is extended, replaces them when it changes", () => {
    const later = normalizeObjectiveParts({ objectives: [{ objectiveId: "o115", parts: [{ label: "Renamed duration", quote: "Schizophreniform disorder lasts 1 to 6 months", page: 3 }] }] }, { lectureId: "L67", objectives: [objective], pages });
    expect(mergeInventory(inventory, later).objectives.o115.parts[0].id).toBe(duration.id);
    expect(mergeInventory(inventory, { ...later, sourceVersion: "other" }).objectives.o115.parts[0].label).toBe("Renamed duration");
  });
});

describe("quote support", () => {
  it("accepts a real quote split by an interleaved slide column, rejects an invented one", () => {
    const source = "If schizoaffective disorder, there are distinct If a mood disorder, psychosis occurs only periods of psychosis outside of a mood episode during mood episodes";
    expect(quoteSupported("If schizoaffective disorder, there are distinct periods of psychosis outside of a mood episode", source)).toBe(true);
    expect(quoteSupported("Excessive movements due to \"inner restlessness\"", "excessive movements due to \u201cinner restlessness\u201d typically")).toBe(true);
    expect(quoteSupported("Delusional disorder requires one month of fixed delusions", source)).toBe(false);
  });
});

describe("part coverage", () => {
  const journal = [
    { objectiveIds: ["o115"], questionKey: "q-old", correct: true, at: 10 },                       // mapped from history
    { objectiveIds: ["o115"], objectivePartId: schizoaffective.id, correct: false, at: 20 },         // tagged miss
    { objectiveIds: ["o115"], objectivePartId: catatonia.id, correct: true, at: 30, assisted: true }, // assisted: ignored
  ];
  const coverage = partCoverage(inventory, "o115", journal);

  it("counts independent answers per part, from tags or the history mapping", () => {
    expect(coverage.map(row => [row.label, row.attempts, row.correct, row.covered])).toEqual([
      ["Brief psychotic vs schizophreniform: duration", 1, 1, true],
      ["Schizoaffective vs mood disorder", 1, 0, false],
      ["Catatonia", 0, 0, false],
    ]);
  });

  it("targets untested parts first, then missed ones", () => {
    expect(nextParts(coverage, 2).map(row => row.label)).toEqual(["Catatonia", "Schizoaffective vs mood disorder"]);
    const [targeted] = withPartTargets([objective], inventory, journal);
    expect(targeted._targetPartIds[0]).toBe(catatonia.id);
    expect(objectivePartsPrompt([targeted])).toContain(`"testNext":["${catatonia.id}"`);
  });

  it("accepts a returned part id only for the question's own objective, else matches the facet", () => {
    expect(validatedPartId({ objectiveIds: ["o115"], objectivePartId: catatonia.id }, inventory)).toBe(catatonia.id);
    expect(validatedPartId({ objectiveIds: ["other"], objectivePartId: catatonia.id }, inventory)).toBeNull();
    expect(validatedPartId({ objectiveIds: ["o115"], objectiveFacet: "schizoaffective versus mood disorder timing" }, inventory)).toBe(schizoaffective.id);
    expect(validatedPartId({ objectiveIds: ["o115"], objectiveFacet: "psychosis" }, inventory)).toBeNull();
  });

  it("lists only answered questions on these objectives for the history mapping", () => {
    const rows = answeredForParts([{ id: "q1", objectiveIds: ["o115"], stem: "s", timesAnswered: 1, choices: { A: "x" }, correct: "A" }, { id: "q2", objectiveIds: ["o115"], stem: "s" }, { id: "q3", objectiveIds: ["zz"], stem: "s", timesAnswered: 2 }], [objective]);
    expect(rows).toEqual([{ questionKey: "q1", objectiveId: "o115", stem: "s", keyed: "x", facet: null }]);
  });
});

describe("mastery needs every part", () => {
  const DAY = 86_400_000;
  const answers = [
    { correct: true, orderLevel: "first-order", at: 1 * DAY },
    { correct: true, orderLevel: "second-order", at: 2 * DAY }, { correct: true, orderLevel: "second-order", at: 3 * DAY },
    { correct: true, orderLevel: "second-order", taskType: "discrimination", confidence: 5, at: 4 * DAY }, { correct: true, orderLevel: "second-order", taskType: "discrimination", confidence: 5, at: 5 * DAY },
    { correct: true, orderLevel: "third-order", at: 6 * DAY },
    { correct: true, orderLevel: "second-order", taskType: "fresh-retest", at: 9 * DAY },
  ].map((answer, index) => ({ ...answer, questionKey: `k${index}`, reasoningVerified: true }));
  const entry = { recentFreshAnswers: answers };

  it("holds an otherwise-mastered objective at Integration until each part is answered", () => {
    expect(ladderForObjective(entry, { now: 10 * DAY }).rung).toBe(5);
    const held = ladderForObjective(entry, { now: 10 * DAY, parts: [{ id: "p1", label: "Duration", covered: true }, { id: "p2", label: "Catatonia", covered: false }] });
    expect(held).toMatchObject({ rung: 4, next: { step: "parts", partIds: ["p2"] }, parts: { total: 2, covered: 1 }, retestDue: false });
    expect(ladderForObjective(entry, { now: 10 * DAY, parts: [{ id: "p1", covered: true }] }).rung).toBe(5);
  });

  it("keeps practice readiness open while parts are untested", () => {
    const evidence = { objectives: { o115: { attempts: 6, correct: 6, sessions: ["a", "b"], taskTypes: { recall: 2, application: 4 }, recentFreshAnswers: answers, recent: [true, true, true] } } };
    const open = objectivePracticePlan([{ ...objective, _parts: [{ id: "p2", label: "Catatonia", covered: false }] }], evidence).rows[0];
    expect(open.ready).toBe(false);
    expect(objectivePracticePlan([{ ...objective, _parts: [{ id: "p2", label: "Catatonia", covered: true }] }], evidence).rows[0].ready).toBe(true);
    expect(open.missingRequirements.join(" ")).toMatch(/untested parts: Catatonia/);
  });
});

describe("quiz preparation with parts", () => {
  it("builds parts once, steers the writer to untested parts and tags accepted questions", async () => {
    const question = { stem: "A 24-year-old has had hallucinations and disorganized speech for six weeks after a stressor, with full return to baseline function. Which diagnosis best fits this course?", choices: { A: "Schizophreniform disorder", B: "Brief psychotic disorder" }, correct: "A", objectiveIds: ["o115"], objectivePartId: duration.id };
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [question] });
    const ensureObjectiveParts = vi.fn().mockResolvedValue(inventory);
    const result = await prepareObjectiveQuiz(
      { objectives: [objective], lectureIdHint: "L67", blockId: "b", sourcePages: pages, lectureText: pages.map(page => page.text).join("\n").repeat(4), questionCount: 1, evidenceModel: { objectives: {}, learningJournal: [] } },
      { callAIJSON, ensureObjectiveParts, prepareBatchSize: 1, reviewBatchSize: 1, maxPrepareAttempts: 1, skipQuestionAudit: true }
    );
    expect(ensureObjectiveParts).toHaveBeenCalledWith(expect.objectContaining({ lectureId: "L67", pages }), expect.objectContaining({ callAIJSON }));
    expect(callAIJSON.mock.calls[0][1]).toContain("OBJECTIVE PARTS (required)");
    expect(result.questions[0]?.objectivePartId).toBe(duration.id);
  });
});

describe("parts across lectures (exam and CBSE dashboards)", () => {
  it("recognises the same lecture text whether it arrives as chunk pages or joined text, and the first-release version", () => {
    const joined = [{ page: 1, text: pages.map(page => page.text).join("\n\f\n") }];
    expect(sourceMatches(inventory, joined)).toBe(true);
    expect(sourceMatches({ ...inventory, sourceVersion: legacyPartsSourceVersion(pages) }, pages)).toBe(true);
    expect(sourceMatches(inventory, [{ page: 1, text: "different lecture" }])).toBe(false);
    const stale = { ...inventory, sourceVersion: legacyPartsSourceVersion(pages) };
    expect(mergeInventory(stale, normalizeObjectiveParts(raw, { lectureId: "L67", objectives: [objective], pages })).objectives.o115.parts[0].id).toBe(duration.id);
  });

  it("combines lecture inventories so block objectives each carry their own parts", () => {
    const other = { ...inventory, lectureId: "L2", objectives: { o2: { parts: [{ id: "p-x", label: "Other part" }] } }, questionParts: { e_x: "p-x" } };
    const combined = combineInventories([inventory, other, null]);
    expect(Object.keys(combined.objectives).sort()).toEqual(["o115", "o2"]);
    const [a, b] = withPartTargets([objective, { id: "o2", objective: "Other" }], combined, []);
    expect(a._parts).toHaveLength(3);
    expect(b._parts.map(part => part.label)).toEqual(["Other part"]);
  });

  it("CBSE progress rows show parts and stay not-ready while parts are untested", () => {
    const progress = cbseProgress({ objectives: { b: [objective] }, evidence: { learningJournal: [] }, parts: inventory });
    expect(progress.objectives[0].parts.map(part => part.covered)).toEqual([false, false, false]);
    expect(progress.objectives[0].missingRequirements.join(" ")).toMatch(/untested parts/);
  });

  it("exam generation builds the lecture inventory, prompts with parts and tags accepted questions", async () => {
    const lecture = { id: "L67", blockId: "b", lectureTitle: "Psychotic disorders", chunks: pages.map(page => ({ markdown: page.text.repeat(3), pageNumber: page.page })) };
    const question = { stem: "A 24-year-old has had hallucinations for six weeks with full recovery. Which diagnosis best fits?", choices: { A: "Schizophreniform disorder", B: "Brief psychotic disorder", C: "Schizophrenia", D: "Delusional disorder" }, correct: "A", explanation: "Duration 1 to 6 months.", objectiveIds: ["o115"], objectivePartId: duration.id };
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [question] });
    const ensureObjectiveParts = vi.fn().mockResolvedValue(inventory);
    const result = await generateExamQuestions({ allocation: { L67: 1 }, lecturesById: { L67: lecture }, lectures: [lecture], objectivesByLecture: { L67: [objective] }, atomsByLecture: {}, blockId: "b", userId: null }, { callAIJSON, ensureObjectiveParts, skipQuestionAudit: true });
    expect(ensureObjectiveParts).toHaveBeenCalledWith(expect.objectContaining({ lectureId: "L67" }), expect.anything());
    expect(callAIJSON.mock.calls[0][1]).toContain("OBJECTIVE PARTS (required)");
    expect(result.questions[0]?.objectivePartId).toBe(duration.id);
  });
});

describe("Today's schedule context", () => {
  it("attaches parts so the planner sees an objective with untested parts as not ready", async () => {
    const { buildScheduleContext } = await import("../shell/features/today/scheduleContext.js");
    const lecture = { id: "L67", blockId: "b", lectureTitle: "Psychotic disorders" };
    const context = buildScheduleContext({ blockId: "b", terms: [{ id: "t", blocks: [{ id: "b", name: "B" }] }], lectures: [lecture], objectives: { b: [{ ...objective, linkedLecId: "L67" }] }, learnerEvidence: { learningJournal: [] }, parts: inventory });
    expect(context.objectives[0]._parts).toHaveLength(3);
    expect(objectivePracticePlan(context.objectives, {}).rows[0].missingRequirements.join(" ")).toMatch(/untested parts/);
  });
});
