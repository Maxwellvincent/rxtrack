import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const transactionGet = vi.fn();
const transactionSet = vi.fn();

const runTransaction = vi.fn(async (_db, fn) =>
  fn({ get: transactionGet, set: transactionSet }),
);

vi.mock("firebase/firestore", () => ({
  doc: (...args) => ({ path: args.slice(1).join("/") }),
  runTransaction: (...args) => runTransaction(...args),
  Timestamp: { fromMillis: (ms) => ({ ms }) },
}));

let userId = "user-1";
vi.mock("./focusHudLink.js", () => ({
  isFocusHudConfigured: true,
  focusHudDb: () => ({}),
  focusHudUserId: () => userId,
}));

const {
  applyBurstDelta,
  applyStudyDelta,
  focusDayKey,
  reportStudyTime,
  trackStudyTime,
  FLUSH_MS,
} = await import("./focusHudStudy.js");

beforeEach(() => {
  userId = "user-1";
  runTransaction.mockClear();
  transactionGet.mockReset();
  transactionSet.mockClear();
  transactionGet.mockResolvedValue({ exists: () => false, data: () => ({}) });
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("applyStudyDelta", () => {
  it("adds a first entry", () => {
    expect(applyStudyDelta([], { kind: "questions", detail: "Cardio", studiedMs: 60_000 })).toEqual(
      [{ kind: "questions", detail: "Cardio", studiedMs: 60_000 }],
    );
  });

  it("sums repeats of the same thing rather than listing them twice", () => {
    const first = applyStudyDelta([], { kind: "questions", detail: "Cardio", studiedMs: 60_000 });
    const second = applyStudyDelta(first, {
      kind: "questions",
      detail: "Cardio",
      studiedMs: 30_000,
    });

    expect(second).toEqual([{ kind: "questions", detail: "Cardio", studiedMs: 90_000 }]);
  });

  it("keeps different lectures apart", () => {
    const entries = applyStudyDelta(
      [{ kind: "lecture", detail: "Renal 2", studiedMs: 60_000 }],
      { kind: "lecture", detail: "Renal 3", studiedMs: 30_000 },
    );

    expect(entries).toHaveLength(2);
  });

  it("treats a missing detail as its own bucket", () => {
    const entries = applyStudyDelta([{ kind: "review", detail: null, studiedMs: 1000 }], {
      kind: "review",
      detail: null,
      studiedMs: 1000,
    });

    expect(entries).toEqual([{ kind: "review", detail: null, studiedMs: 2000 }]);
  });

  it("ignores a zero or negative delta", () => {
    const entries = [{ kind: "review", detail: null, studiedMs: 1000 }];

    expect(applyStudyDelta(entries, { kind: "review", detail: null, studiedMs: 0 })).toBe(entries);
    expect(applyStudyDelta(entries, { kind: "review", detail: null, studiedMs: -5 })).toBe(entries);
  });

  it("survives a corrupt stored value instead of throwing", () => {
    expect(
      applyStudyDelta("not an array", { kind: "review", detail: null, studiedMs: 1000 }),
    ).toEqual([{ kind: "review", detail: null, studiedMs: 1000 }]);
  });

  it("caps the list at what focus-hud's rules accept, keeping the largest", () => {
    let entries = [];
    for (let index = 0; index < 210; index += 1) {
      entries = applyStudyDelta(entries, {
        kind: "questions",
        detail: `Block ${index}`,
        studiedMs: index + 1,
      });
    }

    expect(entries).toHaveLength(200);
    expect(entries[0].studiedMs).toBe(210);
  });
});

describe("focusDayKey", () => {
  it("puts 03:00 on the previous focus day, matching focus-hud's 04:00 boundary", () => {
    const lateNight = new Date(2026, 7, 20, 3, 0).getTime();
    const morning = new Date(2026, 7, 20, 9, 0).getTime();

    expect(focusDayKey(lateNight)).toBe("2026-08-19");
    expect(focusDayKey(morning)).toBe("2026-08-20");
  });
});

describe("reportStudyTime", () => {
  it("writes the merged entries for the current focus day", async () => {
    transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ entries: [{ kind: "questions", detail: "Cardio", studiedMs: 60_000 }] }),
    });

    await reportStudyTime("questions", "Cardio", 30_000, new Date(2026, 7, 20, 9).getTime());

    expect(transactionSet).toHaveBeenCalledTimes(1);
    const [ref, payload] = transactionSet.mock.calls[0];
    expect(ref.path).toContain("users/user-1/externalStudy/2026-08-20");
    expect(payload.source).toBe("rxtrack");
    expect(payload.entries).toEqual([
      { kind: "questions", detail: "Cardio", studiedMs: 90_000 },
    ]);
  });

  it("writes nothing when not linked to focus-hud", async () => {
    userId = null;

    expect(await reportStudyTime("questions", "Cardio", 30_000)).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("never throws when the write fails — study must not break", async () => {
    runTransaction.mockRejectedValueOnce(new Error("offline"));

    expect(await reportStudyTime("questions", "Cardio", 30_000)).toBe(false);
  });
});

