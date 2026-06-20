# Adaptive Learning Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fixed ~10-item adaptive session that selects concepts weak-first and presents each in its mastery-driven mode (Teach/Recognize/Test) from the recognition bank, feeding results back into the mastery store, mounted behind the shell's "Continue learning".

**Architecture:** New isolated `src/engine/` module — pure `selectConcept` + `session` reducers (unit-tested), thin `masteryStore` + `content` adapters over localStorage / the recognition bank, and an `EngineSession.jsx` view composed in `Shell.jsx`. Runs only in the new shell (`?shell=new`); legacy untouched.

**Tech Stack:** React 19, Tailwind (shell tokens), vitest (node env — pure logic only), existing `recognitionBank.js` + `aiClient.js`.

## Global Constraints

- Burst size default **10 items**; ends with a **summary**.
- Selection **weak-first**: struggling → developing (by `missCount` desc); a **new** concept enters only when no struggling/developing concepts remain.
- Mode policy: `struggling → "teach"`, `developing → "recognize"`, `mastered → "test"`.
- `masteryLevel` derived from `consecutiveCorrect`: `>=4 → "mastered"`, `>=2 → "developing"`, else `"struggling"` (matches App.jsx).
- Mastery store = `localStorage["rxt-weak-concepts"]`, shape `{ [blockId]: Concept[] }`, `Concept = { concept, masteryLevel, consecutiveCorrect, missCount, totalAttempts }`. After writes, dispatch `window.dispatchEvent(new CustomEvent("rxt-weak-concepts-updated"))`.
- Teach mode is **exposure, not graded** (no correct/wrong scoring); Recognize + Test are graded.
- Tutor/live AI via existing `aiClient` (`callAIJSON`) — already routes Claude/Gemini.
- Engine code lives in `src/engine/`; the view uses the shell's Tailwind token classes.
- vitest env is `node` — unit-test pure logic only; views verified by build + manual `?shell=new`.
- Branch `app-rework`.

---

## File Structure

- `src/engine/mastery.js` — pure mastery helpers: `levelFromConsecutive(n)`, `modeForLevel(level)`, `recordOutcome(concept, outcome)` (returns updated concept, pure). **New.** Test.
- `src/engine/masteryStore.js` — localStorage adapter: `readConcepts(blockId)`, `writeConcept(blockId, concept)`. **New.** (I/O; exercised via the view, not unit-tested.)
- `src/engine/selectConcept.js` — pure `selectNext(concepts, newPool)`. **New.** Test.
- `src/engine/session.js` — pure reducer: `createSession(size)`, `advanceSession(state, item)`, `sessionSummary(state)`. **New.** Test.
- `src/engine/content.js` — `pickItemForConcept(items, concept)` (pure) + `ensureBlockItems(userId, blockId)` (fetch/build). **New.** Test the pure part.
- `src/engine/EngineSession.jsx` — the session view (Teach/Recognize/Test sub-views, progress, summary). **New.**
- `src/shell/Shell.jsx` — **Modify**: "Continue learning" mounts `EngineSession` instead of `alert`.

---

## Task 1: Mastery helpers (pure, TDD)

**Files:** Create `src/engine/mastery.js`, Test `src/engine/mastery.test.js`

**Interfaces:**
- `levelFromConsecutive(n: number): "struggling"|"developing"|"mastered"`.
- `modeForLevel(level): "teach"|"recognize"|"test"`.
- `recordOutcome(concept, outcome: "correct"|"wrong"|"exposure"): Concept` — pure; returns a NEW concept object with updated `consecutiveCorrect`, `missCount`, `totalAttempts`, `masteryLevel`. `correct`→consecutive+1; `wrong`→consecutive 0, missCount+1; `exposure`→unchanged streak, totalAttempts+1.

- [ ] **Step 1: Write the failing tests**

