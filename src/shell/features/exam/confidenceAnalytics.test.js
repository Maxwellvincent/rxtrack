import {describe,it,expect} from 'vitest';
import {confidenceAnalytics,confidenceTrustMessage} from './confidenceAnalytics.js';
describe('longitudinal confidence calibration',()=>{
 it('reports observed accuracy by confidence and high-confidence reliability',()=>{const records=[...Array(9)].map((_,i)=>({confidence:5,correct:i<8})).concat([{confidence:4,correct:true},{confidence:2,correct:false}]);const out=confidenceAnalytics(records);expect(out.curve[4]).toMatchObject({label:'Certain',count:9,accuracy:8/9});expect(out.highCount).toBe(10);expect(out.highAccuracy).toBe(0.9);expect(out.landmines).toBe(1);expect(confidenceTrustMessage(out)).toContain('reliable');});
 it('withholds trust claims when the sample is small and ignores invalid records',()=>{const out=confidenceAnalytics([{confidence:5,correct:true},{confidence:null,correct:true},{confidence:3}]);expect(out.total).toBe(1);expect(confidenceTrustMessage(out)).toContain('10+');});
 it('compares recent and prior windows',()=>{const records=[...Array(50)].map(()=>({confidence:5,correct:false})).concat([...Array(50)].map(()=>({confidence:5,correct:true})));const out=confidenceAnalytics(records);expect(out.priorHighAccuracy).toBe(0);expect(out.recentHighAccuracy).toBe(1);});
});
