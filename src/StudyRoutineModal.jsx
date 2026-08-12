import { useEffect, useMemo, useState, useCallback } from "react";
import {
  loadRoutine,
  saveRoutine,
  resetRoutineToDefault,
  evaluateToday,
  getSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  markWeeklyReviewDone,
  getWeeklyStatus,
  addMissNote,
} from "./studyRoutine";

/**
 * Modal that surfaces the user's daily study routine, today's auto-checked
 * progress, and any active suggestions.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   onOpenWeakConcepts?: () => void   // navigates user to Weak Concepts tab
 */
export default function StudyRoutineModal({ open, onClose, onOpenWeakConcepts }) {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!open) return undefined;
    const events = [
      "rxt-routine-updated",
      "rxt-calibration-updated",
      "rxt-weak-concepts-updated",
      "rxt-completion-updated",
      "rxt-miss-notes-updated",
      "rxt-weak-drills-updated",
    ];
    events.forEach((e) => window.addEventListener(e, bump));
    return () => events.forEach((e) => window.removeEventListener(e, bump));
  }, [open, bump]);

  // tick forces re-read from localStorage after writes / event bumps.
  const routine = useMemo(
    () => loadRoutine(),
    [tick] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const evaluation = useMemo(
    () => evaluateToday({ routine }),
    [routine, tick] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const suggestions = useMemo(
    () => getSuggestions({ routine }),
    [routine, tick] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const weekly = useMemo(
    () => getWeeklyStatus({ routine }),
    [routine, tick] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!open) return null;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const pct = evaluation.totalCount
    ? Math.round((evaluation.doneCount / evaluation.totalCount) * 100)
    : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily study routine"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "60px 16px",
        zIndex: 9999,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
          background: "var(--color-background-primary, #fff)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          padding: 20,
        }}
      >
        <header style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "var(--color-text-tertiary)",
              }}
            >
              {today}
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700 }}>Daily study routine</h2>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              {evaluation.doneCount} / {evaluation.totalCount} steps · {pct}%
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: 20,
              lineHeight: 1,
              padding: "4px 10px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--color-text-tertiary)",
            }}
          >
            ×
          </button>
        </header>

        {/* progress bar */}
        <div
          style={{
            height: 6,
            borderRadius: 4,
            background: "var(--color-background-tertiary, #eee)",
            margin: "10px 0 14px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: pct >= 80 ? "#2E7D32" : pct >= 40 ? "#3C3489" : "#BA7517",
              transition: "width 200ms ease",
            }}
          />
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <section style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                marginBottom: 6,
                letterSpacing: 0.5,
              }}
            >
              Suggestions
            </div>
            {suggestions.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: "10px 12px",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: 8,
                  marginBottom: 6,
                  background: "#FFF8E1",
                }}
              >
                <div style={{ fontSize: 13, color: "#5D4200", marginBottom: 8 }}>{s.message}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.kind === "target-edit" && (
                    <button
                      type="button"
                      onClick={() => acceptSuggestion(s)}
                      style={btnPrimary}
                    >
                      Accept ({s.proposedTarget})
                    </button>
                  )}
                  {s.kind === "action" && s.action === "open-backfill" && (
                    <button
                      type="button"
                      onClick={() => {
                        acceptSuggestion(s);
                        onOpenWeakConcepts?.();
                        onClose?.();
                      }}
                      style={btnPrimary}
                    >
                      Open Weak Concepts
                    </button>
                  )}
                  {s.kind === "advisory" && (
                    <button type="button" onClick={() => acceptSuggestion(s)} style={btnPrimary}>
                      Got it
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissSuggestion(s.id, { snoozeDays: 7 })}
                    style={btnSecondary}
                  >
                    Snooze 7d
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissSuggestion(s.id)}
                    style={btnSecondary}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Steps */}
        <section style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              marginBottom: 6,
              letterSpacing: 0.5,
            }}
          >
            Today
          </div>
          {evaluation.steps.map((step) => {
            const def = (routine.steps || []).find((s) => s.id === step.stepId);
            return (
              <div
                key={step.stepId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: step.done ? "#E8F5E9" : "transparent",
                  marginBottom: 2,
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1.2 }}>{step.done ? "✅" : "⬜"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{step.title}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{step.label}</span>
                  </div>
                  {def?.description && (
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                      {def.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Weekly */}
        <section style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              marginBottom: 6,
              letterSpacing: 0.5,
            }}
          >
            Weekly
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 6,
              background: weekly.done ? "#E8F5E9" : "transparent",
            }}
          >
            <span style={{ fontSize: 16 }}>{weekly.done ? "✅" : "⬜"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{routine.weekly?.title || "Weekly review"}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                {routine.weekly?.description}
              </div>
            </div>
            {!weekly.done && (
              <button type="button" onClick={() => markWeeklyReviewDone()} style={btnPrimary}>
                Mark done
              </button>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 10,
            borderTop: "0.5px solid var(--color-border-tertiary, #eee)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Reset to the default routine? Your dismissed suggestions stay.")) {
                const r = loadRoutine();
                resetRoutineToDefault();
                // Preserve dismissals to honor the user's history.
                const fresh = loadRoutine();
                saveRoutine({
                  ...fresh,
                  acceptedSuggestionIds: r.acceptedSuggestionIds || [],
                  dismissedSuggestions: r.dismissedSuggestions || {},
                });
                bump();
              }
            }}
            style={{
              ...btnSecondary,
              color: "var(--color-text-tertiary)",
            }}
          >
            Reset to default
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Targets edit themselves when you accept suggestions.
          </span>
        </footer>
      </div>
    </div>
  );
}

