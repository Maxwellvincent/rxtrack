import { describe, it, expect } from 'vitest';
import { buildMcqPrompt, buildQuestionAuditPrompt } from './mcq.js';
import { buildBlindSolvePrompt } from './blindQuestionSolve.js';
import { QUESTION_CONTRACT_VERSION } from './questionContract.js';

const cfg = {
  count: 1, promptProfile: 'local',
  objectives: [{ id: 'o', objective: 'Explain preservation of local responses after interruption of upstream input', _targetOrder: 'second-order' }],
  lectureText: 'Local responses persist after upstream input is interrupted. '.repeat(120),
};
const question = {
  stem: 'An upstream input is interrupted while a local response persists. Which mechanism explains the preserved response?',
  choices: { A: 'Local mechanism', B: 'Upstream drive', C: 'No response', D: 'Unrelated input' }, correct: 'A',
  explanation: 'PRIVATE_WRITER_EXPLANATION', objectiveIds: ['o'], orderLevel: 'second-order',
};

describe('bounded local question prompts', () => {
  it('reduces writing instructions while retaining assigned depth and source evidence', () => {
    const local = buildMcqPrompt(cfg);
    const cloud = buildMcqPrompt({ ...cfg, promptProfile: 'compact' });
    expect(local.length).toBeLessThan(cloud.length * .6);
    expect(local).toContain(QUESTION_CONTRACT_VERSION);
    expect(local).toContain('"targetOrder":"second-order"');
    expect(local).toContain('SOURCE EVIDENCE CATALOG');
    expect(local).toContain('Local responses persist');
  });
  it('requires the same key, objective, discriminator and reasoning judgments', () => {
    const review = buildQuestionAuditPrompt([question], cfg);
    for (const field of ['objectiveAligned', 'objectiveClause', 'bestSourceObjectiveCode', 'whyAssignedOverNeighbor', 'closestAlternative', 'stemClue', 'keyUniquelySupported', 'evidenceIds', 'allStepsRequired', 'connectedChain', 'singleEndpoint', 'choiceShortcut']) {
      expect(review).toContain(field);
    }
    expect(review).toContain('Fail uncertain items');
  });
  it('keeps the separate solve blind to the proposed answer and explanation', () => {
    const prompt = buildBlindSolvePrompt([question], cfg);
    expect(prompt).not.toContain('PRIVATE_WRITER_EXPLANATION');
    expect(prompt).not.toContain('"correct":');
    expect(prompt).toContain('unique');
    expect(prompt).toContain('SOURCE EVIDENCE CATALOG');
  });
});
