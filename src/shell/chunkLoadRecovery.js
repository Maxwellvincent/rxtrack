const RELOAD_COOLDOWN_MS = 60_000;
const GUARD_KEY = "rxtrack:chunk-load-recovery";

/** Recover once when an open tab asks a newer deployment for an old lazy chunk. */
export function installChunkLoadRecovery(targetWindow = window, { reload, now = Date.now } = {}) {
  if (!targetWindow?.addEventListener) return () => {};
  let attemptedInThisDocument = false;
  const refresh = reload || (() => targetWindow.location.reload());
  const onPreloadError = (event) => {
    if (attemptedInThisDocument) return;
    let previous = 0;
    try { previous = Number(targetWindow.sessionStorage.getItem(GUARD_KEY)) || 0; } catch { /* storage may be unavailable */ }
    if (previous && now() - previous < RELOAD_COOLDOWN_MS) return;

    try { targetWindow.sessionStorage.setItem(GUARD_KEY, String(now())); } catch { return; }
    attemptedInThisDocument = true;
    event.preventDefault?.();
    refresh();
  };
  targetWindow.addEventListener("vite:preloadError", onPreloadError);
  return () => targetWindow.removeEventListener("vite:preloadError", onPreloadError);
}
