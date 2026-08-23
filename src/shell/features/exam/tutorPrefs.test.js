import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { TUTOR_MODE_KEY, readTutorModeEnabled, writeTutorModeEnabled } from "./tutorPrefs.js";

beforeEach(() => {
  installDomStorage();
});

describe("tutorPrefs", () => {
  it("defaults to false when nothing is stored", () => {
    expect(readTutorModeEnabled()).toBe(false);
  });

  it("round-trips a written value", () => {
    writeTutorModeEnabled(true);
    expect(readTutorModeEnabled()).toBe(true);

    writeTutorModeEnabled(false);
    expect(readTutorModeEnabled()).toBe(false);
  });

  it("handles a corrupt localStorage value gracefully", () => {
    localStorage.setItem(TUTOR_MODE_KEY, "{not json");
    expect(readTutorModeEnabled()).toBe(false);
  });

  it("handles a missing/wrong-shaped stored value gracefully", () => {
    localStorage.setItem(TUTOR_MODE_KEY, JSON.stringify("not-an-object"));
    expect(readTutorModeEnabled()).toBe(false);

    localStorage.setItem(TUTOR_MODE_KEY, JSON.stringify(42));
    expect(readTutorModeEnabled()).toBe(false);
  });
});
