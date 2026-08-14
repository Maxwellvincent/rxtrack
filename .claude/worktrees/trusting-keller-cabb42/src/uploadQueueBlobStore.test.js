import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteUploadQueueBlob,
  getUploadQueueBlob,
  putUploadQueueBlob,
  __resetUploadBlobMemoryForTests,
} from "./uploadQueueBlobStore.js";

describe("uploadQueueBlobStore (memory fallback)", () => {
  beforeEach(() => {
    __resetUploadBlobMemoryForTests();
  });

  it("round-trips a File", async () => {
    const f = new File([new Uint8Array([1, 2, 3])], "test.pdf", { type: "application/pdf" });
    await putUploadQueueBlob("q1", f);
    const out = await getUploadQueueBlob("q1");
    expect(out).toBeTruthy();
    expect(out.name).toBe("test.pdf");
    expect(out.type).toBe("application/pdf");
    const buf = new Uint8Array(await out.arrayBuffer());
    expect([...buf]).toEqual([1, 2, 3]);
  });

  it("delete returns null on get", async () => {
    const f = new File([""], "a.pdf", { type: "application/pdf" });
    await putUploadQueueBlob("x", f);
    await deleteUploadQueueBlob("x");
    expect(await getUploadQueueBlob("x")).toBe(null);
  });
});
