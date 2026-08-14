import { Button } from "../../../ui/Button.jsx";
import { IMAGE_KINDS } from "../../../lectureImages.js";

const KINDS = [...IMAGE_KINDS, "decorative"];

const KIND_HINT = {
  histology: "tissue under the microscope",
  clinical: "a real patient, or an image taken from one",
  diagram: "a drawn teaching figure",
  decorative: "not testable — logos, headshots, slide furniture",
  unlabelled: "not labelled — decide by eye",
};

/**
 * The lecture's figures, on one page, before any of them are uploaded.
 *
 * A filename cannot be judged: `_page_17_Figure_6.jpeg` tells you nothing about whether the
 * figure is worth answering a question about, and only the person studying knows that a pathway
 * they already understand makes a poor stimulus. So the model's labels are a starting selection
 * and this grid is the decision.
 */
export function FigureReview({ figures, onToggle, onKind, onConfirm, onCancel, busy }) {
  const kept = figures.filter((f) => f.keep);

  return (
    <div className="mb-4">
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 border-b border-border bg-bg py-2">
        <Button onClick={onConfirm} disabled={!!busy || !kept.length}>
          {busy || `▸ Use these ${kept.length}`}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={!!busy}>
          Cancel
        </Button>
        <span className="text-[12px] text-text-3">
          {kept.length} of {figures.length} kept · untick anything that would not make a good
          question — nothing is uploaded until you confirm
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
        {figures.map((f, i) => (
          <div
            key={f.name}
            className={
              "overflow-hidden rounded-lg border bg-bg-elevated transition-opacity " +
              (f.keep ? "border-accent" : "border-border opacity-40")
            }
          >
            <button
              type="button"
              onClick={() => onToggle(i)}
              disabled={!!busy}
              className="block w-full cursor-pointer"
              aria-pressed={f.keep}
              aria-label={`${f.keep ? "Drop" : "Keep"} ${f.shows || f.name}`}
            >
              {f.url ? (
                <img src={f.url} alt="" loading="lazy" className="h-40 w-full bg-panel object-contain" />
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-panel text-[12px] text-text-3">
                  no preview
                </div>
              )}
            </button>
            <div className="p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[12px] text-text-3">{f.keep ? "✓" : "○"}</span>
                <select
                  value={f.kind}
                  disabled={!!busy}
                  onChange={(e) => onKind(i, e.target.value)}
                  className="rounded border border-border bg-bg px-1 py-0.5 font-mono text-[12px] text-text-2"
                >
                  {(f.kind === "unlabelled" ? ["unlabelled", ...KINDS] : KINDS).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div className="text-[13px] leading-snug text-text-2">
                {f.shows || <span className="text-text-3">{KIND_HINT[f.kind]}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
