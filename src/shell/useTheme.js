import { useState, useCallback, useEffect } from "react";

const KEY = "rxt-shell-theme";

/** Theme state for the new shell. Dark default; persisted. */
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(KEY) || "dark");
  useEffect(() => {
    try { localStorage.setItem(KEY, theme); } catch {}
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
