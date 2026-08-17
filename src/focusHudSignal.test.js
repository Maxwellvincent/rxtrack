import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const setDoc = vi.fn(async () => {});
const deleteDoc = vi.fn(async () => {});

vi.mock("firebase/firestore", () => ({
  doc: (...args) => ({ path: args.slice(1).join("/") }),
  setDoc,
  deleteDoc,
  serverTimestamp: () => "SERVER_TS",
  Timestamp: { fromMillis: (ms) => ({ ms }) },
}));
// The link module is stubbed: this suite is about what gets written, not about
// the second Firebase project it is written to.
let userId = "user-1";
vi.mock("./focusHudLink.js", () => ({
  isFocusHudConfigured: true,
  focusHudDb: () => ({}),
  focusHudUserId: () => userId,
}));

const { beatFocusHud, stopFocusHud, trackFocusHudActivity, HEARTBEAT_MS } = await import(
  "./focusHudSignal.js"
);

beforeEach(() => {
  userId = "user-1";
  setDoc.mockClear();
  deleteDoc.mockClear();
  vi.useRealTimers();
});

afterEach(() => vi.useRealTimers());

describe("focus-hud signal", () => {
  it("writes the signal document for the signed-in user", async () => {
    await beatFocusHud("questions", { detail: "Cardio block 3", externalRef: "block-3" });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0];
    expect(ref.path).toBe("users/user-1/activitySignals/rxtrack");
    expect(payload).toMatchObject({
      source: "rxtrack",
      kind: "questions",
      detail: "Cardio block 3",
      externalRef: "block-3",
      lastSeenAt: "SERVER_TS",
    });
  });

  it("does nothing when nobody is signed in", async () => {
    userId = null;
    expect(await beatFocusHud("questions")).toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("never throws when the write fails", async () => {
    // Studying must not break because optional bookkeeping did.
    setDoc.mockRejectedValueOnce(new Error("offline"));
    await expect(beatFocusHud("questions")).resolves.toBe(false);
  });

  it("clears the signal on stop", async () => {
    await stopFocusHud();
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it("heartbeats while an activity runs and clears when it ends", () => {
    vi.useFakeTimers();
    const stop = trackFocusHudActivity("questions", { detail: "Block 3" });

    expect(setDoc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(setDoc).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(setDoc).toHaveBeenCalledTimes(3);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it("does not heartbeat while the tab is hidden", () => {
    // A question set left open in a background tab is not studying.
    // This suite runs without a DOM, so document is supplied directly.
    vi.useFakeTimers();
    vi.stubGlobal("document", { visibilityState: "hidden" });

    const stop = trackFocusHudActivity("questions");
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(setDoc).not.toHaveBeenCalled();

    stop();
    vi.unstubAllGlobals();
  });

  it("keeps startedAt fixed across heartbeats", () => {
    vi.useFakeTimers();
    const stop = trackFocusHudActivity("lecture");
    const firstStart = setDoc.mock.calls[0][1].startedAt.ms;

    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(setDoc.mock.calls[1][1].startedAt.ms).toBe(firstStart);
    stop();
  });
});
