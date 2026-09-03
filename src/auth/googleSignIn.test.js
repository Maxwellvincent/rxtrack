import { describe, expect, it, vi } from "vitest";
import { startGoogleSignIn } from "./googleSignIn.js";

describe("startGoogleSignIn", () => {
  it("uses the popup when it completes", async () => {
    const popup = vi.fn().mockResolvedValue({});
    const redirect = vi.fn();
    await startGoogleSignIn({ auth: {}, provider: {}, popup, redirect, timeoutMs: 10 });
    expect(popup).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("uses redirect directly when requested", async () => {
    const popup = vi.fn();
    const redirect = vi.fn().mockResolvedValue(undefined);
    await startGoogleSignIn({
      auth: {}, provider: {}, popup, redirect, preferRedirect: true,
    });
    expect(redirect).toHaveBeenCalledOnce();
    expect(popup).not.toHaveBeenCalled();
  });

  it("falls back to redirect when the popup never opens", async () => {
    vi.useFakeTimers();
    const popup = vi.fn(() => new Promise(() => {}));
    const redirect = vi.fn().mockResolvedValue(undefined);
    const attempt = startGoogleSignIn({ auth: {}, provider: {}, popup, redirect, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await attempt;
    expect(redirect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("surfaces configuration errors instead of hiding them", async () => {
    const popup = vi.fn().mockRejectedValue(Object.assign(new Error("domain blocked"), { code: "auth/unauthorized-domain" }));
    const redirect = vi.fn();
    await expect(startGoogleSignIn({ auth: {}, provider: {}, popup, redirect })).rejects.toMatchObject({ code: "auth/unauthorized-domain" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
