import { expect, it, vi } from "vitest";
import { startBackgroundJob, readBackgroundJobs, subscribeBackgroundJobs, dismissBackgroundJob } from "./backgroundJobs.js";
it("continues work when a page subscriber leaves and exposes completion to the next page", async () => {
  let finish;
  const unsubscribe = subscribeBackgroundJobs(() => {});
  const id = startBackgroundJob({ label: "Quiz", run: async report => {
    report("1/3 ready");
    await new Promise(resolve => { finish = resolve; });
    return "3/3 ready";
  } });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  unsubscribe();
  expect(readBackgroundJobs().find(job => job.id === id)).toMatchObject({ status: "running", detail: "1/3 ready" });
  finish();
  await vi.waitFor(() => expect(readBackgroundJobs().find(job => job.id === id)).toMatchObject({ status: "done", detail: "3/3 ready" }));
  dismissBackgroundJob(id);
});
