/**
 * Deduplicate MCQ choices by normalized option text; remap correct letter to match new A–D order.
 * Returns { valid: false } if fewer than 4 distinct non-empty options remain.
 */
export function dedupeMcqQuestionChoices(q) {
  if (!q || typeof q !== "object") return { valid: false, q };
  const letters = ["A", "B", "C", "D"];
  const choices = q.choices || {};
  const seen = new Set();
  const uniq = [];
  for (const L of letters) {
    const t = String(choices[L] ?? "").trim();
    if (!t) return { valid: false, q };
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ origLetter: L, text: t });
  }
  if (uniq.length < 4) return { valid: false, q };
  const newChoices = {
    A: uniq[0].text,
    B: uniq[1].text,
    C: uniq[2].text,
    D: uniq[3].text,
  };
  const correctOld = String(q.correct || "A")
    .toUpperCase()
    .replace(/[^A-D]/g, "")
    .slice(0, 1);
  const correctNorm = String(choices[correctOld] ?? "").trim().toLowerCase();
  let newCorrect = "A";
  for (let i = 0; i < 4; i++) {
    if (uniq[i].text.toLowerCase() === correctNorm) {
      newCorrect = letters[i];
      break;
    }
  }
  return {
    valid: true,
    q: { ...q, choices: newChoices, correct: newCorrect },
  };
}

/** Drill / quiz prompts: four options must be unique; correct text must not repeat in distractors. */
export const MCQ_OPTION_UNIQUENESS_CRITICAL = `CRITICAL: Each of the 4 answer options must be completely unique in text and meaning. Never reuse the same sequence, value, or phrase across multiple options. The correct answer text must not appear anywhere in the distractor options. Double-check all 4 options are distinct before returning.`;

/** Prompt snippets: distinct options + lab teaching points (injected into AI prompts only). */
export const MCQ_DISTINCT_OPTIONS_RULE = `CRITICAL: Every answer option must be numerically and textually distinct. Never repeat the same value across options. If generating numerical answers, ensure each option uses a different number. If the question involves a calculated or measured numerical result, generate distractors that represent common calculation errors or clinically meaningful adjacent values — never the same value twice.`;

export const MCQ_LAB_NORMAL_RANGES_RULE = `When generating questions involving lab values or calculated values, always include the relevant normal reference range in the teaching point explanation. Examples:
- LDL cholesterol: normal <100 mg/dL (optimal), <130 mg/dL (near optimal)
- Total cholesterol: normal <200 mg/dL
- HDL: normal >40 mg/dL (men), >50 mg/dL (women)
- Triglycerides: normal <150 mg/dL
- Blood glucose (fasting): normal 70-99 mg/dL
- HbA1c: normal <5.7%
- Blood pressure: normal <120/80 mmHg
- Creatinine: normal 0.7-1.3 mg/dL (men), 0.6-1.1 mg/dL (women)
Include the normal range as a dedicated line in the teaching point:
"Normal range: [value] — this patient's result is [interpretation]."`;

