import { expect, it } from "vitest";
import { canViewQuestionDiagnostics } from "./diagnosticsAccess.js";
it("does not expose diagnostics to signed-out or ordinary accounts", () => {
  expect(canViewQuestionDiagnostics(null)).toBe(false);
  expect(canViewQuestionDiagnostics("ordinary-account")).toBe(false);
});
it("permits the configured app owner", () => {
  expect(canViewQuestionDiagnostics("KX9K9IK4DgU0dBoAD6pj6Q4CEgr1")).toBe(true);
});
