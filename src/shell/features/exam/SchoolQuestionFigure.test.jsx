import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { SchoolQuestionFigure, questionReferencesVisual } from "./SchoolQuestionFigure.jsx";
vi.mock("../../../supabase.js", () => ({ fetchQuestionBankSourceBytes: vi.fn(async () => new Uint8Array([37,80,68,70]).buffer), uploadQuestionBankPage: vi.fn(async () => "https://example.com/saved-crop.jpg") }));
vi.mock("../../../examParser.js", () => ({ loadPDFJS: vi.fn(async () => {}) }));
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
    expect(host.textContent).toContain("Show source figure · page 6");
    act(() => disclosure.querySelector("summary").click());
    expect(host.querySelector("img").getAttribute("src")).toBe("https://example.com/original.png");
    expect(host.textContent).toContain("may include the answer choices or key");
    expect(host.textContent).toContain("Use cropped figure");
    expect(host.textContent).toContain("IMCQ.pdf · visual page 6");
    act(() => host.querySelector("img").dispatchEvent(new window.Event("error")));
    expect(host.querySelector('[role="status"]').textContent).toContain("Do not answer");
  });
  it("shows a previously saved figure crop instead of the answer-bearing source page", () => {
    const question = { id: "q4", hasImage: true, sourceImageUrl: "https://example.com/page.png", sourceFile: "IMCQ.pdf", sourcePage: 4 };
    localStorage.setItem("rxtrack-school-figure-crop:IMCQ.pdf:q4", "data:image/jpeg;base64,crop");
    render(<SchoolQuestionFigure question={question} />);
    act(() => host.querySelector("summary").click());
    expect(host.querySelector("img").getAttribute("src")).toBe("data:image/jpeg;base64,crop");
    expect(host.textContent).not.toContain("may include the answer choices or key");
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

it("loads the next archived source page on demand for cropping without re-uploading", async () => {
  const getPage = vi.fn(async () => ({ getViewport: () => ({ width: 500, height: 700 }), render: () => ({ promise: Promise.resolve() }) }));
  window.pdfjsLib = { getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 8, getPage, destroy: vi.fn() }) })) };
  const context = vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue({});
  const dataUrl = vi.spyOn(window.HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,page8");
  render(<SchoolQuestionFigure question={{ hasImage: true, sourceImageUrl: "https://example.com/page7.png", sourcePage: 7, sourceStoragePath: "exam-sources/u1/original.pdf" }} userId="u1" />);
  const next = [...host.querySelectorAll("button")].find(b => b.textContent === "Next source page");
  await act(async () => { next.click(); await Promise.resolve(); });
  expect(getPage).toHaveBeenCalledWith(8);
  expect(host.querySelector("img").getAttribute("src")).toBe("data:image/jpeg;base64,page8");
  expect(host.textContent).toContain("Show source figure · page 8");
  context.mockRestore(); dataUrl.mockRestore(); delete window.pdfjsLib;
});

it("detects plural photomicrographs and exposes original page recovery when no exhibit was extracted", () => {
  expect(questionReferencesVisual("A biopsy is shown in the attached photomicrographs.")).toBe(true);
  render(<SchoolQuestionFigure question={{ stem:"A biopsy is shown in the attached photomicrographs.", sourcePage:10, sourceStoragePath:"exam-sources/u1/original.pdf" }} userId="u1" />);
  expect(host.textContent).toContain("Load original question page");
  expect(host.querySelector("details").open).toBe(true);
  expect([...host.querySelectorAll("button")].find(b=>b.textContent==="Use cropped figure").disabled).toBe(true);
  expect(host.textContent).toContain("Select a figure area first");
});
it('enables cropping after a loaded image and a real selection, then displays the saved crop', async () => {
  const draw=vi.fn();
  const context=vi.spyOn(window.HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw});
  const data=vi.spyOn(window.HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,selected');
  render(<SchoolQuestionFigure question={{id:'crop-test',hasImage:true,sourceImageUrl:'https://example.com/source.jpg'}} />);
  const image=host.querySelector('img');const region=image.parentElement;
  Object.defineProperties(image,{naturalWidth:{value:1000},naturalHeight:{value:1000}});
  region.getBoundingClientRect=()=>({left:0,top:0,width:500,height:500});
  const save=[...host.querySelectorAll('button')].find(b=>b.textContent==='Use cropped figure');
  act(()=>image.dispatchEvent(new window.Event('load')));
  act(()=>region.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,clientX:50,clientY:50})));
  act(()=>region.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:250,clientY:250})));
  act(()=>region.dispatchEvent(new window.MouseEvent('pointerup',{bubbles:true})));
  expect(save.disabled).toBe(false);
  await act(async()=>save.click());
  expect(draw).toHaveBeenCalled();expect(host.querySelector('img').alt).toBe('Cropped question figure');
  context.mockRestore();data.mockRestore();
});

it("offers figure recovery for Site X/Y and see-attached dependencies",()=>{
 for(const stem of ['Entered at Site X and lodged at Site Y. Which trajectory?', 'Imaging shows a hematoma (see attached). Which diagnosis?']) {
  expect(questionReferencesVisual(stem)).toBe(true);
  render(<SchoolQuestionFigure question={{stem,sourceFile:'NB.pdf',sourceStoragePath:'source.pdf'}}/>);
  expect(host.textContent).toContain('Load original question page');
 }
 expect(questionReferencesVisual('CT imaging reveals a mass. Which hormone is increased?')).toBe(false);
});
