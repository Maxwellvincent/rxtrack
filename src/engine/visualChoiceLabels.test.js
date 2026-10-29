import {describe,it,expect} from 'vitest';
import {restoreVisualChoices} from './visualChoiceLabels.js';
describe('source diagram labels',()=>{
 it('restores F in an existing session from retained A and F source labels',()=>{
 const q={stem:'Which labeled site corresponds to the lesion? A F',choices:Object.fromEntries('ABCDE'.split('').map(k=>[k,`Visual option ${k}`])),correct:'D'};
 expect(restoreVisualChoices(q).choices.F).toBe('Visual option F');
 expect(restoreVisualChoices(q).correct).toBe('D');
 });
 it('does not invent labels or alter text options',()=>{
 const q={stem:'Which site? A F',choices:{A:'Thalamus',B:'Pons'}};
 expect(restoreVisualChoices(q)).toBe(q);
 const visual={stem:'Which site?',choices:{A:'Visual option A',B:'Visual option B'}};
 expect(restoreVisualChoices(visual)).toBe(visual);
 });
});
