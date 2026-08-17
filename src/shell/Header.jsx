import { useState, useRef, useEffect } from "react";

export function Header({
  termName, blockName, theme, onToggleTheme,
  onAnki, onRecognize, onImportSchedule, onAddLecture, onBulkImport,
  onQuestionBanks, onRoutine, onDailyPlanSettings, onApiKeySettings, onFocusHudLink, onSignOut, onExamDate,
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
    onExamDate           && { label: "Exam date",          action: onExamDate },
    onDailyPlanSettings  && { label: "Daily plan settings", action: onDailyPlanSettings },
    onApiKeySettings     && { label: "AI settings",         action: onApiKeySettings },
    onFocusHudLink       && { label: "focus-hud link",      action: onFocusHudLink },
    onImportSchedule     && { label: "Import schedule",    action: onImportSchedule },
    onAddLecture         && { label: "Add lecture",        action: onAddLecture },
    onBulkImport         && { label: "Import folder",      action: onBulkImport },
    onQuestionBanks      && { label: "Question banks",    action: onQuestionBanks },
    onAnki               && { label: "Anki sync",         action: onAnki },
    onRecognize          && { label: "Recognize",         action: onRecognize },
  ].filter(Boolean);

  return (
    <header className="shell-chrome flex h-12 flex-shrink-0 items-center justify-between border-b border-border bg-bg px-5">
      {/* Breadcrumb — condensed uppercase */}
      <span className="font-condensed text-sm font-semibold uppercase tracking-wider text-text-3">
        {termName ? (
          <>{termName} <span className="text-text-3 opacity-50">/</span>{" "}
          <span className="text-text-1">{blockName}</span></>
        ) : (
          <span className="text-text-2">RxTrack</span>
        )}
      </span>

      <div className="flex items-center gap-4">
        {onRoutine && (
          <button
            onClick={onRoutine}
            className="font-condensed text-xs font-semibold uppercase tracking-wider text-text-3 hover:text-text-1 transition-colors"
          >
            Routine
          </button>
        )}
        <button
          onClick={onToggleTheme}
          className="font-mono text-[13px] text-text-3 hover:text-text-1 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "◑ light" : "◐ dark"}
        </button>
        {adminItems.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="font-mono text-sm text-text-3 hover:text-text-1 transition-colors"
              title="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-sm border border-border bg-bg-elevated py-1 shadow-xl">
                {adminItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { item.action(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left font-condensed text-[13px] font-semibold uppercase tracking-wide text-text-2 transition-colors hover:bg-panel hover:text-text-1"
                  >
                    {item.label}
                  </button>
                ))}
                {onSignOut && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => { onSignOut(); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left font-condensed text-[13px] font-semibold uppercase tracking-wide text-text-3 transition-colors hover:bg-panel hover:text-text-1"
                    >
                      Sign out
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {adminItems.length === 0 && onSignOut && (
          <button onClick={onSignOut} className="text-text-3 hover:text-text-1 font-mono text-sm">⎋</button>
        )}
      </div>
    </header>
  );
}
