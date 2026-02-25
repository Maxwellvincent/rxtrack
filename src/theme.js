import { createContext, useContext } from "react";

export const themes = {
  dark: {
    appBg: "#06090f",
    cardBg: "#09111e",
    cardBorder: "#0f1e30",
    sidebarBg: "#060c17",
    sidebarBorder: "#0d1829",
    navBg: "#06090ff5",
    subnavBg: "#07090e",
    inputBg: "#080f1c",
    textPrimary: "#f1f5f9",
    textSecondary: "#c4cdd6",
    textMuted: "#6b7280",
    textFaint: "#374151",
    textGhost: "#2d3d4f",
    borderSubtle: "#1a2a3a",
    borderFaint: "#0d1829",
    rowHover: "#09111e",
    rowExpanded: "#060c17",
    scrollbarTrack: "#06090f",
    scrollbarThumb: "#1a2a3a",
  },
  light: {
    appBg: "#f0f4f8",
    cardBg: "#ffffff",
    cardBorder: "#dde3ec",
    sidebarBg: "#e8edf5",
    sidebarBorder: "#e2e8f0",
    navBg: "#ffffffee",
    subnavBg: "#f5f7fa",
    inputBg: "#ffffff",
    textPrimary: "#0f172a",
    textSecondary: "#1e293b",
    textMuted: "#475569",
    textFaint: "#64748b",
    textGhost: "#94a3b8",
    borderSubtle: "#cbd5e1",
    borderFaint: "#e2e8f0",
    rowHover: "#f8fafc",
    rowExpanded: "#f1f5f9",
    scrollbarTrack: "#f3f4f6",
    scrollbarThumb: "#cbd5e1",
  },
};

export const ThemeContext = createContext({
  theme: themes.dark,
  mode: "dark",
  isDark: true,
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

