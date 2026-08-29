import { useState, useCallback, useEffect } from "react";

const KEY = "rxt-shell-theme";

/** Respect saved preferences; new study desks start in paper/light mode. */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(KEY) === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, theme); } catch {}
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
