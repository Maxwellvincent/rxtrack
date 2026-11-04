// One shared gate for draft, blind-solve, review and repair calls in a run.
// Queued work is cancellable and acquires no provider slot after cancellation.
export function createRequestGate(limit = 3) {
  let active = 0;
  const queue = [];
  const drain = () => {
    const ceiling = Math.max(1, Number(typeof limit === "function" ? limit() : limit) || 1);
    while (active < ceiling && queue.length) {
      const item = queue.shift();
      item.signal?.removeEventListener("abort", item.abort);
      if (item.signal?.aborted) { item.reject(item.signal.reason || new Error("Request cancelled")); continue; }
      active += 1;
      Promise.resolve().then(item.run).then(item.resolve, item.reject).finally(() => { active -= 1; drain(); });
    }
  };
  return (run, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new Error("Request cancelled")); return; }
    const item = { run, signal, resolve, reject };
    item.abort = () => { const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1); reject(signal.reason || new Error("Request cancelled")); };
    signal?.addEventListener("abort", item.abort, { once: true });
    queue.push(item);
    drain();
  });
}