const btnPrimary = {
  fontSize: 12,
  fontWeight: 600,
  padding: "6px 12px",
  border: "none",
  borderRadius: 6,
  background: "#3C3489",
  color: "#fff",
  cursor: "pointer",
};

const btnSecondary = {
  fontSize: 12,
  padding: "6px 10px",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

/**
 * Toast that listens for `rxt-miss-recorded` events and offers to capture a
 * 1-line "why I missed it" note. Mount once at the App root.
 */
export function MissNoteToast() {
  const [active, setActive] = useState(null); // { wcId, conceptName }
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      const detail = e?.detail || {};
      if (!detail.wcId) return;
      setActive({ wcId: detail.wcId, conceptName: detail.conceptName || "" });
      setValue("");
      setSaved(false);
    };
    window.addEventListener("rxt-miss-recorded", handler);
    return () => window.removeEventListener("rxt-miss-recorded", handler);
  }, []);

  if (!active) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setActive(null);
      return;
    }
    addMissNote({ wcId: active.wcId, note: trimmed });
    setSaved(true);
    setTimeout(() => setActive(null), 1200);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9998,
        width: "min(360px, calc(100vw - 40px))",
        background: "var(--color-background-primary, #fff)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        padding: 12,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--color-text-tertiary)",
          marginBottom: 4,
        }}
      >
        Why did you miss it?
      </div>
      {active.conceptName && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            marginBottom: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={active.conceptName}
        >
          {active.conceptName}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          autoFocus
          value={value}
          placeholder="One line, future-you will thank you"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setActive(null);
          }}
          style={{
            flex: 1,
            fontSize: 12,
            padding: "6px 8px",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 6,
            background: "var(--color-background-primary)",
            color: "var(--color-text-primary)",
          }}
        />
        <button type="button" onClick={submit} style={btnPrimary}>
          {saved ? "✓" : "Save"}
        </button>
        <button type="button" onClick={() => setActive(null)} style={btnSecondary}>
          Skip
        </button>
      </div>
    </div>
  );
}

/**
 * Tiny inline note input for the "why I missed it" capture flow on the
 * recordWrongAnswer site. Exported for App.jsx to embed near the miss UI.
 *
 * Props:
 *   wcId: string | null
 *   onSaved?: () => void
 */
export function MissNoteQuickCapture({ wcId, onSaved }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    addMissNote({ wcId, note: trimmed });
    setSaved(true);
    setValue("");
    onSaved?.();
    setTimeout(() => setSaved(false), 2000);
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 6,
        fontFamily: "var(--font-sans)",
      }}
    >
      <input
        type="text"
        value={value}
        placeholder="Why I missed it (1 line)"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        style={{
          flex: 1,
          fontSize: 12,
          padding: "6px 8px",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: 6,
          background: "var(--color-background-primary)",
          color: "var(--color-text-primary)",
        }}
      />
      <button type="button" onClick={submit} style={btnPrimary}>
        Save
      </button>
      {saved && <span style={{ fontSize: 11, color: "#2E7D32" }}>Saved</span>}
    </div>
  );
}
