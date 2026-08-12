import { useState, useRef, useEffect } from "react";

export function Header({
  termName, blockName, theme, onToggleTheme,
  onAnki, onRecognize, onImportSchedule, onAddLecture, onBulkImport,
  onQuestionBanks, onRoutine, onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [menuOpen]);

  const adminItems = [
    onImportSchedule && { label: "📅 Import schedule", action: onImportSchedule },
    onAddLecture     && { label: "＋ Add lecture",      action: onAddLecture },
    onBulkImport     && { label: "⇉ Import folder",    action: onBulkImport },
    onQuestionBanks  && { label: "🗂 Question banks",  action: onQuestionBanks },
    onAnki           && { label: "🃏 Anki sync",       action: onAnki },
    onRecognize      && { label: "🩺 Recognize",       action: onRecognize },
  ].filter(Boolean);

  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-bg px-4 text-sm">
      <span className="font-mono text-xs text-text-3">
        {termName
          ? <>{termName} / <span className="text-text-1">{blockName}</span></>
          : "RXTrack"}
      </span>
      <div className="flex items-center gap-3 text-xs">
        {onRoutine && (
          <button onClick={onRoutine} className="text-text-2 hover:text-text-1" title="Daily study routine">
            📋 Routine
          </button>
        )}
        <button onClick={onToggleTheme} className="text-text-2 hover:text-text-1" aria-label="Toggle theme">
          {theme === "dark" ? "◑ light" : "◐ dark"}
        </button>
        {adminItems.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="text-text-2 hover:text-text-1"
              title="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-bg-elevated py-1 shadow-lg">
                {adminItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { item.action(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-2 hover:bg-panel hover:text-text-1"
                  >
                    {item.label}
                  </button>
                ))}
                {onSignOut && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => { onSignOut(); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-3 hover:bg-panel hover:text-text-1"
                    >
                      ⎋ Sign out
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {adminItems.length === 0 && onSignOut && (
          <button onClick={onSignOut} className="text-text-3 hover:text-text-1" title="Sign out">⎋</button>
        )}
      </div>
    </header>
  );
}
