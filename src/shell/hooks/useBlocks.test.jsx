import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../stores/testEnv.js";
import { setStoreHookUserId } from "./currentUser.js";
import * as termsStore from "../../stores/terms.js";
import * as lecturesStore from "../../stores/lectures.js";
import { useBlocks } from "./useBlocks.js";

// Tells React that act() is legitimate here; without it every act warns.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = "u1";

describe("useBlocks", () => {
  beforeEach(() => {
    installDomStorage();
    setStoreHookUserId(null);
  });

  it("re-renders the nav when terms or lectures change — no reload needed", async () => {
    termsStore.write(USER, [{ id: "t1", name: "Term 1", blocks: [{ id: "b1", name: "Block 1" }] }]);
    lecturesStore.write(USER, [{ id: "lec1", blockId: "b1" }]);

    const seen = [];
    function Probe() {
      const blocks = useBlocks(USER);
      useEffect(() => {
        seen.push(blocks.map((b) => `${b.id}:${b.lectureCount}`).join(","));
      }, [blocks]);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Probe />); });
    expect(seen.at(-1)).toBe("b1:1");

    // A schedule import adding a block used to leave the sidebar stale.
    await act(async () => {
      termsStore.write(USER, [
        { id: "t1", name: "Term 1", blocks: [{ id: "b1", name: "Block 1" }, { id: "b2", name: "Block 2" }] },
      ]);
    });
    expect(seen.at(-1)).toBe("b1:1,b2:0");

    // And an upload updating the per-block lecture count.
    await act(async () => {
      lecturesStore.write(USER, [{ id: "lec1", blockId: "b1" }, { id: "lec2", blockId: "b2" }]);
    });
    expect(seen.at(-1)).toBe("b1:1,b2:1");

    await act(async () => { root.unmount(); });
  });
});
