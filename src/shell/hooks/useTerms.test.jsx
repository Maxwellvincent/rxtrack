import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../stores/testEnv.js";
import { useTerms } from "./useTerms.js";
import { setStoreHookUserId } from "./currentUser.js";

describe("useTerms", () => {
  beforeEach(() => {
    installDomStorage();
    setStoreHookUserId(null);
  });

  it("reads the current user scoped store and reacts to mutate", async () => {
    const seen = [];
    function Probe() {
      const terms = useTerms("u1");
      useEffect(() => {
        seen.push(terms.data.map((term) => term.id).join(","));
        if (seen.length === 1) terms.mutate([{ id: "t1", blocks: [] }]);
      }, [terms]);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Probe />); });

    expect(seen).toContain("");
    expect(seen).toContain("t1");
    await act(async () => { root.unmount(); });
  });
});
