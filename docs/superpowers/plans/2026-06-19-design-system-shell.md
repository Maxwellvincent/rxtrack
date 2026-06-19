# Design System + Shell Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Tailwind + shadcn/ui in the existing Vite/React 19 app and build the Direction-B / Compact app shell (sidebar term/block tree, breadcrumb header, ⌘K palette, block home, single "Continue learning" entry) wired to real data, behind a feature flag, with zero regression to the legacy app.

**Architecture:** New isolated modules `src/ui/` (component kit) + `src/shell/` (layout) + `src/theme/` (tokens), mounted by `main.jsx` only when a flag is on; otherwise the legacy `App.jsx` renders unchanged. The shell reads existing localStorage data through a small self-contained reader, never coupling to `App.jsx`.

**Tech Stack:** Vite 7, React 19, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (Dialog/Command), vitest (pure-logic tests; env is `node`, so NO component-render tests — UI is verified by `npm run build` + manual visual check against the approved mockups).

## Global Constraints

- Direction **B (Focus Dark / Command)**, **Compact** density, **dark default** + light.
- Preserve the colorblind-safe status palette: **blue / amber / purple / cyan** paired with **shape** (dot vs diamond) + value. Never encode status by color alone.
- Fonts stay: IBM Plex Sans (`--font-sans`), IBM Plex Mono (`--font-mono`, data/labels), Fraunces (`--font-display`). Already defined in `src/index.css`.
- **Zero legacy regression:** with the flag OFF, the existing app renders byte-for-byte as today and `npm run build` + the existing 45 vitest tests stay green.
- New shell reads data via `src/shell/data.js` (localStorage `rxt-terms`, `rxt-block-objectives`) — do NOT import from `App.jsx`.
- Tests: vitest env is `node`. Only pure functions are unit-tested. Do NOT add component-render tests (no jsdom configured).
- The "Continue learning" CTA is a **placeholder** this sub-project — it opens a stub "coming soon (engine = sub-project #2)" dialog. No engine logic here.
- Branch: `app-rework`.

---

## File Structure

- `src/theme/tokens.css` — CSS custom properties: status palette, surfaces, text, borders for dark + light (`.theme-dark` / `.theme-light` on the shell root). **New.**
- `src/theme/tailwind.css` — `@import "tailwindcss";` + `@theme` bridge mapping tokens to Tailwind color/spacing/font scales. Imported only by the shell entry. **New.**
- `tailwind` config via `@tailwindcss/vite` (v4 needs no JS config file for basics; the `@theme` block lives in `tailwind.css`). `vite.config.js` — **Modify** (add plugin + `@` alias).
- `src/shell/data.js` — pure readers: `readTerms()`, `blockCoverage(blockId)`, `flattenBlocks(terms)`. **New.** Test: `src/shell/data.test.js`.
- `src/shell/status.js` — `statusToken(status)` pure. **New.** Test: `src/shell/status.test.js`.
- `src/shell/fuzzy.js` — `fuzzyFilter(items, query)` pure. **New.** Test: `src/shell/fuzzy.test.js`.
- `src/ui/Button.jsx`, `src/ui/Card.jsx`, `src/ui/Badge.jsx`, `src/ui/Input.jsx` — Tailwind component kit. **New.**
- `src/ui/CommandPalette.jsx` — ⌘K dialog (shadcn Command + Dialog). **New.**
- `src/shell/Sidebar.jsx`, `src/shell/Header.jsx`, `src/shell/BlockHome.jsx`, `src/shell/Shell.jsx` — layout. **New.**
- `src/shell/useTheme.js` — theme state + persistence hook. **New.**
- `src/main.jsx` — **Modify** (flag-gated mount).
- shadcn: `components.json`, `src/lib/utils.js` (cn helper) — **New** (created by shadcn init).

---

## Task 1: Tailwind v4 + shadcn setup + alias + legacy regression gate

**Files:**
- Modify: `vite.config.js`
- Create: `src/theme/tailwind.css`, `src/theme/tokens.css`, `src/lib/utils.js`, `components.json`
- Modify: `package.json` (deps)

