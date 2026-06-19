import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useTheme } from "./useTheme";

/** New app shell root. Imports Tailwind ONLY here so the legacy app is never
 *  affected by preflight. Scopes tokens via .theme-* on the root wrapper. */
export default function Shell() {
  const { theme, toggle } = useTheme();
  return (
    <div className={`theme-${theme} min-h-screen bg-bg text-text-1 font-sans`}>
      <div className="p-6">
        <h1 className="font-display text-2xl">RXTrack shell</h1>
        <button onClick={toggle} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-white text-sm">
          Toggle theme ({theme})
        </button>
      </div>
    </div>
  );
}
