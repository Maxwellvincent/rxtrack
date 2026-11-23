import {lectureCheckpointResults} from './lectureCheckpointResults.js';
export function LectureCheckpointReport({session,objectivesById={},connectionLabels={},ratings={}}){
 if(session.purpose!=='lecture-checkpoint'||session.status!=='submitted')return null;
 const result=lectureCheckpointResults(session,ratings);
 return <section aria-label="Lecture checkpoint results" className="my-4 rounded-xl border border-accent p-4">
  <h2 className="text-lg font-semibold">Independent lecture checkpoint · {result.percent==null?'No scoreable questions':`${result.percent}%`}</h2>
  <p className="mt-1 text-sm">{result.correct}/{result.total} correct · {result.unanswered} unanswered included · {result.excluded} quality exclusions</p>
  <p className="mt-1 text-xs text-text-3">Independent application evidence from this sitting. Earlier exposure outside RXTrack is unknown. A single checkpoint does not establish mastery or predict an exam score.</p>
  <h3 className="mt-3 font-semibold">Objectives to focus on</h3>
  <ul className="mt-2 space-y-2 text-sm">{result.objectives.map(row=><li key={row.id}>{objectivesById[row.id]?.objective||objectivesById[row.id]?.text||'Objective link unavailable'} · {row.percent}% ({row.correct}/{row.total})</li>)}</ul>
  {!!result.connections.length&&<><h3 className="mt-3 font-semibold">Tested connections</h3><ul className="mt-2 space-y-1 text-sm">{result.connections.map(row=><li key={row.id}>{connectionLabels[row.id]||'Verified lecture connection'} · {row.percent}% ({row.correct}/{row.total}){row.correct<row.total?' · revisit this connection':''}</li>)}</ul></>}
  <p className="mt-2 text-xs text-text-3">Only tested objectives and connections are scored. Linked rows overlap and should not be added together.</p>
 </section>;
}
