import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { TutorPanel } from "./TutorPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(ui) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    rerender: (nextUi) => act(() => root.render(nextUi)),
    unmount: () => act(() => root.unmount()),
  };
}

const QUESTION = { questionId: "q1", stem: "stem" };

beforeEach(() => {
  installDomStorage();
});

describe("TutorPanel", () => {
  it("renders an initial trigger and calls onRequest when clicked", () => {
    const onRequest = vi.fn();
    const { host } = render(
      <TutorPanel question={QUESTION} onRequest={onRequest} text={null} loading={false} error={null} />
    );

    const button = host.querySelector("button");
    expect(button).toBeTruthy();
    act(() => button.click());
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("renders a distinct loading state", () => {
    const { host } = render(
      <TutorPanel question={QUESTION} onRequest={() => {}} text={null} loading={true} error={null} />
    );
    expect(host.querySelector('[data-testid="tutor-panel-loading"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="tutor-panel-error"]')).toBeFalsy();
    expect(host.querySelector('[data-testid="tutor-panel-text"]')).toBeFalsy();
  });

  it("renders a distinct, low-alarm error state", () => {
    const { host } = render(
      <TutorPanel question={QUESTION} onRequest={() => {}} text={null} loading={false} error="boom" />
    );
    const errorEl = host.querySelector('[data-testid="tutor-panel-error"]');
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).not.toMatch(/boom/i);
    expect(host.querySelector('[data-testid="tutor-panel-loading"]')).toBeFalsy();
  });

  it("renders the text once loaded", () => {
    const { host } = render(
      <TutorPanel
        question={QUESTION}
        onRequest={() => {}}
        text="Here's the breakdown."
        loading={false}
        error={null}
      />
    );
    const textEl = host.querySelector('[data-testid="tutor-panel-text"]');
    expect(textEl).toBeTruthy();
    expect(textEl.textContent).toBe("Here's the breakdown.");
  });
});