/** ESoft / school-exam style spec — derived from CPR ESoft Quiz 4 corpus. Injected into all MCQ generators. */
export const ESOFT_EXAM_STYLE_SPEC = `SCHOOL-EXAM STYLE SPEC (mirror this format — derived from the student's actual ESoft block exams):

VIGNETTE SKELETON (in this order):
1. Open with demographic + setting: "A [age]-year-old [man/woman/boy/girl]" (or "X-month-old / X-day-old [boy/girl]" for peds). Never lead with the chief complaint.
2. Setting verb (pick by acuity): "is brought to the emergency department" / "comes to the physician" / "is admitted to the hospital".
3. Reason clause is durational: "because of a [N-day/week/month/year] history of [chief complaint]". Never "presents with".
4. PMH next: pack-year smoking, prior episodes, family history reference (e.g. "patient IV-6"), comorbidities.
5. Vitals (match this exact format): "His blood pressure is 90/70 mm Hg, pulse is 98/min and temperature is 104°F (40°C)." Use "respiration are X/min" (school's grammar). Temperature in °C primary, °F in parens or vice versa.
6. PE line: "Physical examination shows..." — not "PE reveals" / "On exam".
7. Labs as indented bullets with qualifier in parens: "Hemoglobin: 8.0 g/dL (low)" / "Reticulocyte count: 12% (elevated)". Always flag abnormals — do not require reference-range memorization.
8. Diagnosis-given pattern (~30%): "A diagnosis of X is made." When used, the question MUST pivot to mechanism / anatomy / structure / principle — NEVER ask for diagnosis again.
9. Image references go at the END of the stem: "A peripheral blood smear is shown" / "The attached figure shows..." / "Which of the following numbers in the attached photomicrograph...".

LEAD-IN PATTERNS (last sentence ends in "?"):
- "Which of the following [structure / nerve / cell type / mediator / finding] is most likely…"
- "Which of the following best [explains / describes / characterizes]…"
- "In which of the following locations / intercostal spaces…"
- "What is most likely the cause of…"
- Calc: "Which of the following values is most likely close to…"

OPTION SHAPE:
- Short noun phrases or short descriptors. NOT full sentences. ("Hilum of the lung." "Surfactant deficiency." "Above the superior border of the rib.")
- Parallel grammar across all options.
- No "all/none of the above."
- This app renders 4 options (A–D) with exactly one correct — pick the strongest 3 distractors using the archetypes below.

COGNITIVE TARGET (critical):
This is a PRE-CLINICAL FOUNDATIONAL-SCIENCE exam — anatomy, histology, embryology, biochem, genetics, physiology, basic pathology. NOT clinical management. The correct answer is a STRUCTURE, MECHANISM, PRINCIPLE, CELL TYPE, VALUE, or CONCEPT — almost never a treatment. Avoid "best initial therapy" / "next step in management" lead-ins unless the lecture is explicitly clinical-management.

DISTRACTOR ARCHETYPES (pick one per question and build distractors from it):
1. Anatomical-neighbor — adjacent rib space, adjacent border, adjacent layer.
2. Direction-flip — left vs right shift, proximal vs distal, increase vs decrease.
3. Terminology cousins — cluster ≥3 from same conceptual family (locus heterogeneity / allelic heterogeneity / loss of heterozygosity / haploinsufficiency / anticipation).
4. Same-category-different-disease — list other inherited anemias / other inflammation types / other coag disorders.
5. Tissue-taxonomy — stratified squamous / pseudostratified / simple cuboidal / transitional / simple squamous.
6. Mechanism-but-wrong-direction — both alter the system, only one matches the figure/data.
7. Test-method options — Bohr's / Fowler / helium dilution / plethysmography / spirometry, only one fits the patient.
8. Pre-clinical red herrings — irrelevant-but-related items to test active exclusion.
9. Sign/magnitude trap on calc — include +X and −X, and decimal-shift versions (8.5 vs 0.085 vs 0.17).

TRIP PATTERNS to deliberately exploit:
- Sign/direction errors (left vs right ODC shift, proximal vs distal equal pressure point).
- Adjacent-anatomy confusion (superior vs inferior border of rib).
- Terminology near-miss (haploinsufficiency vs allelic heterogeneity).
- Re-diagnosing when diagnosis is already given in the stem.
- Image-not-integrated — the discriminator must be in the figure when an image is referenced.
- Calculation arithmetic — sign of (−5) − (−25), decimal placement.

REQUIRED METADATA FIELDS (return these on every question):
- cognitiveType: one of "anatomy-landmark" | "mechanism-direction" | "histology-image-id" | "genetics-principle" | "physiology-calc" | "pathophys-mechanism" | "cell-biology" | "test-method-selection" | "pharmacology" | "embryology"
- distractorArchetype: one of "anatomical-neighbor" | "direction-flip" | "terminology-cousins" | "same-category-different-disease" | "tissue-taxonomy" | "mechanism-wrong-direction" | "test-method" | "red-herring" | "sign-magnitude-trap"
- discriminatingClue: ONE short sentence naming the specific phrase or value in the stem that should steer the student to the correct answer (e.g. "The phrase 'flat compliance curve' = restrictive disease, ruling out obstructive options."). Required even when the question is straightforward.`;

/**
 * MEMORY-CONSOLIDATION SPEC — used as the primary system prompt when the
 * student is in the pre-vignette / post-lab phase. This is the "before
 * vignettes" mode: short, mechanism-first, one-concept-per-item retrieval
 * questions. Synthesized from the student's two reference docs:
 *   - school-vignette-system-prompt.pdf (school-aligned engine, Anki priority)
 *   - Question creater ideas.pdf       (8 post-lab question categories)
 *
 * Use this INSTEAD OF (not in addition to) ESOFT_EXAM_STYLE_SPEC when the
 * mode is "consolidation". The two specs are mutually exclusive at the
 * top of a system prompt.
 */
