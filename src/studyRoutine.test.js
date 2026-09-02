import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock supabase before any module imports it.
vi.mock("./supabase", () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
  getCurrentUser: () => Promise.resolve(null),
  scheduleDebouncedCloudPush: () => {},
}));

// In-memory localStorage shim (vitest config uses node environment).
class MemoryStorage {
  constructor() {
    this.store = {};
  }
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
  }
  setItem(k, v) {
    this.store[k] = String(v);
  }
  removeItem(k) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = new MemoryStorage();
}
if (typeof globalThis.window === "undefined") {
  globalThis.window = { dispatchEvent: () => {} };
} else if (typeof globalThis.window.dispatchEvent !== "function") {
  globalThis.window.dispatchEvent = () => {};
}
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
}

const TODAY = "2026-04-30T12:00:00.000Z";
const TODAY_PREFIX = TODAY.slice(0, 10);

function isoDaysAgo(n, base = TODAY) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

async function freshImport() {
  vi.resetModules();
  globalThis.localStorage.clear();
  // Re-import after clearing so module-level reads are fresh.
  return await import("./studyRoutine.js");
}

describe("studyRoutine — defaults & persistence", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("getDefaultRoutine returns 6 daily steps with stable ids", async () => {
    const { getDefaultRoutine } = await freshImport();
    const r = getDefaultRoutine();
    const ids = r.steps.map((s) => s.id);
    expect(ids).toEqual([
      "calibration-warmup",
      "preview-objectives",
      "lecture-block",
      "qbank",
      "weak-drill",
      "evening-misses",
    ]);
    expect(r.weekly?.id).toBe("weekly-audit");
  });

  it("loadRoutine returns default when nothing stored, persists via saveRoutine", async () => {
    const m = await freshImport();
    const r1 = m.loadRoutine();
    expect(r1.version).toBe(1);
    const updated = m.saveRoutine({ ...r1, lastWeeklyReviewAt: "2026-04-25T00:00:00Z" });
    expect(updated.lastWeeklyReviewAt).toBe("2026-04-25T00:00:00Z");
    const r2 = m.loadRoutine();
    expect(r2.lastWeeklyReviewAt).toBe("2026-04-25T00:00:00Z");
  });

  it("setStepTarget mutates only the targeted step", async () => {
    const m = await freshImport();
    m.setStepTarget("qbank", 20);
    const r = m.loadRoutine();
    expect(r.steps.find((s) => s.id === "qbank").target).toBe(20);
    expect(r.steps.find((s) => s.id === "calibration-warmup").target).toBe(5);
  });
});

