import { describe, expect, it, vi } from "vitest";
import {
  fetchTeachingMaps,
  hasTeachingMap,
  stripTeachingMap,
  teachingMapSectionCount,
  teachingMapStub,
  withTeachingMaps,
} from "./lectureTeachingMap.js";

const map = {
  clinicalHook: "A 42-year-old with bitemporal hemianopsia.",
  summary: "The pituitary.",
  sections: [{ title: "Anatomy" }, { title: "Physiology" }, { title: "Pathology" }],
};

describe("teachingMapStub", () => {
  it("keeps only what the badge needs", () => {
    expect(teachingMapStub(map)).toEqual({ sections: 3, hasHook: true });
  });

  it("is null for a map with nothing in it", () => {
    expect(teachingMapStub({ sections: [] })).toBeNull();
    expect(teachingMapStub(null)).toBeNull();
  });
});

describe("stripTeachingMap", () => {
  it("swaps the body for the stub and leaves everything else", () => {
    const row = stripTeachingMap({ id: "l1", lectureTitle: "Pituitary", teachingMap: map, lectureDate: "2026-08-12" });
    expect(row).toEqual({
      id: "l1",
      lectureTitle: "Pituitary",
      lectureDate: "2026-08-12",
      teachingMapMeta: { sections: 3, hasHook: true },
    });
    expect(JSON.stringify(row).length).toBeLessThan(140);
  });

  it("leaves a lecture with no map alone", () => {
    const row = { id: "l2" };
    expect(stripTeachingMap(row)).toBe(row);
  });

  it("drops an empty map rather than leaving a useless stub", () => {
    expect(stripTeachingMap({ id: "l3", teachingMap: { sections: [] } })).toEqual({ id: "l3" });
  });
});

describe("hasTeachingMap / teachingMapSectionCount", () => {
  it("reads either form", () => {
    expect(hasTeachingMap({ teachingMap: map })).toBe(true);
    expect(hasTeachingMap({ teachingMapMeta: { sections: 3 } })).toBe(true);
    expect(hasTeachingMap({ id: "none" })).toBe(false);

    expect(teachingMapSectionCount({ teachingMap: map })).toBe(3);
    expect(teachingMapSectionCount({ teachingMapMeta: { sections: 4 } })).toBe(4);
    expect(teachingMapSectionCount({})).toBe(0);
  });
});

describe("withTeachingMaps", () => {
  it("folds fetched maps onto the rows", () => {
    const out = withTeachingMaps([{ id: "a" }, { id: "b" }], { a: map });
    expect(out[0].teachingMap).toBe(map);
    expect(out[1].teachingMap).toBeUndefined();
  });

  it("never overwrites a map the row already has", () => {
    const fresh = { ...map, summary: "generated this session" };
    const out = withTeachingMaps([{ id: "a", teachingMap: fresh }], { a: map });
    expect(out[0].teachingMap).toBe(fresh);
  });

  it("returns the rows untouched when there is nothing to fold", () => {
    const rows = [{ id: "a" }];
    expect(withTeachingMaps(rows, {})).toBe(rows);
  });
});

describe("fetchTeachingMaps", () => {
  it("fetches only the lectures that have a map and lack the body", async () => {
    const fetchContent = vi.fn(async (_uid, id) => ({ meta: { teachingMap: { ...map, id } } }));
    const lectures = [
      { id: "needs", teachingMapMeta: { sections: 3 } },
      { id: "hasBody", teachingMap: map },
      { id: "noMap" },
    ];

    const out = await fetchTeachingMaps("u1", lectures, fetchContent);

    expect(Object.keys(out)).toEqual(["needs"]);
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("skips a lecture whose fetch fails rather than failing the batch", async () => {
    const fetchContent = vi.fn(async (_uid, id) => {
      if (id === "bad") throw new Error("offline");
      return { meta: { teachingMap: map } };
    });
    const out = await fetchTeachingMaps("u1", [
      { id: "bad", teachingMapMeta: { sections: 1 } },
      { id: "good", teachingMapMeta: { sections: 3 } },
    ], fetchContent);

    expect(Object.keys(out)).toEqual(["good"]);
  });

  it("does nothing when signed out", async () => {
    const fetchContent = vi.fn();
    expect(await fetchTeachingMaps(null, [{ id: "a", teachingMapMeta: { sections: 1 } }], fetchContent)).toEqual({});
    expect(fetchContent).not.toHaveBeenCalled();
  });
});
