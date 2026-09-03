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

export function formatSlideTargets(targets = []) {
  const slides = [...new Set(targets.flatMap((target) => target.slides || []))].sort((a, b) => a - b);
  return slides.length ? `slide${slides.length === 1 ? "" : "s"} ${slides.join(", ")}` : "";
}
