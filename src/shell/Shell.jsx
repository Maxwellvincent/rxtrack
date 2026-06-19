import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTheme } from "./useTheme";
import { readTerms, readLectures, flattenBlocks } from "./data.js";
import { Sidebar } from "./Sidebar.jsx";
import { Header } from "./Header.jsx";
import { BlockHome } from "./BlockHome.jsx";
import { CommandPalette } from "../ui/CommandPalette.jsx";

export default function Shell() {
  const { theme, toggle } = useTheme();
  const blocks = useMemo(() => flattenBlocks(readTerms(), readLectures()), []);
  const [activeBlockId, setActiveBlockId] = useState(() => blocks[0]?.id ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const active = blocks.find((b) => b.id === activeBlockId) || null;

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

  const onContinue = useCallback(() => {
    // Placeholder — the adaptive engine is sub-project #2.
    alert("Adaptive learning session — coming in the next build (engine sub-project).");
  }, []);

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
          <BlockHome blockId={activeBlockId} onContinue={onContinue} />
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
