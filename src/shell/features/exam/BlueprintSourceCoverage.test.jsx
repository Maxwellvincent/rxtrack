import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {installDomStorage} from '../../../stores/testEnv.js';
import {SourceCoverageView} from './BlueprintSourceCoverage.jsx';
import {buildBlueprintSourceCoverage} from './blueprintSourceCoverage.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('shows source percentages, missing figures, and per-file details without scoring any attempts',()=>{
 installDomStorage();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const coverage=buildBlueprintSourceCoverage({banks:[{filename:'NB ESoft.pdf',questions:[{stem:'A figure is shown below. Which structure?',schoolObjectiveCode:'SOM.BPM2.ANAT.1',choices:{A:'One',B:'Two'},correct:'A'}]}]});
 act(()=>root.render(<SourceCoverageView exam={3} coverage={coverage}/>));
 expect(host.textContent).toContain('1 distinct imported questions');
 expect(host.textContent).toContain('1 missing required figures');
 expect(host.querySelector('table').textContent).toContain('ExamSoft / ESoft');
 expect(host.textContent).toContain('NB ESoft.pdf');
 expect(host.textContent).toContain('0 usable items');
 expect(host.querySelector('[role="img"]').getAttribute('aria-label')).toContain('observed 100 percent');
 act(()=>root.unmount());host.remove();
});
