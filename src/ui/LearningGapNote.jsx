import { useState } from "react";
import { recordLearningNote } from "../stores/learnerEvidence.js";
export function LearningGapNote({userId,question,blockId,lectureId}) {
 const [note,setNote]=useState(""); const [saved,setSaved]=useState(false);
 const [saving,setSaving]=useState(false); const [error,setError]=useState("");
 if(!question.objectiveIds?.length)return null;
 return <details className="mt-2 rounded border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">Save a sticking point · optional</summary>
 <label className="mt-2 block">What distinction confused you?<textarea maxLength={600} value={note} onChange={e=>{setNote(e.target.value);setSaved(false);}} className="mt-1 block w-full rounded border border-border bg-bg p-2" placeholder="For example: I confuse which nerve uses each opening." /></label>
 <button type="button" disabled={!note.trim() || saving} onClick={async()=>{setSaving(true);setError("");try {await recordLearningNote(userId,{note,blockId,lectureId,objectiveIds:question.objectiveIds,questionKey:question.questionKey || question.poolId || question.id || question.questionId || `stem:${question.stem}`},{persistAwait:true});setSaved(true);}catch{setSaved(false);setError("Could not confirm this learning point was saved. Keep your text and retry when connected.");}finally{setSaving(false);}}} className="mt-2 rounded border border-accent px-3 py-2 disabled:opacity-40">Save learning point</button>
 {error && <p role="alert" className="mt-2">{error}</p>}
 {saved && <p role="status" className="mt-2">Learning point saved for future questions on these objectives.</p>}
 </details>;
}
