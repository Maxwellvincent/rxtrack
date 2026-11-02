import {it,expect,vi} from 'vitest';import {installDomStorage} from './testEnv.js';import {writeJson} from './base.js';import {read,key} from './learnerEvidence.js';
it('does not invent a current timestamp while projecting legacy evidence without a date',()=>{
 installDomStorage();writeJson(null,key,{evidenceJournal:[{questionKey:'q',correct:true,objectiveIds:['o'],lectureId:'l'}]});
 vi.useFakeTimers();try{vi.setSystemTime(1000);const first=read(null);vi.setSystemTime(5000);expect(read(null)).toEqual(first);expect(first.objectives.o.lastSeen).toBe(0);}finally{vi.useRealTimers();}
});
