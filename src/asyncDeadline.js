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
