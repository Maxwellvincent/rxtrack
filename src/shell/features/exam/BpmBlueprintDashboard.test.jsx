import { expect, it } from 'vitest';
import { blueprintReadiness } from './BpmBlueprintDashboard.jsx';
it('summarizes recent linked evidence without presenting untested objectives as zero accuracy',()=>{
 const rows=blueprintReadiness(3,{l:[{id:'a',discipline:'ANAT'},{id:'b',discipline:'ANAT'},{id:'h',discipline:'HCB'}]},
  {objectives:{a:{attempts:20,correct:5,recent:[true,true,false,true]}}});
 expect(rows[0]).toMatchObject({accuracy:.75,practiced:1,untested:1,weak:0});
 expect(rows.find(r=>r.subject==='histology')).toMatchObject({accuracy:null,practiced:0,untested:1});
});
