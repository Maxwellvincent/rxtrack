// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const row={id:'r',lectureId:'l',blockId:'b',objectiveId:'o',sourceVersion:'v',label:'A tested relationship',learning:{audit:{status:'approved'},explanation:'A source-grounded connection explains this result.',checkPrompt:'How does this connection predict the result?'}};
vi.mock('../shell/hooks/useStoreResource.js',()=>({useStoreResource:()=>({data:{relationships:{r:row}}})}));
import {ConnectionFeedback} from './ConnectionFeedback.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const question={lectureId:'l',blockId:'b',objectiveIds:['o'],sourceRelationshipIds:['r'],relationshipSourceVersion:'v',qualityAudit:{relationshipIds:['r']}};
it('shows only independently identified connections in the exact question scope',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<ConnectionFeedback question={question}/>));expect(host.textContent).toContain(row.learning.explanation);expect(host.querySelector('details').open).toBe(false);
 act(()=>root.render(<ConnectionFeedback question={{...question,qualityAudit:{}}}/>));expect(host.textContent).toBe('');
 act(()=>root.render(<ConnectionFeedback question={{...question,relationshipSourceVersion:'old'}}/>));expect(host.textContent).toBe('');
 act(()=>root.render(<ConnectionFeedback question={{...question,blockId:'another-block'}}/>));expect(host.textContent).toBe('');act(()=>root.unmount());
});