```javascript
// src/engine/mastery.test.js
import { describe, it, expect } from "vitest";
import { levelFromConsecutive, modeForLevel, recordOutcome } from "./mastery.js";

describe("levelFromConsecutive", () => {
  it("maps streak to level", () => {
    expect(levelFromConsecutive(0)).toBe("struggling");
    expect(levelFromConsecutive(1)).toBe("struggling");
    expect(levelFromConsecutive(2)).toBe("developing");
    expect(levelFromConsecutive(3)).toBe("developing");
    expect(levelFromConsecutive(4)).toBe("mastered");
  });
});

describe("modeForLevel", () => {
  it("maps level to mode", () => {
    expect(modeForLevel("struggling")).toBe("teach");
    expect(modeForLevel("developing")).toBe("recognize");
    expect(modeForLevel("mastered")).toBe("test");
    expect(modeForLevel("???")).toBe("teach");
  });
});

describe("recordOutcome", () => {
  const base = { concept: "preload", consecutiveCorrect: 1, missCount: 0, totalAttempts: 1, masteryLevel: "struggling" };
  it("correct advances streak + level", () => {
    const c = recordOutcome(base, "correct");
    expect(c.consecutiveCorrect).toBe(2);
    expect(c.masteryLevel).toBe("developing");
    expect(c.totalAttempts).toBe(2);
  });
  it("wrong resets streak + bumps missCount", () => {
    const c = recordOutcome({ ...base, consecutiveCorrect: 3 }, "wrong");
    expect(c.consecutiveCorrect).toBe(0);
    expect(c.missCount).toBe(1);
    expect(c.masteryLevel).toBe("struggling");
  });
  it("exposure leaves streak, bumps attempts", () => {
    const c = recordOutcome(base, "exposure");
    expect(c.consecutiveCorrect).toBe(1);
    expect(c.totalAttempts).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/mastery.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/mastery.js`**

```javascript
/** Mastery model — matches App.jsx (>=4 mastered, >=2 developing, else struggling). */
export function levelFromConsecutive(n) {
  const c = Number(n) || 0;
  return c >= 4 ? "mastered" : c >= 2 ? "developing" : "struggling";
}

export function modeForLevel(level) {
  if (level === "mastered") return "test";
  if (level === "developing") return "recognize";
  return "teach";
}

/** Pure: apply an outcome to a concept, returning a new concept object. */
export function recordOutcome(concept, outcome) {
  const c = concept || {};
  let consecutiveCorrect = c.consecutiveCorrect || 0;
  let missCount = c.missCount || 0;
  if (outcome === "correct") consecutiveCorrect += 1;
  else if (outcome === "wrong") { consecutiveCorrect = 0; missCount += 1; }
  // "exposure": leave streak untouched
  return {
    ...c,
    consecutiveCorrect,
    missCount,
    totalAttempts: (c.totalAttempts || 0) + 1,
    masteryLevel: levelFromConsecutive(consecutiveCorrect),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/mastery.test.js`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/engine/mastery.js src/engine/mastery.test.js
git commit -m "feat: engine mastery helpers (level/mode/outcome)"
```

---

## Task 2: Concept selection (pure, TDD)

**Files:** Create `src/engine/selectConcept.js`, Test `src/engine/selectConcept.test.js`

**Interfaces:**
- Consumes: `modeForLevel` from `./mastery.js`.
- `selectNext(concepts, newPool): { concept, mode, isNew } | null` — picks weak-first: struggling first then developing, each ordered by `missCount` desc (tie → original order); when no struggling/developing remain, returns the first `newPool` entry as a brand-new struggling concept (`isNew: true`, mode `"teach"`). Returns `null` if nothing available. `mastered` concepts are eligible only if no struggling/developing AND no newPool (then a mastered concept for a `test`).

- [ ] **Step 1: Write the failing tests**

```javascript
// src/engine/selectConcept.test.js
import { describe, it, expect } from "vitest";
import { selectNext } from "./selectConcept.js";

const C = (concept, masteryLevel, missCount = 0) => ({ concept, masteryLevel, missCount });

