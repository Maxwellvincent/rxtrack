const entries=new Map();const key=(userId,blockId)=>JSON.stringify([userId,blockId]);
const MAX_AGE=10000;
export function invalidateSessionReads({userId,blockId}={}){
 for(const [id,e] of entries)if((!userId||e.userId===userId)&&(!blockId||e.blockId===blockId))entries.delete(id);
}
/** Share a short-lived read and in-flight request; never share across accounts/blocks. */
export function readSessionHistory(userId,blockId,load){
 const id=key(userId,blockId),old=entries.get(id);
 if(old?.pending)return old.pending;
 if(old&&Date.now()-old.at<MAX_AGE)return Promise.resolve(old.rows);
 // Bound inactive account/block entries, while preserving active in-flight requests.
 for(const [k,e] of entries)if(!e.pending&&Date.now()-e.at>300000)entries.delete(k);
 const entry={userId,blockId,at:0,rows:null,pending:null};entries.set(id,entry);
 entry.pending=Promise.resolve().then(()=>load(userId,blockId)).then(rows=>{entry.rows=rows;entry.at=Date.now();return rows;}).catch(error=>{if(entries.get(id)===entry)entries.delete(id);throw error;}).finally(()=>{entry.pending=null;});
 return entry.pending;
}
