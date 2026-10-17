// Necessary causal facts belong in the stem, never only in the explanation.
export const QUESTION_CLARITY_CONTRACT = `QUESTION CLARITY: The lead-in must name one precise requested finding, structure, mechanism or prediction. Every necessary intervention and its relevant effect must be explicit in the stem. Applying an enzyme does not establish digestion, removal or loss: state the confirmed effect, or describe its source-supported action. Never introduce the decisive event only in the explanation. Distinguish adjacent histological layers and their basement membranes; do not treat nearby names as synonyms without source support. Reject missing causal premises as inconsistent_vignette and uncertain layer/key identity as ambiguous_key. Prefer patient presentations with meaningful symptoms, examination and investigations whenever lecture evidence supports them. Do not invent diseases or decorative ages to simulate clinical reasoning. Experimental scenarios are occasional alternatives, not the default; changing tracer, dye or marker names is not diversity.`;

export function questionClarityIssues(question) {
  const stem = String(question?.stem || "");
  const explanation = String(question?.explanation || "");
  // Narrow screen for the demonstrated failure, not a claim that all enzyme
  // experiments need to describe removal or that every removal is valid.
  const appliedEnzyme = /\benzyme\b.{0,100}\b(?:applied|added|administered)\b|\b(?:applied|added|administered)\b.{0,100}\benzyme\b/i.test(stem);
  const asksLoss = /\b(?:absent|lost|missing|disappear|removed)\b/i.test(stem);
  const explicitEffect = /\b(?:digests?|digesting|digested|degrades?|degrading|degraded|dissolves?|dissolving|dissolved|removes?|removing|removed|destroys?|destroyed|cleaves?|cleaved)\b/i.test(stem.split(/\b(?:which|what)\b/i)[0]);
  const assumesRemoval = /\b(?:removed|digested|degraded|destroyed|dissolved|cleaved)\b/i.test(explanation);
  return appliedEnzyme && asksLoss && assumesRemoval && !explicitEffect ? ["inconsistent_vignette"] : [];
}
