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
import { supabase } from "../supabase.js";

export default function Shell() {
  const { theme, toggle } = useTheme();
  const blocks = useMemo(() => flattenBlocks(readTerms(), readLectures()), []);
  const [activeBlockId, setActiveBlockId] = useState(() => blocks[0]?.id ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inSession, setInSession] = useState(false);
  const [userId, setUserId] = useState(null);
  const active = blocks.find((b) => b.id === activeBlockId) || null;
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id ?? null)); }, []);

  // ⌘K opens the palette globally.
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
        onSelectBlock={setActiveBlockId}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header termName={active?.termName} blockName={active?.name} theme={theme} onToggleTheme={toggle} />
        <main className="flex-1 overflow-y-auto">
          {inSession && activeBlockId ? (
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
        onPick={(it) => setActiveBlockId(it.id)}
      />
    </div>
  );
}
