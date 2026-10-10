import { it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ session: null, record: vi.fn(), evidence: vi.fn() }));
vi.mock("../../../supabase.js", () => ({
  updateExamSessionTransaction: vi.fn(async (_u, _id, update) => { state.session = update(state.session) || state.session; return state.session; }),
  getExamSession: vi.fn(async () => state.session), listExamSessions: vi.fn(async () => []),
}));
vi.mock("../../../stores/lectureQuestionStats.js", () => ({ recordAnswerAwait: (...args) => state.record(...args) }));
vi.mock("../../../stores/learnerEvidence.js", () => ({ recordEvidenceAwait: (...args) => state.evidence(...args) }));
vi.mock("../../../stores/weakConcepts.js", () => ({ read: vi.fn(async () => ({})), writeAwait: vi.fn(async () => {}) }));
vi.mock("../../../questionPool.js", () => ({ releaseUnansweredQuestions: vi.fn(async () => {}) }));
import { finalizeExamSession } from "./finalize.js";
it("links resumed homework on submission, records lecture answers once, and does not invent objectives", async () => {
  state.record.mockClear(); state.evidence.mockClear();
  state.session = { sessionId: "s", blockId: "nb1", status: "in_progress", questions: [{ questionId: "q", sourceType: "question-bank", sourceSection: "NB 05", sourceSectionTitle: "Neurons and Glia", stem: "Which organelle?", correct: "D" }], answers: [{ questionId: "q", value: "A" }], sideEffectsCompleted: { statsRecordedQuestionIds: [], weakConceptsRecorded: false } };
  const options = { lectures: [{ id: "l5", blockId: "nb1", lectureNumber: 5, lectureTitle: "NB 05 Neurons and Glia" }] };
  expect(await finalizeExamSession("u", "s", options)).toEqual({ ok: true });
  expect(state.session.questions[0]).toMatchObject({ lectureId: "l5", curriculumLinkStatus: "source-label-matched" });
  expect(state.record).toHaveBeenCalledWith("u", "l5", false);
  expect(state.evidence.mock.calls[0][1]).toMatchObject({ lectureId: "l5", objectiveIds: [], correct: false });
  expect(await finalizeExamSession("u", "s", options)).toMatchObject({ alreadySubmitted: true });
  expect(state.record).toHaveBeenCalledTimes(1);
});
