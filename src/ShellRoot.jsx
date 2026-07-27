/**
 * SP1 T5.1 — boot-time shell selection.
 *
 * Resolves query → remote → local → default. The local choice is applied
 * immediately so the first paint is not delayed by a network call; the remote
 * flag is consulted once auth settles and can override it, which is what makes
 * rollback possible without shipping a build.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { onAuthChange, fetchShellFlag } from "./supabase.js";
import {
  resolveShellChoice,
  localFlagAfterRemote,
  setLocalShell,
  readQueryShell,
  readLocalShell,
  SHELL_NEW,
} from "./shell/shellSelection.js";

const Shell = lazy(() => import("./shell/Shell.jsx"));
const App = lazy(() => import("./App.jsx"));

export default function ShellRoot() {
  const query = readQueryShell();
  const [choice, setChoice] = useState(() => resolveShellChoice({ query, local: readLocalShell() }));

  // A ?shell= override is what the user asked for, so it sticks — but only as
  // the local choice, which the remote flag can still overrule below.
  useEffect(() => {
    if (query) setLocalShell(query);
  }, [query]);

  useEffect(() => {
    let alive = true;
    const unsub = onAuthChange(async (user) => {
      if (!user?.id) return;
      const remote = await fetchShellFlag(user.id);
      if (!alive || !remote) return;

      const local = readLocalShell();
      // Rollback: write the remote decision down. Clearing instead would fall
      // through to the default — which is now the new shell, i.e. straight back
      // into whatever was being rolled back.
      const next = localFlagAfterRemote({ remote, local });
      if (next) setLocalShell(next);
      setChoice(resolveShellChoice({ query, remote, local }));
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [query]);

  return (
    <Suspense fallback={null}>
      {choice.shell === SHELL_NEW ? <Shell /> : <App />}
    </Suspense>
  );
}
