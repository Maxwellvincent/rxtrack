import React, { useState, useEffect, useCallback } from "react";
import { ping, pullProperLearningCards, ANKI_SETUP_NOTE, ANKICONNECT_ADDON_CODE } from "./ankiConnect";
import { upsertAnkiCards } from "./ankiCards";
import { supabase } from "./supabase";
import { buildBlockBank } from "./recognitionBank";

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
  const [progress, setProgress] = useState(null); // { deck, done, total }
  const [result, setResult] = useState(null); // { blocks, total }
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(null);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError("");
    try {
      await ping();
      setStatus("ready");
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  const sync = useCallback(async () => {
    setStatus("syncing");
    setError("");
    setResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in first — cards are saved to your account.");
      const appTerms = JSON.parse(localStorage.getItem("rxt-terms") || "[]");
      setProgress({ deck: "Proper Learning", done: 0, total: 0 });
      const rows = await pullProperLearningCards(appTerms, {
        onProgress: (done, total, deck) => setProgress({ deck, done, total }),
      });
      const { count, error } = await upsertAnkiCards(user.id, rows);
      if (error) throw new Error(error.message || "Upload failed");
      setResult({
        blocks: new Set(rows.map((r) => r.block_id)).size,
        total: count,
        blockIds: Array.from(new Set(rows.map((r) => r.block_id))),
      });
      setStatus("done");
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("error");
    } finally {
      setProgress(null);
    }
  }, []);

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

          {/* Ready */}
          {status === "ready" && (
            <>
              <div style={{ fontSize: 13, color: T.text2, marginBottom: 14, lineHeight: 1.5 }}>
                Pull every card under <strong>Proper Learning</strong> into your account (organized by term → block).
                Anki must be open. This is a one-time grab; re-running updates cards in place.
              </div>
              <button type="button" onClick={sync} style={primaryBtn}>
                Pull Proper Learning → my account
              </button>
            </>
          )}

          {/* Syncing */}
          {status === "syncing" && (
            <div style={{ padding: "16px 0" }}>
              {progress && (
                <div style={{ fontSize: 12.5, color: T.text3, marginBottom: 12, fontFamily: "var(--font-mono)" }}>
                  Pulling <span style={{ color: T.text2 }}>{progress.deck}</span>
                  {progress.total > 0 ? ` — ${progress.done}/${progress.total}` : "…"}
                </div>
              )}
              <div style={{ fontSize: 13, color: T.text3 }}>Syncing…</div>
            </div>
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
              <button
                type="button"
                disabled={building}
                onClick={async () => {
                  setBuilding(true);
                  setError("");
                  setBuilt(0);
                  const { data: { user } } = await supabase.auth.getUser();
                  let total = 0;
                  let firstErr = null;
                  // Loop small batches per block (cap each) so calls never time out.
                  for (const blockId of result.blockIds || []) {
                    const r = await buildBlockBank(user.id, blockId, {
                      cap: 60,
                      onProgress: ({ generated }) => setBuilt(total + generated),
                    });
                    total += r.generated || 0;
                    setBuilt(total);
                    if (r.error && !firstErr) firstErr = r.error;
                  }
                  setBuilt(total);
                  setBuilding(false);
                  if (firstErr) setError(typeof firstErr === "string" ? firstErr : (firstErr.message || "Bank build failed"));
                }}
                style={{ ...primaryBtn, marginTop: 12 }}
              >
                {building ? `Building bank… (${built ?? 0})` : "Build recognition bank"}
              </button>
              {built != null && !building && (
                <div style={{ fontSize: 12.5, color: T.text3, marginTop: 8 }}>{built} items generated</div>
              )}
              {error && (
                <div style={{ fontSize: 12.5, color: T.statusBad, marginTop: 6 }}>{error}</div>
              )}
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
