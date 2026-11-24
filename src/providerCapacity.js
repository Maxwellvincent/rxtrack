/** Capacity failures are not malformed questions or network reconnection events. */
export function capacityKind(error) {
 const message=String(error?.message || error || '');
 if(/\b429\b|too many requests|\brate[ -]?limit(?:ed)?\b/i.test(message))return 'rate-limit';
 if(/\b402\b|usage[ -]?limit|\bquota\b.{0,24}(?:exceed|exhaust|reach|limit)|(?:exceed|exhaust|insufficient|over).{0,24}\bquota\b|credits? (?:exhaust|deplet)|insufficient.*credit|monthly cap|budget.*(?:reach|exceed)/i.test(message))return 'usage-limit';
 return null;
}
export function retryAfterMs(value,now=Date.now()) {
 if(value==null || value==='')return 60000;
 const seconds=Number(value);
 const delay=Number.isFinite(seconds) ? seconds*1000 : Date.parse(value)-now;
 return Number.isFinite(delay) && delay>0 ? Math.max(1000,delay) : 60000;
}
export function capacityError(backend,kind,delay=60000,detail='') {
 const label=backend==='codex'?'Codex':backend==='ollama-cloud'?'Ollama Cloud':'The configured AI service';
 // The local bridge enforces its own estimated spending caps. Those are not a
 // provider plan limit and are fixed by raising the bridge setting, not waiting.
 const bridgeCap=String(detail||'').match(/cloud monthly cap reached \(([^)]*)\)/i);
 const message=bridgeCap
  ? `The llm-bridge monthly cloud budget is used up (${bridgeCap[1]}). This is the bridge's own estimated cap, not your ${label} plan limit. Raise LLM_BRIDGE_CLOUD_MONTHLY_BUDGET_USD for the bridge service and restart it, or wait for the new month. Completed work remains saved.`
  : `${label} ${kind==='rate-limit'?'rate limit (HTTP 429)':'usage limit'} reached. Automatic retries are paused; try again after the provider limit resets. Reviewed questions remain saved.`;
 const error=new Error(message);
 error.code='AI_PROVIDER_CAPACITY';error.backend=backend;error.capacityKind=kind;error.retryAt=Date.now()+delay;
 return error;
}
