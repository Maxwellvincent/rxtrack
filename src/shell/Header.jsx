export function Header({ termName, blockName, theme, onToggleTheme, onAnki, onRecognize, onSignOut }) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-bg px-4 text-sm">
      <span className="font-mono text-xs text-text-3">
        {termName ? <>{termName} / <span className="text-text-1">{blockName}</span></> : "RXTrack"}
      </span>
      <div className="flex items-center gap-3 text-xs">
        {onAnki && (
          <button onClick={onAnki} className="text-text-2 hover:text-text-1" title="Anki Sync — build the bank">🃏 Sync</button>
        )}
        {onRecognize && (
          <button onClick={onRecognize} className="text-text-2 hover:text-text-1" title="Patient Recognition">🩺 Recognize</button>
        )}
        <button onClick={onToggleTheme} className="text-text-2 hover:text-text-1" aria-label="Toggle theme">
          {theme === "dark" ? "◑ light" : "◐ dark"}
        </button>
        {onSignOut && (
          <button onClick={onSignOut} className="text-text-3 hover:text-text-1" title="Sign out">⎋</button>
        )}
      </div>
    </header>
  );
}
