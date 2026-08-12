const TABS = [
  { id: "today", label: "Today" },
  { id: "lectures", label: "Lectures" },
  { id: "objectives", label: "Objectives" },
  { id: "more", label: "More" },
];

export function TabBar({ active, onChange }) {
  return (
    <nav className="flex border-b border-border bg-bg px-4">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            "px-4 py-2.5 text-xs font-mono transition-colors",
            active === t.id
              ? "border-b-2 border-accent text-text-1"
              : "text-text-3 hover:text-text-2",
          ].join(" ")}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
