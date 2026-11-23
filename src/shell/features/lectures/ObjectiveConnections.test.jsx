// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {ObjectiveConnections} from './ObjectiveConnections.jsx';
import {prepareObjectiveConnections} from '../../../engine/objectiveConnections.js';
import {mergeSourceRelationships} from '../../../engine/sourceRelationships.js';
const call=vi.hoisted(()=>vi.fn());
vi.mock('../../../aiClient.js',()=>({callAIJSON:call}));
const save=vi.hoisted(()=>vi.fn(async()=>({})));
vi.mock('../../../stores/sourceRelationships.js',()=>({save}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const objective={id:'o',blockId:'b',linkedLecId:'l',objective:'Compare vibration pathways and spinal laterality.'};
const quote='Dorsal columns carry vibration ipsilaterally in the spinal cord.';
const scope={blockId:'b',lectureId:'l',objectives:[objective],pages:[{page:1,text:quote}]};
const row={key:'a',objectiveId:'o',clause:'vibration pathways',label:'Spinal vibration laterality',quote,page:1,kind:'text',explanation:'The location of the pathway in the cord determines the side of the sensory loss before crossing.',checkPrompt:'How does crossing location determine the side of loss?',prerequisites:[]};
it('builds once on Learn, saves reviewed evidence, and does not count reading as an answer',async()=>{
 call.mockReset().mockResolvedValueOnce({connections:[row]}).mockResolvedValueOnce({approvedKeys:['a']});save.mockClear();
 const host=document.createElement('div'),root=createRoot(host);
 await act(async()=>root.render(<ObjectiveConnections userId="u" scope={scope} catalog={{}} evidence={{}} enabled/>));
 expect(call).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('source-supported connections saved');
 await act(async()=>root.render(<ObjectiveConnections userId="u" scope={scope} catalog={{}} evidence={{}} enabled/>));
 expect(call).toHaveBeenCalledTimes(2);act(()=>root.unmount());
});
it('keeps teaching behind a disclosure and requests an exact fresh second-order connection',async()=>{
 const catalog=mergeSourceRelationships({},await prepareObjectiveConnections(scope,vi.fn().mockResolvedValueOnce({connections:[row]}).mockResolvedValueOnce({approvedKeys:['a']})));
 const onPractice=vi.fn(),host=document.createElement('div'),root=createRoot(host);
 act(()=>root.render(<ObjectiveConnections scope={scope} catalog={catalog} evidence={{}} onPractice={onPractice}/>));
 expect(host.textContent).toContain('Explain to yourself:');expect(host.textContent).toContain('Not yet tested');
 expect([...host.querySelectorAll('details')].at(-1).open).toBe(false);
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent.includes('Practice this connection')).click());
 expect(onPractice).toHaveBeenCalledWith(expect.objectContaining({objectives:[expect.objectContaining({_targetOrder:'second-order',_connectionTargetIds:[Object.keys(catalog.relationships)[0]]})]}));act(()=>root.unmount());
});
it('shows a provider failure without repeatedly firing requests or saving an invented map',async()=>{
 call.mockReset().mockRejectedValue(Error('Provider capacity unavailable'));save.mockClear();
 const host=document.createElement('div'),root=createRoot(host);
 await act(async()=>root.render(<ObjectiveConnections scope={scope} catalog={{}} evidence={{}} enabled/>));
 expect(host.textContent).toContain('Provider capacity unavailable');expect(save).not.toHaveBeenCalled();
 await act(async()=>root.render(<ObjectiveConnections scope={scope} catalog={{}} evidence={{}} enabled/>));
 expect(call).toHaveBeenCalledTimes(1);act(()=>root.unmount());
});
