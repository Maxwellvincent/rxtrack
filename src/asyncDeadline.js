// The caller stops waiting at the deadline; fetch transports also receive an
// abort signal. Remote providers may still finish work already accepted.
export function withDeadline(run, timeoutMs, parentSignal, label = "AI request") {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); };
    const abort = () => {
      const error = parentSignal?.reason || new Error(`${label} timed out. Please retry.`);
      controller.abort(error); cleanup(); reject(error);
    };
    if (parentSignal?.aborted) { abort(); return; }
    parentSignal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, timeoutMs);
    Promise.resolve().then(() => run(controller.signal)).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
  });
}

/** Every AI stage spends the same preparation budget and receives cancellation. */
export function boundedAIAdapter(adapter,{signal,deadline,bridgeTimeoutMs=300000,onRequest,label='Question preparation'}={}) {
 if(typeof adapter!=='function')return undefined;
 return (...args)=>{
  signal?.throwIfAborted();
  const remaining=deadline-Date.now();
  if(remaining<=0)throw new Error(`${label} timed out. Please retry.`);
  const options=args[6] || {};
  const requestSignal=signal && options.signal && signal!==options.signal ? AbortSignal.any([signal,options.signal]) : signal || options.signal;
  requestSignal?.throwIfAborted();
  onRequest?.(args);
  args[6]={...options,signal:requestSignal,timeoutMs:Math.min(remaining,Number(options.timeoutMs)>0?Number(options.timeoutMs):remaining),bridgeTimeoutMs:Math.min(remaining,bridgeTimeoutMs,Number(options.bridgeTimeoutMs)>0?Number(options.bridgeTimeoutMs):bridgeTimeoutMs),throwOnError:true};
  return adapter(...args);
 };
}
