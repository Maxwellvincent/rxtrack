import { useState } from "react";
import { questionEvidenceKey } from "../stores/learnerEvidence.js";
import { quizAnswerKey } from "../engine/questionHistory.js";
import { acceptedChoiceNotes, buildOtherChoicesPrompt, readCachedChoiceNotes, saveCachedChoiceNotes } from "./explainOtherChoices.js";

export const choiceNotesKey = (question) => questionEvidenceKey(quizAnswerKey(question || {}));

/** Source notes win; cached AI notes fill the rest. Returns merged notes and which are AI-written. */
export function mergeAiChoiceNotes(question, baseNotes = {}) {
  const cached = readCachedChoiceNotes(choiceNotesKey(question));
  const aiLetters = Object.keys(cached).filter((letter) => !baseNotes[letter] && letter in (question?.choices || {}));
  return { notes: { ...Object.fromEntries(aiLetters.map((letter) => [letter, cached[letter]])), ...baseNotes }, aiLetters: new Set(aiLetters) };
}

/** Button shown after reveal when some wrong choices still have no explanation. */
export function ExplainOtherChoicesButton({ question, notes = {}, onDone, ask = null }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const missing = Object.keys(question?.choices || {}).filter((letter) => letter !== question?.correct && !notes[letter]);
  if (!question?.correct || !missing.length) return null;
  const run = async () => {
    setBusy(true); setError("");
    try {
      const call = ask || (await import("../aiClient.js")).callAIJSON;
      const raw = await call("You are a medical educator writing concise answer-choice explanations for USMLE-style questions.", buildOtherChoicesPrompt(question, missing, notes), { notes: {} }, 900);
      const accepted = acceptedChoiceNotes(raw, missing);
      if (!Object.keys(accepted).length) throw new Error("No explanations came back. Try again.");
      saveCachedChoiceNotes(choiceNotesKey(question), { ...readCachedChoiceNotes(choiceNotesKey(question)), ...accepted });
      onDone?.();
    } catch (e) { setError(e?.message || String(e)); } finally { setBusy(false); }
  };
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <button type="button" disabled={busy} onClick={run} className="rounded border border-border px-2.5 py-1 font-semibold text-text-2 hover:text-text-1 disabled:opacity-50">
      {busy ? "Explaining…" : `Explain the other choices (${missing.join(", ")})`}
    </button>
    <span className="text-text-3">AI-written · checked against the key</span>
    {error && <span role="alert" className="text-text-1">✕ {error}</span>}
  </div>;
}