**Interfaces:**
- Produces: Tailwind v4 build pipeline; `@` alias → `src`; `cn()` from `src/lib/utils.js`; token CSS vars; a `.theme-dark`/`.theme-light` scoping convention.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install -D tailwindcss@^4 @tailwindcss/vite
npm install clsx tailwind-merge class-variance-authority lucide-react
```
Expected: installs succeed.

- [ ] **Step 2: Add the Tailwind plugin + `@` alias to `vite.config.js`**

```javascript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
```

- [ ] **Step 3: Create `src/lib/utils.js`**

```javascript
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names, resolving Tailwind conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Create `src/theme/tokens.css` (status palette + surfaces, dark + light)**

```css
/* Design tokens. Scoped to the shell root via .theme-dark / .theme-light so the
   legacy app (which does not use these vars) is never affected. */
.theme-dark {
  --bg: #0f1420;
  --bg-elevated: #0b0f17;
  --panel: #131a2a;
  --border: #1c2433;
  --border-strong: #2a3650;
  --text-1: #e2e8f0;
  --text-2: #94a3b8;
  --text-3: #64748b;
  --accent: #3b82f6;
  --accent-soft: #15203a;
  --accent-text: #60a5fa;
  /* colorblind-safe status palette */
  --status-blue: #3b82f6;
  --status-amber: #f59e0b;
  --status-purple: #a78bfa;
  --status-cyan: #22d3ee;
  --good: #34d399;
  --warn: #f59e0b;
  --bad: #f87171;
}
.theme-light {
  --bg: #ffffff;
  --bg-elevated: #f7f9fb;
  --panel: #f1f5f9;
  --border: #e6e9ee;
  --border-strong: #cbd5e1;
  --text-1: #0f172a;
  --text-2: #475569;
  --text-3: #94a3b8;
  --accent: #2563eb;
  --accent-soft: #eef2ff;
  --accent-text: #2563eb;
  --status-blue: #2563eb;
  --status-amber: #d97706;
  --status-purple: #7c3aed;
  --status-cyan: #0891b2;
  --good: #059669;
  --warn: #d97706;
  --bad: #dc2626;
}
```

- [ ] **Step 5: Create `src/theme/tailwind.css` (Tailwind v4 entry + theme bridge)**

```css
@import "tailwindcss";

/* Map design tokens into Tailwind's theme so classes like bg-bg, text-text-1,
   border-border, text-accent work. Tailwind v4 reads @theme. */
@theme inline {
  --color-bg: var(--bg);
  --color-bg-elevated: var(--bg-elevated);
  --color-panel: var(--panel);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text-1: var(--text-1);
  --color-text-2: var(--text-2);
  --color-text-3: var(--text-3);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-accent-text: var(--accent-text);
  --color-status-blue: var(--status-blue);
  --color-status-amber: var(--status-amber);
  --color-status-purple: var(--status-purple);
  --color-status-cyan: var(--status-cyan);
  --color-good: var(--good);
  --color-warn: var(--warn);
  --color-bad: var(--bad);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-display: var(--font-display);
}
```

- [ ] **Step 6: Create a minimal `components.json` for shadcn (Tailwind v4, no base color reset)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "",
    "css": "src/theme/tailwind.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": { "components": "@/ui", "utils": "@/lib/utils" }
}
```

- [ ] **Step 7: Verify build + LEGACY REGRESSION GATE**

Run: `npm run build`
Expected: `✓ built`. The legacy app does not import `tailwind.css` yet (only the shell will, Task 2), so the legacy bundle/output is unchanged.
Run: `npm test`
Expected: existing 45 tests pass.
Manual: `npm run dev`, open the app (flag off) — it must look exactly as before. (Tailwind CSS is not yet imported anywhere that the legacy path loads, so there is no preflight in play. This is the safety property: preflight only ships inside the shell entry, Task 2.)

- [ ] **Step 8: Commit**

```bash
git add vite.config.js package.json package-lock.json src/lib/utils.js src/theme/tokens.css src/theme/tailwind.css components.json
git commit -m "feat: tailwind v4 + shadcn setup + design tokens (shell-scoped)"
```

---

## Task 2: Feature flag + shell mount (legacy untouched when off)

**Files:**
- Modify: `src/main.jsx`
- Create: `src/shell/Shell.jsx` (stub for now), `src/shell/useTheme.js`

**Interfaces:**
- Consumes: tokens.css, tailwind.css.
- Produces: `Shell` React component (root `.theme-dark`/`.theme-light` wrapper importing `tailwind.css`); `useTheme()` → `{ theme, toggle }`; flag `shellEnabled()`.

- [ ] **Step 1: Create `src/shell/useTheme.js`**

```javascript
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
```

- [ ] **Step 2: Create `src/shell/Shell.jsx` (stub)**

```javascript
import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useTheme } from "./useTheme";

