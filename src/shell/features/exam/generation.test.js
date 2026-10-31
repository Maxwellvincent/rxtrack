import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { buildObjectiveCoverage, generateExamQuestions, resolveQuestionObjectiveIds } from "./generation.js";

const LECTURE_BODY = "Brachial plexus anatomy. ".repeat(20); // over the 150-char floor

const lectures = [
  { id: "lec1", blockId: "b1", lectureTitle: "Brachial Plexus and Upper Limb", chunks: [{ markdown: LECTURE_BODY }] },
  { id: "lec2", blockId: "b1", lectureTitle: "Cranial Nerves Overview", chunks: [{ markdown: LECTURE_BODY }] },
];

const lecturesById = {
  lec1: lectures[0],
  lec2: lectures[1],
};

const objectivesByLecture = {
  lec1: [{ id: "obj1", objective: "Describe the brachial plexus." }],
  lec2: [{ id: "obj2", objective: "Describe cranial nerve XII." }],
};

function mcq(stem) {
  return {
    stem,
    choices: { A: "Axillary", B: "Radial", C: "Ulnar", D: "Median" },
    correct: "A",
    explanation: "Because.",
  };
}

function tableMcq(stem) {
  return {
    stem,
    choiceLayout: "table",
    choices: { A: { rowA: "x" }, B: { rowB: "y" } },
    correct: "A",
    explanation: "Because.",
  };
}

beforeEach(() => installDomStorage());

