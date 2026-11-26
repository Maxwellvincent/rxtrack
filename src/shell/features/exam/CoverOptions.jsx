import { useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { keyReasoning, MAX_PREDICTION_LENGTH } from "../../../engine/activeRecall.js";

/** Visible on/off switch for writing reasoning before the choices. */
export function ReasoningToggle({ on, onChange }) {
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs text-text-2">
      <input type="checkbox" checked={on} onChange={event => onChange(event.target.checked)} />
      <span>✎ Write my reasoning first: <strong className="text-text-1">{on ? "On" : "Off"}</strong></span>
    </label>
  );
}

/**
 * Choices stay hidden until the learner commits an answer and the reason that
 * links the clue to it. Skipping is allowed and recorded as a skip.
 */
export function CoverOptions({ question, onCommit, onSkip, onDisable = null }) {
  const [text, setText] = useState("");
  const ready = text.trim().length >= 3;
  const cross = question?.crossLecture?.partnerTitle;
  return (
    <section aria-label="Cover the options" className="mt-3 space-y-2 rounded-lg border border-border bg-panel p-3">
      <p className="text-sm font-semibold text-text-1">Choices hidden: answer it first</p>
      <p className="text-xs text-text-2">
        In one line: your answer, and the link that gets you there{cross ? ` (this one needs a fact from ${cross} too)` : ""}.
      </p>
      <label className="block text-xs text-text-2">Your answer and reason
        <textarea
          value={text}
          maxLength={MAX_PREDICTION_LENGTH}
          rows={2}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) onCommit(text); }}
          placeholder="e.g. Left CN XII lesion: tongue deviates toward the lesion because the left genioglossus is weak"
          className="mt-1 block w-full rounded border border-border bg-bg p-2 text-sm text-text-1"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!ready} onClick={() => onCommit(text)}>Show choices</Button>
        <button type="button" className="text-xs text-text-3 underline" onClick={onSkip}>Skip this time</button>
        {onDisable && <button type="button" className="text-xs text-text-3 underline" onClick={onDisable}>Turn off reasoning first</button>}
      </div>
    </section>
  );
}

/** After the reveal: the learner's own reason beside the question's reasoning. */
export function PredictionCheck({ question, entry, onSelfCheck }) {
  if (!entry?.prediction) return null;
  const lines = keyReasoning(question);
  const choice = entry.selfCheck;
  return (
    <section aria-label="Check your reasoning" className="space-y-2 rounded-lg border border-border bg-panel p-3 text-sm">
      <p><span className="font-semibold text-text-1">Your prediction:</span> <span className="text-text-2">{entry.prediction}</span></p>
      {lines.length > 0 && <ul className="space-y-1 text-text-2">
        {lines.map(line => <li key={line.label}><span className="font-semibold text-text-1">{line.label}:</span> {line.text}</li>)}
      </ul>}
      {choice
        ? <p role="status" className="text-xs text-text-2">{choice === "matched" ? "✓ You marked your reason as matching." : "✕ You marked your reason as missing the link."}</p>
        : <div className="flex flex-wrap gap-2" role="group" aria-label="Did your reason match?">
            <Button variant="outline" onClick={() => onSelfCheck("matched")}>✓ My reason matched</Button>
            <Button variant="outline" onClick={() => onSelfCheck("missed")}>✕ My reason missed the link</Button>
          </div>}
    </section>
  );
}
