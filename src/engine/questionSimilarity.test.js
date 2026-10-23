import { describe, expect, it } from "vitest";
import { areNearDuplicateQuestions, questionSimilarity, uniqueQuestions, exceedsAnswerConcentration, repeatedSuccessfulAnswerGuidance } from "./questionSimilarity.js";

const first = {
  stem: "A 45-year-old male presents with intermittent abdominal pain. Examination shows tenderness in the upper mid-abdomen. Which of the following best describes the location of the peritoneum in this patient?",
  choices: { A: "Parietal peritoneum", B: "Visceral peritoneum", C: "Peritoneal cavity", D: "Mesentery", E: "Lesser sac" },
  objectiveIds: ["peritoneum"],
};

describe("semantic question deduplication", () => {
  it("rejects identical tasks even when new distractors change the full token set", () => {
    const rewritten = { ...first, choices: { A: "Endothelium", B: "Fibroblasts", C: "Smooth muscle", D: "Collagen" } };
    expect(questionSimilarity(first, rewritten)).toBeLessThan(0.9);
    expect(areNearDuplicateQuestions(first, rewritten)).toBe(true);
  });
  it("treats demographic and option-order changes as the same reasoning route", () => {
    const paraphrase = {
      ...first,
      stem: "A 55-year-old man has intermittent abdominal pain and tenderness in the upper mid-abdomen. Which option best describes the location of the peritoneum in this patient?",
      choices: { A: "Lesser sac", B: "Mesentery", C: "Peritoneal cavity", D: "Visceral peritoneum", E: "Parietal peritoneum" },
    };
    expect(questionSimilarity(first, paraphrase)).toBeGreaterThan(0.9);
    expect(areNearDuplicateQuestions(first, paraphrase)).toBe(true);
    expect(uniqueQuestions([first, paraphrase])).toEqual([first]);
  });

  it("keeps genuinely different clinical routes", () => {
    const different = {
      stem: "A patient undergoes abdominal surgery and develops severe pain when the abdominal wall is touched. Which membrane carries somatic sensory innervation?",
      choices: { A: "Parietal peritoneum", B: "Visceral peritoneum", C: "Greater omentum", D: "Mesentery", E: "Lesser sac" },
      objectiveIds: ["peritoneum"],
    };
    expect(areNearDuplicateQuestions(first, different)).toBe(false);
  });
});
it("rejects paraphrased questions testing the same intervention and endpoint but keeps different endpoints", () => {
  const left = { stem: "Following an operation a patient cannot produce tears.", objectiveIds: ["o"], choices: { A: "Reduced gland secretion" }, correct: "A", questionPlan: { perturbation: "Interrupt parasympathetic preganglionic nerve fibers", endpoint: "Predict reduced lacrimal gland secretion" } };
  const right = { ...left, stem: "An investigator examines an isolated autonomic pathway in the face." };
  expect(areNearDuplicateQuestions(left, right)).toBe(true);
  expect(areNearDuplicateQuestions(left, { ...right, questionPlan: { ...right.questionPlan, endpoint: "Identify skeletal muscle motor weakness" } })).toBe(false);
});

it("recognizes substituted tracer labels without collapsing distinct experimental endpoints", () => {
  const make = label => ({
    stem: `An investigator injects a ${label} into the peripheral nerve ending and observes its accumulation in the cell body after transport. Which motor carries this material?`,
    objectiveIds: ["axonal-transport"],
    choices: { A: "Dynein", B: "Kinesin", C: "Myosin", D: "Actin" }, correct: "A",
  });
  expect(uniqueQuestions([make("tracer"), make("fluorescent marker"), make("tagged molecule")])).toHaveLength(1);
  const different = { stem: "After selective inhibition of anterograde movement, newly made vesicles accumulate near the soma. What happens to delivery of secretory cargo at the terminal?", objectiveIds: ["axonal-transport"], choices: { A: "Decreased delivery", B: "Increased delivery", C: "Unchanged delivery" }, correct: "A" };
  expect(areNearDuplicateQuestions(make("tracer"), different)).toBe(false);
});

it('caps repeated answer concepts independent of option letter without banning the topic',()=>{
 const q={correct:'A',choices:{A:'Spinal accessory nerve'}};
 const same={correct:'E',choices:{E:'Spinal accessory nerve'}};
 expect(exceedsAnswerConcentration(same,[q,q,q],15)).toBe(true);
 expect(exceedsAnswerConcentration({correct:'A',choices:{A:'Ansa cervicalis'}},[q,q,q],15)).toBe(false);
 expect(repeatedSuccessfulAnswerGuidance([{...q,lastCorrect:true,timesCorrect:1},{...same,lastCorrect:true,timesCorrect:1}])).toContain('spinal accessory nerve');
});
