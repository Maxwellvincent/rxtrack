import { describe, expect, it, vi } from "vitest";
import { logUploadPhase } from "./uploadTelemetry.js";

describe("logUploadPhase", () => {
  it("logs object detail as JSON", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logUploadPhase("abc-12345", "phase", { ok: true, n: 1 });
    expect(spy.mock.calls[0][0]).toContain("phase");
    expect(spy.mock.calls[0][0]).toContain('"ok":true');
    spy.mockRestore();
  });
});
