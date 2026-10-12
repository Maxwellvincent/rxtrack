import { describe, expect, it } from "vitest";
import { preparationErrorMessage } from "./preparationError.js";

describe("preparation error messages", () => {
  it("extracts structured provider failures without dumping the payload", () => {
    expect(preparationErrorMessage({ error: { message: "Provider deadline exceeded", request: "private" } })).toBe("Provider deadline exceeded");
    expect(preparationErrorMessage(new Error("Connection failed"))).toBe("Connection failed");
  });
  it("uses a readable fallback for unrecognized responses", () => {
    expect(preparationErrorMessage({ code: 502 })).not.toContain("object Object");
    expect(preparationErrorMessage("[object Object]")).toContain("Reviewed questions are saved");
  });
});