/** New app shell root. Imports Tailwind ONLY here so the legacy app is never
 *  affected by preflight. Scopes tokens via .theme-* on the root wrapper. */
export default function Shell() {
  const { theme, toggle } = useTheme();
  return (
    <div className={`theme-${theme} min-h-screen bg-bg text-text-1 font-sans`}>
      <div className="p-6">
        <h1 className="font-display text-2xl">RXTrack shell</h1>
        <button onClick={toggle} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-white text-sm">
          Toggle theme ({theme})
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modify `src/main.jsx` to flag-gate the mount (DYNAMIC import — critical for regression safety)**

The shell is loaded with a **dynamic `import()`**, NOT a static import. This is the property that keeps the legacy app safe: `Shell.jsx` imports `tailwind.css` (which ships Tailwind preflight). A static `import Shell` would bundle that CSS into every page load and reset the legacy app's base styles. Dynamic import means `tailwind.css` only loads when the flag mounts the shell — and gives the code-split perf win for free.

```javascript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/** New shell is opt-in: ?shell=new in the URL or localStorage rxt-new-shell="1". */
function shellEnabled() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('shell') === 'new') { localStorage.setItem('rxt-new-shell', '1'); return true; }
    if (p.get('shell') === 'old') { localStorage.removeItem('rxt-new-shell'); return false; }
    return localStorage.getItem('rxt-new-shell') === '1';
  } catch { return false; }
}

const root = createRoot(document.getElementById('root'));

if (shellEnabled()) {
  // Dynamic import: Shell + its tailwind.css load ONLY when the flag is on.
  import('./shell/Shell.jsx').then(({ default: Shell }) => {
    root.render(<StrictMode><Shell /></StrictMode>);
  });
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(<StrictMode><App /></StrictMode>);
  });
}
```

- [ ] **Step 4: Build + verify both paths**

Run: `npm run build` → `✓ built`. `npm test` → 45 pass.
Manual: `npm run dev`. Default URL = legacy app, unchanged. Add `?shell=new` → the stub shell renders dark, theme toggle flips dark/light. Add `?shell=old` → back to legacy.

- [ ] **Step 5: Commit**

```bash
git add src/main.jsx src/shell/Shell.jsx src/shell/useTheme.js
git commit -m "feat: feature-flagged new shell mount + theme toggle"
```

---

## Task 3: Shell data readers (pure, TDD)

**Files:**
- Create: `src/shell/data.js`
- Test: `src/shell/data.test.js`

**Interfaces:**
- Produces:
  - `flattenBlocks(terms)` → `[{ id, name, termId, termName, termColor, lectureCount }]`.
  - `readTerms()` → parsed `rxt-terms` array (or `[]`).
  - `blockCoverage(blockId)` → `number | null` (avg objective coverage %, from `rxt-block-objectives`; null if none).

- [ ] **Step 1: Write the failing tests**

```javascript
// src/shell/data.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";
import { flattenBlocks } from "./data.js";

describe("flattenBlocks", () => {
  it("flattens terms→blocks with term metadata + lecture count", () => {
    const terms = [
      { id: "t1", name: "Term 1", color: "#3b82f6", blocks: [
        { id: "cpr1", name: "CPR 1" }, { id: "msk", name: "MSK" },
      ] },
    ];
    const lectures = [{ blockId: "cpr1" }, { blockId: "cpr1" }, { blockId: "msk" }];
    const out = flattenBlocks(terms, lectures);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "cpr1", name: "CPR 1", termId: "t1", termName: "Term 1", termColor: "#3b82f6", lectureCount: 2 });
    expect(out[1].lectureCount).toBe(1);
  });
  it("handles missing blocks/lectures", () => {
    expect(flattenBlocks([], [])).toEqual([]);
    expect(flattenBlocks(null, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shell/data.test.js`
Expected: FAIL — `flattenBlocks` undefined.

- [ ] **Step 3: Implement `src/shell/data.js`**

```javascript
/** Read + shape the shell's data from localStorage. Self-contained — no App.jsx. */

export function readTerms() {
  try { return JSON.parse(localStorage.getItem("rxt-terms") || "[]"); }
  catch { return []; }
}

export function readLectures() {
  try { return JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]"); }
  catch { return []; }
}

/** Flatten terms→blocks with term metadata + per-block lecture count. */
export function flattenBlocks(terms, lectures) {
  const lecs = Array.isArray(lectures) ? lectures : [];
  return (Array.isArray(terms) ? terms : []).flatMap((t) =>
    (t.blocks || []).map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      termId: t.id,
      termName: t.name,
      termColor: t.color,
      lectureCount: lecs.filter((l) => l && l.blockId === b.id).length,
    }))
  );
}

/** Average objective coverage % for a block, or null. Reads rxt-block-objectives. */
export function blockCoverage(blockId) {
  try {
    const store = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
    const entry = store[blockId];
    const list = Array.isArray(entry)
      ? entry
      : entry && typeof entry === "object"
      ? [...(entry.imported || []), ...(entry.extracted || [])]
      : [];
    const scores = list.map((o) => (typeof o?.score === "number" ? o.score : null)).filter((s) => s != null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shell/data.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shell/data.js src/shell/data.test.js
git commit -m "feat: shell data readers (terms/blocks/coverage)"
```

---

## Task 4: statusToken + Badge (pure TDD + component)

**Files:**
- Create: `src/shell/status.js`, `src/ui/Badge.jsx`
- Test: `src/shell/status.test.js`

**Interfaces:**
- Produces:
  - `statusToken(status)` → `{ colorVar: string, shape: 'dot'|'diamond', label: string }`. `colorVar` is a CSS var name like `var(--status-blue)`.
  - `Badge` React component: props `{ status, children }` — renders the shape glyph + label using the token.

- [ ] **Step 1: Write the failing test**

```javascript
// src/shell/status.test.js
import { describe, it, expect } from "vitest";
import { statusToken } from "./status.js";

describe("statusToken", () => {
  it("maps known statuses to colorblind-safe color + shape", () => {
    expect(statusToken("in-progress")).toEqual({ colorVar: "var(--status-blue)", shape: "dot", label: "In progress" });
    expect(statusToken("weak")).toEqual({ colorVar: "var(--status-amber)", shape: "diamond", label: "Weak" });
    expect(statusToken("review")).toEqual({ colorVar: "var(--status-purple)", shape: "dot", label: "Review" });
    expect(statusToken("new")).toEqual({ colorVar: "var(--status-cyan)", shape: "dot", label: "New" });
  });
  it("falls back for unknown status", () => {
    expect(statusToken("zzz")).toEqual({ colorVar: "var(--text-3)", shape: "dot", label: "—" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shell/status.test.js`
Expected: FAIL — `statusToken` undefined.

- [ ] **Step 3: Implement `src/shell/status.js`**

```javascript
/** Map a block/objective status → colorblind-safe color + SHAPE + label.
 *  Status is never encoded by color alone — shape carries it too. */
const MAP = {
  "in-progress": { colorVar: "var(--status-blue)", shape: "dot", label: "In progress" },
  weak:          { colorVar: "var(--status-amber)", shape: "diamond", label: "Weak" },
  review:        { colorVar: "var(--status-purple)", shape: "dot", label: "Review" },
  new:           { colorVar: "var(--status-cyan)", shape: "dot", label: "New" },
};

export function statusToken(status) {
  return MAP[status] || { colorVar: "var(--text-3)", shape: "dot", label: "—" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shell/status.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `src/ui/Badge.jsx`**

```javascript
import { statusToken } from "../shell/status.js";

/** Status glyph (dot/diamond) + optional label. Color + shape both encode status. */
export function StatusGlyph({ status, size = 7 }) {
  const { colorVar, shape } = statusToken(status);
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, background: colorVar, display: "inline-block",
        borderRadius: shape === "dot" ? "50%" : 0,
        transform: shape === "diamond" ? "rotate(45deg)" : "none",
      }}
    />
  );
}

