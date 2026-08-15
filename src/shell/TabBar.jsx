const TABS = [
  { id: "today", label: "Today" },
  { id: "lectures", label: "Lectures" },
  { id: "objectives", label: "Objectives" },
  { id: "guide", label: "Guide" },
  { id: "more", label: "More" },
];

export function TabBar({ active, onChange }) {
  return (
    <nav className="shell-chrome flex flex-shrink-0 border-b border-border bg-bg px-2">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            "px-4 py-2.5 font-condensed text-xs font-semibold uppercase tracking-widest transition-colors",
            active === t.id
              ? "border-b-2 border-accent text-text-1"
              : "border-b-2 border-transparent text-text-3 hover:text-text-2",
          ].join(" ")}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
