import { describe, it, expect } from 'vitest';
import { practiceSections, sectionQuestionIndices, firstSectionQuestion } from './practiceSections.js';

describe('source section practice navigation', () => {
  const questions = [
    {questionId:'a',sourceSection:'NB27',sourceSectionTitle:'Cortex'},
    {questionId:'b',sourceSection:'NB28/NB29/NB30',sourceSectionTitle:'Sensation',lectureId:'l29'},
    {questionId:'c',sourceSection:'NB27'},
    {questionId:'d',lectureId:'l31'},
    {questionId:'e'},
  ];
  it('keeps a grouped source heading intact, includes unknown sections, and counts picks including A', () => {
    const groups = practiceSections(questions,[{questionId:'a',value:'A'},{questionId:'b',value:null}],{l31:'LEC 31 Motor'});
    expect(groups.map(s=>s.label)).toEqual(['NB27','NB28/NB29/NB30','LEC 31 Motor','Section not identified']);
    expect(groups[0]).toMatchObject({indices:[0,2],answered:1});
    expect(groups[1]).toMatchObject({indices:[1],answered:0});
  });
  it('filters navigation in original source order without renumbering or removing questions', () => {
    const groups = practiceSections(questions);
    const indices = sectionQuestionIndices(groups,['source:NB27','lecture:l31']);
    expect(indices).toEqual([0,2,3]);
    expect(firstSectionQuestion(indices,questions,[{questionId:'a',value:'A'}])).toBe(2);
    expect(sectionQuestionIndices(groups,[])).toEqual([0,1,2,3,4]);
    expect(questions).toHaveLength(5);
  });
  it('opens a completed selection for review and never needs an invented lecture link', () => {
    expect(firstSectionQuestion([0,2],questions,[{questionId:'a',value:'B'},{questionId:'c',value:'A'}])).toBe(0);
    expect(questions[0].lectureId).toBeUndefined();
  });
});
