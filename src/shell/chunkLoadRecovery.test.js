import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChunkLoadRecovery } from "./chunkLoadRecovery.js";
import { installDomStorage } from "../stores/testEnv.js";

describe("lazy chunk recovery", () => {
  beforeEach(() => { installDomStorage(); window.sessionStorage.clear(); });

  it("reloads once when a stale open tab requests a missing deployment chunk", () => {
    const reload = vi.fn();
    const remove = installChunkLoadRecovery(window, { now: () => 100_000, reload });
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    remove();
  });

  it("does not create a reload loop when the chunk remains missing after reload", () => {
    window.sessionStorage.setItem("rxtrack:chunk-load-recovery", "100000");
    const reload = vi.fn();
    installChunkLoadRecovery(window, { now: () => 100_100, reload });
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