export function Badge({ status, children }) {
  const { label } = statusToken(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
      <StatusGlyph status={status} />
      {children ?? label}
    </span>
  );
}
```

- [ ] **Step 6: Build + commit**

Run: `npm run build` → `✓ built`.
```bash
git add src/shell/status.js src/shell/status.test.js src/ui/Badge.jsx
git commit -m "feat: status token (colorblind shape+color) + Badge"
```

---

## Task 5: UI kit — Button, Card, Input

**Files:**
- Create: `src/ui/Button.jsx`, `src/ui/Card.jsx`, `src/ui/Input.jsx`

**Interfaces:**
- Produces:
  - `Button` props `{ variant?: 'primary'|'ghost'|'outline', className?, ...rest }`.
  - `Card` props `{ className?, children }`; `Panel` alias with border.
  - `Input` props `{ className?, ...rest }`.

- [ ] **Step 1: Create `src/ui/Button.jsx`**

```javascript
import { cn } from "../lib/utils.js";

const VARIANTS = {
  primary: "bg-accent text-white hover:opacity-90",
  outline: "border border-border-strong text-text-1 hover:bg-panel",
  ghost: "text-text-2 hover:bg-panel",
};

export function Button({ variant = "primary", className, ...rest }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold font-mono cursor-pointer transition-colors",
        VARIANTS[variant], className
      )}
      {...rest}
    />
  );
}
```

- [ ] **Step 2: Create `src/ui/Card.jsx`**

```javascript
import { cn } from "../lib/utils.js";

