import {it,expect,vi} from 'vitest';import {subscribeExamSessionChanges,notifyExamSessionChange,sessionPublicationChanged} from './examSessionChanges.js';
it('publishes saved checkpoints and completed attempts but not private answer autosaves',()=>{
 const current={status:'in_progress',progressSavedAt:1,answers:[]};
 expect(sessionPublicationChanged(current,{...current,answers:[{questionId:'q',value:'A'}]})).toBe(false);
 expect(sessionPublicationChanged(current,{...current,progressSavedAt:2})).toBe(true);
 expect(sessionPublicationChanged(current,{...current,status:'submitted'})).toBe(true);
 expect(sessionPublicationChanged(current,null)).toBe(false);
});
it('notifies mounted views, isolates listener errors and unsubscribes cleanly',()=>{
 const called=vi.fn(),offBad=subscribeExamSessionChanges(()=>{throw Error('closed view');}),off=subscribeExamSessionChanges(called);notifyExamSessionChange({userId:'u',blockId:'b'});expect(called).toHaveBeenCalledTimes(1);off();offBad();notifyExamSessionChange({userId:'u'});expect(called).toHaveBeenCalledTimes(1);
});
