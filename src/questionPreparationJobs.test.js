import { expect, it } from "vitest";
import { cancelOtherAccountJobs, getPreparationJob, startPreparationJob, subscribePreparationJob } from "./questionPreparationJobs.js";
it("continues after the lecture view detaches and restores results on return", async () => {
  let finish;
  const job = startPreparationJob("navigation-test", { initialQuestions: [], controller: new AbortController() }, async current => {
    await new Promise(resolve => { finish = resolve; });
    current.accept([{ stem: "Verified question" }]);
    return { questions: current.questions };
  });
  const detach = subscribePreparationJob(job, () => {});
  await Promise.resolve(); detach();
  expect(job.controller.signal.aborted).toBe(false);
  finish(); await job.promise;
  const restored = getPreparationJob("navigation-test");
  expect(restored.status).toBe("finished");
  expect(restored.questions).toHaveLength(1);
});
it("shares an existing running job and ignores progress after completion", async () => {
  const job = startPreparationJob("same-job", {}, async () => ({ questions: [] }));
  expect(startPreparationJob("same-job", {}, () => { throw new Error("duplicate"); })).toBe(job);
  await job.promise; job.progress({ ready: 0 });
  expect(job.latestProgress).toBeUndefined();
});
it("cancels and removes jobs when the signed-in account changes", async () => {
  const controller = new AbortController();
  const job = startPreparationJob("account-job", { userId: "first", controller }, async () => ({ questions: [] }));
  cancelOtherAccountJobs("second");
  expect(controller.signal.aborted).toBe(true);
  expect(getPreparationJob("account-job")).toBeUndefined();
  await job.promise;
});

it('preserves accepted work and rejection reasons when an outer deadline wins',async()=>{
 const {recoverPreparationFailure}=await import('./questionPreparationJobs.js');
 const job={initialQuestions:[{stem:'Saved reviewed item'}],questions:[{stem:'Saved reviewed item'},{stem:'New reviewed item'}],latestProgress:{diagnostics:{requested:19,accepted:0,rejections:{unverified_objective_alignment:3},calls:[{stage:'draft',status:'running'}]}}};
 const result=recoverPreparationFailure(job,new Error('Quiz preparation timed out'));
 expect(result.questions).toHaveLength(2);expect(result.diagnostics.accepted).toBe(1);
 expect(result.reason).toContain('objective mapping not fully verified');expect(result.reason).toContain('timed out');
 expect(result.diagnostics.calls[0].status).toBe('cancelled');expect(job.latestProgress.diagnostics.calls[0].status).toBe('running');
});

it('retains accepted callbacks if a running preparation job throws',async()=>{
 const job=startPreparationJob('deadline-retention', {initialQuestions:[]},async current=>{
  current.accept([{stem:'Independently accepted question'}]);
  current.progress({diagnostics:{accepted:1,rejections:{unsupported_fact:2},calls:[]}});
  throw new Error('Quiz preparation timed out');
 });
 const result=await job.promise;expect(result.questions).toHaveLength(1);expect(result.reason).toContain('timed out');
 expect(result.diagnostics.rejections.unsupported_fact).toBe(2);
});
