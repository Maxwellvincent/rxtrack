// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { installDomStorage } from "./stores/testEnv.js";
import { addLectureTombstoneId, readLectureTombstoneIds } from "./firebaseData.js";

beforeEach(() => installDomStorage());

it("reads tombstones in both the legacy { oldId } shape and the plain-id shape written today", () => {
  localStorage.setItem("rxt-id-tombstones", JSON.stringify([{ oldId: "legacy" }]));
  addLectureTombstoneId("deleted-now");
  expect([...readLectureTombstoneIds()].sort()).toEqual(["deleted-now", "legacy"]);
});
