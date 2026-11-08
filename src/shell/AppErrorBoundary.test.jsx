import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';import {installDomStorage} from '../stores/testEnv.js';import {AppErrorBoundary} from './AppErrorBoundary.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows a recoverable error instead of leaving the root blank and does not clear study data',()=>{
 installDomStorage();localStorage.setItem('study-sentinel','keep');const host=document.createElement('div'),root=createRoot(host),reload=vi.fn(),log=vi.spyOn(console,'error').mockImplementation(()=>{});function Broken(){throw new Error('display failed');}
 try{act(()=>root.render(<AppErrorBoundary onReload={reload}><Broken/></AppErrorBoundary>));expect(host.querySelector('[role="alert"]').textContent).toContain('Reload the app');act(()=>host.querySelector('button').click());expect(reload).toHaveBeenCalledOnce();expect(localStorage.getItem('study-sentinel')).toBe('keep');}finally{act(()=>root.unmount());log.mockRestore();}
});
