import React, { useState } from "react";
import {
  getRoutine,
  toggleItem,
  addItem,
  removeItem,
  isDoneToday,
  evaluateToday,
  getSuggestions,
} from "./studyRoutine";

// Daily study routine — checklist + smart suggestions.
// Self-contained: persists via studyRoutine.js (localStorage). Takes only
// theme `T` and `onClose`; optional `onChange` lets the parent refresh its
// menu summary badge.
export default function StudyRoutineModal({ T, onClose, onChange }) {
  const [, force] = useState(0);
  const [draft, setDraft] = useState("");
  const rerender = () => {
    force((x) => x + 1);
    onChange?.();
  };

  const routine = getRoutine();
  const { doneCount, totalCount } = evaluateToday();
  const suggestions = getSuggestions();
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const allDone = totalCount > 0 && doneCount === totalCount;

  const accent = T.statusGood; // colorblind-safe blue
  const card = {
    background: T.cardBg,
    border: "1px solid " + T.border1,
    borderRadius: 14,
  };

  const submitDraft = (e) => {
    e?.preventDefault?.();
    if (!draft.trim()) return;
    addItem(draft);
    setDraft("");
    rerender();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Study routine"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: T.overlayBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: 16,
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...card,
          width: "100%",
          maxWidth: 460,
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: T.shadowMd,
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 22px 16px",
            borderBottom: "1px solid " + T.border2,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 22,
                fontWeight: 600,
                color: T.text1,
                lineHeight: 1.1,
              }}
            >
              Study Routine
            </div>
            <div style={{ fontSize: 12, color: T.text3, marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {doneCount}/{totalCount} done today · {pct}%
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: T.text3,
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ padding: "0 22px", marginTop: 16 }}>
          <div style={{ height: 6, background: T.inputBg, borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                width: pct + "%",
                height: "100%",
                background: allDone ? T.statusGood : accent,
                borderRadius: 999,
                transition: "width 280ms cubic-bezier(.4,0,.2,1)",
              }}
            />
          </div>
          {allDone && (
            <div style={{ fontSize: 12, color: T.statusGood, marginTop: 8, fontWeight: 600 }}>
              ✓ Routine complete — nice work.
            </div>
          )}
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div style={{ padding: "16px 22px 0" }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: T.text3,
                fontWeight: 700,
                marginBottom: 8,
                fontFamily: "var(--font-mono)",
              }}
            >
              Suggested today
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: T.statusProgressBg,
                    border: "1px solid " + T.statusProgressBorder,
                    borderRadius: 9,
                    fontSize: 13,
                    color: T.text2,
                  }}
                >
                  <span style={{ color: T.statusProgress }}>◑</span>
                  {s.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Checklist */}
        <div style={{ padding: "18px 22px 8px" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: T.text3,
              fontWeight: 700,
              marginBottom: 8,
              fontFamily: "var(--font-mono)",
            }}
          >
            Today's checklist
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {routine.items.length === 0 && (
              <div style={{ fontSize: 13, color: T.text3, padding: "8px 0" }}>
                No tasks yet — add one below.
              </div>
            )}
            {routine.items.map((it) => {
              const done = isDoneToday(it);
              return (
                <div
                  key={it.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 10px",
                    borderRadius: 9,
                    background: done ? T.statusGoodBg : "transparent",
                    transition: "background 160ms",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      toggleItem(it.id);
                      rerender();
                    }}
                    aria-pressed={done}
                    aria-label={done ? "Mark not done" : "Mark done"}
                    style={{
                      width: 20,
                      height: 20,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: "2px solid " + (done ? T.statusGood : T.border1),
                      background: done ? T.statusGood : "transparent",
                      color: "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    {done ? "✓" : ""}
                  </button>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 14,
                      color: done ? T.text3 : T.text1,
                      textDecoration: done ? "line-through" : "none",
                    }}
                  >
                    {it.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      removeItem(it.id);
                      rerender();
                    }}
                    aria-label="Remove task"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: T.text4,
                      cursor: "pointer",
                      fontSize: 15,
                      padding: 2,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add task */}
        <form onSubmit={submitDraft} style={{ padding: "8px 22px 22px", display: "flex", gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task…"
            style={{
              flex: 1,
              padding: "9px 12px",
              fontSize: 13,
              background: T.inputBg,
              border: "1px solid " + T.border1,
              borderRadius: 9,
              color: T.text1,
              fontFamily: "var(--font-sans)",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: draft.trim() ? accent : T.inputBg,
              border: "1px solid " + (draft.trim() ? accent : T.border1),
              borderRadius: 9,
              color: draft.trim() ? "#fff" : T.text4,
              cursor: draft.trim() ? "pointer" : "default",
              fontFamily: "var(--font-sans)",
            }}
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
