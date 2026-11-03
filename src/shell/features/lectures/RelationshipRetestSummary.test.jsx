// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {RelationshipRetestSummary} from './RelationshipRetestSummary.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('keeps unknown and figure-only inventories out of the summary',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 for(const props of [{rows:[]},{rows:[{kind:'figure'}]},{loading:true,rows:[{kind:'text'}]},{error:new Error('offline'),rows:[{kind:'text'}]}]){
  act(()=>root.render(<RelationshipRetestSummary {...props}/>));expect(host.textContent).toBe('');
 }
 act(()=>root.unmount());
});
it('shows due and repair counts without calling them mastery or predictions',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<RelationshipRetestSummary rows={[{kind:'text',practiceState:'due',delayedApplicationCorrect:1},{kind:'text',practiceState:'repair',delayedApplicationCorrect:0},{kind:'figure',practiceState:'due'}]}/>));
 expect(host.textContent).toContain('1 due · 1 to repair');expect(host.textContent).toContain('1/2 registered relationships');
 expect(host.textContent).toContain('does not establish mastery');act(()=>root.unmount());
});
