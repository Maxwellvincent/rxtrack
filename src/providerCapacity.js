/** Capacity failures are not malformed questions or network reconnection events. */
export function capacityKind(error) {
 const message=String(error?.message || error || '');
 if(/\b429\b|too many requests|rate[ -]?limit/i.test(message))return 'rate-limit';
 if(/\b402\b|usage[ -]?limit|quota|credits? (?:exhaust|deplet)|insufficient.*credit|monthly cap|budget.*(?:reach|exceed)/i.test(message))return 'usage-limit';
 return null;
}
export function retryAfterMs(value,now=Date.now()) {
 if(value==null || value==='')return 60000;
 const seconds=Number(value);
 const delay=Number.isFinite(seconds) ? seconds*1000 : Date.parse(value)-now;
 return Number.isFinite(delay) && delay>0 ? Math.max(1000,delay) : 60000;
}
export function capacityError(backend,kind,delay=60000) {
 const label=backend==='codex'?'Codex':backend==='ollama-cloud'?'Ollama Cloud':'The configured AI service';
 const error=new Error(`${label} ${kind==='rate-limit'?'rate limit (HTTP 429)':'usage limit'} reached. Automatic retries are paused; try again after the provider limit resets. Reviewed questions remain saved.`);
 error.code='AI_PROVIDER_CAPACITY';error.backend=backend;error.capacityKind=kind;error.retryAt=Date.now()+delay;
 return error;
}
