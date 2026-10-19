import { expect, it } from "vitest";
import { selectSchoolQuestions } from "./schoolQuestionSelection.js";
const lectures = [{ id: "l5", blockId: "b", lectureNumber: 5, lectureTitle: "NB 05 Neurons and Glia" }];
const question = { id: "q", stem: "Which organelle is affected?", choices: { A: "Lysosome", B: "Golgi" }, correct: "A", sourceSection: "NB 05", sourceSectionTitle: "Neurons and Glia" };
const args = { banks: [{ filename: "homework.pdf", blockId: "b", questions: [question, { ...question, id: "duplicate" }] }], lectures, blockId: "b", allocation: { l5: 2 } };
it("uses original valid school questions once, keeps keys and source links, and requests only missing slots", () => {
  const result = selectSchoolQuestions(args);
  expect(result.questions).toHaveLength(1);
  expect(result.questions[0]).toMatchObject({ correct: "A", lectureId: "l5", sourceType: "question-bank", sourceFile: "homework.pdf", exposure: "unseen", objectiveIds: [] });
  expect(result.allocation).toEqual({ l5: 1 });
});
it("excludes answered content across renamed banks unless review is requested", () => {
  expect(selectSchoolQuestions({ ...args, history: [question] }).questions).toHaveLength(0);
  expect(selectSchoolQuestions({ ...args, history: [question], includeSeen: true }).questions[0].exposure).toBe("review");
});
it("rejects missing figures, wrong blocks and unconfirmed lecture guesses", () => {
  for (const patch of [{ hasImage: true }, { sourceSection: "", sourceSectionTitle: "", lectureId: "l5", curriculumLinkStatus: "candidate" }]) {
    expect(selectSchoolQuestions({ ...args, banks: [{ ...args.banks[0], questions: [{ ...question, ...patch }] }] }).questions).toHaveLength(0);
  }
  expect(selectSchoolQuestions({ ...args, blockId: "other" }).questions).toHaveLength(0);
});
it('uses clear single-subject school originals for blueprint quotas without inventing objective credit',()=>{
 const result=selectSchoolQuestions({...args,allocation:{'l5::bpm::neuroscience':2},objectivesByLecture:{l5:[{id:'o',code:'SOM.BPM2.NSCI.1'}]}});
 expect(result.questions).toHaveLength(1);
 expect(result.questions[0]).toMatchObject({blueprintSubject:'neuroscience',blueprintSlot:'l5::bpm::neuroscience',lectureId:'l5',objectiveIds:[],sourceBlockId:'b'});
 expect(result.allocation).toEqual({'l5::bpm::neuroscience':1});
});
it('keeps a mixed-subject lecture unresolved when a school question has no discipline evidence',()=>{
 const result=selectSchoolQuestions({...args,allocation:{'l5::bpm::neuroscience':1},objectivesByLecture:{l5:[{id:'n',discipline:'NSCI'},{id:'a',discipline:'ANAT'}]}});
 expect(result.questions).toHaveLength(0);
 expect(result.allocation).toEqual({'l5::bpm::neuroscience':1});
});
