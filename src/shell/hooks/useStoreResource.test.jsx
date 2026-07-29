import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { installDomStorage } from "../../stores/testEnv.js";
import { useStoreResource } from "./useStoreResource.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A store with the three-function contract, driven by the test. */
function makeStore(initial, extras = {}) {
  let value = initial;
  const listeners = new Set();
  return {
    read: () => value,
    write: (_uid, next) => { value = next; listeners.forEach((l) => l()); return next; },
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    set: (next) => { value = next; listeners.forEach((l) => l()); },
    ...extras,
  };
}

async function mount(store, onRender) {
  installDomStorage();
  const root = createRoot(document.createElement("div"));
  function Probe() {
    const res = useStoreResource(store, "u1");
    useEffect(() => { onRender(res); }, [res]);
    return null;
  }
  await act(async () => { root.render(<Probe />); });
  return root;
}

describe("useStoreResource", () => {
  it("reports data, with loading false for a synchronous store", async () => {
    const seen = [];
    await mount(makeStore({ a: 1 }), (r) => seen.push(r));
    expect(seen.at(-1)).toMatchObject({ data: { a: 1 }, loading: false, error: null });
  });

  it("reports loading until a cloud-backed store hydrates", async () => {
    let hydrated = false;
    const store = makeStore({}, { isHydrated: () => hydrated, readError: () => null });

    const seen = [];
    await mount(store, (r) => seen.push({ loading: r.loading, data: r.data }));
    expect(seen[0].loading).toBe(true);

    hydrated = true;
    await act(async () => { store.set({ a: 1 }); });
    expect(seen.at(-1)).toMatchObject({ loading: false, data: { a: 1 } });
  });

  it("surfaces a store's read error", async () => {
    const store = makeStore({}, { isHydrated: () => true, readError: () => new Error("permission-denied") });
    const seen = [];
    await mount(store, (r) => seen.push(r));
    expect(seen.at(-1).error?.message).toBe("permission-denied");
  });

  it("treats a snapshot with reordered keys as unchanged", async () => {
    // Firestore does not preserve map key order. The same document reordered is
    // not a change, and treating it as one re-renders every consumer for nothing.
    const store = makeStore({ a: 1, b: 2, c: 3 });
    const seen = [];
    await mount(store, (r) => seen.push(r.data));
    const renders = seen.length;

    await act(async () => { store.set({ c: 3, a: 1, b: 2 }); });

    expect(seen.length).toBe(renders);        // no extra effect run
    expect(seen.at(-1)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("does re-render when a value actually changes", async () => {
    const store = makeStore({ a: 1 });
    const seen = [];
    await mount(store, (r) => seen.push(r.data));

    await act(async () => { store.set({ a: 2 }); });
    expect(seen.at(-1)).toEqual({ a: 2 });
  });

  it("writes through the store", async () => {
    const store = makeStore({ a: 1 });
    let api;
    await mount(store, (r) => { api = r; });
    await act(async () => { api.mutate({ a: 9 }); });
    expect(store.read()).toEqual({ a: 9 });
  });
});
