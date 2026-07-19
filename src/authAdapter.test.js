import { describe, it, expect, beforeAll } from "vitest";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";
import { getCurrentUser } from "./supabase";

describe("auth adapter", () => {
  beforeAll(async () => {
    try { await createUserWithEmailAndPassword(auth, "t@t.com", "pw1234"); } catch {}
    await signInWithEmailAndPassword(auth, "t@t.com", "pw1234");
  });
  it("getCurrentUser returns the signed-in user", async () => {
    const u = await getCurrentUser();
    expect(u?.email).toBe("t@t.com");
    expect(u?.id).toBeTruthy();
  });
});
