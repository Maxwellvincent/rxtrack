import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "./asyncDeadline.js";
afterEach(() => vi.useRealTimers());
describe("bounded requests", () => {
  it("aborts stalled transports and stops waiting", async () => {
    vi.useFakeTimers();
    let signal;
    const task = withDeadline(s => { signal = s; return new Promise(() => {}); }, 100);
    const check = expect(task).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(101);
    await check;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears timers on success", async () => {
    vi.useFakeTimers();
    expect(await withDeadline(async () => "done", 100)).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
});
