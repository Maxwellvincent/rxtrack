/** Segmented control for the Practice card's modes; badges are text, never color alone. */
export function PracticeModeTabs({ modes = [], value, onChange }) {
  return <div role="tablist" aria-label="Practice mode" className="flex flex-wrap gap-1 rounded-lg bg-bg p-1">
    {modes.map((mode) => {
      const active = value === mode.id;
      return <button key={mode.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(mode.id)}
        className={`min-h-9 flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? "bg-bg-elevated font-semibold text-text-1 shadow-sm" : "text-text-2 hover:text-text-1"}`}>
        {mode.label}{mode.badge ? <span className="ml-1.5 font-mono text-xs text-text-3">{mode.badge}</span> : null}
      </button>;
    })}
  </div>;
}