export function Card({ className, ...rest }) {
  return <div className={cn("rounded-xl bg-panel p-4", className)} {...rest} />;
}

export function Panel({ className, ...rest }) {
  return <div className={cn("rounded-lg border border-border bg-bg-elevated p-3", className)} {...rest} />;
}
```

- [ ] **Step 3: Create `src/ui/Input.jsx`**

```javascript
import { cn } from "../lib/utils.js";

export function Input({ className, ...rest }) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-1 outline-none focus:border-accent placeholder:text-text-3 font-mono",
        className
      )}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Build + commit**

Run: `npm run build` → `✓ built`.
```bash
git add src/ui/Button.jsx src/ui/Card.jsx src/ui/Input.jsx
git commit -m "feat: UI kit — Button, Card/Panel, Input"
```

---

## Task 6: Sidebar (term/block tree from real data)

**Files:**
- Create: `src/shell/Sidebar.jsx`

**Interfaces:**
- Consumes: `flattenBlocks`, `readTerms`, `readLectures`, `blockCoverage` (Task 3); `StatusGlyph` (Task 4); `Input` (Task 5).
- Produces: `Sidebar` props `{ activeBlockId, onSelectBlock, onOpenPalette }`.

- [ ] **Step 1: Create `src/shell/Sidebar.jsx`**

