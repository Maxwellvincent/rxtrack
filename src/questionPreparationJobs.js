import { preparationErrorMessage, preparationReviewSummary } from "./preparationError.js";
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
    job.result = recoverPreparationFailure(job,error);
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

// A deadline can win the race against the engine's final result. Retain only
// accepted callbacks and metadata, never in-flight drafts or implied approvals.
export function recoverPreparationFailure(job, error) {
  const initial=job.initialQuestions?.length || 0;
  const accepted=Math.max(0,(job.questions?.length || 0)-initial);
  const diagnostics=job.latestProgress?.diagnostics;
  const reason=[preparationErrorMessage(error),preparationReviewSummary(diagnostics?.rejections)].filter(Boolean).join(" ");
  return {questions:[...(job.questions || [])],incomplete:true,error:reason,reason,
    ...(diagnostics?{diagnostics:{...diagnostics,accepted,calls:(diagnostics.calls || []).map(call=>call.status==="running"?{...call,status:"cancelled"}:call)}}:{})};
}
