import React from "react";
import { createContext, useContext } from "react";

// Colorblind-safe semantic palette (works for deuteranopia, protanopia, tritanopia)
export const STATUS_COLORS = {
  good: { color: "#2563eb", bg: "#2563eb15", border: "#2563eb40", label: "✓" },
  warning: { color: "#d97706", bg: "#d9770615", border: "#d9770640", label: "△" },
  critical: { color: "#9333ea", bg: "#9333ea15", border: "#9333ea40", label: "⚠" },
  neutral: { color: "#6b7280", bg: "#6b728015", border: "#6b728040", label: "○" },
  inprogress: { color: "#0891b2", bg: "#0891b215", border: "#0891b240", label: "◑" },
};

const MONO = "'DM Mono','Courier New',monospace";

// Score → colorblind-safe color
export function getScoreColor(T, score) {
  if (score == null) return T?.statusNeutral ?? "#6b7280";
  return score >= 80 ? T?.statusGood : score >= 60 ? T?.statusProgress : score >= 40 ? T?.statusWarn : T?.statusBad;
}

export function getScoreLabel(score) {
  if (score == null) return "—";
  return score >= 80 ? "✓ Strong" : score >= 60 ? "◑ OK" : score >= 40 ? "△ Weak" : "⚠ Low";
}

// Progress bar/ring color
export function getBarColor(T, pct) {
  if (pct == null) return T?.statusNeutral ?? "#6b7280";
  return pct === 100 ? T?.statusGood : pct >= 70 ? T?.statusProgress : pct >= 40 ? T?.statusWarn : pct > 0 ? T?.statusBad : T?.statusNeutral;
}

// Objective status
export function getObjStatusColor(T, status) {
  const map = { mastered: T?.statusGood, inprogress: T?.statusProgress, struggling: T?.statusBad, untested: T?.statusNeutral };
  return map[status] ?? T?.statusNeutral;
}

export function getObjStatusIcon(status) {
  const map = { mastered: "✓", inprogress: "◑", struggling: "⚠", untested: "○" };
  return map[status] ?? "○";
}

// Tracker urgency
export const URGENCY_LABELS = {
  overdue: "⏰ Overdue",
  soon: "⏱ Due Soon",
  weak: "△ Weak",
  untouched: "○ Not Started",
  ok: "✓ OK",
  critical: "⚠ Critical",
  none: "",
};

export function getUrgencyColor(T, urgency) {
  const map = { overdue: T?.statusBad, soon: T?.statusWarn, weak: T?.statusWarn, untouched: T?.statusNeutral, ok: T?.statusGood, critical: T?.statusBad, none: T?.text3 };
  return map[urgency] ?? T?.statusNeutral;
}

// Reusable status badge with shape + text (colorblind-safe). Pass T from useTheme().
export function StatusBadge({ status, label, T, fontFamily = MONO }) {
  const t = T || {};
  const configs = {
    mastered: { color: t.statusGood, bg: t.statusGoodBg, border: t.statusGoodBorder, icon: "✓", text: label || "Mastered" },
    ok: { color: t.statusGood, bg: t.statusGoodBg, border: t.statusGoodBorder, icon: "✓", text: label || "OK" },
    inprogress: { color: t.statusProgress, bg: t.statusProgressBg, border: t.statusProgressBorder, icon: "◑", text: label || "In Progress" },
    weak: { color: t.statusWarn, bg: t.statusWarnBg, border: t.statusWarnBorder, icon: "△", text: label || "Weak" },
    struggling: { color: t.statusBad, bg: t.statusBadBg, border: t.statusBadBorder, icon: "⚠", text: label || "Struggling" },
    critical: { color: t.statusBad, bg: t.statusBadBg, border: t.statusBadBorder, icon: "⚠", text: label || "Critical" },
    untested: { color: t.statusNeutral, bg: t.statusNeutralBg, border: t.statusNeutralBorder, icon: "○", text: label || "Not Started" },
    overdue: { color: t.statusBad, bg: t.statusBadBg, border: t.statusBadBorder, icon: "⏰", text: label || "Overdue" },
    soon: { color: t.statusWarn, bg: t.statusWarnBg, border: t.statusWarnBorder, icon: "⏱", text: label || "Due Soon" },
  };
  const cfg = configs[status] || configs.untested;
  return React.createElement(
    "span",
    {
      style: {
        fontFamily,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 5,
        background: cfg.bg,
        color: cfg.color,
        border: "1px solid " + (cfg.border || cfg.bg),
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      },
    },
    React.createElement("span", null, cfg.icon),
    React.createElement("span", null, cfg.text)
  );
}