```javascript
import { useMemo } from "react";
import { readTerms, readLectures, flattenBlocks, blockCoverage } from "./data.js";
import { StatusGlyph } from "../ui/Badge.jsx";
import { Input } from "../ui/Input.jsx";

export function Sidebar({ activeBlockId, onSelectBlock, onOpenPalette }) {
  const terms = useMemo(() => readTerms(), []);
  const lectures = useMemo(() => readLectures(), []);
  const blocks = useMemo(() => flattenBlocks(terms, lectures), [terms, lectures]);
  const byTerm = useMemo(() => {
    const m = new Map();
    for (const b of blocks) {
      if (!m.has(b.termId)) m.set(b.termId, { name: b.termName, blocks: [] });
      m.get(b.termId).blocks.push(b);
    }
    return [...m.values()];
  }, [blocks]);

  const totalQ = 0; // session stats wired later; keep footer stable

  return (
    <aside className="flex w-[210px] flex-col border-r border-border bg-bg-elevated text-text-2">
      <div className="p-2.5">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center justify-between rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-text-3 font-mono"
        >
          Search… <span>⌘K</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {byTerm.length === 0 && (
          <div className="px-3.5 py-6 text-xs text-text-3">No terms yet.</div>
        )}
        {byTerm.map((term, i) => (
          <div key={i}>
            <div className="px-3.5 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-text-3">{term.name}</div>
            {term.blocks.map((b) => {
              const cov = blockCoverage(b.id);
              const active = b.id === activeBlockId;
              return (
                <button
                  key={b.id}
                  onClick={() => onSelectBlock(b.id)}
                  className={
                    "flex w-full items-center justify-between px-3.5 py-1.5 text-xs " +
                    (active ? "bg-accent-soft text-text-1 border-l-2 border-accent" : "text-text-2 hover:bg-panel border-l-2 border-transparent")
                  }
                >
                  <span className="flex items-center gap-2 truncate">
                    <StatusGlyph status={b.status} />
                    {b.name}
                  </span>
                  {cov != null && <span className={active ? "text-accent-text font-bold" : "opacity-60"}>{cov}%</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-border px-3.5 py-2.5 text-[10px] text-text-3 font-mono">
        {blocks.length} blocks
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` → `✓ built`.
```bash
git add src/shell/Sidebar.jsx
git commit -m "feat: shell sidebar — term/block tree from real data"
```

---

## Task 7: Header (breadcrumb + theme toggle)

**Files:**
- Create: `src/shell/Header.jsx`

**Interfaces:**
- Consumes: `Button` (Task 5).
- Produces: `Header` props `{ termName, blockName, theme, onToggleTheme }`.

- [ ] **Step 1: Create `src/shell/Header.jsx`**

```javascript
export function Header({ termName, blockName, theme, onToggleTheme }) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-bg px-4 text-sm">
      <span className="font-mono text-xs text-text-3">
        {termName ? <>{termName} / <span className="text-text-1">{blockName}</span></> : "RXTrack"}
      </span>
      <button onClick={onToggleTheme} className="text-text-2 hover:text-text-1 text-xs" aria-label="Toggle theme">
        {theme === "dark" ? "◑ light" : "◐ dark"}
      </button>
    </header>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` → `✓ built`.
```bash
git add src/shell/Header.jsx
git commit -m "feat: shell header — breadcrumb + theme toggle"
```

---

## Task 8: Command palette (⌘K) — fuzzy filter (TDD) + dialog

**Files:**
- Create: `src/shell/fuzzy.js`, `src/ui/CommandPalette.jsx`
- Test: `src/shell/fuzzy.test.js`

**Interfaces:**
- Produces:
  - `fuzzyFilter(items, query)` → filtered `items` (subsequence match on `item.label`, case-insensitive; empty query returns all). Pure.
  - `CommandPalette` props `{ open, onClose, items, onPick }` where `items = [{ id, label }]`.

- [ ] **Step 1: Write the failing test**

```javascript
// src/shell/fuzzy.test.js
import { describe, it, expect } from "vitest";
import { fuzzyFilter } from "./fuzzy.js";

const items = [{ id: "1", label: "CPR 1" }, { id: "2", label: "MSK" }, { id: "3", label: "Cardiac Cycle" }];

describe("fuzzyFilter", () => {
  it("subsequence-matches case-insensitively", () => {
    expect(fuzzyFilter(items, "cc").map((i) => i.id)).toEqual(["3"]);
    expect(fuzzyFilter(items, "msk").map((i) => i.id)).toEqual(["2"]);
  });
  it("returns all on empty query", () => {
    expect(fuzzyFilter(items, "")).toHaveLength(3);
  });
  it("returns [] on no match", () => {
    expect(fuzzyFilter(items, "zzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shell/fuzzy.test.js`
Expected: FAIL — `fuzzyFilter` undefined.

- [ ] **Step 3: Implement `src/shell/fuzzy.js`**

