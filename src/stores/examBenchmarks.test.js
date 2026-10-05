import { describe, expect, it, vi } from "vitest";

vi.mock("./cloudBase.js", () => ({
  readCloud: () => ({ version: 0, records: [{ id: "future", actualPercent: 80 }] }),
  subscribeToCloudStore: () => () => {},
  writeCloudAwait: vi.fn(),
  isHydrated: () => true,
  readError: () => null,
}));

const { read, withBaseline } = await import("./examBenchmarks.js");

describe("exam benchmark migration", () => {
  it("adds Benchmark #1 without deleting future records and is idempotent", () => {
    const first = withBaseline({ records: [{ id: "future", actualPercent: 80 }] });
    const second = withBaseline(first);
    expect(first.records).toHaveLength(2);
    expect(second.records).toHaveLength(2);
    expect(read("u1").records.map((record) => record.id)).toContain("benchmark-1-bpm2-dm-2026-09-30");
  });
});
