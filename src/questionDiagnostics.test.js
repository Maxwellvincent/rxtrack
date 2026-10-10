import { it, expect, vi } from 'vitest';
import { sanitizeQuestionDiagnostics, saveQuestionDiagnostics, readQuestionDiagnostics } from './questionDiagnostics.js';
it('retains only bounded timing and count metadata, never model or lecture content', () => {
 const report=sanitizeQuestionDiagnostics({requested:15,accepted:3,prompt:'lecture-private',calls:Array.from({length:80},()=>({stage:'review',provider:'codex',response:'private answer',status:'complete',durationMs:3})),rejections:{unsupported_fact:2,'private sentence here':1}});
 expect(report.calls).toHaveLength(60);
 expect(JSON.stringify(report)).not.toContain('private');
 expect(report.rejections).toEqual({unsupported_fact:2});
});
it('limits saved session reports to ten and tolerates full storage', () => {
 let text='{}'; vi.stubGlobal('sessionStorage',{getItem:()=>text,setItem:(_key,value)=>{text=value}});
 for(let i=0;i<12;i++)saveQuestionDiagnostics('u',String(i),{requested:15});
 expect(Object.keys(JSON.parse(text))).toHaveLength(10);
 expect(readQuestionDiagnostics('u','0')).toBeNull();
 expect(readQuestionDiagnostics('u','11').requested).toBe(15);
 vi.stubGlobal('sessionStorage',{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('full')}});
 expect(()=>saveQuestionDiagnostics('u','l',{})).not.toThrow();
 vi.unstubAllGlobals();
});
