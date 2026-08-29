import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import { TabBar } from "./TabBar.jsx";
import { Header } from "./Header.jsx";
import { useTheme } from "./useTheme.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => installDomStorage());
function mount(ui) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); act(() => root.render(ui));
  return { host, close() { act(() => root.unmount()); host.remove(); } };
}
it("keeps all six workspace destinations with a labeled active state", () => {
  const onChange = vi.fn(); const view = mount(<TabBar active="lectures" onChange={onChange} />);
  expect(view.host.querySelector('[aria-current="page"]').textContent).toBe("Lectures");
  const buttons = [...view.host.querySelectorAll("button")];
  expect(buttons).toHaveLength(6);
  buttons.forEach((b) => act(() => b.click()));
  expect(onChange.mock.calls.flat()).toEqual(["today", "lectures", "objectives", "exam", "guide", "more"]);
  view.close();
});
it("keeps integrations available and closes the tools menu with Escape", () => {
  const onAnki = vi.fn(); const view = mount(<Header onAnki={onAnki} />);
  const trigger = view.host.querySelector('[aria-label="More actions"]');
  act(() => trigger.click()); expect(trigger.getAttribute("aria-expanded")).toBe("true");
  act(() => [...view.host.querySelectorAll("button")].find(b => b.textContent === "Anki sync").click());
  expect(onAnki).toHaveBeenCalledOnce();
  act(() => trigger.click());
  act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  view.close();
});
function ThemeProbe() { const { theme, toggle } = useTheme(); return <button onClick={toggle}>{theme}</button>; }
it("starts light without discarding a saved dark preference", () => {
  let view = mount(<ThemeProbe />); expect(view.host.textContent).toBe("light");
  act(() => view.host.querySelector("button").click()); expect(view.host.textContent).toBe("dark");
  view.close(); view = mount(<ThemeProbe />); expect(view.host.textContent).toBe("dark"); view.close();
});
