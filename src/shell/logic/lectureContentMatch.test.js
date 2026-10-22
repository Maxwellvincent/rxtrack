import {it,expect} from 'vitest';
import {linkSourceLecture} from '../features/exam/questionBankLinks.js';
import {rankLectureContent} from './lectureContentMatch.js';
const question={sourceFile:'Week 10 Practice Questions.pdf',sourceSectionTitle:'Eye anatomy and ocular movements',stem:'A man has double vision, cannot adduct his left eye and lacks a corneal reflex. Where is the lesion?',choices:{A:'Superior orbital fissure',B:'Foramen ovale'},correct:'A'};
const lectures=[
 {id:'skull',blockId:'NB',weekNumber:8,lectureTitle:'General Concepts of Cranial Nerves and Relationship to Skull',chunks:[{text:'The superior orbital fissure transmits cranial nerves III, IV, V1 and VI.'}]},
 {id:'eye',blockId:'NB',weekNumber:10,lectureTitle:'Gross Anatomy and Development of the Eye',chunks:[{text:'The eye: double vision and inability to adduct implicate medial rectus and the oculomotor nerve. The corneal reflex involves the ophthalmic nerve. These nerves enter the superior orbital fissure.'}]}
];
it('prefers the teaching domain supported by ocular findings, section and source-file week',()=>{
 const result=linkSourceLecture(question,lectures,'NB');
 expect(result.lectureId).toBe('eye');
 expect(result.lectureLinkBasis).toBe('teaching-context-and-content');
 expect(result.curriculumMapping.sourceContext.weekNumber).toBe(10);
 expect(result.objectiveIds).toBeUndefined();
 expect(rankLectureContent(question,lectures,'NB').map(r=>r.lecture.id)).toContain('skull');
});
it('recognizes ocular findings without a helpful section heading',()=>{
 expect(linkSourceLecture({...question,sourceSectionTitle:null},lectures,'NB').lectureId).toBe('eye');
});
it('does not map from the eye heading, schedule, or distractor alone without teaching evidence',()=>{
 const vague={...question,stem:'Which structure is affected?',choices:{A:'A structure',B:'The eye'}};
 expect(linkSourceLecture(vague,lectures,'NB').lectureId).toBeUndefined();
 const empty=lectures.map(l=>({...l,chunks:[]}));
 expect(linkSourceLecture({...question,sourceSectionTitle:null},empty,'NB').lectureId).toBeUndefined();
});
it('preserves confirmed mappings and never crosses the selected block',()=>{
 expect(linkSourceLecture({...question,lectureId:'skull',curriculumLinkStatus:'user-confirmed'},lectures,'NB').lectureId).toBe('skull');
 expect(linkSourceLecture(question,lectures,'ER').lectureId).toBeUndefined();
});
it('does not treat an orbital-fissure recall question as an eye examination case',()=>{
 const rows=rankLectureContent({stem:'Which nerves pass through the superior orbital fissure?',choices:{A:'III IV V1 VI'},correct:'A'},lectures,'NB');
 expect(rows.every(row=>!row.contextualEvidence.includes('ocular-findings-and-lecture-content'))).toBe(true);
});
