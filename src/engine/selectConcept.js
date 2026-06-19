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
