// @vitest-environment jsdom
// (push/pull round-trip through localStorage, which the default 'node' test
// environment doesn't provide; jsdom is scoped to just this file.)
import { describe, it, expect, beforeAll } from "vitest";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc } from "firebase/firestore";
import { auth, db } from "./firebase";
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

  it("pull is not empty for a kv-only account (no state/objectives/lectures)", async () => {
    // Fresh user so no state/terms/objectives/lectures docs exist at all —
    // the ONLY cloud data for this account is a single kv doc. This is the
    // exact shape that used to trip the early `{ empty: true }` return and
    // silently skip pullUserKvFromSupabase.
    try { await createUserWithEmailAndPassword(auth, "kvonly@d.com", "pw1234"); } catch {}
    const cred = await signInWithEmailAndPassword(auth, "kvonly@d.com", "pw1234");
    const kvUid = cred.user.uid;

    const kvRef = doc(db, "users", kvUid, "kv", __test.encodeDocId("rxt-question-notes"));
    await __test.writeDoc(kvRef, { note: "hello" });

    localStorage.clear();
    const { pullAllDataFromSupabase } = await import("./supabase");
    const result = await pullAllDataFromSupabase(kvUid);
    expect(result).not.toEqual({ empty: true });

    // pullUserKvFromSupabase runs in the background (fire-and-forget) off the
    // non-empty path — give it a tick to land in localStorage.
    await new Promise((r) => setTimeout(r, 300));
    expect(JSON.parse(localStorage.getItem("rxt-question-notes"))).toEqual({ note: "hello" });
  });

  it("saveMcqBankEntry then pull restores the question", async () => {
    // The previous test signed in as a different user (kvonly@d.com) —
    // restore auth to the original `uid` before writing to its subtree,
    // or Firestore rules' owner(uid) check denies the write.
    await signInWithEmailAndPassword(auth, "d@d.com", "pw1234");
    const { saveMcqBankEntry, pullMcqBankFromSupabase } = await import("./supabase");
    await saveMcqBankEntry(uid, "obj1", 0, { stem: "Q?" });
    localStorage.removeItem("rxt-mcq-bank");
    await pullMcqBankFromSupabase(uid);
    const bank = JSON.parse(localStorage.getItem("rxt-mcq-bank"));
    expect(bank["obj1_r0"].stem).toBe("Q?");
  });
});
