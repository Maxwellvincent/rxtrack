// src/rules.test.js — SP0 Task 9 Step 0: security-rule unit tests against the
// Firebase emulator (Firestore + Storage). Requires the emulators to be
// running with the actual firestore.rules / storage.rules loaded. Run via:
//
//   firebase emulators:exec --only firestore,storage,auth \
//     "npx vitest run src/rules.test.js"
//
// which sets FIRESTORE_EMULATOR_HOST for us. Outside that wrapper (e.g. a
// plain `npm test`), the whole suite is skipped rather than failing on
// connection errors — so it stays safe to include in the normal test glob.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";

const HAS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const maybeDescribe = HAS_EMULATOR ? describe : describe.skip;

const PROJECT_ID = process.env.GCLOUD_PROJECT || "rxtrack-rules-test";
const UID_A = "userA";
const UID_B = "userB";

maybeDescribe("security rules (emulator)", () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
        host: "127.0.0.1",
        port: 8080,
      },
      storage: {
        rules: readFileSync(resolve(__dirname, "../storage.rules"), "utf8"),
        host: "127.0.0.1",
        port: 9199,
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
  });

  describe("firestore.rules — cross-user denial", () => {
    it("user A cannot read another user's profile/state doc", async () => {
      // Seed B's doc with rules disabled so the read attempt below is the
      // only thing being evaluated against the rules.
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(`users/${UID_B}`).set({ hello: "world" });
        await ctx.firestore().doc(`users/${UID_B}/state/prefs`).set({ x: 1 });
      });

      const a = testEnv.authenticatedContext(UID_A);
      await assertFails(a.firestore().doc(`users/${UID_B}`).get());
      await assertFails(a.firestore().doc(`users/${UID_B}/state/prefs`).get());
    });

    it("user A cannot write into another user's tree", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      await assertFails(
        a.firestore().doc(`users/${UID_B}/kv/someKey`).set({ v: 1 })
      );
      await assertFails(
        a.firestore().doc(`users/${UID_B}/lectures/lec1`).set({ title: "x" })
      );
    });

    it("an unauthenticated client cannot read or write any user tree", async () => {
      const anon = testEnv.unauthenticatedContext();
      await assertFails(anon.firestore().doc(`users/${UID_A}`).get());
      await assertFails(
        anon.firestore().doc(`users/${UID_A}/kv/someKey`).set({ v: 1 })
      );
    });

    it("user A CAN read/write their own tree", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      await assertSucceeds(
        a.firestore().doc(`users/${UID_A}/kv/someKey`).set({ v: 1 })
      );
      await assertSucceeds(
        a.firestore().doc(`users/${UID_A}/kv/someKey`).get()
      );
    });
  });

  describe("firestore.rules — recognitionItems is server-only (read-only for clients)", () => {
    it("denies a client write to recognitionItems", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      await assertFails(
        a
          .firestore()
          .doc(`users/${UID_A}/recognitionItems/item1`)
          .set({ term: "aspirin" })
      );
    });

    it("allows a client read of recognitionItems (once seeded server-side)", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx
          .firestore()
          .doc(`users/${UID_A}/recognitionItems/item1`)
          .set({ term: "aspirin" });
      });

      const a = testEnv.authenticatedContext(UID_A);
      await assertSucceeds(
        a.firestore().doc(`users/${UID_A}/recognitionItems/item1`).get()
      );
    });
  });

  describe("firestore.rules — client Anki ingest is writable", () => {
    it("allows a client write to ankiCards", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      await assertSucceeds(
        a
          .firestore()
          .doc(`users/${UID_A}/ankiCards/card1`)
          .set({ front: "Q", back: "A" })
      );
    });

    it("allows a client write to ungeneratedCards", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      await assertSucceeds(
        a
          .firestore()
          .doc(`users/${UID_A}/ungeneratedCards/card1`)
          .set({ front: "Q" })
      );
    });
  });

  describe("storage.rules — question-images type/size limits", () => {
    it("denies a non-image (pdf) upload", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      const ref = a.storage().ref(`question-images/${UID_A}/doc.pdf`);
      const blob = new Blob([new Uint8Array(1024)], {
        type: "application/pdf",
      });
      await assertFails(ref.put(blob, { contentType: "application/pdf" }));
    });

    it("allows a png upload under the 10MB size limit", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      const ref = a.storage().ref(`question-images/${UID_A}/small.png`);
      const blob = new Blob([new Uint8Array(1024 * 1024)], {
        // 1MB
        type: "image/png",
      });
      await assertSucceeds(ref.put(blob, { contentType: "image/png" }));
    });

    it("denies a png upload over the 10MB size limit", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      const ref = a.storage().ref(`question-images/${UID_A}/big.png`);
      const blob = new Blob([new Uint8Array(11 * 1024 * 1024)], {
        // 11MB
        type: "image/png",
      });
      await assertFails(ref.put(blob, { contentType: "image/png" }));
    });

    it("denies cross-user storage writes", async () => {
      const a = testEnv.authenticatedContext(UID_A);
      const refIntoB = a.storage().ref(`question-images/${UID_B}/x.png`);
      const blob = new Blob([new Uint8Array(1024)], { type: "image/png" });
      await assertFails(refIntoB.put(blob, { contentType: "image/png" }));
    });
  });
});
