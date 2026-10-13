// Jobs belong to the open app, not the lecture component. Navigation only
// detaches the view; explicit Stop and the shared deadline cancel the work.
const jobs = new Map();
export const preparationJobKey = (userId, lectureId) => JSON.stringify([userId, lectureId]);
export const getPreparationJob = key => jobs.get(key);
export function cancelOtherAccountJobs(userId) {
  for (const [key, job] of jobs) {
    if (job.userId !== userId) {
      job.controller?.abort();
      jobs.delete(key);
    }
  }
}
export function startPreparationJob(key, context, execute) {
  const existing = jobs.get(key);
  if (existing?.status === "running") return existing;
  const job = { ...context, status: "running", questions: [...(context.initialQuestions || [])], listeners: new Set() };
  jobs.set(key, job);
  const notify = () => job.listeners.forEach(listener => listener(job));
  job.progress = progress => { if (job.status === "running") { job.latestProgress = progress; notify(); } };
  job.accept = questions => {
    if (job.status !== "running") return;
    const seen = new Set(job.questions.map(q => q.stem));
    job.questions.push(...questions.filter(q => !seen.has(q.stem)));
  };
  job.promise = Promise.resolve().then(() => execute(job)).then(result => {
    job.result = result; job.status = "finished"; notify(); return result;
  }, error => {
    job.result = { error: error?.message || "Question preparation failed." };
    job.status = "finished"; notify(); return job.result;
  }).finally(() => {
    for (const [id, old] of jobs) if (jobs.size > 12 && old.status === "finished" && id !== key) jobs.delete(id);
  });
  return job;
}
export function subscribePreparationJob(job, listener) {
  job.listeners.add(listener); listener(job);
  return () => job.listeners.delete(listener);
}
