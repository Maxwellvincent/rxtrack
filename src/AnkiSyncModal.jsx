import React, { useState, useEffect, useCallback } from "react";
import {
  ping,
  getDeckNames,
  pullDeckObjectives,
  saveObjectivesToStore,
  ANKI_SETUP_NOTE,
  ANKICONNECT_ADDON_CODE,
} from "./ankiConnect";

// ── Anki Sync ────────────────────────────────────────────────────────────────
// Pulls deck content from the locally-running Anki desktop (AnkiConnect add-on)
// into the localStorage knowledge base (rxt-block-objectives), one block per
// deck. Patient Recognition and other modes then build vignettes from it.
//
// Local-only: a deployed https:// page can't reach http://localhost:8765
// (mixed content), so this is a dev / local-build tool. Self-contained — props
// are just T (theme) and onClose, matching PatientRecognition.

export default function AnkiSyncModal({ T, onClose }) {
  const [status, setStatus] = useState("connecting"); // connecting | ready | error | syncing | done
  const [error, setError] = useState("");
  const [decks, setDecks] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [progress, setProgress] = useState(null); // { deck, done, total }
  const [result, setResult] = useState(null); // { blocks, total }

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError("");
    try {
      await ping();
      const names = await getDeckNames();
      setDecks(names);
      setStatus("ready");
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  const toggle = (deck) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(deck) ? next.delete(deck) : next.add(deck);
      return next;
    });
  };

  const sync = useCallback(async () => {
    const chosen = Array.from(selected);
    if (chosen.length === 0) return;
    setStatus("syncing");
    setError("");
    setResult(null);
    try {
      const all = [];
      for (const deck of chosen) {
        setProgress({ deck, done: 0, total: 0 });
        const objs = await pullDeckObjectives(deck, {
          onProgress: (done, total) => setProgress({ deck, done, total }),
        });
        all.push(...objs);
      }
      const saved = saveObjectivesToStore(all);
      setResult(saved);
      setStatus("done");
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("error");
    } finally {
      setProgress(null);
    }
  }, [selected]);

  const overlay = {
    position: "fixed",
    inset: 0,
    background: T.overlayBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: 16,
    backdropFilter: "blur(3px)",
  };
  const panel = {
    background: T.cardBg,
    border: "1px solid " + T.border1,
    borderRadius: 16,
    width: "100%",
    maxWidth: 620,
    maxHeight: "92vh",
    overflowY: "auto",
    boxShadow: T.shadowMd,
    fontFamily: "var(--font-sans)",
  };
  const accent = T.statusProgress;

  const primaryBtn = {
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    background: accent,
    border: "1px solid " + accent,
    borderRadius: 10,
    color: "#fff",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Anki Sync" onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        {/* Header */}
        <div
          style={{
            padding: "18px 22px 14px",
            borderBottom: "1px solid " + T.border2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            position: "sticky",
            top: 0,
            background: T.cardBg,
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🃏</span>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600, color: T.text1 }}>
                Anki Sync
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 3, fontFamily: "var(--font-mono)" }}>
              Deck → knowledge base · local only
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "none", color: T.text3, fontSize: 20, cursor: "pointer", padding: 4 }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "18px 22px 22px" }}>
          {/* Connecting */}
          {status === "connecting" && (
            <div style={{ padding: "40px 0", textAlign: "center", color: T.text3 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔌</div>
              <div style={{ fontSize: 14 }}>Connecting to Anki…</div>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div style={{ padding: "16px 0" }}>
              <div style={{ color: T.statusBad, fontSize: 14, marginBottom: 12, lineHeight: 1.5 }}>{error}</div>
              <div
                style={{
                  fontSize: 12.5,
                  color: T.text3,
                  lineHeight: 1.6,
                  background: T.inputBg,
                  border: "1px solid " + T.border2,
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontWeight: 700, color: T.text2, marginBottom: 6 }}>Setup checklist</div>
                1. Anki desktop is open.
                <br />
                2. AnkiConnect add-on installed (code <code style={{ fontFamily: "var(--font-mono)" }}>{ANKICONNECT_ADDON_CODE}</code>).
                <br />
                3. {ANKI_SETUP_NOTE}
              </div>
              <button type="button" onClick={connect} style={primaryBtn}>
                Retry
              </button>
            </div>
          )}

          {/* Deck picker */}
          {(status === "ready" || status === "syncing") && (
            <>
              <div style={{ fontSize: 13, color: T.text2, marginBottom: 12, lineHeight: 1.5 }}>
                Pick decks to pull into the knowledge base. Each deck becomes its own block; re-syncing updates
                cards in place (no duplicates).
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  maxHeight: 320,
                  overflowY: "auto",
                  border: "1px solid " + T.border2,
                  borderRadius: 11,
                  padding: 6,
                  marginBottom: 16,
                }}
              >
                {decks.length === 0 && (
                  <div style={{ padding: "16px", textAlign: "center", color: T.text3, fontSize: 13 }}>
                    No decks found in Anki.
                  </div>
                )}
                {decks.map((deck) => {
                  const on = selected.has(deck);
                  return (
                    <button
                      key={deck}
                      type="button"
                      onClick={() => toggle(deck)}
                      disabled={status === "syncing"}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        textAlign: "left",
                        padding: "9px 12px",
                        background: on ? T.statusProgressBg : "transparent",
                        border: "1px solid " + (on ? T.statusProgressBorder : "transparent"),
                        borderRadius: 9,
                        cursor: status === "syncing" ? "default" : "pointer",
                        color: T.text1,
                        fontFamily: "var(--font-sans)",
                        fontSize: 13.5,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          flexShrink: 0,
                          borderRadius: 4,
                          border: "1.5px solid " + (on ? accent : T.border1),
                          background: on ? accent : "transparent",
                          color: "#fff",
                          fontSize: 11,
                          lineHeight: "14px",
                          textAlign: "center",
                        }}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span style={{ flex: 1 }}>{deck}</span>
                    </button>
                  );
                })}
              </div>

              {status === "syncing" && progress && (
                <div style={{ fontSize: 12.5, color: T.text3, marginBottom: 12, fontFamily: "var(--font-mono)" }}>
                  Pulling <span style={{ color: T.text2 }}>{progress.deck}</span>
                  {progress.total > 0 ? ` — ${progress.done}/${progress.total}` : "…"}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  onClick={sync}
                  disabled={selected.size === 0 || status === "syncing"}
                  style={{
                    ...primaryBtn,
                    opacity: selected.size === 0 || status === "syncing" ? 0.5 : 1,
                    cursor: selected.size === 0 || status === "syncing" ? "default" : "pointer",
                  }}
                >
                  {status === "syncing" ? "Syncing…" : `Sync ${selected.size || ""} deck${selected.size === 1 ? "" : "s"}`}
                </button>
                {selected.size > 0 && status !== "syncing" && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    style={{ background: "transparent", border: "none", color: T.text3, fontSize: 12.5, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          )}

          {/* Done */}
          {status === "done" && result && (
            <div style={{ padding: "20px 0", textAlign: "center" }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 15, color: T.text1, fontWeight: 600, marginBottom: 6 }}>
                {result.total} card{result.total === 1 ? "" : "s"} synced
              </div>
              <div style={{ fontSize: 12.5, color: T.text3, marginBottom: 18, fontFamily: "var(--font-mono)" }}>
                across {result.blocks} block{result.blocks === 1 ? "" : "s"} · ready for Patient Recognition
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button type="button" onClick={() => setStatus("ready")} style={primaryBtn}>
                  Sync more
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "10px 18px",
                    fontSize: 14,
                    fontWeight: 600,
                    background: "transparent",
                    border: "1px solid " + T.border1,
                    borderRadius: 10,
                    color: T.text2,
                    cursor: "pointer",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
