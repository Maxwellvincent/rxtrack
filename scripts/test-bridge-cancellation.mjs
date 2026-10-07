import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
let closed=0, generated=0;
const fake=createServer((req,res)=>{
 if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'qwen2.5:7b'}]}));return;}
 generated++;let data='';req.on('data',b=>data+=b);req.on('end',()=>{const body=JSON.parse(data);if(body.prompt.includes('fast-check')){res.end(JSON.stringify({response:'ok'}));return;}res.on('close',()=>{if(!res.writableEnded)closed++;});});
});
await new Promise(resolve=>fake.listen(4327,'127.0.0.1',resolve));
const bridge=spawn(process.execPath,[new URL('../../llm-bridge/server.mjs', import.meta.url).pathname],{env:{...process.env,PORT:'4328',OLLAMA_HOST:'http://127.0.0.1:4327',LLM_BRIDGE_BACKENDS:'ollama,missing',LLM_BRIDGE_LOG:'/tmp/rxtrack-cancellation-test.log'},stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 for(let n=0;n<50;n++){try{if((await fetch('http://127.0.0.1:4328/health')).ok)break;}catch{}await pause(50);}
 const deadline=await fetch('http://127.0.0.1:4328/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'deadline-test',timeoutMs:120})});
 assert.equal(deadline.status,504);await pause(100);assert.equal(closed,1);
 const ctrl=new AbortController();const request=fetch('http://127.0.0.1:4328/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'disconnect-test'}),signal:ctrl.signal});
 await pause(150);ctrl.abort();await request.catch(()=>{});await pause(150);assert.equal(closed,2);
 const success=await fetch('http://127.0.0.1:4328/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'fast-check'})});assert.equal((await success.json()).text,'ok');assert.equal(generated,3);
 console.log('PASS: deadline and client disconnect close model requests; next request succeeds.');
}finally{bridge.kill('SIGTERM');fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));}
