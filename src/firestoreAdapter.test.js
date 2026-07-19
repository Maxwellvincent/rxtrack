// @vitest-environment jsdom
// (push/pull round-trip through localStorage, which the default 'node' test
// environment doesn't provide; jsdom is scoped to just this file.)
import { describe, it, expect, beforeAll } from "vitest";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";
import { __test } from "./supabase"; // export the primitives under __test

describe("firestore doc primitives", () => {
  let uid;
  beforeAll(async () => {
    try { await createUserWithEmailAndPassword(auth, "d@d.com", "pw1234"); } catch {}
    const cred = await signInWithEmailAndPassword(auth, "d@d.com", "pw1234");
    uid = cred.user.uid;
  });
  it("writeDoc then readDoc round-trips the JSON value", async () => {
    const ref = __test.stateRef(uid, "terms");
    await __test.writeDoc(ref, [{ id: "t1", name: "Term 1" }]);
    const got = await __test.readDoc(ref);
    expect(got).toEqual([{ id: "t1", name: "Term 1" }]);
  });

  it("push writes state/terms, pull merges it back", async () => {
    localStorage.setItem("rxt-terms", JSON.stringify([{ id: "t1", blocks: [{ id: "b1" }] }]));
    const { pushAllLocalDataToSupabase, pullAllDataFromSupabase } = await import("./supabase");
    await pushAllLocalDataToSupabase(uid);
    localStorage.removeItem("rxt-terms");
    await pullAllDataFromSupabase(uid);
    expect(JSON.parse(localStorage.getItem("rxt-terms"))[0].id).toBe("t1");
  });
});
