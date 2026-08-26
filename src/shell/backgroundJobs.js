let jobs = [];
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());
const update = (id, patch) => {
  jobs = jobs.map((job) => job.id === id ? { ...job, ...patch, updatedAt: Date.now() } : job);
  emit();
};

export function startBackgroundJob({ label, detail = "", run }) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  jobs = [{ id, label, detail, status: "running", startedAt: Date.now(), updatedAt: Date.now() }, ...jobs].slice(0, 8);
  emit();
  Promise.resolve().then(async () => {
    try {
      const result = await run((nextDetail) => update(id, { detail: nextDetail }));
      update(id, { status: "done", detail: result || "Processing complete." });
    } catch (e) {
      update(id, { status: "error", detail: e?.message || String(e) });
    }
  });
  return id;
}

export function readBackgroundJobs() { return jobs; }
export function subscribeBackgroundJobs(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function dismissBackgroundJob(id) { jobs = jobs.filter((job) => job.id !== id); emit(); }
