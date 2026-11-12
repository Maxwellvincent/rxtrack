import {act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi,beforeEach,afterEach} from 'vitest';import {installDomStorage} from '../stores/testEnv.js';import {HelpMeReason} from './HelpMeReason.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root,host;
beforeEach(()=>{installDomStorage();host=document.createElement('div');document.body.append(host);root=createRoot(host);});afterEach(()=>{act(()=>root.unmount());host.remove();});
const click=async text=>{await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text).click());};
it('saves assistance before opening and offers a next step without forcing a guess',async()=>{
 const onAssist=vi.fn(async()=>{}),onState=vi.fn(),request=vi.fn(async()=>({feedback:'Start with the crossing level.',hint:'Separate face from body.',question:'Where does the body pathway first cross?'}));
 act(()=>root.render(<HelpMeReason question={{stem:'Which site?'}} onAssist={onAssist} onState={onState} request={request}/>));
 expect(host.querySelector('textarea')).toBeNull();await click('Help Me Reason');expect(onAssist).toHaveBeenCalledTimes(1);expect(request).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Assisted practice');await click('Show next step');expect(request.mock.calls[0][0].action).toBe('next-step');expect(onState).toHaveBeenCalled();expect(host.textContent).toContain('Where does the body pathway first cross?');
});
it('does not display coaching when the assistance marker could not be saved',async()=>{
 act(()=>root.render(<HelpMeReason question={{}} onAssist={async()=>{throw Error('Save unavailable');}}/>));await click('Help Me Reason');expect(host.querySelector('textarea')).toBeNull();expect(host.querySelector('[role="alert"]').textContent).toContain('Save unavailable');
});
it('aborts stale question work on unmount and restores earlier turns on return',async()=>{
 let finish;const request=vi.fn(()=>new Promise(r=>{finish=r;}));
 act(()=>root.render(<HelpMeReason initialState={{turns:[{role:'learner',text:'I know the body crossing.'}]}} question={{}} request={request}/>));await click('Help Me Reason');expect(host.textContent).toContain('I know the body crossing.');
 await click('Show next step');const signal=request.mock.calls[0][0].signal;act(()=>root.unmount());expect(signal.aborted).toBe(true);finish({feedback:'Old response',question:'Why?'});root=createRoot(host);
});
it('does not wait indefinitely for an unsaved assistance marker',async()=>{
 vi.useFakeTimers();
 try{
  act(()=>root.render(<HelpMeReason question={{}} onAssist={()=>new Promise(()=>{})}/>));
  await click('Help Me Reason');await act(async()=>vi.advanceTimersByTimeAsync(15001));
  expect(host.querySelector('[role="alert"]').textContent).toContain('timed out');expect(host.querySelector('textarea')).toBeNull();
 }finally{vi.useRealTimers();}
});
