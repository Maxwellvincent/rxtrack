import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { SchoolQuestionFigure } from "./SchoolQuestionFigure.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  installDomStorage();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = (ui) => act(() => root.render(ui));
describe("SchoolQuestionFigure", () => {
  it("keeps the duplicate source page collapsed until requested", () => {
    render(<SchoolQuestionFigure question={{ hasImage: true, sourceImageUrl: "https://example.com/original.png", sourceFile: "IMCQ.pdf", sourcePage: 6 }} />);
    const disclosure = host.querySelector("details");
    expect(disclosure.open).toBe(false);
    expect(host.textContent).toContain("Show source figure / page · page 6");
    act(() => disclosure.querySelector("summary").click());
    expect(host.querySelector("img").getAttribute("src")).toBe("https://example.com/original.png");
    expect(host.textContent).toContain("IMCQ.pdf · page 6");
    act(() => host.querySelector("img").dispatchEvent(new window.Event("error")));
    expect(host.querySelector('[role="status"]').textContent).toContain("Do not answer");
  });
  it("warns for a missing source visual, including an unflagged figure reference", () => {
    render(<SchoolQuestionFigure question={{ hasImage: true }} />);
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    render(<SchoolQuestionFigure question={{ stem: "A figure showing Hb gene switching is shown. Which line is higher?" }} />);
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    render(<SchoolQuestionFigure question={{ hasImage: false }} />);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
