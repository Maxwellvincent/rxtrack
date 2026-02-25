import { createContext, useContext } from "react";

const DARK = {
  appBg:       "#06090f",
  cardBg:      "#09111e",
  cardBorder:  "#0f1e30",
  sidebarBg:   "#060c17",
  navBg:       "#06090ff5",
  navBorder:   "#0d1829",
  subnavBg:    "#07090e",
  inputBg:     "#080f1c",
  rowHover:    "#09111e",
  rowExpanded: "#060c17",
  pickerBg:    "#09111e",
  pickerBorder: "#1a2a3a",
  pickerHover: "#09111e",
  text1:       "#f1f5f9",
  text2:       "#c4cdd6",
  text3:       "#6b7280",
  text4:       "#374151",
  text5:       "#2d3d4f",
  border1:     "#1a2a3a",
  border2:     "#0d1829",
  tableHeader: "#07090e",
  subjectRow:  "#080d18",
  scrollbarTrack: "#06090f",
  scrollbarThumb: "#1a2a3a",
  cardShadow:  "none",
  navShadow:   "none",
};

const LIGHT = {
  appBg:       "#f0f4f8",
  cardBg:      "#ffffff",
  cardBorder:  "#dde3ec",
  sidebarBg:   "#e8edf5",
  navBg:       "#ffffffee",
  navBorder:   "#dde3ec",
  subnavBg:    "#f5f7fa",
  inputBg:     "#ffffff",
  rowHover:    "#f8fafc",
  rowExpanded: "#f1f5f9",
  pickerBg:    "#ffffff",
  pickerBorder: "#dde3ec",
  pickerHover: "#f0f4f8",
  text1:       "#0f172a",
  text2:       "#1e293b",
  text3:       "#475569",
  text4:       "#475569",
  text5:       "#475569",
  border1:     "#cbd5e1",
  border2:     "#e2e8f0",
  tableHeader: "#f5f7fa",
  subjectRow:  "#f8fafc",
  scrollbarTrack: "#f3f4f6",
  scrollbarThumb: "#cbd5e1",
  cardShadow:  "0 1px 3px rgba(15,23,42,0.08)",
  navShadow:   "0 1px 0 #dde3ec",
};

export const themes = { dark: DARK, light: LIGHT };

export const ThemeContext = createContext({
  T: DARK,
  isDark: true,
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
