import { describe, it, expect } from "vitest";
import {
  parseImageRefs,
  isUsableImage,
  imageForAtom,
  attachImagesToQuestions,
  CONTEXT_WINDOW,
} from "./lectureImages.js";

describe("parseImageRefs", () => {
  it("finds marker's image refs in order with their filenames", () => {
    const md = "intro\n\n![](_page_5_Figure_1.jpeg)\n\nmiddle\n\n![](_page_9_Picture_3.jpeg)\n";
    const refs = parseImageRefs(md);
    expect(refs.map((r) => r.file)).toEqual(["_page_5_Figure_1.jpeg", "_page_9_Picture_3.jpeg"]);
  });

  it("keeps the surrounding markdown as context so an atom can be matched to it", () => {
    const md = "Thyroid follicles are lined by cuboidal cells.\n\n![](_page_2_Figure_1.jpeg)\n\nColloid fills the lumen.";
    const [ref] = parseImageRefs(md);
    expect(ref.context).toContain("Thyroid follicles");
    expect(ref.context).toContain("Colloid fills the lumen");
  });

  it("caps context so one image cannot carry the whole lecture", () => {
    const md = "x".repeat(5000) + "\n![](_page_1_Figure_1.jpeg)\n" + "y".repeat(5000);
    const [ref] = parseImageRefs(md);
    expect(ref.context.length).toBeLessThanOrEqual(CONTEXT_WINDOW * 2);
  });

  it("ignores an image that is not a marker extraction (remote URLs, badges)", () => {
    const md = "![logo](https://example.com/logo.png)\n![](_page_1_Figure_1.jpeg)";
    expect(parseImageRefs(md).map((r) => r.file)).toEqual(["_page_1_Figure_1.jpeg"]);
  });

  it("returns nothing for empty or missing markdown", () => {
    expect(parseImageRefs("")).toEqual([]);
    expect(parseImageRefs(null)).toEqual([]);
  });
});

describe("isUsableImage", () => {
  it("keeps histology, clinical photos and diagrams", () => {
    expect(isUsableImage({ kind: "histology", url: "u" })).toBe(true);
    expect(isUsableImage({ kind: "clinical", url: "u" })).toBe(true);
    expect(isUsableImage({ kind: "diagram", url: "u" })).toBe(true);
  });

  it("drops decoration — logos, headshots, slide furniture", () => {
    expect(isUsableImage({ kind: "decorative", url: "u" })).toBe(false);
  });

  it("drops an image with no URL to render", () => {
    expect(isUsableImage({ kind: "histology" })).toBe(false);
  });
});

describe("imageForAtom", () => {
  const histo = {
    file: "a.jpeg",
    url: "u/a",
    kind: "histology",
    shows: "Photomicrograph of thyroid follicles filled with colloid",
    context: "The thyroid gland stores hormone as colloid.",
  };
  const other = {
    file: "b.jpeg",
    url: "u/b",
    kind: "diagram",
    shows: "Flow chart of the renin-angiotensin system",
    context: "Angiotensin II raises blood pressure.",
  };

  it("matches an atom to the image whose label names it", () => {
    const atom = { term: "Colloid", content: "Stored thyroglobulin in the follicle lumen." };
    expect(imageForAtom(atom, [other, histo])?.file).toBe("a.jpeg");
  });

  it("falls back to the markdown context when the label does not name the term", () => {
    const atom = { term: "Angiotensin II", content: "Vasoconstrictor." };
    expect(imageForAtom(atom, [histo, other])?.file).toBe("b.jpeg");
  });

  it("prefers histology over a diagram when both match", () => {
    const dia = { ...other, shows: "Diagram of thyroid follicles", context: "" };
    expect(imageForAtom({ term: "thyroid follicles" }, [dia, histo])?.file).toBe("a.jpeg");
  });

  it("prefers a clinical photo over a diagram — the patient beats the drawing", () => {
    const dia = { file: "d.jpeg", url: "u/d", kind: "diagram", shows: "Diagram of exophthalmos", context: "" };
    const pic = { file: "c.jpeg", url: "u/c", kind: "clinical", shows: "Bilateral exophthalmos", context: "" };
    expect(imageForAtom({ term: "exophthalmos" }, [dia, pic])?.file).toBe("c.jpeg");
  });

  it("returns null rather than forcing an unrelated picture onto the question", () => {
    expect(imageForAtom({ term: "Osteoclast" }, [histo, other])).toBe(null);
  });

  it("ignores decorative images entirely", () => {
    const deco = { ...histo, kind: "decorative" };
    expect(imageForAtom({ term: "Colloid" }, [deco])).toBe(null);
  });

  it("does not match on short filler words shared by every atom", () => {
    const atom = { term: "The of and", content: "" };
    expect(imageForAtom(atom, [histo, other])).toBe(null);
  });

  it("survives an empty image list", () => {
    expect(imageForAtom({ term: "Colloid" }, [])).toBe(null);
    expect(imageForAtom({ term: "Colloid" }, null)).toBe(null);
  });
});

describe("attachImagesToQuestions", () => {
  const images = [
    { file: "a.jpeg", url: "u/a", kind: "histology", shows: "Thyroid follicles with colloid", context: "" },
  ];
  const atoms = [
    { term: "Colloid", content: "Stored thyroglobulin." },
    { term: "Osteoclast", content: "Resorbs bone." },
  ];

  it("gives a question the image belonging to the atom it tests", () => {
    const qs = [{ stem: "s", topic: "Colloid", choices: { A: "1", B: "2" }, correct: "A" }];
    expect(attachImagesToQuestions(qs, atoms, images)[0].image).toMatchObject({ url: "u/a" });
  });

  it("pairs by position when the model did not echo the term as topic", () => {
    const qs = [
      { stem: "s1", topic: "", choices: {}, correct: "A" },
      { stem: "s2", topic: "", choices: {}, correct: "A" },
    ];
    const out = attachImagesToQuestions(qs, atoms, images);
    expect(out[0].image?.url).toBe("u/a");
    expect(out[1].image).toBeUndefined();
  });

  it("leaves questions untouched when the lecture has no images", () => {
    const qs = [{ stem: "s", topic: "Colloid" }];
    expect(attachImagesToQuestions(qs, atoms, [])).toEqual(qs);
  });

  it("never puts the image's own label into the stem — that would give the answer away", () => {
    const qs = [{ stem: "A 40-year-old woman...", topic: "Colloid" }];
    const [q] = attachImagesToQuestions(qs, atoms, images);
    expect(q.stem).toBe("A 40-year-old woman...");
    expect(q.stem).not.toContain("Thyroid follicles");
  });
});
