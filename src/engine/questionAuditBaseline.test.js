import {it,expect} from 'vitest';
import {buildQuestionAuditBaseline} from './questionAuditBaseline.js';
const q=(id,extra={})=>({id,stem:`A patient has a finding ${id}. Which structure is affected?`,choices:{A:'One',B:'Two'},correct:'A',...extra});
it('samples across lectures and source roles deterministically without mutating records',()=>{
 const input={generated:{a:{questions:Array.from({length:20},(_,i)=>q(`a${i}`))},b:{questions:[q('b1'),q('b2')]}},banks:{'Homework Week12.pdf':[q('h')],'ESoft.pdf':[q('e')],'IMCQ.pdf':[q('i')]},generatedLimit:4,now:0};
 const before=JSON.stringify(input),a=buildQuestionAuditBaseline(input),b=buildQuestionAuditBaseline(input);
 expect(a).toEqual(b);expect(JSON.stringify(input)).toBe(before);
 expect(a.sampled).toEqual({generated:4,homework:1,examsoft:1,imcq:1});
 expect(a.samples.filter(x=>x.lectureId==='b')).toHaveLength(2);
 expect(a.samples.every(x=>x.review.verdict===null)).toBe(true);
});
it('excludes contested and abbreviated original keys without hiding generated defects',()=>{
 const packet=buildQuestionAuditBaseline({generated:{a:{questions:[q('generated',{correct:null})]}},banks:{'homework.pdf':[q('ok'),q('held',{sourceKeyReviewStatus:'stem-mismatch'}),q('bad',{answerKeyVerified:false}),q('summary',{sourceRepresentation:'answer-explanation-summary'})]}});
 expect(packet.population).toMatchObject({generated:1,originals:4,eligibleOriginals:1,excludedOriginals:3});
 expect(packet.samples.find(x=>x.role==='generated').correct).toBeNull();
});
it('does not export account details, signed figure URLs, embedded images or answer history',()=>{
 const packet=buildQuestionAuditBaseline({generated:{a:{questions:[q('a',{userId:'private-account',sourceImageUrl:'https://private?token=secret',sourceImageDataUrl:'data:huge',answers:['private'],hasImage:true})]}}});
 const text=JSON.stringify(packet);expect(text).not.toContain('private-account');expect(text).not.toContain('token=secret');expect(text).not.toContain('data:huge');expect(packet.samples[0].figureRequired).toBe(true);
 expect(packet.limitations.join(' ')).toContain('not an unseen holdout');
});
it('supports empty retained stores without fabricating samples or order estimates',()=>{
 const packet=buildQuestionAuditBaseline();expect(packet.samples).toEqual([]);expect(packet.population.generated).toBe(0);
});

it('does not call a continuation-only original an eligible reference sample',()=>{
 const packet=buildQuestionAuditBaseline({banks:{'IMCQ.pdf':[q('fragment',{stem:'that is being ablated, which structure is involved?'}),q('complete')]}});
 expect(packet.population).toMatchObject({originals:2,eligibleOriginals:1,excludedOriginals:1});
 expect(packet.sampled.imcq).toBe(1);
});
