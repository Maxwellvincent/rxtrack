import { describe, expect, it } from "vitest";
import { coverAnswerEntry, coverAnswerEvidence, keyReasoning, readCoverPreference, selfCheckObjectiveIds, selfCheckSummary, shouldCoverOptions, writeCoverPreference } from "./activeRecall.js";

const practice = { format: "practice", status: "in_progress" };
const question = { questionId: "q1", choices: { A: "a", B: "b" }, explanation: "The medial medulla holds the hypoglossal nucleus. More text." };

describe("active recall (cover the options)", () => {
  it("covers any in-progress session when on, before a pick or prediction", () => {
    expect(shouldCoverOptions({ session: practice, question })).toBe(true);
    expect(shouldCoverOptions({ session: { ...practice, format: "exam" }, question })).toBe(true);
    expect(shouldCoverOptions({ session: { ...practice, status: "completed" }, question })).toBe(false);
    expect(shouldCoverOptions({ session: practice, question, picked: "A" })).toBe(false);
    expect(shouldCoverOptions({ session: practice, question, enabled: false })).toBe(false);
    expect(shouldCoverOptions({ session: practice, question: { ...question, coverAnswer: { prediction: "x" } } })).toBe(false);
    expect(shouldCoverOptions({ session: practice, question: { ...question, coverAnswer: { skipped: true } } })).toBe(false);
  });

  it("shows the plan's link, deciding clue and partner lecture, else the explanation's first sentence", () => {
    expect(keyReasoning({ questionPlan: { inference: "Link", discriminator: "Clue" }, crossLecture: { partnerTitle: "NB 30" } }).map(l => l.label)).toEqual(["Link", "Deciding clue", "Second lecture"]);
    expect(keyReasoning(question)).toEqual([{ label: "Key point", text: "The medial medulla holds the hypoglossal nucleus." }]);
  });

  it("stores trimmed predictions and only valid self-checks, and reports them as evidence", () => {
    const entry = coverAnswerEntry({}, { prediction: "  CN XII  " }, 5);
    expect(entry).toEqual({ prediction: "CN XII", at: 5 });
    const checked = coverAnswerEntry(entry, { selfCheck: "missed" }, 6);
    expect(coverAnswerEntry(checked, { selfCheck: "bogus" }, 7).selfCheck).toBe("missed");
    expect(coverAnswerEvidence({ coverAnswer: checked })).toEqual({ recallAttempted: true });
    expect(selfCheckObjectiveIds({ objectiveIds: ["o1"], secondaryObjectiveIds: ["o2", "o1"] })).toEqual(["o1", "o2"]);
    expect(coverAnswerEvidence({ coverAnswer: { skipped: true } })).toEqual({ recallAttempted: false });
    expect(selfCheckSummary([{ coverAnswer: checked }, { coverAnswer: { prediction: "y", selfCheck: "matched" } }, {}])).toEqual({ predicted: 2, matched: 1, missed: 1 });
  });

  it("defaults covering off and remembers turning it on", () => {
    const store = new Map();
    const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    expect(readCoverPreference(storage)).toBe(false);
    writeCoverPreference(true, storage);
    expect(readCoverPreference(storage)).toBe(true);
    writeCoverPreference(false, storage);
    expect(readCoverPreference(storage)).toBe(false);
    expect(readCoverPreference({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});
