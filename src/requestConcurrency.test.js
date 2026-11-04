import {it,expect,vi} from 'vitest';
import {createRequestGate} from './requestConcurrency.js';
it('shares a ceiling across draft and both independent reviews',async()=>{
 const gate=createRequestGate(3),releases=[];let active=0,peak=0;
 const work=Array.from({length:8},()=>gate(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;}));
 await Promise.resolve();expect(releases).toHaveLength(3);
 while(releases.length || active){releases.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setTimeout(resolve,0));}
 await Promise.all(work);expect(peak).toBe(3);
});
it('cancels queued work before it reaches a provider',async()=>{
 const gate=createRequestGate(1);let release;
 const first=gate(()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 const controller=new AbortController(),run=vi.fn();
 const queued=gate(run,controller.signal);const rejected=expect(queued).rejects.toThrow('Stopped');controller.abort(new Error('Stopped'));
 await rejected;release();await first;expect(run).not.toHaveBeenCalled();
});
