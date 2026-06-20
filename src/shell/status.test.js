// src/shell/status.test.js
import { describe, it, expect } from "vitest";
import { statusToken } from "./status.js";

describe("statusToken", () => {
  it("maps known statuses to colorblind-safe color + shape", () => {
    expect(statusToken("in-progress")).toEqual({ colorVar: "var(--status-blue)", shape: "dot", label: "In progress" });
    expect(statusToken("weak")).toEqual({ colorVar: "var(--status-amber)", shape: "diamond", label: "Weak" });
    expect(statusToken("review")).toEqual({ colorVar: "var(--status-purple)", shape: "dot", label: "Review" });
    expect(statusToken("new")).toEqual({ colorVar: "var(--status-cyan)", shape: "dot", label: "New" });
  });
  it("falls back for unknown status", () => {
    expect(statusToken("zzz")).toEqual({ colorVar: "var(--text-3)", shape: "dot", label: "—" });
  });
});
