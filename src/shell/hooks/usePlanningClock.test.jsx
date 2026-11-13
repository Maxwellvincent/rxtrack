// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {usePlanningClock} from './usePlanningClock.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('updates due-time projections in an open app and releases the shared clock',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
 function View(){return <span>{usePlanningClock()}</span>;}
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<><View/><View/></>));const before=host.querySelector('span').textContent;
 act(()=>vi.advanceTimersByTime(60000));expect(Number(host.querySelector('span').textContent)).toBe(Number(before)+60000);
 expect(host.querySelectorAll('span')[0].textContent).toBe(host.querySelectorAll('span')[1].textContent);
 act(()=>root.unmount());expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();
});
