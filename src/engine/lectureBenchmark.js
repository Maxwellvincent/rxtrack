// Reproducible lecture benchmark helpers.
// A benchmark compares extracted atoms/questions with a small, human-reviewed ledger;
// it is not a lexical substitute for medical review. Gold rows should be paraphrased,
// source-linked, and objective-linked rather than copied wholesale from a lecture.

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return String(value);
}

function normalize(text) {
  return textOf(text).toLowerCase().replace(/[^a-z0-9+>↑↓.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesAny(text, patterns = []) {
  const haystack = normalize(text);
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(haystack);
    return haystack.includes(normalize(pattern));
  });
}

function codeSet(value) {
  return new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map(String));
}

/** Extract slide-local SOM objective codes from OCR chunks without trusting slide titles. */
export function extractSlideObjectiveEvidence(chunks = []) {
  return (chunks || []).map((chunk, index) => {
    const text = textOf(chunk?.markdown || chunk?.text || chunk?.content || chunk);
    const codes = [...new Set(text.match(/SOM\.?\s*(?:[A-Z]{1,4}\.)?MK\.?[^\s,;|]+/gi) || [])]
      .map((code) => code.replace(/\s+/g, "").replace(/SOM\.?/i, "SOM."));
    return {
      index,
      pageNumber: chunk?.pageNumber ?? index + 1,
      codes,
      text,
    };
  }).filter((entry) => entry.codes.length);
}

/** Attach the slide-local objective evidence to an extracted atom using source offsets/pages when available. */
export function objectiveEvidenceForAtom(atom, slideEvidence = [], objectives = []) {
  const atomText = textOf([atom?.term, atom?.content, atom?.testableDetails, atom?.exceptions, atom?.quantitativeDetails]);
  const sourcePage = atom?.pageNumber ?? atom?.sourcePage;
  const sourceChunk = atom?.chunkIndex ?? atom?.sourceChunkIndex;
  const byLocation = slideEvidence.filter((slide) => (
    sourcePage != null && Number(slide.pageNumber) === Number(sourcePage)
  ) || (
    sourceChunk != null && Number(slide.index) === Number(sourceChunk)
  ));
  // If extraction has no source location yet, retain only a conservative term-overlap fallback.
  const relevant = byLocation.length
    ? byLocation
    : slideEvidence.filter((slide) => matchesAny(slide.text, atomText.split(/\s+/).filter((word) => word.length > 7).slice(0, 3)));
  const codes = new Set(relevant.flatMap((slide) => slide.codes));
  const objectiveByCode = new Map((objectives || []).flatMap((objective) => [
    [String(objective?.id || ""), objective],
    [String(objective?.code || objective?.objectiveCode || ""), objective],
  ].filter(([key]) => key)));
  return {
    codes: [...codes],
    objectives: [...codes].map((code) => objectiveByCode.get(code)).filter(Boolean),
    pages: [...new Set(relevant.map((slide) => slide.pageNumber))],
  };
}

function scoreGoldRow(row, atoms = []) {
  const candidates = atoms.filter((atom) => {
    const atomText = [atom?.term, atom?.content, atom?.clinicalCorrelate, atom?.clinicalCues, atom?.buzzwords, atom?.testableDetails, atom?.exceptions, atom?.quantitativeDetails];
    const termMatches = (row.terms || []).filter((term) => matchesAny(atomText, [term])).length;
    return termMatches >= (row.minTermMatches || 2);
  });
  const best = candidates.find((atom) => {
    const atomText = [atom?.term, atom?.content, atom?.clinicalCorrelate, atom?.clinicalCues, atom?.buzzwords, atom?.testableDetails, atom?.exceptions, atom?.quantitativeDetails];
    return (row.requiredDetails || []).every((detail) => matchesAny(atomText, detail.patterns || detail));
  }) || candidates[0] || null;
  const detailsCaptured = best ? (row.requiredDetails || []).filter((detail) => matchesAny(best, detail.patterns || detail)).length : 0;
  return {
    id: row.id,
    objectiveIds: row.objectiveIds || [],
    captured: !!best,
    detailsCaptured,
    detailsExpected: (row.requiredDetails || []).length,
    atom: best || null,
  };
}

/** Score extraction recall, detail preservation, and objective coverage against a gold ledger. */
export function scoreLectureAtoms({ atoms = [], gold = [], objectives = [] } = {}) {
  const rows = gold.map((row) => scoreGoldRow(row, atoms));
  const objectiveIds = new Set((objectives || []).map((objective) => String(objective?.id || objective?.code)).filter(Boolean));
  const coveredObjectives = new Set(rows.filter((row) => row.captured).flatMap((row) => row.objectiveIds || []));
  const expectedDetails = rows.reduce((sum, row) => sum + row.detailsExpected, 0);
  const capturedDetails = rows.reduce((sum, row) => sum + Math.min(row.detailsCaptured, row.detailsExpected), 0);
  return {
    rows,
    goldCount: rows.length,
    capturedCount: rows.filter((row) => row.captured).length,
    coreRecall: rows.length ? rows.filter((row) => row.captured).length / rows.length : 0,
    detailRecall: expectedDetails ? capturedDetails / expectedDetails : 1,
    objectiveCoverage: objectiveIds.size ? [...objectiveIds].filter((id) => coveredObjectives.has(id)).length / objectiveIds.size : 1,
  };
}

/** Score whether generated questions actually use the lecture-specific details. */
export function scoreQuestionUsage({ questions = [], gold = [] } = {}) {
  const rows = gold.map((row) => {
    const matches = questions.filter((question) => {
      const questionText = [question?.stem, question?.explanation, question?.whyWrong, question?.topic];
      const objectiveMatch = !row.objectiveIds?.length || row.objectiveIds.some((id) => (question?.objectiveIds || []).map(String).includes(String(id)));
      const termMatches = (row.terms || []).filter((term) => matchesAny(questionText, [term])).length;
      return objectiveMatch && termMatches >= (row.minTermMatches || 2);
    });
    const detailQuestions = matches.filter((question) => (row.requiredDetails || []).some((detail) => matchesAny(question, detail.patterns || detail)));
    return { id: row.id, generated: matches.length > 0, usesDetail: detailQuestions.length > 0, questionCount: matches.length };
  });
  return {
    rows,
    goldCount: rows.length,
    generatedCount: rows.filter((row) => row.generated).length,
    detailUseCount: rows.filter((row) => row.usesDetail).length,
    coverage: rows.length ? rows.filter((row) => row.generated).length / rows.length : 0,
    detailUseRate: rows.length ? rows.filter((row) => row.usesDetail).length / rows.length : 0,
  };
}
