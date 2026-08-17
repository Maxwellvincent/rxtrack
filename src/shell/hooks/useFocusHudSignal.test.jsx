import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../stores/testEnv.js";

// Tells React that act() is legitimate here; without it every act warns.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stop = vi.fn();
const track = vi.fn(() => stop);

vi.mock("../../focusHudSignal.js", () => ({
  trackFocusHudActivity: (...args) => track(...args),
}));

const { useFocusHudSignal } = await import("./useFocusHudSignal.js");

function Probe({ detail, enabled = true }) {
  useFocusHudSignal("questions", detail, { enabled });
  return null;
}

function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));

  return {
    rerender: (next) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  // The suite runs in node; this is how the rest of the hook tests get a DOM.
  installDomStorage();
  track.mockClear();
  stop.mockClear();
  document.body.innerHTML = "";
});

describe("useFocusHudSignal", () => {
  it("starts a signal on mount and stops it on unmount", () => {
    const view = mount(<Probe detail="Lecture 1" />);
    expect(track).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not start when disabled", () => {
    mount(<Probe detail="Lecture 1" enabled={false} />);
    expect(track).not.toHaveBeenCalled();
  });

  it("reports the current detail without restarting the signal", () => {
    // Moving to the next lecture mid-session must not reset the start time.
    const view = mount(<Probe detail="Lecture 1" />);
    const getDetail = track.mock.calls[0][1].detail;
    expect(getDetail()).toBe("Lecture 1");

    view.rerender(<Probe detail="Lecture 2" />);
    expect(track).toHaveBeenCalledTimes(1);
    expect(getDetail()).toBe("Lecture 2");
  });
});
