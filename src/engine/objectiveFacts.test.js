import { describe, expect, it } from "vitest";
import { cardsToSeed, objectivesToCards } from "./objectiveFacts.js";

const lecturesById = new Map([["lec1", { id: "lec1", lectureTitle: "Lecture 01 - Endocrine System" }]]);
const long = (n) => "Describe the mechanism by which ".padEnd(n, "x");

describe("objectivesToCards", () => {
  it("maps an objective to the shape the Cloud Function reads", () => {
    const [row] = objectivesToCards(
      [{ id: "o1", linkedLecId: "lec1", objective: "Explain the regulation of thyroid hormone synthesis.", code: "SOM.1ai.BMP2.2.ER.1.PHYS.0705" }],
      { blockId: "endo", lecturesById }
    );
    expect(row).toEqual({
      card_id: "obj-o1",
      block_id: "endo",
      subject: "Lecture 01 - Endocrine System",
      lecture: "Lecture 01 - Endocrine System",
      text: "Explain the regulation of thyroid hormone synthesis.",
      source: "objective",
      objective_id: "o1",
      objective_code: "SOM.1ai.BMP2.2.ER.1.PHYS.0705",
    });
  });

  it("falls back to the activity when the lecture is unknown", () => {
    const [row] = objectivesToCards(
      [{ id: "o1", linkedLecId: "missing", text: "Explain the regulation of thyroid hormone synthesis.", activity: "LEC" }],
      { blockId: "endo", lecturesById }
    );
    expect(row.subject).toBe("LEC");
    expect(row.lecture).toBeNull();
  });

  it("skips a fact too short to build a case on", () => {
    expect(objectivesToCards([{ id: "o1", text: "Thyroid." }], { blockId: "endo" })).toEqual([]);
  });

  it("skips a fact long enough to be a paragraph", () => {
    expect(objectivesToCards([{ id: "o1", text: long(700) }], { blockId: "endo" })).toEqual([]);
  });

  it("dedupes by code, because this data has duplicate rows sharing one", () => {
    const rows = objectivesToCards(
      [
        { id: "o1", code: "SOM.X.0705", text: "Explain the regulation of thyroid hormone synthesis." },
        { id: "o2", code: "SOM.X.0705", text: "Explain the regulation of thyroid hormone synthesis." },
      ],
      { blockId: "endo" }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].card_id).toBe("obj-o1");
  });

  it("dedupes uncoded objectives by their text", () => {
    const rows = objectivesToCards(
      [
        { id: "o1", text: "Explain the regulation of thyroid hormone synthesis." },
        { id: "o2", text: "explain the REGULATION of thyroid hormone synthesis." },
      ],
      { blockId: "endo" }
    );
    expect(rows).toHaveLength(1);
  });

  it("gives a stable card_id, so a re-seed overwrites rather than duplicates", () => {
    const once = objectivesToCards([{ id: "o1", text: "Explain the regulation of thyroid hormone synthesis." }], { blockId: "endo" });
    const twice = objectivesToCards([{ id: "o1", text: "Explain the regulation of thyroid hormone synthesis." }], { blockId: "endo" });
    expect(once[0].card_id).toBe(twice[0].card_id);
  });

  it("survives no objectives at all", () => {
    expect(objectivesToCards(undefined, { blockId: "endo" })).toEqual([]);
  });
});

describe("cardsToSeed", () => {
  const rows = [{ card_id: "obj-1" }, { card_id: "obj-2" }, { card_id: "obj-3" }];

  it("leaves out what is already queued", () => {
    expect(cardsToSeed(rows, { existingCardIds: ["obj-2"] }).map((r) => r.card_id)).toEqual(["obj-1", "obj-3"]);
  });

  it("leaves out what has already been generated — regenerating costs money", () => {
    expect(cardsToSeed(rows, { generatedCardIds: ["obj-1", "obj-3"] }).map((r) => r.card_id)).toEqual(["obj-2"]);
  });

  it("returns everything when nothing exists yet", () => {
    expect(cardsToSeed(rows)).toHaveLength(3);
  });
});
