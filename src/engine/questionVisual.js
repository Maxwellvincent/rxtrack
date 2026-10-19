/** Explicit exhibit dependencies, not an imaging test mentioned only as clinical context. */
export function questionReferencesVisual(stem = "") {
  const text = String(stem);
  return /\b(?:figures?|images?|graphs?|charts?|tables?|photomicrographs?|radiographs?|x[- ]ray|ultrasound)\b.{0,90}\b(?:shown|below|above|provided|attached|following|numbered|labeled)\b|\b(?:shown|below|above|provided|attached|following)\b.{0,70}\b(?:figures?|images?|graphs?|charts?|tables?|photomicrographs?|radiographs?|x[- ]ray|ultrasound)\b/i.test(text)
    || /\bsee\s+(?:the\s+)?attached\b|\bsite\s+X\b[\s\S]{0,100}\bsite\s+Y\b|\b(?:indicated|marked|labeled)\s+(?:by\s+)?(?:the\s+)?arrows?\b/i.test(text);
}
export function missingRequiredVisual(question = {}) {
  return !!(question.hasImage || question.imageDependent || questionReferencesVisual(question.stem))
    && !(question.sourceImageUrl || question.sourceImageDataUrl || question.image?.url || typeof question.image === "string");
}
