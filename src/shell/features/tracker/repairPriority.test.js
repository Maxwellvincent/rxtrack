import { expect, it } from "vitest";
import { buildLectureRows } from "./lectureRows.js";
it("ranks distinct unresolved atom flags, not total misses or objective counts",()=>{
 const scores=[{lec:{id:"a"},total:0,urgency:8},{lec:{id:"b"},total:0,urgency:1},{lec:{id:"c"},total:0,urgency:10}];
 const atomProgress={a:{x:{status:"needs-review",missCount:9}},b:{x:{status:"needs-review"},y:{status:"needs-review"}},c:{x:{status:"complete"}}};
 const rows=buildLectureRows(scores,{filter:"repairs",sort:"repairs",atomProgress});
 expect(rows.map(r=>[r.lectureId,r.repairCount])).toEqual([["b",2],["a",1]]);
});
