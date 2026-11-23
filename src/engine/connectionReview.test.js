import {it,expect} from 'vitest';
import {connectionReviewPrompt,reviewedConnectionIds} from './connectionReview.js';
import {buildQuestionAuditPrompt} from './mcq.js';
import {buildBlindSourceReviewPrompt,decodeBlindSourceReviews} from './blindSourceReview.js';
import {decodeLocalQuestionWire} from './localQuestionWire.js';
const targets=[{id:'durable-id',objectiveId:'o',label:'Motor control connection',quote:'Upper motor neurons control lower motor neurons.',page:1}];
it('resolves only named connection aliases, never E evidence IDs or unknown claims',()=>{
 expect(reviewedConnectionIds(['C1','E1','C2','foreign','durable-id'],targets)).toEqual(['durable-id']);
 expect(connectionReviewPrompt([])).toBe('');
});
it.each(['full','compact','local'])('supplies connection identities to %s review without trusting writer claims',promptProfile=>{
 const prompt=buildQuestionAuditPrompt([],{promptProfile,relationshipTargets:targets,objectives:[],lectureText:targets[0].quote});
 expect(prompt).toContain('CONNECTION OWNERSHIP CATALOG');expect(prompt).toContain('C1');
});
it('keeps the connection classification in blind and compact transports',()=>{
 expect(buildBlindSourceReviewPrompt([],{relationshipTargets:targets,objectives:[],lectureText:targets[0].quote})).toContain('CONNECTION OWNERSHIP CATALOG');
 expect(decodeLocalQuestionWire({reviews:[{i:0,cr:['C1']}]}).reviews[0].sourceRelationshipIds).toEqual(['C1']);
 expect(decodeBlindSourceReviews({reviews:[{i:0,cr:['C1']}]},{objectives:[]}).reviews[0].sourceRelationshipIds).toEqual(['C1']);
});
