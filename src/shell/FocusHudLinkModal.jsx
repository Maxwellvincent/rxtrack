import { useEffect, useState } from "react";
import {
  connectFocusHud,
  disconnectFocusHud,
  isFocusHudConfigured,
  onFocusHudUser,
} from "../focusHudLink.js";

/**
 * Links this browser to focus-hud so study activity is reported there.
 *
 * focus-hud is a separate Firebase project, so it needs its own sign-in. The
 * session persists per origin, which is why this is a one-time step rather than
 * something to think about again.
 */
export function FocusHudLinkModal({ onClose }) {
  const [uid, setUid] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => onFocusHudUser(setUid), []);

  async function connect() {
    setBusy(true);
    setError(null);
    const result = await connectFocusHud();
    if (!result.ok) setError(result.reason);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-line bg-surface p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">focus-hud link</h2>

        {!isFocusHudConfigured ? (
          <p className="mt-3 text-sm text-text-3">
            Not configured. Set the <code>VITE_FOCUSHUD_*</code> values in
            <code> .env</code> to enable it.
          </p>
        ) : uid ? (
          <>
            <p className="mt-3 text-sm text-text-2">
              Linked. Question sessions are reported to focus-hud while you work,
              so the time is attributed to the right lecture without starting a
              timer.
            </p>
            <p className="mt-2 break-all text-xs text-text-3">focus-hud user: {uid}</p>
            <div className="mt-4 flex gap-2">
              <button
                className="rounded border border-line px-3 py-1.5 text-sm"
                onClick={async () => {
                  await disconnectFocusHud();
                }}
              >
                Unlink
              </button>
              <button className="rounded border border-line px-3 py-1.5 text-sm" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-text-2">
              focus-hud is a separate Firebase project, so it needs its own
              sign-in. Use the same Google account; the session is remembered on
              this machine.
            </p>
            {error && <p className="mt-2 text-sm text-danger">Could not link: {error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                disabled={busy}
                className="rounded bg-accent px-3 py-1.5 text-sm text-black disabled:opacity-50"
                onClick={connect}
              >
                {busy ? "Linking…" : "Link with Google"}
              </button>
              <button className="rounded border border-line px-3 py-1.5 text-sm" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
