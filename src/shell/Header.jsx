export function Header({ termName, blockName, theme, onToggleTheme }) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-bg px-4 text-sm">
      <span className="font-mono text-xs text-text-3">
        {termName ? <>{termName} / <span className="text-text-1">{blockName}</span></> : "RXTrack"}
      </span>
      <button onClick={onToggleTheme} className="text-text-2 hover:text-text-1 text-xs" aria-label="Toggle theme">
        {theme === "dark" ? "◑ light" : "◐ dark"}
      </button>
    </header>
  );
}
