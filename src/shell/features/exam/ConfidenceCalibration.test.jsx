import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {ConfidenceCalibration} from './ConfidenceCalibration.jsx';
import {installDomStorage} from '../../../stores/testEnv.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('renders a color-independent calibration graph and trust summary',()=>{installDomStorage();const host=document.createElement('div'),root=createRoot(host);const records=[...Array(10)].map(()=>({confidence:5,correct:true}));act(()=>root.render(<ConfidenceCalibration records={records}/>));expect(host.querySelector('[role="img"]').getAttribute('aria-label')).toContain('Observed accuracy');expect(host.textContent).toContain('High-confidence accuracy');expect(host.textContent).toContain('100%');expect(host.textContent).toContain('Dashed line');act(()=>root.unmount());});
