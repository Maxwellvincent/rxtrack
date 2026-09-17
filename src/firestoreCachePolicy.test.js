import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./stores/testEnv.js";
import {
  clearLegacyFirestoreSharedState,
  isLegacyFirestoreSharedStateKey,
} from "./firestoreCachePolicy.js";

describe("Firestore browser cache policy", () => {
  beforeEach(() => installDomStorage());

  it("recognizes only Firestore multi-tab coordination records", () => {
    expect(isLegacyFirestoreSharedStateKey("firestore_targets_firestore/[DEFAULT]/rxtrack-med/_58")).toBe(true);
    expect(isLegacyFirestoreSharedStateKey("firestore_clients_firestore/[DEFAULT]/rxtrack-med")).toBe(true);
    expect(isLegacyFirestoreSharedStateKey("firebase:authUser:abc:[DEFAULT]")).toBe(false);
    expect(isLegacyFirestoreSharedStateKey("rxt-question-pool")).toBe(false);
  });

  it("removes Firestore coordination records without touching auth or RXTrack data", () => {
    localStorage.setItem("firestore_targets_firestore/[DEFAULT]/rxtrack-med/_58", "target-cache");
    localStorage.setItem("firestore_online_state_firestore/[DEFAULT]/rxtrack-med", "online");
    localStorage.setItem("firebase:authUser:abc:[DEFAULT]", "signed-in-user");
    localStorage.setItem("rxt-question-pool", "saved-questions");

    expect(clearLegacyFirestoreSharedState()).toEqual({ removed: 2, failed: 0 });
    expect(localStorage.getItem("firestore_targets_firestore/[DEFAULT]/rxtrack-med/_58")).toBeNull();
    expect(localStorage.getItem("firestore_online_state_firestore/[DEFAULT]/rxtrack-med")).toBeNull();
    expect(localStorage.getItem("firebase:authUser:abc:[DEFAULT]")).toBe("signed-in-user");
    expect(localStorage.getItem("rxt-question-pool")).toBe("saved-questions");
  });

  it("does not block startup when browser storage is unavailable", () => {
    const unavailableStorage = {
      get length() { throw new DOMException("Blocked", "SecurityError"); },
      key() { return null; },
      removeItem() {},
    };

    expect(() => clearLegacyFirestoreSharedState(unavailableStorage)).not.toThrow();
    expect(clearLegacyFirestoreSharedState(unavailableStorage)).toEqual({ removed: 0, failed: 1 });
  });
});