describe("evaluateToday — per-step done calculation", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("calibration-warmup done when 5 calibration entries today", async () => {
    const m = await freshImport();
    const log = [];
    for (let i = 0; i < 5; i++) {
      log.push({
        date: TODAY,
        predicted: 70,
        correct: true,
        source: "drill",
        blockId: null,
        objectiveId: null,
        lectureId: null,
      });
    }
    // Plus older entry that shouldn't count
    log.push({ date: isoDaysAgo(2), predicted: 70, correct: true });
    localStorage.setItem("rxt-calibration-log", JSON.stringify(log));
    const out = m.evaluateToday({ todayISO: TODAY });
    const step = out.steps.find((s) => s.stepId === "calibration-warmup");
    expect(step.value).toBe(5);
    expect(step.done).toBe(true);
  });

  it("preview-objectives reads rxt-completion activityLog with type=preview", async () => {
    const m = await freshImport();
    const completion = {
      "lec1__bA": {
        activityLog: [
          { date: TODAY, activityType: "preview" },
          { date: isoDaysAgo(1), activityType: "preview" },
        ],
      },
    };
    localStorage.setItem("rxt-completion", JSON.stringify(completion));
    const out = m.evaluateToday({ todayISO: TODAY });
    const step = out.steps.find((s) => s.stepId === "preview-objectives");
    expect(step.value).toBe(1);
    expect(step.done).toBe(true);
  });

  it("lecture-block matches lecture/deep_learn/review activity types today", async () => {
    const m = await freshImport();
    const completion = {
      "lec1__bA": {
        activityLog: [
          { date: TODAY, activityType: "deep_learn" },
          { date: TODAY, activityType: "manual" }, // should NOT match
        ],
      },
    };
    localStorage.setItem("rxt-completion", JSON.stringify(completion));
    const out = m.evaluateToday({ todayISO: TODAY });
    const step = out.steps.find((s) => s.stepId === "lecture-block");
    expect(step.value).toBe(1);
    expect(step.done).toBe(true);
  });

  it("qbank counts session-history entries today", async () => {
    const m = await freshImport();
    const profile = {
      sessionHistory: [
        ...Array.from({ length: 30 }, () => ({ at: TODAY, wasCorrect: true })),
        { at: isoDaysAgo(1), wasCorrect: true },
      ],
    };
    localStorage.setItem("rxt-learning-profile", JSON.stringify(profile));
    const out = m.evaluateToday({ todayISO: TODAY });
    const step = out.steps.find((s) => s.stepId === "qbank");
    expect(step.value).toBe(30);
    expect(step.done).toBe(true);
  });

  it("weak-drill unions explicit drills and weak-concepts missed today", async () => {
    const m = await freshImport();
    localStorage.setItem(
      "rxt-weak-drills",
      JSON.stringify([
        { conceptId: "c1", at: TODAY },
        { conceptId: "c1", at: TODAY }, // duplicate, should dedupe
      ])
    );
    localStorage.setItem(
      "rxt-weak-concepts",
      JSON.stringify({
        bA: [
          { id: "c2", lastMissed: TODAY },
          { id: "c3", lastMissed: TODAY },
          { id: "c4", lastMissed: isoDaysAgo(2) },
        ],
        lifetime: [],
      })
    );
    const out = m.evaluateToday({ todayISO: TODAY });
    const step = out.steps.find((s) => s.stepId === "weak-drill");
    expect(step.value).toBe(3); // c1, c2, c3
    expect(step.done).toBe(true);
  });

  it("evening-misses counts rxt-miss-notes entries today", async () => {
    const m = await freshImport();
    m.addMissNote({ wcId: "c1", note: "forgot the loop diuretic mechanism" });
    const out = m.evaluateToday({ todayISO: new Date().toISOString() });
    const step = out.steps.find((s) => s.stepId === "evening-misses");
    expect(step.value).toBe(1);
    expect(step.done).toBe(true);
  });

  it("doneCount/totalCount aggregates across steps", async () => {
    const m = await freshImport();
    const out = m.evaluateToday({ todayISO: TODAY });
    expect(out.totalCount).toBe(6);
    expect(out.doneCount).toBe(0);
  });
});

describe("getSuggestions — rule firing", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("rule 1: overconfidence when 90% bucket gap < -10 with n>=10", async () => {
    const m = await freshImport();
    const log = [];
    // 12 entries at 90% predicted; 6 correct → 50% accuracy → gap = -40
    for (let i = 0; i < 12; i++) {
      log.push({
        date: isoDaysAgo(i),
        confidence: 90,
        correct: i < 6,
      });
    }
    localStorage.setItem("rxt-calibration-log", JSON.stringify(log));
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id === "overconfidence-90")).toBe(true);
  });

  it("rule 1: silent when n<10", async () => {
    const m = await freshImport();
    const log = Array.from({ length: 5 }, (_, i) => ({
      date: isoDaysAgo(i),
      confidence: 90,
      correct: false,
    }));
    localStorage.setItem("rxt-calibration-log", JSON.stringify(log));
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id === "overconfidence-90")).toBe(false);
  });

  it("rule 2: drill consistency fires when <3/7 days had weak-drill done", async () => {
    const m = await freshImport();
    // No weak-drill log at all → 0/7 days
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id === "drill-consistency")).toBe(true);
  });

  it("rule 2: silent when 3+/7 days had weak-drill done", async () => {
    const m = await freshImport();
    // 3 distinct days each with 3 unique conceptIds
    const drills = [];
    for (let i = 0; i < 3; i++) {
      const at = isoDaysAgo(i);
      drills.push({ conceptId: "c1-" + i, at });
      drills.push({ conceptId: "c2-" + i, at });
      drills.push({ conceptId: "c3-" + i, at });
    }
    localStorage.setItem("rxt-weak-drills", JSON.stringify(drills));
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id === "drill-consistency")).toBe(false);
  });

  it("rule 3: qbank target floor proposes 20 when <4/7 days hit and current>20", async () => {
    const m = await freshImport();
    // Default target is 30; no qbank session history → 0/7 days
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    const s = suggestions.find((x) => x.id === "qbank-target-floor");
    expect(s).toBeTruthy();
    expect(s.proposedTarget).toBe(20);
    expect(s.stepId).toBe("qbank");
  });

  it("rule 4: unlinked-concepts fires when >20 weak concepts have empty objectiveIds", async () => {
    const m = await freshImport();
    const concepts = Array.from({ length: 25 }, (_, i) => ({
      id: "c" + i,
      objectiveIds: [],
      linkedLecIds: ["lec1"],
    }));
    localStorage.setItem("rxt-weak-concepts", JSON.stringify({ bA: concepts, lifetime: [] }));
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id === "backfill-objective-links")).toBe(true);
  });

  it("rule 4: silent when <=20 unlinked", async () => {
    const m = await freshImport();
    const concepts = Array.from({ length: 5 }, (_, i) => ({
      id: "c" + i,
      objectiveIds: ["obj-" + i],
    }));
    localStorage.setItem("rxt-weak-concepts", JSON.stringify({ bA: concepts, lifetime: [] }));
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id === "backfill-objective-links")).toBe(false);
  });

  it("rule 5: mastery drift fires for mastered objectives that had a recent miss", async () => {
    const m = await freshImport();
    localStorage.setItem(
      "rxt-calibration-log",
      JSON.stringify([
        { date: isoDaysAgo(2), predicted: 70, correct: false, objectiveId: "obj-A" },
      ])
    );
    localStorage.setItem(
      "rxt-block-objectives",
      JSON.stringify({
        bA: [{ id: "obj-A", objective: "Diuretic mechanisms", status: "mastered" }],
      })
    );
    const suggestions = m.getSuggestions({ todayISO: TODAY });
    expect(suggestions.some((s) => s.id.startsWith("mastery-drift-"))).toBe(true);
  });
});

