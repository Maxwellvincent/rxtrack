import { useState } from 'react';
import { useQuestionBanks } from '../../hooks/useQuestionBanks.js';
import { useQuestionBankMeta } from '../../hooks/useQuestionBankMeta.js';
import { useObjectives } from '../../hooks/useObjectives.js';
import { useStoreResource } from '../../hooks/useStoreResource.js';
import { selectBlockObjectives } from '../../logic/objectives.js';
import { alignSchoolQuestions } from '../../../engine/schoolAlignment.js';
import { compareSchoolResults, validateSchoolResult } from '../../../engine/examComparison.js';
import * as schoolResults from '../../../stores/schoolResults.js';

export function SchoolAlignmentPanel({ blockId, userId, sessions = [], historyReady = true }) {
  const banks=useQuestionBanks(userId),meta=useQuestionBankMeta(userId),objectiveData=useObjectives(null,userId);
  const results=useStoreResource(schoolResults,userId);
  const [message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const objectives=selectBlockObjectives(objectiveData.data,blockId);
  const files=new Set(Object.values(meta.data || {}).filter(x=>x.blockId===blockId).map(x=>x.filename));
  const examples=Object.entries(banks.data || {}).flatMap(([name,qs])=>files.has(name)?qs:qs.filter(q=>q.blockId===blockId));
  const links=alignSchoolQuestions(examples,objectives);
  const covered=new Set(links.flatMap(x=>x.links.filter(l=>l.basis==='school-code').map(l=>l.targetId)));
  const objectiveIds=new Set(objectives.map(o=>o.id || o.code || o.objective || o.text));
  const comparison=compareSchoolResults(blockId,sessions,Object.values(results.data || {}));
  const loading=banks.loading || meta.loading || objectiveData.loading;
  async function save(e) {
    e.preventDefault();const form=e.currentTarget, data=new FormData(form);
    const record={blockId,name:String(data.get('name')).trim(),date:String(data.get('date')),kind:String(data.get('kind')),percent:Number(data.get('percent'))};
    if(!validateSchoolResult(record)){setMessage('Enter a result name, date, type and percentage from 0 to 100.');return;}
    setSaving(true);setMessage('');
    try {const id=encodeURIComponent(`${blockId}:${record.kind}:${record.date}:${record.name.toLowerCase()}`);
      await results.mutate({...results.data,[id]:{...record,id,source:'manually-entered school report'}});
      setMessage('School result saved. The same name, date and type updates this result.');form.reset();
    } catch {setMessage('Could not confirm the save. Please retry.');} finally {setSaving(false);}
  }
  return <details className="mt-4 rounded-lg border border-border p-3 text-sm">
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">School alignment & exam comparison</summary>
    <p>{loading?'Mapping synced sources…':`${covered.size} of ${objectiveIds.size} objectives have matching school-code annotations across ${examples.length} source questions.`}</p>
    {(banks.error || meta.error || objectiveData.error) && <p role="alert">Some sources could not sync; coverage may be incomplete.</p>}
    <p className="mt-2 text-text-2">Observed sample coverage—not predicted exam coverage. Unmatched objectives still matter. Similar wording is a candidate link, not proof.</p>
    <details className="my-2"><summary className="cursor-pointer py-2">Inspect question-to-objective evidence</summary>
      <ul className="max-h-64 space-y-3 overflow-y-auto">{links.filter(x=>x.links.length).map(({question:q,links:ls},i)=><li key={`${q.sourceFile}:${q.id}:${i}`}>
        <strong>{q.sourceFile || 'School bank'} · Q{q.num || q.id}</strong>
        {ls.slice(0,3).map((l,j)=><p key={j}>{l.basis==='school-code'?'School-code annotation':'Candidate wording overlap'}: {l.targetText} · Evidence: {l.evidence.join(', ')}</p>)}
      </li>)}</ul>
    </details>
    <h4 className="mt-4 font-semibold">Does practice transfer to school results?</h4>
    <p className="my-2">No validated exam-score prediction yet. Compare each actual school result with the preceding seven days of submitted, medium-difficulty timed generated practice. Repeated stems, IMCQs, original banks and unknown difficulty are excluded. Freshness is checked against recorded sessions only—not all prior exposure.</p>
    {!historyReady ? <p>Waiting for complete exam-session history before comparing.</p> : comparison.pairs.map(r=><p key={r.id} className="my-2 rounded border border-border p-2">
      {r.date} · {r.name} ({r.kind}): {r.percent}% school result · {r.practiceAccuracy==null?'No comparable timed practice recorded':`${(r.practiceAccuracy*100).toFixed(1)}% prior practice (${r.practiceCount} questions); school minus practice: ${r.gap.toFixed(1)} percentage points`}.
    </p>)}
    <p className="my-2 text-text-2">One pair cannot establish prediction. Difficulty, objective coverage, exam format and prior exposure still differ. Your 74% target is a benchmark, not a pass guarantee.</p>
    <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
      <label>School result name<input required name="name" maxLength={100} className="block w-full rounded border border-border bg-bg p-2" placeholder="ER block exam" /></label>
      <label>Exam or quiz date<input required type="date" name="date" className="block w-full rounded border border-border bg-bg p-2" /></label>
      <label>Result type<select name="kind" className="block w-full rounded border border-border bg-bg p-2"><option value="exam">School exam</option><option value="quiz">School quiz</option></select></label>
      <label>Actual percentage<input required type="number" min="0" max="100" step="0.01" name="percent" className="block w-full rounded border border-border bg-bg p-2" /></label>
      <button disabled={!userId || saving || results.loading || !!results.error} className="min-h-11 rounded border border-border px-3">{saving?'Saving…':'Save school result'}</button>
    </form>
    {results.error && <p role="alert">School results could not sync. Saving is disabled to protect existing records.</p>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </details>;
}
