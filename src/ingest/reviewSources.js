import {loadPDFJS} from '../examParser.js';
import {classifyReviewPage} from '../../functions/review-page-classification.mjs';

export function readableReviewText(text){
 const s=String(text||'');
 return s.trim().length>=70 && !Array.from(s).some(c=>c.charCodeAt(0)<9||(c.charCodeAt(0)>13&&c.charCodeAt(0)<32)) && (s.match(/\b(the|and|of|to|is|in|with|for|from|nerve|lesion|motor|sensory|blood)\b/gi)||[]).length>=2;
}
export async function extractReviewFile(file,onProgress=()=>{},existing=[]){
 if(!file||file.size>20_000_000)throw new Error('Choose a review file smaller than 20 MB.');
 const bytes=await file.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const saved=existing.find(p=>p.sourceVersion===hash);if(saved)return {alreadySaved:true,name:saved.name};
 const id='review-'+hash.slice(0,24);let pages=[];
 if(/\.pdf$/i.test(file.name)){
  // Reuse the exact-content local OCR index when available, never a filename match.
  const {bridgeReviewLibrary}=await import('../llmBridge.js');
  const indexed=await bridgeReviewLibrary().catch(()=>null);
  const known=indexed?.packs?.find(p=>p.sourceVersion===hash);
  if(known)return {...known,name:file.name};
  await loadPDFJS();const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;
  try{
   if(pdf.numPages>1000)throw new Error('Choose a PDF with at most 1,000 pages.');
   for(let i=1;i<=pdf.numPages;i++){
    onProgress(`Reading ${file.name} · page ${i}/${pdf.numPages}`);
    const page=await pdf.getPage(i),content=await page.getTextContent();
    pages.push({page:i,text:content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('').trim(),method:'pdfjs-native',confidence:1});page.cleanup?.();
   }
  }finally{await pdf.destroy?.();}
  if(pages.some(p=>p.text.length>70&&!readableReviewText(p.text))||!pages.some(p=>readableReviewText(p.text))){
   onProgress(`Reading ${file.name} with local OCR…`);
   const {bridgeReviewPdf}=await import('../llmBridge.js');
   pages=await bridgeReviewPdf(bytes);
  }
 }else if(/\.(md|txt)$/i.test(file.name)){
  const text=new TextDecoder().decode(bytes);let n=0;
  for(const part of text.split(/\f|\n\s*---\s*\n/))for(let start=0;start<part.length;start+=3500)pages.push({page:++n,text:part.slice(start,start+3500),method:'text',confidence:1});
 }else throw new Error('Choose a PDF, Markdown, or text review file.');
 const units=pages.flatMap(p=>{const classification={...classifyReviewPage(p),...(readableReviewText(p.text)?{}:{held:true,holdReason:'unreadable-or-insufficient-text'})};const parts=[];for(let i=0;i<Math.max(1,p.text.length);i+=3500)parts.push({...p,text:p.text.slice(i,i+3500),id:`${id}-p${p.page}-${i/3500}`,...classification});return parts;});
 if(!units.some(u=>!u.held))throw new Error('No readable review text was found. Add a searchable PDF or OCR text export; no source or answer was guessed.');
 return {id,module:'NB2',sourceVersion:hash,name:file.name,units};
}
