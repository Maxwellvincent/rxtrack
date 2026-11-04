import { describe, expect, it } from "vitest";
import { preparationErrorMessage, preparationReviewSummary } from "./preparationError.js";

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

it("explains the leading review outcomes without echoing unknown payload fields",()=>{
 expect(preparationReviewSummary({unverified_objective_alignment:5,ambiguous_choices:2,private_payload:99})).toBe("Review outcomes: objective mapping not fully verified (5); answer choices were ambiguous (2).");
 expect(preparationReviewSummary({private_payload:2})).toBe("");
});