describe("generateExamQuestions", () => {
  it("loads cloud text for a metadata-only lecture and passes it to the real quiz generator", async () => {
    const lecture = { id: "cloud-lecture", blockId: "b1", lectureTitle: "Saved lecture" };
    const fetchLectureContent = vi.fn(async () => ({ chunks: [{ markdown: LECTURE_BODY }], atoms: [] }));
    const callAIJSON = vi.fn(async () => ({ questions: [mcq("Which supplied anatomical structure is involved in the described finding?")] }));
    await generateExamQuestions({ allocation: { [lecture.id]: 1 }, lecturesById: { [lecture.id]: lecture }, lectures: [lecture], objectivesByLecture: { [lecture.id]: [{ id: "o", objective: "Identify the structure" }] }, atomsByLecture: {}, blockId: "b1", userId: "u" }, { fetchLectureContent, callAIJSON, skipQuestionAudit: true });
    expect(fetchLectureContent).toHaveBeenCalledWith("u", lecture.id);
    expect(callAIJSON).toHaveBeenCalled();
    expect(callAIJSON.mock.calls[0][1]).toContain(LECTURE_BODY.trim());
  });
  it("injects the lecture-matched NB1 correlate plan into generated exams and preserves its tag", async () => {
    const lecture = { id: "l04", blockId: "nb1", lectureTitle: "Lecture 04 - Meninges and Arteries", chunks: [{ markdown: "A middle meningeal artery injury can cause an epidural hemorrhage with a biconvex collection. ".repeat(8) }] };
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [{
      ...mcq("A patient has a biconvex extra-axial collection after temporal trauma. Which injured vessel best explains this finding?"),
      clinicalCorrelateId: "nb1-04-epidural-hemorrhage",
      clinicalCorrelate: "Epidural hemorrhage",
      clinicalCueUsed: "biconvex collection",
      clinicalReasoningStage: "mechanism",
    }] });
    const result = await generateExamQuestions({
      allocation: { l04: 1 },
      lecturesById: { l04: lecture },
      objectivesByLecture: { l04: [{ id: "o4", objective: "Differentiate intracranial hemorrhages" }] },
      atomsByLecture: { l04: [{ term: "Epidural hemorrhage", content: "Middle meningeal artery injury produces a biconvex collection.", objectiveIds: ["o4"] }] },
      blockId: "nb1",
      lectures: [lecture],
      weakConceptAccuracyByLecture: {},
      userId: null,
    }, { callAIJSON, skipQuestionAudit: true });
    expect(callAIJSON.mock.calls[0][1]).toContain("CONDITIONAL CLINICAL PRACTICE CANDIDATES");
    expect(callAIJSON.mock.calls[0][1]).toContain("nb1-04-epidural-hemorrhage");
    expect(result.questions[0]).toMatchObject({ clinicalCorrelateId: "nb1-04-epidural-hemorrhage", clinicalReasoningStage: "mechanism" });
  });

  it("keeps objective provenance conservative when a multi-objective item is untagged", () => {
    const objectives = [{ id: "o1", code: "A" }, { id: "o2", code: "B" }];
    expect(resolveQuestionObjectiveIds({ objectiveIds: ["B", "unknown"] }, objectives)).toEqual(["o2"]);
    expect(resolveQuestionObjectiveIds({}, objectives)).toEqual([]);
    expect(buildObjectiveCoverage([{ objectiveIds: ["o1"] }, {}], objectives)).toMatchObject({
      covered: ["o1"], untested: ["o2"], untagged: 1, coverageRate: 0.5,
    });
    expect(buildObjectiveCoverage([{}], [{ id: "o1" }])).toMatchObject({
      covered: ["o1"], untested: [], untagged: 0, coverageRate: 1,
    });
  });

  it("generates once per lecture and stamps provenance on every surviving question", async () => {
    const callAIJSON = vi
      .fn()
      .mockResolvedValueOnce({ questions: [mcq("Q1a"), mcq("Q1b")] }) // lec1
      .mockResolvedValueOnce({ questions: [mcq("Q2a")] }); // lec2

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 2, lec2: 1 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(3);
    expect(callAIJSON).toHaveBeenCalledTimes(2); // one call per lecture, not per question

    for (const q of result.questions) {
      expect(q.questionId).toBeTruthy();
      expect(q.blockId).toBe("b1");
    }

    const lec1Questions = result.questions.filter((q) => q.lectureId === "lec1");
    expect(lec1Questions).toHaveLength(2);
    expect(lec1Questions.every((q) => q.objectiveIds).toString()).toBeTruthy();
    for (const q of lec1Questions) expect(q.objectiveIds).toEqual(["obj1"]);

    const lec2Questions = result.questions.filter((q) => q.lectureId === "lec2");
    expect(lec2Questions).toHaveLength(1);
    for (const q of lec2Questions) expect(q.objectiveIds).toEqual(["obj2"]);

    // unique questionIds
    const ids = new Set(result.questions.map((q) => q.questionId));
    expect(ids.size).toBe(3);
  });

  it("honors a selected difficulty override instead of the adaptive lecture level", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [mcq("Medium-level question")] });
    const result = await generateExamQuestions({
      allocation: { lec1: 1 }, lecturesById, objectivesByLecture, atomsByLecture: {},
      blockId: "b1", lectures, weakConceptAccuracyByLecture: { lec1: 0.99 },
      userId: null, difficultyOverride: "medium",
    }, { callAIJSON, skipQuestionAudit: true });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].difficulty).toBe("medium");
    expect(JSON.stringify(callAIJSON.mock.calls[0])).toContain("medium");
  });

  it("preserves table-shaped choice questions for the table renderer", async () => {
    const callAIJSON = vi.fn().mockResolvedValueOnce({
      questions: [mcq("Good question"), tableMcq("Bad table question")],
    });

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 2 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].stem).toBe("Good question");
    expect(result.questions[1].choiceLayout).toBe("table");
    expect(Object.values(result.questions[1].choices)).toContainEqual({ rowA: "x" });
    expect(result.errors).toEqual([]);
  });

  it("retains partial success when the batch-sized retry limit is exhausted", async () => {
    // Every attempt (initial + 2 retries = 3 calls) returns only 1 valid question.
    const callAIJSON = vi
      .fn()
      .mockResolvedValueOnce({ questions: [mcq("A1")] })
      .mockResolvedValueOnce({ questions: [mcq("A2")] })
      .mockResolvedValueOnce({ questions: [mcq("A3")] });

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 5 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(4); // ceil(5 / 3) + 2 bounded attempts
    expect(result.questions).toHaveLength(3); // partial success kept
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ lectureId: "lec1", requested: 5, obtained: 3 });
  });

  it("succeeds fully when a retry makes up the shortfall", async () => {
    const callAIJSON = vi
      .fn()
      .mockResolvedValueOnce({ questions: [mcq("A1")] }) // short: 1 of 2
      .mockResolvedValueOnce({ questions: [mcq("A2")] }); // retry supplies the rest

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 2 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(2);
    expect(result.questions).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it("skips lectures absent from the allocation or allocated zero", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [mcq("Q1")] });

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 1, lec2: 0 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(1);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].lectureId).toBe("lec1");
  });

  it("threads deps.callAIJSON through startObjectiveQuiz's generators, not bypassed", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [mcq("Q1")] });

    await generateExamQuestions(
      {
        allocation: { lec1: 1 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(callAIJSON).toHaveBeenCalled();
    // the prompt (2nd positional arg to callAIJSON) should reflect the lecture content
    const prompt = callAIJSON.mock.calls[0][1];
    expect(prompt).toContain("Brachial plexus anatomy");
  });

  it("reads block-filtered exemplars once and threads them into every lecture's call", async () => {
    localStorage.setItem(
      "rxt-question-banks",
      JSON.stringify({ "b1-exam.pdf": [{ stem: "Exemplar Q", choices: { A: "a", B: "b" }, correct: "A" }] })
    );
    localStorage.setItem(
      "rxt-question-bank-meta",
      JSON.stringify({ m1: { filename: "b1-exam.pdf", blockId: "b1", uploadedAt: 1 } })
    );

    const callAIJSON = vi.fn().mockResolvedValueOnce({ questions: [mcq("Q1")] }).mockResolvedValueOnce({ questions: [mcq("Q2")] });

    await generateExamQuestions(
      {
        allocation: { lec1: 1, lec2: 1 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON, skipQuestionAudit: true }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(2);
    for (const call of callAIJSON.mock.calls) {
      expect(call[1]).toContain("Exemplar Q");
    }
  });
});

it('generates separate subject slots from a mixed lecture while retaining its real source block', async()=>{
 const callAIJSON=vi.fn().mockResolvedValue({questions:[mcq('Subject-specific clinical item')]});
 const result=await generateExamQuestions({allocation:{'lec1::bpm::anatomy':1,'lec1::bpm::histology':1},lecturesById,lectures,
  objectivesByLecture:{lec1:[{id:'a',discipline:'ANAT',objective:'Describe anatomy'},{id:'h',discipline:'HCB',objective:'Describe histology'}]},atomsByLecture:{},blockId:'exam-center',userId:null},
  {callAIJSON,skipQuestionAudit:true});
 expect(result.questions).toHaveLength(2);
 expect(result.questions.map(q=>q.blueprintSubject).sort()).toEqual(['anatomy','histology']);
 expect(result.questions.every(q=>q.lectureId==='lec1'&&q.sourceBlockId==='b1')).toBe(true);
 expect(result.questions.find(q=>q.blueprintSubject==='anatomy').objectiveIds).toEqual(['a']);
 expect(result.questions.find(q=>q.blueprintSubject==='histology').objectiveIds).toEqual(['h']);
});

it('never reassigns a saved question from another subject to a sole target objective',async()=>{
 const pool={history:async()=>[],readyForLectures:async()=>[{...mcq('Wrong subject'),objectiveIds:['not-anatomy']}],ready:async()=>[]};
 const result=await generateExamQuestions({allocation:{'lec1::bpm::anatomy':1},lecturesById,lectures,objectivesByLecture:{lec1:[{id:'a',discipline:'ANAT'}]},atomsByLecture:{},blockId:'b1',userId:null},
  {pool,savedOnly:true,skipQuestionAudit:true});
 expect(result.questions).toHaveLength(0);
 expect(result.errors[0].lectureId).toBe('lec1::bpm::anatomy');
});
