import { describe, it, expect } from "vitest";
import { cardToRow } from "./ankiCards.js";

const terms = [{ id: "ftm1id", name: "FTM 1", blocks: [{ id: "ftm1", name: "FTM 1" }] }];
const path = "AnKing::Proper Learning::Term 1::FTM 1::Week 1::Apoptosis::Pickle";

describe("cardToRow", () => {
  it("maps a note to an anki_cards row with revealed cloze and resolved block", () => {
    const note = {
      noteId: 123,
      tags: ["DrPickle"],
      fields: {
        Text: { value: 'The two types of cell death are {{c1::necrosis}} and {{c1::apoptosis}}', order: 0 },
        Extra: { value: "", order: 1 },
      },
    };
    const row = cardToRow(note, path, terms);
    expect(row.card_id).toBe("123");
    expect(row.block_id).toBe("ftm1");
    expect(row.term_id).toBe("ftm1id");
    expect(row.subject).toBe("Week 1");
    expect(row.text).toContain("necrosis and apoptosis");
    expect(row.has_media).toBe(false);
    expect(row.tags).toEqual(expect.arrayContaining(["DrPickle", "Apoptosis"]));
    expect(row.source_deck).toBe(path);
  });

  it("flags media and returns null for empty/short text", () => {
    const media = { noteId: 9, tags: [], fields: { Text: { value: '<img src="x.jpg"> Identify the {{c1::pneumonia}} on this chest film', order: 0 } } };
    expect(cardToRow(media, path, terms).has_media).toBe(true);
    const empty = { noteId: 10, tags: [], fields: { Text: { value: "", order: 0 } } };
    expect(cardToRow(empty, path, terms)).toBeNull();
    expect(cardToRow({ noteId: 1, fields: {} }, "AnKing::Other::x", terms)).toBeNull();
  });
});
