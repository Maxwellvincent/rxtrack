const SOM_CODE = /SOM(?:\.\s?[A-Za-z0-9]+)+\.\s?\d{4}/gi;

export function normalizeSomCode(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function chunkText(chunk) {
  return String(chunk?.markdown || chunk?.text || chunk?.content || "");
}

function slideNumber(chunk, index) {
  const explicit = chunk?.pageNumber ?? chunk?.page_number ?? chunk?.page ?? chunk?.slideNumber ?? chunk?.slide_number;
  const parsed = Number(explicit);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1;
}

export function indexObjectiveSlides(chunks = []) {
  const index = new Map();
  chunks.forEach((chunk, chunkIndex) => {
    const slide = slideNumber(chunk, chunkIndex);
    for (const rawCode of chunkText(chunk).match(SOM_CODE) || []) {
      const code = normalizeSomCode(rawCode);
      if (!index.has(code)) index.set(code, []);
      if (!index.get(code).includes(slide)) index.get(code).push(slide);
    }
  });
  return index;
}

export function slideTargetsForObjectiveIds(objectiveIds = [], objectives = [], chunks = []) {
  const objectiveById = new Map((objectives || []).map((objective) => [String(objective.id), objective]));
  const slideIndex = indexObjectiveSlides(chunks);
  const targets = [];
  for (const objectiveId of objectiveIds || []) {
    const objective = objectiveById.get(String(objectiveId));
    const code = normalizeSomCode(objective?.code || objective?.objectiveCode || objectiveId);
    if (!code.startsWith("SOM.")) continue;
    const slides = slideIndex.get(code) || [];
    if (slides.length) targets.push({ objectiveId, code, slides });
  }
  return targets;
}

/**
 * Audit coded objectives against this lecture's uploaded slide/chunk text.
 * Missing codes are evidence gaps, not proof of a bad link: OCR may omit a
 * footer, the school may list objectives not repeated on slides, or source
 * chunks may be incomplete. Callers should warn, never silently discard.
 */
export function auditObjectiveSlideCoverage(objectives = [], chunks = [], sourceText = "") {
  const hasChunks = (chunks || []).length > 0;
  const hasText = String(sourceText || "").trim().length > 0;
  const hasSource = hasChunks || hasText;
  const index = indexObjectiveSlides(chunks);
  const codesInText = new Set((String(sourceText || "").match(SOM_CODE) || []).map(normalizeSomCode));
  return (objectives || []).map((objective) => {
    const code = normalizeSomCode(objective?.code || objective?.objectiveCode);
    if (!code.startsWith("SOM.")) {
      return { objective, code: "", status: hasSource ? "uncoded" : "source-unavailable", slides: [] };
    }
    const slides = index.get(code) || [];
    const foundInText = codesInText.has(code);
    return {
      objective,
      code,
      status: !hasSource ? "source-unavailable" : slides.length ? "found" : foundInText ? "found-unlocated" : "not-found",
      slides,
    };
  });
}

export function formatSlideTargets(targets = []) {
  const slides = [...new Set(targets.flatMap((target) => target.slides || []))].sort((a, b) => a - b);
  return slides.length ? `slide${slides.length === 1 ? "" : "s"} ${slides.join(", ")}` : "";
}