const THEMES = {
  dark: {
    appBg: "#06090f",
    panelBg: "#07090e",
    cardBg: "#09111e",
    inputBg: "#0d1829",
    deepBg: "#080f1c",
    border1: "#1a2a3a",
    border2: "#0f1e30",
    text1: "#f1f5f9",
    text2: "#c4cdd6",
    text3: "#6b7280",
    text4: "#374151",
    text5: "#2d3d4f",
    badgeBg: "#0d1829",
    pillBg: "#1a2a3a",
    pillText: "#9ca3af",
    hoverBg: "#0f1e30",
    activeBg: "#0d1829",
    shadowSm: "0 1px 3px rgba(0,0,0,0.4)",
    shadowMd: "0 4px 16px rgba(0,0,0,0.5)",
    overlayBg: "#000000a0",
    green: "#10b981",
    greenBg: "#10b98118",
    greenBorder: "#10b98130",
    amber: "#f59e0b",
    amberBg: "#f59e0b18",
    amberBorder: "#f59e0b30",
    red: "#ef4444",
    redBg: "#ef444418",
    redBorder: "#ef444430",
    // Colorblind-safe status colors (use for mastery/scores/urgency — not brand)
    statusGood: "#2563eb",
    statusGoodBg: "#2563eb15",
    statusGoodBorder: "#2563eb40",
    statusWarn: "#d97706",
    statusWarnBg: "#d9770615",
    statusWarnBorder: "#d9770640",
    statusBad: "#9333ea",
    statusBadBg: "#9333ea15",
    statusBadBorder: "#9333ea40",
    statusNeutral: "#6b7280",
    statusNeutralBg: "#6b728015",
    statusNeutralBorder: "#6b728040",
    statusProgress: "#0891b2",
    statusProgressBg: "#0891b215",
    statusProgressBorder: "#0891b240",
    blue: "#60a5fa",
    blueBg: "#60a5fa18",
    blueBorder: "#60a5fa30",
    purple: "#a78bfa",
    purpleBg: "#a78bfa18",
    purpleBorder: "#a78bfa30",
    alwaysDark: "#09111e",
    alwaysDarkText: "#f1f5f9",
    alwaysDarkBorder: "#1a2a3a",
    // Backward compat (derived)
    cardBorder: "#0f1e30",
    sidebarBg: "#07090e",
    navBg: "#06090ff5",
    navBorder: "#0d1829",
    subnavBg: "#07090e",
    rowHover: "#09111e",
    rowExpanded: "#060c17",
    pickerBg: "#09111e",
    pickerBorder: "#1a2a3a",
    pickerHover: "#09111e",
    tableHeader: "#07090e",
    subjectRow: "#080d18",
    scrollbarTrack: "#06090f",
    scrollbarThumb: "#1a2a3a",
    cardShadow: "none",
    navShadow: "none",
  },
  light: {
    appBg: "#f0f4f8",
    panelBg: "#e8edf5",
    cardBg: "#ffffff",
    inputBg: "#f8fafc",
    deepBg: "#f1f5f9",
    border1: "#cbd5e1",
    border2: "#dde3ec",
    text1: "#0f172a",
    text2: "#1e293b",
    text3: "#475569",
    text4: "#94a3b8",
    text5: "#64748b",
    badgeBg: "#f1f5f9",
    pillBg: "#e2e8f0",
    pillText: "#475569",
    hoverBg: "#f1f5f9",
    activeBg: "#e2e8f0",
    shadowSm: "0 1px 3px rgba(15,23,42,0.08)",
    shadowMd: "0 4px 16px rgba(15,23,42,0.12)",
    overlayBg: "#000000a0",
    green: "#059669",
    greenBg: "#d1fae5",
    greenBorder: "#6ee7b7",
    amber: "#d97706",
    amberBg: "#fef3c7",
    amberBorder: "#fcd34d",
    red: "#dc2626",
    redBg: "#fee2e2",
    redBorder: "#fca5a5",
    // Colorblind-safe status colors
    statusGood: "#2563eb",
    statusGoodBg: "#dbeafe",
    statusGoodBorder: "#93c5fd",
    statusWarn: "#d97706",
    statusWarnBg: "#ffedd5",
    statusWarnBorder: "#fdba74",
    statusBad: "#9333ea",
    statusBadBg: "#f3e8ff",
    statusBadBorder: "#c084fc",
    statusNeutral: "#6b7280",
    statusNeutralBg: "#f3f4f6",
    statusNeutralBorder: "#d1d5db",
    statusProgress: "#0891b2",
    statusProgressBg: "#cffafe",
    statusProgressBorder: "#67e8f9",
    blue: "#2563eb",
    blueBg: "#dbeafe",
    blueBorder: "#93c5fd",
    purple: "#7c3aed",
    purpleBg: "#ede9fe",
    purpleBorder: "#c4b5fd",
    alwaysDark: "#09111e",
    alwaysDarkText: "#f1f5f9",
    alwaysDarkBorder: "#1a2a3a",
    // Backward compat (derived)
    cardBorder: "#dde3ec",
    sidebarBg: "#e8edf5",
    navBg: "#ffffffee",
    navBorder: "#dde3ec",
    subnavBg: "#f5f7fa",
    rowHover: "#f8fafc",
    rowExpanded: "#f1f5f9",
    pickerBg: "#ffffff",
    pickerBorder: "#dde3ec",
    pickerHover: "#f0f4f8",
    tableHeader: "#f5f7fa",
    subjectRow: "#f8fafc",
    scrollbarTrack: "#f3f4f6",
    scrollbarThumb: "#cbd5e1",
    cardShadow: "0 1px 3px rgba(15,23,42,0.08)",
    navShadow: "0 1px 0 #dde3ec",
  },
};

export const themes = { dark: THEMES.dark, light: THEMES.light };

export const ThemeContext = createContext({
  T: THEMES.dark,
  isDark: true,
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
