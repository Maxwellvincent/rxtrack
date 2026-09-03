import { describe, expect, it, vi } from "vitest";
import { startGoogleSignIn } from "./googleSignIn.js";

describe("startGoogleSignIn", () => {
  it("uses the popup when it completes", async () => {
    const popup = vi.fn().mockResolvedValue({});
    const redirect = vi.fn();
    await startGoogleSignIn({ auth: {}, provider: {}, popup, redirect });
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

  it("falls back to redirect when the popup is blocked", async () => {
    const popup = vi.fn().mockRejectedValue(
      Object.assign(new Error("blocked"), { code: "auth/popup-blocked" }),
    );
    const redirect = vi.fn().mockResolvedValue(undefined);
    await startGoogleSignIn({ auth: {}, provider: {}, popup, redirect });
    expect(redirect).toHaveBeenCalledOnce();
  });

  it("surfaces configuration errors instead of hiding them", async () => {
    const popup = vi.fn().mockRejectedValue(Object.assign(new Error("domain blocked"), { code: "auth/unauthorized-domain" }));
    const redirect = vi.fn();
    await expect(startGoogleSignIn({ auth: {}, provider: {}, popup, redirect })).rejects.toMatchObject({ code: "auth/unauthorized-domain" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
