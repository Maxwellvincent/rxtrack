// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { DeleteBlockDialog } from "./DeleteBlockDialog.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("downloads a backup, then deletes only after the block name is typed", async () => {
  const deps = {
    terms: { read: () => [{ id: "t", blocks: [{ id: "ftm2", name: "FTM 2" }] }] },
    lectures: { read: () => [{ id: "l1", blockId: "ftm2" }] },
    objectives: { read: () => ({ ftm2: [{ id: "o", attempts: 2 }] }) },
    backup: vi.fn(async () => ({ kind: "backup" })),
    download: vi.fn(),
    deleteBlock: vi.fn(async () => ({})),
  };
  const onDeleted = vi.fn();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<DeleteBlockDialog userId="u" blockId="ftm2" deps={deps} onDeleted={onDeleted} onClose={() => {}} />));
  expect(host.textContent).toContain("1 lecture,");
  expect(host.textContent).toContain("1 of these objectives have practice on record");
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Delete block");
  expect(button.disabled).toBe(true);
  const input = host.querySelector('input[aria-label="Block name to confirm"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => { setValue.call(input, "FTM 2"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(deps.download).toHaveBeenCalledWith(expect.stringMatching(/^rxtrack-block-FTM-2-/), { kind: "backup" });
  expect(deps.deleteBlock).toHaveBeenCalledWith({ userId: "u", blockId: "ftm2" }, deps);
  expect(deps.download.mock.invocationCallOrder[0]).toBeLessThan(deps.deleteBlock.mock.invocationCallOrder[0]);
  expect(onDeleted).toHaveBeenCalledWith("ftm2");
  act(() => root.unmount());
});