```javascript
/** Subsequence fuzzy match on item.label (case-insensitive). Empty query = all. */
export function fuzzyFilter(items, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return items || [];
  return (items || []).filter((it) => {
    const label = String(it.label || "").toLowerCase();
    let qi = 0;
    for (let i = 0; i < label.length && qi < q.length; i++) {
      if (label[i] === q[qi]) qi++;
    }
    return qi === q.length;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shell/fuzzy.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `src/ui/CommandPalette.jsx` (hand-rolled overlay — no extra deps)**

```javascript
import { useState, useEffect, useRef } from "react";
import { fuzzyFilter } from "../shell/fuzzy.js";
import { Input } from "./Input.jsx";

/** ⌘K palette: filter + pick. Hand-rolled overlay (keyboard: Esc closes, Enter picks first). */
export function CommandPalette({ open, onClose, items, onPick }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const results = fuzzyFilter(items, q).slice(0, 8);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-20" onClick={onClose}>
      <div className="w-[420px] rounded-xl border border-border-strong bg-panel p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a block or command…"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) { onPick(results[0]); onClose(); }
          }}
        />
        <div className="mt-1 max-h-72 overflow-y-auto">
          {results.length === 0 && <div className="px-3 py-2 text-xs text-text-3">No matches</div>}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => { onPick(r); onClose(); }}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm text-text-2 hover:bg-accent-soft hover:text-text-1 font-mono"
            >
              <span>{r.label}</span>
              {r.hint && <span className="text-text-3 text-xs">{r.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

(`Input` must forward refs — update `src/ui/Input.jsx` to use `forwardRef`.)

- [ ] **Step 6: Update `src/ui/Input.jsx` to forward refs**

```javascript
import { forwardRef } from "react";
import { cn } from "../lib/utils.js";

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-1 outline-none focus:border-accent placeholder:text-text-3 font-mono",
        className
      )}
      {...rest}
    />
  );
});
```

- [ ] **Step 7: Build + commit**

Run: `npm test -- src/shell/fuzzy.test.js` → PASS. `npm run build` → `✓ built`.
```bash
git add src/shell/fuzzy.js src/shell/fuzzy.test.js src/ui/CommandPalette.jsx src/ui/Input.jsx
git commit -m "feat: ⌘K command palette + fuzzy filter"
```

---

## Task 9: Block home + Shell composition + regression

**Files:**
- Create: `src/shell/BlockHome.jsx`
- Modify: `src/shell/Shell.jsx` (compose sidebar/header/blockhome/palette)

**Interfaces:**
- Consumes: everything above.
- Produces: full `Shell` wired to real data.

- [ ] **Step 1: Create `src/shell/BlockHome.jsx`**

```javascript
import { useMemo } from "react";
import { readTerms, readLectures, flattenBlocks, blockCoverage } from "./data.js";
import { Button } from "../ui/Button.jsx";
import { StatusGlyph } from "../ui/Badge.jsx";

export function BlockHome({ blockId, onContinue }) {
  const block = useMemo(() => {
    const blocks = flattenBlocks(readTerms(), readLectures());
    return blocks.find((b) => b.id === blockId) || null;
  }, [blockId]);

  if (!block) {
    return <div className="p-6 text-text-3">Select a block to begin.</div>;
  }
  const cov = blockCoverage(block.id);

  return (
    <div className="p-5">
      <h1 className="text-xl font-bold text-text-1">{block.name}</h1>
      <div className="mt-1 font-mono text-[11px] text-text-3">
        {block.lectureCount} lectures{cov != null ? ` · ${cov}% covered` : ""}
      </div>

      <div className="my-4">
        <Button onClick={onContinue}>▸ Continue learning</Button>
        <div className="mt-1.5 font-mono text-[10px] text-text-3">
          adaptive session — teaches, shows a case, then checks you
        </div>
      </div>

      <div className="mt-2">
        {cov == null && <div className="text-xs text-text-3">No objectives yet for this block.</div>}
        {cov != null && (
          <div className="flex items-center justify-between border-t border-border py-2 text-xs text-text-2">
            <span className="flex items-center gap-2"><StatusGlyph status={block.status} /> Objectives coverage</span>
            <span className="flex items-center gap-2">
              <span className="block h-1.5 w-28 overflow-hidden rounded bg-border">
                <span className="block h-full bg-accent" style={{ width: `${cov}%` }} />
              </span>
              <b className="text-accent-text">{cov}%</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/shell/Shell.jsx` to compose the shell**

```javascript
import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTheme } from "./useTheme";
import { readTerms, readLectures, flattenBlocks } from "./data.js";
import { Sidebar } from "./Sidebar.jsx";
import { Header } from "./Header.jsx";
import { BlockHome } from "./BlockHome.jsx";
import { CommandPalette } from "../ui/CommandPalette.jsx";

export default function Shell() {
  const { theme, toggle } = useTheme();
  const blocks = useMemo(() => flattenBlocks(readTerms(), readLectures()), []);
  const [activeBlockId, setActiveBlockId] = useState(() => blocks[0]?.id ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const active = blocks.find((b) => b.id === activeBlockId) || null;

  // ⌘K opens the palette globally.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(
    () => blocks.map((b) => ({ id: b.id, label: b.name, hint: b.termName })),
    [blocks]
  );

  const onContinue = useCallback(() => {
    // Placeholder — the adaptive engine is sub-project #2.
    alert("Adaptive learning session — coming in the next build (engine sub-project).");
  }, []);

  return (
    <div className={`theme-${theme} flex h-screen overflow-hidden bg-bg text-text-1 font-sans`}>
      <Sidebar
        activeBlockId={activeBlockId}
        onSelectBlock={setActiveBlockId}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header termName={active?.termName} blockName={active?.name} theme={theme} onToggleTheme={toggle} />
        <main className="flex-1 overflow-y-auto">
          <BlockHome blockId={activeBlockId} onContinue={onContinue} />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onPick={(it) => setActiveBlockId(it.id)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Full verification**

Run: `npm run build` → `✓ built`. `npm test` → all pass (45 existing + new pure tests for data/status/fuzzy = 53+).
Manual (`npm run dev`):
- `?shell=old` (or default) → legacy app pixel-identical to before. **Regression gate.**
- `?shell=new` → shell renders dark: sidebar term/block tree with real blocks + coverage %, click a block → header breadcrumb + block home update, ⌘K opens palette → type → Enter jumps to a block, theme toggle flips dark/light, "Continue learning" shows the placeholder. Compare against the approved mockups (Direction B, Compact).

- [ ] **Step 4: Commit**

```bash
git add src/shell/BlockHome.jsx src/shell/Shell.jsx
git commit -m "feat: block home + composed shell wired to real data"
```

---

## Self-Review Notes

- **Spec coverage:** stack (Task 1), tokens + status palette preserved (Tasks 1, 4), dark+light (Tasks 1, 2, 7), feature flag / zero regression (Task 2, gates in 1/2/9), data via shell/data.js not App.jsx (Task 3), component kit (Tasks 4, 5, 8), sidebar/header/⌘K/block home (Tasks 6–9), single "Continue learning" placeholder (Task 9), Compact density (Tailwind spacing throughout). Out-of-scope items (engine, generation, other-view migration, App.jsx removal) are respected — none touched.
- **Regression strategy:** `main.jsx` uses a **dynamic `import()`** (Task 2 Step 3), so `Shell.jsx` and its `tailwind.css` (preflight) are only fetched when the flag is on. With the flag off, the legacy bundle never includes Tailwind, so the flag-off app is byte-unaffected — verified in Tasks 1, 2, 9. A static import would have defeated this.
- **Type consistency:** `flattenBlocks(terms, lectures)`, `blockCoverage(blockId)`, `statusToken(status)→{colorVar,shape,label}`, `fuzzyFilter(items,query)`, `CommandPalette {open,onClose,items,onPick}`, `Sidebar {activeBlockId,onSelectBlock,onOpenPalette}` — consistent across tasks. `Input` becomes a `forwardRef` in Task 8 before the palette consumes its ref.
- **No component-render tests** (vitest env is `node`); UI verified by build + manual visual check per the spec. Pure logic (data, status, fuzzy) is unit-tested.
