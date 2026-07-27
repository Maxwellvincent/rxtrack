/**
 * SP1 T5.1 — which shell boots, resolved explicitly.
 *
 * Precedence, in order: query-param override → remote flag → local flag →
 * default. Remote beats local deliberately: it is the kill switch. If the new
 * shell turns out to be broken, setting the remote flag to "old" both forces
 * the old shell AND clears the persisted local choice, so the next boot does
 * not bounce straight back into the bad state.
 *
 * The thing this replaces did none of that: `?shell=new` wrote
 * `rxt-new-shell=1` and there was no way to turn it off except knowing to visit
 * `?shell=old`.
 */

export const SHELL_NEW = "new";
export const SHELL_OLD = "old";
export const LOCAL_KEY = "rxt-new-shell";

/**
 * The new shell is the default (SP1 T6.1, 2026-07-27).
 *
 * `?shell=old` is the per-load escape hatch and it persists, the remote flag is
 * the fleet-wide rollback, and App.jsx is still there behind both.
 */
export const DEFAULT_SHELL = SHELL_NEW;

const normalise = (value) => {
  if (value === SHELL_NEW || value === SHELL_OLD) return value;
  if (value === true || value === "1") return SHELL_NEW;
  if (value === false || value === "0") return SHELL_OLD;
  return null;
};

export function readQueryShell(search = typeof window !== "undefined" ? window.location.search : "") {
  try {
    return normalise(new URLSearchParams(search).get("shell"));
  } catch {
    return null;
  }
}

export function readLocalShell() {
  try {
    return normalise(localStorage.getItem(LOCAL_KEY));
  } catch {
    return null;
  }
}

/**
 * Both choices persist. Before the flip, "old" was stored by removing the key —
 * which stopped meaning anything the moment the default became "new", because
 * an absent key falls through to the default. "0" is an explicit "keep me on
 * the old shell".
 */
export function setLocalShell(choice) {
  try {
    if (choice === SHELL_NEW) localStorage.setItem(LOCAL_KEY, "1");
    else if (choice === SHELL_OLD) localStorage.setItem(LOCAL_KEY, "0");
    else localStorage.removeItem(LOCAL_KEY);
  } catch { /* storage unavailable — the session choice still applies */ }
}

/** Rollback: forget the sticky choice entirely. */
export function clearLocalShell() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch { /* nothing to clear */ }
}

/**
 * @param {object} inputs
 * @param {string|null} inputs.query  ?shell= override for this load
 * @param {string|null} inputs.remote flag from the user's cloud record
 * @param {string|null} inputs.local  persisted choice
 * @returns {{shell: string, source: "query"|"remote"|"local"|"default"}}
 */
export function resolveShellChoice({ query = null, remote = null, local = null, fallback = DEFAULT_SHELL } = {}) {
  const q = normalise(query);
  if (q) return { shell: q, source: "query" };

  const r = normalise(remote);
  if (r) return { shell: r, source: "remote" };

  const l = normalise(local);
  if (l) return { shell: l, source: "local" };

  return { shell: normalise(fallback) ?? SHELL_OLD, source: "default" };
}

/**
 * What the persisted local choice should become after seeing the remote flag.
 *
 * When they disagree, the remote value is written down — it is not enough to
 * just clear the local one. Now that the default is "new", clearing on a
 * rollback would fall straight back through to "new" the moment the remote flag
 * was removed, i.e. back into the shell that was being rolled back.
 *
 * @returns {string|null} value to persist, or null when nothing should change
 *   (no remote opinion, or it already agrees).
 */
export function localFlagAfterRemote({ remote = null, local = null } = {}) {
  const r = normalise(remote);
  const l = normalise(local);
  if (!r) return null;
  return r === l ? null : r;
}
