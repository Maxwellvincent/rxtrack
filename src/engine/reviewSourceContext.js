/** The account's exact block identity determines scope; filenames never do. */
export function reviewModuleForBlock(terms,blockId){
 const queue=Array.isArray(terms)?[...terms]:[terms];let scanned=0;
 while(queue.length&&scanned++<10000){const value=queue.shift();if(!value||typeof value!=='object')continue;
  if(value.id===blockId){const name=String(value.name || value.title || '').toUpperCase().replace(/[\s_-]+/g,'');return name==='NB2'?'NB2':null;}
  for(const child of Object.values(value))if(child&&typeof child==='object')queue.push(...(Array.isArray(child)?child:[child]));
 }return null;
}
export {reviewInfluencePrompt as reviewSourcePrompt} from '../../functions/review-sources.mjs';
export async function attachReviewSources(cfg){
 if(!cfg.userId||!cfg.blockId||cfg.reviewSourceContext!==undefined)return cfg;
 try{const terms=await import('../stores/terms.js');const module=reviewModuleForBlock(terms.read(cfg.userId),cfg.blockId);if(!module)return cfg;
  const store=await import('../stores/reviewLibrary.js');return {...cfg,reviewSourceContext:await store.loadReviewContext(cfg.userId,cfg.blockId,{module,subject:cfg.subject,objectives:(cfg.objectives || []).filter(Boolean)})};
 }catch(error){throw new Error(`NB2 review sources could not sync: ${error.message}`);}
}