describe("selectNext", () => {
  it("prioritizes struggling, highest missCount first", () => {
    const out = selectNext([C("a", "developing"), C("b", "struggling", 1), C("c", "struggling", 5)], []);
    expect(out).toMatchObject({ concept: C("c", "struggling", 5), mode: "teach" });
  });
  it("falls to developing when no struggling", () => {
    const out = selectNext([C("a", "developing", 2), C("b", "mastered")], []);
    expect(out).toMatchObject({ mode: "recognize" });
    expect(out.concept.concept).toBe("a");
  });
  it("introduces a new concept when weak backlog is empty", () => {
    const out = selectNext([C("a", "mastered")], [{ concept: "newconcept" }]);
    expect(out).toMatchObject({ isNew: true, mode: "teach" });
    expect(out.concept.concept).toBe("newconcept");
  });
  it("tests a mastered concept only when nothing weak and no new pool", () => {
    const out = selectNext([C("a", "mastered")], []);
    expect(out).toMatchObject({ mode: "test" });
  });
  it("returns null when empty", () => {
    expect(selectNext([], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/selectConcept.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/selectConcept.js`**

```javascript
import { modeForLevel } from "./mastery.js";

/** Weak-first concept selection. See spec for ordering rules. */
export function selectNext(concepts, newPool) {
  const list = Array.isArray(concepts) ? concepts : [];
  const byLevel = (lvl) =>
    list
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.masteryLevel === lvl)
      .sort((a, b) => (b.c.missCount || 0) - (a.c.missCount || 0) || a.i - b.i)
      .map((x) => x.c);

  const struggling = byLevel("struggling");
  if (struggling.length) return { concept: struggling[0], mode: "teach", isNew: false };

  const developing = byLevel("developing");
  if (developing.length) return { concept: developing[0], mode: "recognize", isNew: false };

  const pool = Array.isArray(newPool) ? newPool : [];
  if (pool.length) {
    const fresh = { ...pool[0], masteryLevel: "struggling", consecutiveCorrect: 0, missCount: 0, totalAttempts: 0 };
    return { concept: fresh, mode: "teach", isNew: true };
  }

  const mastered = byLevel("mastered");
  if (mastered.length) return { concept: mastered[0], mode: modeForLevel("mastered"), isNew: false };

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/selectConcept.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/selectConcept.js src/engine/selectConcept.test.js
git commit -m "feat: engine weak-first concept selection"
```

---

## Task 3: Session reducer (pure, TDD)

**Files:** Create `src/engine/session.js`, Test `src/engine/session.test.js`

**Interfaces:**
- `createSession(size = 10): SessionState` → `{ size, index: 0, results: [], done: false }`.
- `advanceSession(state, item): SessionState` — push `item` (`{ concept, mode, outcome }`) to `results`, increment `index`, set `done` when `index >= size`.
- `sessionSummary(state): { total, correct, wrong, exposures, masteredGained }` — counts from `results` (`masteredGained` = items whose `outcome==="correct"` AND `item.becameMastered===true`).

- [ ] **Step 1: Write the failing tests**

```javascript
// src/engine/session.test.js
import { describe, it, expect } from "vitest";
import { createSession, advanceSession, sessionSummary } from "./session.js";

describe("session reducer", () => {
  it("creates an empty burst", () => {
    expect(createSession(3)).toEqual({ size: 3, index: 0, results: [], done: false });
  });
  it("advances and completes at size", () => {
    let s = createSession(2);
    s = advanceSession(s, { concept: "a", mode: "teach", outcome: "exposure" });
    expect(s.index).toBe(1);
    expect(s.done).toBe(false);
    s = advanceSession(s, { concept: "b", mode: "test", outcome: "correct" });
    expect(s.index).toBe(2);
    expect(s.done).toBe(true);
  });
  it("summarizes outcomes", () => {
    let s = createSession(3);
    s = advanceSession(s, { concept: "a", mode: "recognize", outcome: "correct", becameMastered: true });
    s = advanceSession(s, { concept: "b", mode: "test", outcome: "wrong" });
    s = advanceSession(s, { concept: "c", mode: "teach", outcome: "exposure" });
    expect(sessionSummary(s)).toEqual({ total: 3, correct: 1, wrong: 1, exposures: 1, masteredGained: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/session.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/session.js`**

```javascript
export function createSession(size = 10) {
  return { size, index: 0, results: [], done: false };
}

export function advanceSession(state, item) {
  const results = [...state.results, item];
  const index = state.index + 1;
  return { ...state, results, index, done: index >= state.size };
}

export function sessionSummary(state) {
  const r = state.results || [];
  return {
    total: r.length,
    correct: r.filter((x) => x.outcome === "correct").length,
    wrong: r.filter((x) => x.outcome === "wrong").length,
    exposures: r.filter((x) => x.outcome === "exposure").length,
    masteredGained: r.filter((x) => x.outcome === "correct" && x.becameMastered).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/session.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/session.js src/engine/session.test.js
git commit -m "feat: engine session reducer + summary"
```

---

## Task 4: Content matching + mastery store

**Files:** Create `src/engine/content.js`, `src/engine/masteryStore.js`, Test `src/engine/content.test.js`

**Interfaces:**
- Consumes: `pickWeightedItems`, `fetchRecognitionItems`, `buildBlockBank` from `../recognitionBank.js`; `recordOutcome` from `./mastery.js`.
- `pickItemForConcept(items, conceptName): item | null` — pure; returns the bank item whose content best matches `conceptName` (reuse `pickWeightedItems(items, [conceptName], 1)[0]`), else the first item, else null.
- `ensureBlockItems(userId, blockId): Promise<item[]>` — `fetchRecognitionItems`; if empty, `await buildBlockBank(userId, blockId, { cap: 12 })` then re-fetch.
- `readConcepts(blockId): Concept[]` and `writeConcept(blockId, concept): void` in `masteryStore.js` — read/update `rxt-weak-concepts[blockId]` (match by `concept` name), persist, dispatch `rxt-weak-concepts-updated`.

- [ ] **Step 1: Write the failing test (pure matcher)**

```javascript
// src/engine/content.test.js
import { describe, it, expect } from "vitest";
import { pickItemForConcept } from "./content.js";

const items = [
  { id: "1", subject: "Heart failure", data: { correctDiagnosis: "CHF" } },
  { id: "2", subject: "Renal", data: { correctDiagnosis: "Nephritis", vignette: "glomerular crescents" } },
];

describe("pickItemForConcept", () => {
  it("matches a concept against item content", () => {
    expect(pickItemForConcept(items, "glomerular").id).toBe("2");
  });
  it("falls back to first item when no match", () => {
    expect(pickItemForConcept(items, "zzz").id).toBe("1");
  });
  it("returns null for empty items", () => {
    expect(pickItemForConcept([], "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/content.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/content.js`**

```javascript
import { pickWeightedItems, fetchRecognitionItems, buildBlockBank } from "../recognitionBank.js";

/** Best bank item for a concept (content match), else first, else null. */
export function pickItemForConcept(items, conceptName) {
  if (!items?.length) return null;
  const [match] = pickWeightedItems(items, [conceptName], 1);
  return match || items[0];
}

/** Ensure a block has bank items; build a small batch if empty. */
export async function ensureBlockItems(userId, blockId) {
  let items = await fetchRecognitionItems(userId, blockId);
  if (!items.length && userId) {
    await buildBlockBank(userId, blockId, { cap: 12 });
    items = await fetchRecognitionItems(userId, blockId);
  }
  return items;
}
```

- [ ] **Step 4: Implement `src/engine/masteryStore.js`**

```javascript
const KEY = "rxt-weak-concepts";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}

/** Concepts for a block (array), or []. */
export function readConcepts(blockId) {
  const all = readAll();
  return Array.isArray(all[blockId]) ? all[blockId] : [];
}

/** Upsert a concept (matched by name) into a block, persist, notify. */
export function writeConcept(blockId, concept) {
  if (!blockId || !concept?.concept) return;
  const all = readAll();
  const list = Array.isArray(all[blockId]) ? [...all[blockId]] : [];
  const name = concept.concept.toLowerCase();
  const idx = list.findIndex((c) => (c.concept || "").toLowerCase() === name);
  if (idx === -1) list.push(concept);
  else list[idx] = concept;
  all[blockId] = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  try { window.dispatchEvent(new CustomEvent("rxt-weak-concepts-updated")); } catch {}
}
```

- [ ] **Step 5: Run test + commit**

Run: `npm test -- src/engine/content.test.js` → PASS (3).
```bash
git add src/engine/content.js src/engine/masteryStore.js src/engine/content.test.js
git commit -m "feat: engine content matcher + mastery store"
```

---

## Task 5: EngineSession view + Shell wiring

**Files:** Create `src/engine/EngineSession.jsx`, Modify `src/shell/Shell.jsx`

**Interfaces:**
- Consumes: all of `src/engine/*`; `Button` from `../ui/Button.jsx`.
- `EngineSession` props `{ userId, blockId, blockName, newPool, onExit }`. `newPool` = `[{ concept }]` derived from block subjects/objectives for new material.
- `Shell.jsx`: "Continue learning" sets state to show `EngineSession` for the active block.

- [ ] **Step 1: Create `src/engine/EngineSession.jsx`**

```javascript
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../ui/Button.jsx";
import { readConcepts, writeConcept } from "./masteryStore.js";
import { ensureBlockItems, pickItemForConcept } from "./content.js";
import { selectNext } from "./selectConcept.js";
import { createSession, advanceSession, sessionSummary } from "./session.js";
import { recordOutcome, levelFromConsecutive } from "./mastery.js";

const BURST = 10;

export function EngineSession({ userId, blockId, blockName, newPool = [], onExit }) {
  const [items, setItems] = useState(null); // null=loading
  const [session, setSession] = useState(() => createSession(BURST));
  const [current, setCurrent] = useState(null); // { concept, mode, item, isNew }
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const conceptsRef = useRef([]);

  // Load bank items once.
  useEffect(() => {
    let alive = true;
    (async () => {
      const it = await ensureBlockItems(userId, blockId);
      if (alive) setItems(it);
    })();
    return () => { alive = false; };
  }, [userId, blockId]);

  const nextItem = useCallback(() => {
    setPicked(null); setRevealed(false);
    const concepts = readConcepts(blockId);
    conceptsRef.current = concepts;
    const sel = selectNext(concepts, newPool);
    if (!sel) { setCurrent(null); return; }
    const item = pickItemForConcept(items || [], sel.concept.concept);
    setCurrent({ ...sel, item });
  }, [blockId, newPool, items]);

  // Kick off the first item once items are loaded.
  useEffect(() => { if (items && !current && !session.done) nextItem(); }, [items]); // eslint-disable-line

  const submit = useCallback((outcome) => {
    if (!current) return;
    // update mastery (teach = exposure)
    const updated = recordOutcome(current.concept, outcome);
    const becameMastered = updated.masteryLevel === "mastered" && current.concept.masteryLevel !== "mastered";
    writeConcept(blockId, updated);
    const next = advanceSession(session, { concept: current.concept.concept, mode: current.mode, outcome, becameMastered });
    setSession(next);
    if (next.done) setCurrent(null);
    else nextItem();
  }, [current, session, blockId, nextItem]);

  // ---- render ----
  if (items === null) {
    return <Centered>Loading your session…</Centered>;
  }
  if (session.done) {
    const s = sessionSummary(session);
    return (
      <Centered>
        <div className="text-lg font-bold text-text-1">Session complete</div>
        <div className="mt-2 font-mono text-xs text-text-2">
          {s.total} items · {s.correct} correct · {s.wrong} missed · {s.masteredGained} newly mastered
        </div>
        <div className="mt-4 flex gap-2 justify-center">
          <Button onClick={() => { setSession(createSession(BURST)); setCurrent(null); }}>Another round</Button>
          <Button variant="outline" onClick={onExit}>Done</Button>
        </div>
      </Centered>
    );
  }
  if (!current) {
    return <Centered>Nothing to study in {blockName} yet — build the recognition bank first.<div className="mt-3"><Button variant="outline" onClick={onExit}>Back</Button></div></Centered>;
  }

  const q = current.item?.data;
  const modeLabel = { teach: "Teach", recognize: "Recognize", test: "Test" }[current.mode];

  return (
    <div className="mx-auto max-w-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-accent-text">{modeLabel} · {current.concept.concept}</span>
        <span className="font-mono text-[11px] text-text-3">{session.index + 1}/{session.size}</span>
      </div>

      {!q && <Centered>No case available for this concept.<div className="mt-3"><Button onClick={() => submit("exposure")}>Skip</Button></div></Centered>}

      {q && current.mode === "teach" && (
        <div className="space-y-3">
          <Panel label="Mechanism">{q.mechanism}</Panel>
          {q.keyDifferentiator && <Panel label="Key differentiator">{q.keyDifferentiator}</Panel>}
          <div className="rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-2">{q.vignette}</div>
          <Button onClick={() => submit("exposure")}>Got it →</Button>
        </div>
      )}

      {q && (current.mode === "recognize" || current.mode === "test") && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-bg-elevated p-4 text-sm text-text-1">{q.vignette}</div>
          <div className="text-sm font-semibold text-text-1">{q.leadIn || "Most likely diagnosis?"}</div>
          <div className="flex flex-col gap-2">
            {(q.options || []).map((o) => {
              const isPicked = picked === o.letter;
              const show = revealed;
              const cls = !show ? "border-border" : o.isCorrect ? "border-good" : isPicked ? "border-bad" : "border-border";
              return (
                <button key={o.letter} disabled={revealed}
                  onClick={() => { setPicked(o.letter); setRevealed(true); }}
                  className={"flex items-center gap-2 rounded-lg border bg-bg-elevated px-3 py-2 text-left text-sm text-text-1 " + cls}>
                  <span className="font-mono text-text-3">{o.letter}</span>{o.text}
                </button>
              );
            })}
          </div>
          {revealed && (
            <div className="space-y-2">
              {current.mode === "recognize" && <Panel label="Mechanism">{q.mechanism}</Panel>}
              <Button onClick={() => {
                const correct = (q.options || []).find((o) => o.letter === picked)?.isCorrect;
                submit(correct ? "correct" : "wrong");
              }}>Next →</Button>
            </div>
          )}
        </div>
      )}

      <button onClick={onExit} className="mt-6 text-xs text-text-3 hover:text-text-1">Exit session</button>
    </div>
  );
}

function Panel({ label, children }) {
  return (
    <div className="rounded-lg border-l-2 border-accent bg-bg-elevated p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-3">{label}</div>
      <div className="text-sm leading-relaxed text-text-1 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Centered({ children }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center text-sm text-text-2">{children}</div>;
}
```

- [ ] **Step 2: Wire `Shell.jsx` "Continue learning" to mount the engine**

In `src/shell/Shell.jsx`, add session state + supabase user, and render `EngineSession` when active. Add imports:

```javascript
import { EngineSession } from "../engine/EngineSession.jsx";
import { supabase } from "../supabase.js";
import { readTerms, readLectures, flattenBlocks } from "./data.js"; // already imported
```

Add state + user near the other hooks:

```javascript
  const [inSession, setInSession] = useState(false);
  const [userId, setUserId] = useState(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id ?? null)); }, []);
```

Replace the `onContinue` placeholder body:

```javascript
  const onContinue = useCallback(() => setInSession(true), []);
```

In the `<main>`, render the session when active, else block home:

```javascript
        <main className="flex-1 overflow-y-auto">
          {inSession && activeBlockId ? (
            <EngineSession
              userId={userId}
              blockId={activeBlockId}
              blockName={active?.name}
              newPool={[]}
              onExit={() => setInSession(false)}
            />
          ) : (
            <BlockHome blockId={activeBlockId} onContinue={onContinue} />
          )}
        </main>
```

- [ ] **Step 3: Build + manual verify**

Run: `npm run build` → `✓ built`. `npm test` → all pass (existing + engine units).
Manual (`?shell=new`, signed in, a block with bank items): click ▸ Continue learning → an item renders in a mode (Teach shows mechanism then "Got it"; Recognize/Test show options → pick → reveal → Next). Progress counts up to 10 → summary. Answers change `rxt-weak-concepts` (re-opening shifts modes). Exit returns to block home.

- [ ] **Step 4: Commit**

```bash
git add src/engine/EngineSession.jsx src/shell/Shell.jsx
git commit -m "feat: adaptive EngineSession view wired to Continue learning"
```

---

## Self-Review Notes

- **Spec coverage:** mastery model reuse (Task 1), weak-first selection + new-when-light (Task 2), burst + summary (Task 3), content matching + bank ensure + mastery persistence (Task 4), three mode presentations + Claude-via-bank + Continue wiring (Task 5). Teach = exposure (ungraded) — Task 1 `recordOutcome("exposure")` + Task 5 teach submits `"exposure"`. ⌘K override + live "Teach me deeper" are existing/deferred polish (the shell's ⌘K already exists; deeper-teach can be a follow-on — noted, not blocking the core loop).
- **Type consistency:** `Concept { concept, masteryLevel, consecutiveCorrect, missCount, totalAttempts }` consistent across mastery/selectConcept/masteryStore/EngineSession; `selectNext → { concept, mode, isNew }`; session item `{ concept, mode, outcome, becameMastered }` consistent between Task 3 tests and Task 5 `advanceSession` calls; `pickItemForConcept(items, name)` matches Task 5 usage.
- **Out of scope respected:** no legacy-view migration, no generation changes (only calls `buildBlockBank`/`fetchRecognitionItems`), no Edge Fn auth change.
- **No component tests** (vitest node env) — views verified by build + manual; all four pure modules are unit-tested.
- Gap noted: "Teach me deeper" live Claude call from the Teach view is not in these tasks (the mechanism text from the bank item is shown instead). Acceptable for the core loop; add as a follow-up if desired.
