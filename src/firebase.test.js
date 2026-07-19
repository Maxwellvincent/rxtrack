import { describe, it, expect } from "vitest";
import { isFirebaseConfigured } from "./firebase";

describe("firebase init", () => {
  it("exports isFirebaseConfigured as a boolean", () => {
    expect(typeof isFirebaseConfigured).toBe("boolean");
  });
});