export const MEMORY_CONSOLIDATION_SPEC = `MEMORY-CONSOLIDATION QUESTION SPEC (pre-vignette / post-lab phase):

This is NOT a school-exam vignette — it's a short-stem retrieval question that comes BEFORE full vignettes. The learner is still building the raw concept map. Long patient stories, hidden diagnoses, and multi-step diagnostic reasoning are all out of scope here. Save those for the vignette mode.

PRIORITY OF SOURCES (when generating questions):
1. Anki Proper deck content (if provided in context)  — highest priority; main tested curriculum.
2. Anki Learning+ deck content (if provided)          — image-aware enrichment, radiology recognition.
3. Lecture-derived high-yield notes                   — fall back on these next.
4. General medical knowledge                          — only to fill gaps; never overrides school framing.

CORE TEACHING PHILOSOPHY:
- Concise, mechanistic, no fluff. Almost every word in the stem must matter.
- One tested objective per item. If you'd need two sentences of clinical setup to ask it, the question is too big for this mode.
- Mechanism-first: the answer should be a mechanism, direction-of-change, structure, formula, or short sequence — NOT a diagnosis.

PICK ONE OF THESE 8 CATEGORIES PER QUESTION (rotate across a session):
1. Definition / identification — "What structures make up the glomerular filtration barrier?"
2. Formula / relationship      — "How does increasing tidal volume affect the dead-space fraction of each breath?"
3. Direction-of-change         — "What happens to physiologic dead space in pulmonary embolism?"
4. Structure–function          — "Why does the medulla look striated?" / "Why do podocyte pedicels matter for filtration?"
5. Compare-and-contrast        — "Anatomic vs physiologic dead space." / "Cortical vs juxtamedullary nephron."
6. Stepwise mechanism / pathway — "Trace blood flow from the renal artery to the glomerulus."
7. Numeric plug-in (1–2 step)  — "Given TV, RR, and dead space, calculate alveolar ventilation."
8. Region / graph interpretation — "How do ventilation and perfusion change from apex to base?"

STEM RULES:
- One clean sentence when possible. Two sentences MAX for standard recall items.
- Numeric items may have one setup line (the values) plus the actual prompt.
- No decorative wording. No "all of the following except" unless explicitly requested.
- The stem must be a real prompt — never a slide heading or topic name. If the source note is a heading like "Second Messenger Systems — Beta adrenergic", rewrite it as "What is the signaling cascade after E/NE bind a beta-1 adrenergic receptor?"
- The answer must be a SHORT, high-yield, specific, memorable phrase (e.g. "Gs → adenylate cyclase → cAMP → PKA." / "Ventilated but not perfused alveoli." / "Decreased, due to reduced surface area.").

DISTRACTOR DESIGN:
Same organ system, same conceptual neighborhood, wrong by ONE key distinction. Use these archetypes:
- Wrong segment (PCT vs DCT vs collecting duct)
- Wrong receptor subtype (β1 vs β2; α1 vs α2; M2 vs M3)
- Right hormone but wrong action direction
- Correct concept but wrong compensation direction (primary vs compensatory)
- Filtered load confused with excreted load
- Same equation, sign or unit flipped
Distractors that are random, obviously unrelated, or too obscure are forbidden.

DIFFICULTY PROGRESSION (the stage this question fits into):
1. Foundational role         — what the segment / hormone / receptor normally does
2. Direction-of-change       — what increases, decreases, becomes dilute
3. Mechanism mapping         — given clues, identify the site or hormone
4. Mini-vignette application — 1 mechanism per stem (this is the bridge to vignette mode)
5. Near-transfer variant     — same physiology, different surface clues
Tag the question's stage in the cognitiveType field if it doesn't fit one of the standard tags.

REQUIRED METADATA FIELDS (return on every question):
- cognitiveType: choose the closest match — "definition" | "formula-relationship" | "direction-of-change" | "structure-function" | "compare-contrast" | "stepwise-mechanism" | "physiology-calc" | "region-graph" | "pathophys-mechanism"
- distractorArchetype: "wrong-segment" | "wrong-receptor-subtype" | "wrong-direction" | "wrong-compensation" | "filtered-vs-excreted" | "sign-magnitude-trap" | "terminology-cousins"
- discriminatingClue: ONE short sentence naming the specific phrase / value in the stem that should steer the learner to the correct answer.

WHAT THIS MODE IS NOT:
- Not a board-style vignette. No "A 56-year-old man comes to the ED..." setup.
- Not a diagnosis question. Diagnosis is for the vignette mode.
- Not a multi-concept question. One tested idea per stem, period.

SUCCESS FEEL:
The learner should think "I know what concept this is testing. I can answer in a sentence or two. This helps me separate similar concepts." If the learner thinks "I know the topic but I don't know what the question is asking," the stem failed.`;

/** True if this MCQ result should count as "correct" for session % (excludes self-reported lucky guesses). */
export function mcqResultCountsTowardCorrectScore(r) {
  return !!(r && r.correct && r.confidenceFlag !== "guessed");
}
