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
  it("shows the original unkeyed figure and source", () => {
    render(<SchoolQuestionFigure question={{ hasImage: true, sourceImageUrl: "https://example.com/original.png", sourceFile: "IMCQ.pdf", sourcePage: 6 }} />);
    expect(host.querySelector("img").getAttribute("src")).toBe("https://example.com/original.png");
    expect(host.textContent).toContain("IMCQ.pdf · page 6");
    act(() => host.querySelector("img").dispatchEvent(new window.Event("error")));
    expect(host.querySelector('[role="status"]').textContent).toContain("do not answer");
  });
  it("warns if an image question has no image, but leaves text-only questions alone", () => {
    render(<SchoolQuestionFigure question={{ hasImage: true }} />);
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    render(<SchoolQuestionFigure question={{ hasImage: false }} />);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
