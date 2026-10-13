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