describe("dismiss / accept suggestion", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("dismissSuggestion permanently hides a suggestion", async () => {
    const m = await freshImport();
    // unlinked rule will fire
    const concepts = Array.from({ length: 25 }, (_, i) => ({ id: "c" + i, objectiveIds: [] }));
    localStorage.setItem("rxt-weak-concepts", JSON.stringify({ bA: concepts, lifetime: [] }));
    expect(m.getSuggestions({ todayISO: TODAY }).some((s) => s.id === "backfill-objective-links"))
      .toBe(true);
    m.dismissSuggestion("backfill-objective-links");
    expect(m.getSuggestions({ todayISO: TODAY }).some((s) => s.id === "backfill-objective-links"))
      .toBe(false);
  });

  it("dismissSuggestion with snoozeDays re-shows after the snooze elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TODAY));
    const m = await freshImport();
    const concepts = Array.from({ length: 25 }, (_, i) => ({ id: "c" + i, objectiveIds: [] }));
    localStorage.setItem("rxt-weak-concepts", JSON.stringify({ bA: concepts, lifetime: [] }));
    m.dismissSuggestion("backfill-objective-links", { snoozeDays: 7 });
    // Today (snoozed): hidden
    expect(m.getSuggestions({ todayISO: TODAY }).some((s) => s.id === "backfill-objective-links"))
      .toBe(false);
    // 10 days later: visible again
    const later = new Date(TODAY);
    later.setUTCDate(later.getUTCDate() + 10);
    expect(
      m
        .getSuggestions({ todayISO: later.toISOString() })
        .some((s) => s.id === "backfill-objective-links")
    ).toBe(true);
    vi.useRealTimers();
  });

  it("acceptSuggestion(target-edit) updates the step target and dismisses", async () => {
    const m = await freshImport();
    const sugg = {
      id: "qbank-target-floor",
      kind: "target-edit",
      stepId: "qbank",
      proposedTarget: 20,
    };
    m.acceptSuggestion(sugg);
    const r = m.loadRoutine();
    expect(r.steps.find((s) => s.id === "qbank").target).toBe(20);
    expect(r.acceptedSuggestionIds).toContain("qbank-target-floor");
  });
});

describe("weekly review status", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("getWeeklyStatus reports done=false when never run", async () => {
    const m = await freshImport();
    expect(m.getWeeklyStatus({ todayISO: TODAY }).done).toBe(false);
  });

  it("markWeeklyReviewDone flips status to done within 7 days", async () => {
    const m = await freshImport();
    m.markWeeklyReviewDone();
    expect(m.getWeeklyStatus().done).toBe(true);
  });
});
