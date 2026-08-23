import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const explainQuestionMock = vi.fn();

vi.mock("./tutorMode.js", () => ({
  explainQuestion: (...args) => explainQuestionMock(...args),
}));

const { useTutorExplanation } = await import("./useTutorExplanation.js");

function makeQuestion(questionId) {
  return {
    questionId,
    stem: `Stem ${questionId}`,
    choices: { A: "a", B: "b" },
    correct: "A",
    explanation: "because",
  };
}

/** Deferred promise so a test can control resolution order. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Render the hook, letting the test swap `question` via `setQuestion`. */
function mountHook(initialQuestion, opts = {}) {
  let latest = null;
  function Probe({ question }) {
    const controller = useTutorExplanation(question, opts, {});
    useEffect(() => {
      latest = controller;
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    render: (question) =>
      act(async () => {
        root.render(<Probe question={question} />);
        await Promise.resolve();
      }),
    get: () => latest,
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  installDomStorage();
  explainQuestionMock.mockReset();
});

describe("useTutorExplanation", () => {
  it("does not auto-fetch on mount or when the question prop changes", async () => {
    const q1 = makeQuestion("auto-q1");
    const q2 = makeQuestion("auto-q2");
    const probe = mountHook(q1);

    await probe.render(q1);
    expect(explainQuestionMock).not.toHaveBeenCalled();

    await probe.render(q2);
    expect(explainQuestionMock).not.toHaveBeenCalled();

    probe.unmount();
  });

  it("dedupes a second request() call for the same questionId while one is in flight", async () => {
    const q = makeQuestion("dedupe-q1");
    const d = deferred();
    explainQuestionMock.mockReturnValue(d.promise);

    const probe = mountHook(q);
    await probe.render(q);

    let p1, p2;
    await act(async () => {
      p1 = probe.get().request();
      p2 = probe.get().request();
    });

    expect(explainQuestionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ text: "the breakdown" });
      await p1;
      await p2;
    });

    expect(probe.get().text).toBe("the breakdown");
    probe.unmount();
  });

  it("does not let a stale response for a previous questionId overwrite state after request() is called for a new one", async () => {
    const qA = makeQuestion("stale-qA");
    const qB = makeQuestion("stale-qB");
    const dA = deferred();
    const dB = deferred();

    explainQuestionMock.mockImplementation((question) => {
      return question.questionId === qA.questionId ? dA.promise : dB.promise;
    });

    const probe = mountHook(qA);
    await probe.render(qA);

    await act(async () => {
      probe.get().request();
    });
    expect(probe.get().loading).toBe(true);

    // Navigate to a new question before A's response lands.
    await probe.render(qB);
    await act(async () => {
      probe.get().request();
    });
    expect(probe.get().loading).toBe(true);

    // Resolve out of order: A (the stale one) resolves AFTER B.
    await act(async () => {
      dB.resolve({ text: "B's breakdown" });
      await Promise.resolve();
    });
    expect(probe.get().text).toBe("B's breakdown");
    expect(probe.get().loading).toBe(false);

    await act(async () => {
      dA.resolve({ text: "A's breakdown (stale)" });
      await Promise.resolve();
    });

    // The stale A response must not have overwritten B's displayed text.
    expect(probe.get().text).toBe("B's breakdown");

    probe.unmount();
  });
});
