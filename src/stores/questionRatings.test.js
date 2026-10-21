import { beforeEach, describe, expect, it } from "vitest";
import * as cloud from "./cloudBase.js";
import { recordEvidence, read as readEvidence } from "./learnerEvidence.js";
import * as ratings from "./questionRatings.js";

describe("question generator ratings", () => {
  beforeEach(() => cloud.clearCloudCache?.());

  it("stores one editable rating per question and compares completed ratings", () => {
    const q1 = { id: "q1", stem: "One", generationVersion: "v1" };
    const q2 = { id: "q2", stem: "Two", generationVersion: "v2" };
    ratings.rateQuestion("rating-user", q1, { fair: true });
    ratings.rateQuestion("rating-user", q1, { examStyle: false, issue: "weak-vignette" });
    ratings.rateQuestion("rating-user", q2, { fair: true, examStyle: true });
    expect(ratings.ratingFor("rating-user", q1)).toMatchObject({ fair: true, examStyle: false, issue: "weak-vignette" });
    expect(ratings.comparison("rating-user")).toMatchObject({
      v1: { count: 1, fairPercent: 100, examStylePercent: 0, issuePercent: 100 },
      v2: { count: 1, fairPercent: 100, examStylePercent: 100, issuePercent: 0 },
    });
  });

  it("excludes and restores source-contested evidence without losing attempts", () => {
    const user = "source-review-user";
    const question = { id: "imported-1", lectureId: "lecture-1" };
    recordEvidence(user, { questionKey: question.id, objectiveIds: ["objective-1"], correct: false, misconception: "landmine", at: 10 });
    recordEvidence(user, { questionKey: "valid-2", objectiveIds: ["objective-1"], correct: true, at: 20 });
    ratings.rateQuestion(user, question, { sourceIssue: "incorrect-key", sourceNote: "Source says otherwise" });
    expect(readEvidence(user).total).toBe(1);
    expect(readEvidence(user).objectives["objective-1"]).toMatchObject({ attempts: 1, correct: 1, landmines: 0 });
    expect(readEvidence(user).evidenceJournal).toHaveLength(2);
    recordEvidence(user, { questionKey: "valid-3", objectiveIds: ["objective-1"], correct: true, at: 30 });
    expect(readEvidence(user).total).toBe(2);
    ratings.rateQuestion(user, question, { sourceIssue: null });
    expect(readEvidence(user).total).toBe(3);
    expect(readEvidence(user).objectives["objective-1"]).toMatchObject({ attempts: 3, correct: 2, landmines: 1 });
  });

  it("does not rate non-versioned school questions", () => {
    expect(ratings.rateQuestion("rating-user-2", { id: "school" }, { fair: true })).toBeNull();
  });
});

it('keeps incomplete explanations eligible and excludes invalid-choice reports across evidence aliases', () => {
 const user='policy-alias-user';
 const q={id:'raw',questionId:'session-q',poolId:'pool-q',questionKey:'canonical-q',lectureId:'l'};
 recordEvidence(user,{questionKey:'canonical-q',lectureId:'l',objectiveIds:['o'],correct:false,at:1});
 ratings.rateQuestion(user,q,{sourceIssue:'incomplete-explanation'});
 expect(readEvidence(user).total).toBe(1);
 ratings.rateQuestion(user,q,{sourceIssue:'invalid-choices'});
 expect(readEvidence(user).total).toBe(0);
 expect(readEvidence(user).objectives.o.attempts).toBe(0);
 expect(readEvidence(user).evidenceJournal).toHaveLength(1);
 ratings.rateQuestion(user,q,{sourceIssue:null});
 expect(readEvidence(user).total).toBe(1);
});

it('replays keyed miss classifications and reflections without excluded questions', async () => {
 const { recordMissType, recordReflection } = await import('./learnerEvidence.js');
 const user='diagnostic-protection-user'; const q={questionId:'diag-q',id:'stable-q'};
 recordEvidence(user,{questionKey:'stable-q',objectiveIds:['o'],correct:false,at:1});
 recordMissType(user,'knowledge','session:diag-q');
 recordReflection(user,'knowledge-gap',null,'stable-q');
 ratings.rateQuestion(user,q,{sourceIssue:'invalid-choices'});
 expect(readEvidence(user).testTaking.missTypes.knowledge).toBeUndefined();
 expect(readEvidence(user).testTaking.reasons['knowledge-gap']).toBeUndefined();
 ratings.rateQuestion(user,q,{sourceIssue:null});
 expect(readEvidence(user).testTaking.missTypes.knowledge.count).toBe(1);
 expect(readEvidence(user).testTaking.reasons['knowledge-gap']).toBe(1);
});

it('does not mix reports for the same source question number in different banks', () => {
 const a={id:'q1',sourceFile:'Bank A.pdf',questionKey:'bank-a-q1'};
 const b={id:'q1',sourceFile:'Bank B.pdf',questionKey:'bank-b-q1'};
 ratings.rateQuestion('scoped-user',a,{sourceIssue:'invalid-choices'});
 ratings.rateQuestion('scoped-user',b,{sourceIssue:'incomplete-explanation'});
 expect(ratings.ratingFor('scoped-user',a).sourceIssue).toBe('invalid-choices');
 expect(ratings.isExcluded('scoped-user',b)).toBe(false);
});

it('migrates an older rating by evidence identity without leaving an exclusion behind after undo', () => {
 const user='legacy-rating-user';
 cloud.writeCloud(user,ratings.key,{ratings:{legacy:{evidenceKey:'pool-legacy',sourceIssue:'incorrect-key'}}});
 const q={id:'old-id',poolId:'pool-legacy',generationVersion:'v2'};
 expect(ratings.ratingFor(user,q).sourceIssue).toBe('incorrect-key');
 ratings.rateQuestion(user,q,{sourceIssue:null});
 expect(ratings.isExcluded(user,q)).toBe(false);
 expect(Object.keys(ratings.read(user).ratings)).toHaveLength(1);
});

it("retains learning notes without grading them and suppresses contested question confusions", async () => {
 const {recordLearningNote}=await import("./learnerEvidence.js");
 const {learningFocus}=await import("../engine/learningLoop.js");
 const user="learning-notes-user";
 recordEvidence(user,{questionKey:"broken",objectiveIds:["o"],lectureId:"l",blockId:"NB",correct:false,learningContext:{selected:"Ovale",keyed:"Rotundum"}});
 const before=readEvidence(user).total;
 recordLearningNote(user,{questionKey:"broken",objectiveIds:["o"],lectureId:"l",blockId:"NB",note:"I confuse nerve exits"});
 expect(readEvidence(user).total).toBe(before);
 expect(learningFocus({objectives:[{id:"o"}],evidence:readEvidence(user),blockId:"NB"})).toContain("I confuse nerve exits");
 ratings.rateQuestion(user,{id:"broken",lectureId:"l"},{sourceIssue:"incorrect-key"});
 expect(learningFocus({objectives:[{id:"o"}],evidence:readEvidence(user),blockId:"NB"})).toBe("");
 expect(readEvidence(user).evidenceJournal).toHaveLength(1);
});