describe("trackStudyTime", () => {
  it("reports elapsed time on each flush and once more on stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 9, 0, 0));

    const stop = trackStudyTime("questions", { detail: () => "Cardio" });

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(transactionSet).toHaveBeenCalledTimes(1);
    expect(transactionSet.mock.calls[0][1].entries[0].studiedMs).toBe(FLUSH_MS);

    await vi.advanceTimersByTimeAsync(FLUSH_MS / 2);
    stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(transactionSet).toHaveBeenCalledTimes(2);
    expect(transactionSet.mock.calls[1][1].entries[0].studiedMs).toBe(FLUSH_MS / 2);
  });

  it("does not report a gap longer than a few flushes — a sleeping machine is not studying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 9, 0, 0));

    const stop = trackStudyTime("questions", { detail: () => "Cardio" });

    // The machine slept: the clock jumped, but the interval did not fire while
    // it was away.
    vi.setSystemTime(new Date(2026, 7, 20, 9, 0, 0).getTime() + FLUSH_MS * 20);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(transactionSet).not.toHaveBeenCalled();
  });
});

describe("applyBurstDelta", () => {
  const NINE = new Date(2026, 7, 20, 9).getTime();

  it("opens a burst at the clock time the study began", () => {
    const bursts = applyBurstDelta([], {
      id: "b1",
      kind: "questions",
      detail: "Cardio",
      studiedMs: 30_000,
      nowMs: NINE + 30_000,
    });

    expect(bursts).toEqual([
      {
        id: "b1",
        kind: "questions",
        detail: "Cardio",
        startedAt: NINE,
        endedAt: NINE + 30_000,
        studiedMs: 30_000,
      },
    ]);
  });

  it("extends the same burst as the session continues", () => {
    const first = applyBurstDelta([], {
      id: "b1",
      kind: "questions",
      detail: "Cardio",
      studiedMs: 30_000,
      nowMs: NINE + 30_000,
    });
    const second = applyBurstDelta(first, {
      id: "b1",
      kind: "questions",
      detail: "Cardio",
      studiedMs: 30_000,
      nowMs: NINE + 60_000,
    });

    expect(second).toHaveLength(1);
    expect(second[0].startedAt).toBe(NINE);
    expect(second[0].endedAt).toBe(NINE + 60_000);
    expect(second[0].studiedMs).toBe(60_000);
  });

  it("a new session id starts a separate burst, so a reload does not merge two sittings", () => {
    const first = applyBurstDelta([], {
      id: "b1",
      kind: "questions",
      detail: "Cardio",
      studiedMs: 30_000,
      nowMs: NINE + 30_000,
    });
    const second = applyBurstDelta(first, {
      id: "b2",
      kind: "questions",
      detail: "Cardio",
      studiedMs: 30_000,
      nowMs: NINE + 5 * 3_600_000,
    });

    expect(second).toHaveLength(2);
    expect(second[1].startedAt).toBe(NINE + 5 * 3_600_000 - 30_000);
  });

  it("keeps the most recent bursts when a day runs long", () => {
    let bursts = [];
    for (let index = 0; index < 210; index += 1) {
      bursts = applyBurstDelta(bursts, {
        id: `b${index}`,
        kind: "questions",
        detail: `Block ${index}`,
        studiedMs: 1000,
        nowMs: NINE + index * 60_000,
      });
    }

    expect(bursts).toHaveLength(200);
    expect(bursts.at(-1).detail).toBe("Block 209");
  });

  it("survives a corrupt stored value", () => {
    expect(
      applyBurstDelta("nope", {
        id: "b1",
        kind: "review",
        detail: null,
        studiedMs: 1000,
        nowMs: NINE,
      }),
    ).toHaveLength(1);
  });
});
