import { CalendarDays, Library, Target, ClipboardCheck, BookOpen, LayoutGrid } from "lucide-react";
const ICONS = { today: CalendarDays, lectures: Library, objectives: Target, exam: ClipboardCheck, guide: BookOpen, more: LayoutGrid };
const TABS = [
  { id: "today", label: "Today" },
  { id: "lectures", label: "Lectures" },
  { id: "objectives", label: "Objectives" },
  { id: "exam", label: "Exam" },
  { id: "guide", label: "Guide" },
  { id: "more", label: "More" },
];

export function TabBar({ active, onChange }) {
  return (
    <nav aria-label="Study workspace" className="desk-tabs shell-chrome">
      {TABS.map((t) => {
        const Icon = ICONS[t.id];
        return (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={active === t.id ? "page" : undefined}
          className="desk-tab"
        >
          <Icon size={18} aria-hidden="true" /><span>{t.label}</span>
        </button>
      ); })}
    </nav>
  );
}
