import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { setStoreHookUserId } from "../../hooks/currentUser.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import * as lecturesStore from "../../../stores/lectures.js";
import * as performanceStore from "../../../stores/performance.js";
import {
  __setCloudBackendForTests,
  resetCloudStores,
} from "../../../stores/cloudBase.js";
import {
  __setObjectivesBackendForTests,
} from "../../../stores/blockObjectivesCloud.js";
import { useObjectivesController } from "./useObjectivesController.js";

// Tells React that act() is legitimate here; without it every act warns.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = "u1";

const cloudBackend = {
  doc: (_db, ...segments) => segments.join("/"),
  onSnapshot: () => () => {},
  setDoc: () => Promise.resolve(),
  serverTimestamp: () => "TEST_TS",
};

const objectivesBackend = {
  collection: (_db, ...segments) => segments.join("/"),
  doc: (_db, ...segments) => segments.join("/"),
  onSnapshot: () => () => {},
  setDoc: () => Promise.resolve(),
  deleteDoc: () => Promise.resolve(),
  serverTimestamp: () => "TEST_TS",
};

/** Render the hook once and hand the caller its latest value. */
async function mount(blockId, run) {
  let latest = null;
  function Probe() {
    const controller = useObjectivesController(blockId, USER);
    // Captured in an effect, not during render — the lint rule is right that a
    // render-phase assignment would be a side effect.
    useEffect(() => { latest = controller; }, [controller]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Probe />); });
  await act(async () => { await run(latest); });
  const after = latest;
  await act(async () => { root.unmount(); });
  return after;
}

function seed({ objectives, lectures = [], performance = {} }) {
  objectivesStore.write(USER, objectives);
  lecturesStore.write(USER, lectures);
  performanceStore.write(USER, performance);
}

const stored = () => objectivesStore.read(USER);

describe("useObjectivesController", () => {
  beforeEach(() => {
    // Controller behavior is deterministic here; Firestore transport behavior
    // belongs to the dedicated store integration tests. Inert backends also
    // prevent delayed network snapshots leaking one fixture into the next.
    __setCloudBackendForTests(cloudBackend);
    __setObjectivesBackendForTests(objectivesBackend);
    installDomStorage();
    setStoreHookUserId(null);
  });

  afterEach(() => {
    objectivesStore.resetObjectivesStore();
    resetCloudStores();
    __setObjectivesBackendForTests(null);
    __setCloudBackendForTests(null);
  });

  it("exposes the block's objectives, deduped by text, plus its lectures", async () => {
    seed({
      objectives: {
        b1: {
          imported: [
            { id: "a", objective: "Describe the brachial plexus.", linkedLecId: "lec1" },
            { id: "dup", objective: "describe the BRACHIAL plexus!" },
          ],
          extracted: [{ id: "c", objective: "Name the rotator cuff." }],
        },
        b2: [{ id: "z", objective: "Other block." }],
      },
      lectures: [
        { id: "lec1", blockId: "b1", lectureTitle: "Plexus" },
        { id: "lec9", blockId: "b2" },
      ],
    });

    const controller = await mount("b1", () => {});

    expect(controller.objectives.map((o) => o.id)).toEqual(["a", "c"]);
    expect(controller.blockLectures.map((l) => l.id)).toEqual(["lec1"]);
  });

  it("writes a status change back through the store", async () => {
    seed({ objectives: { b1: { imported: [{ id: "a", objective: "One." }], extracted: [] } } });

    await mount("b1", (c) => c.onUpdateObjectiveStatus("a", "mastered"));

    const written = stored().b1.imported[0];
    expect(written.status).toBe("mastered");
    expect(written.lastUpdated).toBeTruthy();
  });

  it("assigns, unlinks and deletes through the same store slot", async () => {
    seed({
      objectives: { b1: [{ id: "a", objective: "One." }, { id: "b", objective: "Two." }] },
      lectures: [{ id: "lec1", blockId: "b1" }],
    });

    await mount("b1", (c) => c.onAssignMultipleToLecture(["a", "b"], "lec1"));
    expect(stored().b1.every((o) => o.linkedLecId === "lec1")).toBe(true);

    await mount("b1", (c) => c.onRemoveObjectiveLink("b"));
    expect(stored().b1.find((o) => o.id === "b").linkedLecId).toBeNull();

    await mount("b1", (c) => c.onDeleteSingleObjective("a"));
    expect(stored().b1.map((o) => o.id)).toEqual(["b"]);
  });

  it("drops objectives that point at no lecture in this block", async () => {
    seed({
      objectives: {
        b1: [
          { id: "a", objective: "Linked.", linkedLecId: "lec1" },
          { id: "b", objective: "Imported.", linkedLecId: "imported" },
          { id: "c", objective: "Dangling.", linkedLecId: "gone" },
        ],
      },
      lectures: [{ id: "lec1", blockId: "b1" }],
    });

    await mount("b1", (c) => c.onDeleteUnlinkedObjectives());

    expect(stored().b1.map((o) => o.id)).toEqual(["a"]);
  });

  it("leaves other blocks untouched", async () => {
    seed({
      objectives: {
        b1: [{ id: "a", objective: "One." }],
        b2: [{ id: "z", objective: "Other." }],
      },
    });

    await mount("b1", (c) => c.onDeleteSingleObjective("a"));

    expect(stored().b2).toEqual([{ id: "z", objective: "Other." }]);
  });

  it("renames a lecture without disturbing lectures in other blocks", async () => {
    seed({
      objectives: { b1: [] },
      lectures: [
        { id: "lec1", blockId: "b1", lectureTitle: "Old" },
        { id: "lec9", blockId: "b2", lectureTitle: "Keep" },
      ],
    });

    await mount("b1", (c) => c.onRenameLecture("lec1", "  New title  "));

    const lecs = lecturesStore.read(USER);
    expect(lecs.find((l) => l.id === "lec1").lectureTitle).toBe("New title");
    expect(lecs.find((l) => l.id === "lec9").lectureTitle).toBe("Keep");
  });

  it("reads lecture performance by exact key, then by any older key for that lecture", async () => {
    seed({
      objectives: { b1: [] },
      performance: { "lec1__b1": { accuracy: 0.9 }, "lec2__legacy": { accuracy: 0.4 } },
    });

    const controller = await mount("b1", () => {});

    expect(controller.getLecPerf({ id: "lec1" }, "b1")).toEqual({ accuracy: 0.9 });
    expect(controller.getLecPerf({ id: "lec2" }, "b1")).toEqual({ accuracy: 0.4 });
    expect(controller.getLecPerf({ id: "lec3" }, "b1")).toBeNull();
  });
});
