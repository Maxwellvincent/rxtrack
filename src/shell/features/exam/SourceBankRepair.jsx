import { useState } from 'react';
import { fetchQuestionBankSourceBytes, updateExamSessionTransaction } from '../../../supabase.js';
import * as bankMeta from '../../../stores/questionBankMeta.js';
import * as banks from '../../../stores/questionBanks.js';
import { repairSessionSource } from './repairSessionSource.js';

export function SourceBankRepair({session,userId,onRepaired}) {
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 if(session.sourceType!=='question-bank')return null;
 async function repair(){
  setBusy(true);setNotice('');
  let pdf;
  try {
   const entry=Object.values(bankMeta.read(userId)||{}).find(m=>m.filename===session.sourceFile || m.aliases?.includes(session.sourceFile));
   if(!entry?.sourceStoragePath)throw Error('Original PDF is not available in your account. Re-upload it to repair source choices.');
   const bytes=await fetchQuestionBankSourceBytes(entry.sourceStoragePath);
   if(!bytes)throw Error('Original PDF could not be loaded. Your answers are unchanged.');
   const {loadPDFJS,pdfItemsToLayoutText,parseNumberedQuestionBankText}=await import('../../../examParser.js');
   await loadPDFJS();pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
   const pages=[];
   for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n);const content=await page.getTextContent();pages.push(pdfItemsToLayoutText(content.items));
   }
   const originals=parseNumberedQuestionBankText(pages.join('\f'),session.sourceFile);
   if(!originals.length)throw Error('The original layout could not be verified. No questions changed.');
   const result=await updateExamSessionTransaction(userId,session.sessionId,current=>current?.status==='in_progress'?repairSessionSource(current,originals):null);
   if(!result || result.status!=='in_progress')throw Error('This session is no longer editable.');
   const current=banks.read(userId);const source=current?.[session.sourceFile];
   if(Array.isArray(source)){
    const repaired=repairSessionSource({questions:source,answers:[]},originals);
    await banks.writeAwait(userId,{...current,[session.sourceFile]:repaired.questions});
   }
   await onRepaired?.();
   setNotice(`Original PDF checked · ${result.sourceRepairCount || 0} questions reconciled. Answer identities preserved; conflicting source keys are held from scoring.`);
  }catch(error){setNotice(error.message || 'Source repair failed.');await onRepaired?.();}
  finally{pdf?.destroy?.();setBusy(false);}
 }
 return <details className="rounded border border-border p-3 text-sm"><summary className="cursor-pointer">Missing choices or conflicting key?</summary><p className="mt-2 text-text-2">Re-read the saved original PDF locally to restore source choices in this bank and session. Existing picks keep their option meaning. No AI call is used.</p><button type="button" disabled={busy} onClick={repair} className="mt-2 rounded border border-border px-3 py-2">{busy?'Checking original PDF…':'Repair from original PDF'}</button>{notice&&<p role="status" className="mt-2">{notice}</p>}</details>;
}
