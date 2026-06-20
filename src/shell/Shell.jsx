import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTheme } from "./useTheme";
import { readTerms, readLectures, flattenBlocks } from "./data.js";
import { Sidebar } from "./Sidebar.jsx";
import { Header } from "./Header.jsx";
import { BlockHome } from "./BlockHome.jsx";
import { CommandPalette } from "../ui/CommandPalette.jsx";
import { EngineSession } from "../engine/EngineSession.jsx";
import { Button } from "../ui/Button.jsx";
import { supabase, signInWithGoogle, signOut, pullAllDataFromSupabase } from "../supabase.js";
import AnkiSyncModal from "../AnkiSyncModal.jsx";
import PatientRecognition from "../PatientRecognition.jsx";
import { themes } from "../theme.js";

/**
 * Auth + cloud-load gate. localStorage is per-origin, so the shell pulls the
 * user's data from Supabase on sign-in — it works on any origin, not just the
 * one where data was first created.
 */
export default function Shell() {
  const { theme, toggle } = useTheme();
  const [phase, setPhase] = useState("checking"); // checking | signedout | loading | ready
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let alive = true;
    async function boot(uid) {
      if (!uid) { if (alive) { setUserId(null); setPhase("signedout"); } return; }
      if (alive) { setUserId(uid); setPhase("loading"); }
      try { await pullAllDataFromSupabase(uid); } catch (e) { console.warn("cloud pull failed", e?.message); }
      if (alive) setPhase("ready");
    }
    supabase.auth.getSession().then(({ data }) => boot(data?.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => boot(session?.user?.id ?? null));
    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const wrap = (children) => (
    <div className={`theme-${theme} flex h-screen items-center justify-center bg-bg text-text-1 font-sans`}>{children}</div>
  );

  if (phase === "checking") return wrap(<div className="text-sm text-text-3">Loading…</div>);
  if (phase === "loading") return wrap(<div className="text-sm text-text-3">Loading your data…</div>);
  if (phase === "signedout") {
    return wrap(
      <div className="flex flex-col items-center gap-4">
        <div className="font-display text-2xl">RXTrack</div>
        <div className="text-sm text-text-3">Sign in to load your terms, blocks, and bank.</div>
        <Button onClick={() => signInWithGoogle().catch((e) => alert(e?.message || "Sign-in failed"))}>
          Sign in with Google
        </Button>
      </div>
    );
  }
  return <ShellMain theme={theme} toggle={toggle} userId={userId} />;
}

function ShellMain({ theme, toggle, userId }) {
  // Computed once, AFTER the cloud pull populated localStorage.
  const blocks = useMemo(() => flattenBlocks(readTerms(), readLectures()), []);
  const [activeBlockId, setActiveBlockId] = useState(() => blocks[0]?.id ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inSession, setInSession] = useState(false);
  const [showAnki, setShowAnki] = useState(false);
  const [showRecognize, setShowRecognize] = useState(false);
  const active = blocks.find((b) => b.id === activeBlockId) || null;
  const legacyTheme = themes[theme] || themes.dark;

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(
    () => blocks.map((b) => ({ id: b.id, label: b.name, hint: b.termName })),
    [blocks]
  );

  const onContinue = useCallback(() => setInSession(true), []);

  return (
    <div className={`theme-${theme} flex h-screen overflow-hidden bg-bg text-text-1 font-sans`}>
      <Sidebar
        activeBlockId={activeBlockId}
        onSelectBlock={(id) => { setActiveBlockId(id); setInSession(false); }}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          termName={active?.termName}
          blockName={active?.name}
          theme={theme}
          onToggleTheme={toggle}
          onAnki={() => setShowAnki(true)}
          onRecognize={() => setShowRecognize(true)}
          onSignOut={() => signOut().then(() => window.location.reload())}
        />
        <main className="flex-1 overflow-y-auto">
          {blocks.length === 0 ? (
            <div className="p-8 text-sm text-text-3">No terms found in your account yet. Add them in the current app (?shell=old), then reload.</div>
          ) : inSession && activeBlockId ? (
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
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onPick={(it) => { setActiveBlockId(it.id); setInSession(false); }}
      />
      {showAnki && <AnkiSyncModal T={legacyTheme} onClose={() => setShowAnki(false)} />}
      {showRecognize && <PatientRecognition T={legacyTheme} onClose={() => setShowRecognize(false)} />}
    </div>
  );
}
