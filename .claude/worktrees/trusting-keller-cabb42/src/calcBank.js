/**
 * Physiology calculation question bank — extracted verbatim from school-issued
 * practice PDFs. These are not AI-generated; they are real school questions
 * used as the gold-standard mirror of exam style.
 *
 * Source documents (the user's school CPR practice packs):
 *   - CPR Week 14 - Physiology Practice Questions / Respiratory Part 1
 *   - CPR Week 14 - Physiology Practice Questions / Respiratory Part 2
 *   - CPR Week 15 - Physiology Practice Question / Renal with Answers
 *
 * Schema matches questionBanksByFile entries (rxt-question-banks). The bank
 * pull at App.jsx normalizes A–D only, so any 5-option originals have been
 * trimmed to the 4 strongest options with the correct answer preserved.
 *
 * cognitiveType is set to "physiology-calc" so the per-type breakdown on the
 * session-end screen attributes performance to calculation skill.
 */

const CALC_QUESTIONS_RESPIRATORY = [
  {
    id: "calc-resp-minute-vent-01",
    topic: "Respiratory Physiology — Minute ventilation",
    stem:
      "A 76-year-old man is admitted to the hospital because of a 2-hour history of respiratory distress. His wife says he had a 3-day history of high fever and suddenly developed respiratory distress. He is on a ventilator adjusted for an inspiratory tidal volume of 1 L at a frequency of 10/min. If the patient's anatomic dead space is 200 mL and the machine's dead space 50 mL. Which of the following values most likely represents the patient's minute ventilation?",
    choices: { A: "10 L/min", B: "8.0 L/min", C: "7.5 L/min", D: "5 L/min" },
    correct: "A",
    explanation:
      "Minute ventilation = tidal volume × respiratory rate = 1 L × 10/min = 10 L/min. Dead space does not enter the minute-ventilation calculation (it does enter alveolar ventilation).",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Minute ventilation = TV × RR — dead space is irrelevant here. Subtracting dead space gives alveolar ventilation, not minute.",
  },
  {
    id: "calc-resp-alveolar-vent-02",
    topic: "Respiratory Physiology — Alveolar ventilation",
    stem:
      "A 57-year-old woman is admitted to the hospital because of a 1-hour history of altered mental status and shallow breathing. She is diagnosed with narcotic overdose and put on a ventilator. The ventilator is adjusted for a tidal volume of 800 mL at a frequency of 12/min. The patient's anatomic dead space is 150 mL and the machine's dead space 50 mL. Which of the following values most likely represents the alveolar ventilation in this patient?",
    choices: { A: "5600 mL", B: "6800 mL", C: "7200 mL", D: "9600 mL" },
    correct: "C",
    explanation:
      "Total dead space = 150 + 50 = 200 mL. Alveolar ventilation = (tidal volume − dead space) × respiratory rate = (800 − 200) × 12 = 7200 mL/min.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Add the machine dead space to the anatomic dead space before subtracting. Forgetting the machine dead space gives 7800 — close to a distractor.",
  },
  {
    id: "calc-resp-pio2-03",
    topic: "Respiratory Physiology — Inspired O2 partial pressure",
    stem:
      "A 66-year-old man is brought to the emergency department 15 minutes after falling from a 30-foot height. He is not able to move below his neck and is breathing with a shallow tidal volume. He is diagnosed with cervical spinal cord injury. He is given 40% oxygen (FiO2) through nasal cannula. Atmospheric pressure is 760 mm Hg (PB) and water vapor pressure in trachea is 47 mm Hg (PH2O). Which of the following values most likely represents the partial pressure of inspired oxygen (PIO2) in this patient?",
    choices: { A: "150 mm Hg", B: "200 mm Hg", C: "250 mm Hg", D: "285 mm Hg" },
    correct: "D",
    explanation:
      "PIO2 = (PB − PH2O) × FiO2 = (760 − 47) × 0.40 = 713 × 0.40 = 285 mm Hg.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Subtract water vapor BEFORE multiplying by FiO2. Skipping the subtraction gives 304 — close, but wrong because dry air doesn't exist in the trachea.",
  },
  {
    id: "calc-resp-aagrad-04",
    topic: "Respiratory Physiology — A-a gradient",
    stem:
      "A 60-year-old woman comes to the emergency department because of a 1-week history of progressive shortness of breath and dizziness. Her husband says she had diarrhea 1 week ago. Arterial blood gas studies show: PaO2 = 65 mm Hg, SaO2 = 90%, PaCO2 = 50 mm Hg, pH = 7.30. Barometric pressure is 760 mm Hg, water vapor pressure at body temperature is 47 mm Hg, and the respiratory quotient is 0.8. Which of the following values best represents this patient's alveolar–arterial oxygen (A-a) gradient?",
    choices: { A: "15 mm Hg", B: "22 mm Hg", C: "85 mm Hg", D: "35 mm Hg" },
    correct: "B",
    explanation:
      "PAO2 = [FiO2 × (PB − PH2O)] − (PaCO2 / RQ) = [0.21 × (760 − 47)] − (50 / 0.8) = 150 − 62.5 ≈ 87 mm Hg. A-a gradient = PAO2 − PaO2 = 87 − 65 = 22 mm Hg.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Two steps: alveolar gas equation for PAO2, then subtract PaO2. Forgetting RQ division (PaCO2/0.8 vs PaCO2 alone) is the classic trap.",
  },
  {
    id: "calc-resp-deadspace-05",
    topic: "Respiratory Physiology — Dead space volume",
    stem:
      "A 21-year-old man comes to the physician because of a sudden onset of shortness of breath. His respirations are 20/min, minute ventilation is 8000 mL/min, and alveolar ventilation is 5000 mL/min. Which of the following values best represents the dead space volume in this patient?",
    choices: { A: "250 mL", B: "400 mL", C: "300 mL", D: "150 mL" },
    correct: "D",
    explanation:
      "Dead space ventilation = minute − alveolar = 8000 − 5000 = 3000 mL/min. Per breath: 3000 / 20 = 150 mL.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Per-minute dead space ventilation must be divided by RR to give per-breath dead space VOLUME. Stopping at 3000 gives the wrong unit (mL/min vs mL).",
  },
  {
    id: "calc-resp-aagrad-06",
    topic: "Respiratory Physiology — A-a gradient (alveolar hypoventilation)",
    stem:
      "A 30-year-old man is brought to the emergency department because of a 2-hour history of altered mental status and shallow breathing. ABG: PaO2 = 55 mm Hg, PaCO2 = 72 mm Hg. Barometric pressure = 760 mm Hg, PiO2 = 150 mm Hg, water vapor pressure = 47 mm Hg, RQ = 0.80. Which of the following values best represents the arterial A-a gradient in this patient?",
    choices: { A: "0 mm Hg", B: "5 mm Hg", C: "15 mm Hg", D: "34 mm Hg" },
    correct: "B",
    explanation:
      "PAO2 = PiO2 − PaCO2/RQ = 150 − 72/0.8 = 150 − 90 = 60 mm Hg. A-a gradient = 60 − 55 = 5 mm Hg — within normal range, indicating alveolar hypoventilation, not a diffusion or V/Q problem.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Normal A-a gradient (≤15) with hypoxemia + hypercapnia points to hypoventilation. The numeric answer is small — confirms the mechanism.",
  },
  {
    id: "calc-resp-pao2-07",
    topic: "Respiratory Physiology — Alveolar gas equation",
    stem:
      "A 78-year-old man comes to the emergency department because of a 3-week history of difficulty breathing. ABG: PaO2 = 55 mm Hg, O2 sat = 78%, PaCO2 = 69 mm Hg, pH = 7.17. Barometric pressure = 760 mm Hg, RQ = 0.8. Which of the following is most likely the alveolar PO2 of this patient before oxygen supplementation?",
    choices: { A: "55 mm Hg", B: "78 mm Hg", C: "64 mm Hg", D: "102 mm Hg" },
    correct: "C",
    explanation:
      "PAO2 = [FiO2 × (PB − PH2O)] − (PaCO2 / RQ) = 0.21 × (760 − 47) − (69 / 0.8) = 150 − 86 = 64 mm Hg.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "On room air FiO2 = 0.21 (not 1.0). Forgetting the 0.21 multiplier is the most common arithmetic miss on this equation.",
  },
];

const CALC_QUESTIONS_RENAL = [
  {
    id: "calc-renal-nfp-01",
    topic: "Renal Physiology — Net filtration pressure",
    stem:
      "A 25-year-old healthy man participates in a renal study. Glomerular capillary hydrostatic pressure (PGC) = 55 mm Hg, Bowman's capsule hydrostatic pressure (PBS) = 15 mm Hg, plasma oncotic pressure (πGC) = 25 mm Hg, and no plasma protein is filtered through the barrier. Which of the following values most likely represents the net filtration pressure?",
    choices: { A: "5 mm Hg", B: "10 mm Hg", C: "15 mm Hg", D: "22 mm Hg" },
    correct: "C",
    explanation:
      "Net filtration pressure = (PGC + πBS) − (πGC + PBS). Bowman oncotic pressure (πBS) is 0 because no protein is filtered. NFP = (55 + 0) − (25 + 15) = +15 mm Hg.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "πBS = 0 when no protein is filtered. The four-pressure formula collapses to PGC − πGC − PBS.",
  },
  {
    id: "calc-renal-filtered-load-02",
    topic: "Renal Physiology — Filtered load",
    stem:
      "A 14-year-old boy with type 1 diabetes mellitus missed insulin for 2 days. Serum glucose = 3.10 mg/mL, GFR = 100 mL/min, transport maximum (Tm) for glucose = 375 mg/min. Which of the following values best represents the amount of glucose present in the ultrafiltrate in this patient?",
    choices: { A: "200 mg/min", B: "265 mg/min", C: "310 mg/min", D: "375 mg/min" },
    correct: "C",
    explanation:
      "Filtered load = GFR × plasma concentration = 100 mL/min × 3.10 mg/mL = 310 mg/min. Note units: mg/mL × mL/min = mg/min directly (no conversion).",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Tm (375 mg/min) is the distractor — it's the transport ceiling, not the filtered load. Filtered load ignores reabsorption capacity.",
  },
  {
    id: "calc-renal-tbw-03",
    topic: "Renal Physiology — Total body water (indicator dilution)",
    stem:
      "A 30-year-old man is injected with 100 mL of radioactive D2O to estimate his total body water. 10% is excreted in urine during equilibration. His plasma concentration of D2O after equilibration is 0.20 mL/dL. Which of the following values best represents total body water?",
    choices: { A: "30 L", B: "35 L", C: "40 L", D: "45 L" },
    correct: "D",
    explanation:
      "Volume = amount remaining / concentration. Amount = 100 − 10% = 90 mL. Convert concentration: 0.20 mL/dL = 2 mL/L. V = 90 mL / 2 mL/L = 45 L.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Two unit conversions: subtract 10% lost first, then convert mL/dL → mL/L (×10). Skipping the loss correction gives 50 L — a tempting near-miss.",
  },
  {
    id: "calc-renal-ecf-04",
    topic: "Renal Physiology — ECF volume from body weight",
    stem:
      "A 24-year-old healthy man weighs 80 kg. Body water is 60% of body weight; intracellular fluid constitutes 2/3 of body water. Which of the following best approximates the extracellular fluid (ECF) volume?",
    choices: { A: "16 L", B: "15 L", C: "32 L", D: "48 L" },
    correct: "A",
    explanation:
      "Total body water = 0.60 × 80 = 48 L. ICF = 2/3 × 48 = 32 L. ECF = 1/3 × 48 = 16 L.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "ECF is 1/3 of TBW, not 1/3 of body weight. Mixing those two gives 26.7 L — a wrong-step trap.",
  },
  {
    id: "calc-renal-clearance-05",
    topic: "Renal Physiology — Creatinine clearance",
    stem:
      "A 48-year-old man with chronic kidney disease has serum creatinine = 12 mg/dL, BUN = 80 mg/dL, 24-hour urine volume = 720 mL/day (= 0.5 mL/min), urine creatinine concentration = 960 mg/dL. Which of the following values best represents creatinine clearance in this patient?",
    choices: { A: "10 mL/min", B: "25 mL/min", C: "40 mL/min", D: "100 mL/min" },
    correct: "C",
    explanation:
      "Clearance = (U × V) / P = (960 × 0.5) / 12 = 480 / 12 = 40 mL/min.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Convert urine volume to mL/min before plugging in. 720 mL/day ÷ 1440 min = 0.5 mL/min. Forgetting to convert gives a number off by ~1440.",
  },
  {
    id: "calc-renal-rbf-06",
    topic: "Renal Physiology — Renal blood flow (PAH)",
    stem:
      "A 24-year-old man's renal blood flow is estimated using para-amino hippuric acid (PAH). Serum PAH = 0.05 mg/mL, renal venous PAH = 0, urine volume = 2 mL/min, urine PAH = 10 mg/mL, hematocrit = 0.45. Which of the following values best approximates renal blood flow?",
    choices: { A: "300 mL/min", B: "400 mL/min", C: "540 mL/min", D: "730 mL/min" },
    correct: "D",
    explanation:
      "Step 1: PAH clearance = renal plasma flow = (UPAH × V) / PPAH = (10 × 2) / 0.05 = 400 mL/min. Step 2: Renal blood flow = RPF / (1 − Hct) = 400 / 0.55 ≈ 727 ≈ 730 mL/min.",
    cognitiveType: "physiology-calc",
    distractorArchetype: "sign-magnitude-trap",
    discriminatingClue:
      "Two steps: PAH clearance gives PLASMA flow, not blood flow. Dividing by (1 − Hct) converts plasma → blood. 400 is the trap if you stop at step 1.",
  },
];

export const CALC_BANK_FILES = {
  "CPR-Calc-Respiratory-Physiology.json": CALC_QUESTIONS_RESPIRATORY.map((q) => ({
    ...q,
    sourceFile: "CPR-Calc-Respiratory-Physiology.json",
    bankType: "school-practice",
    qLevel: 2,
    difficulty: "medium",
  })),
  "CPR-Calc-Renal-Physiology.json": CALC_QUESTIONS_RENAL.map((q) => ({
    ...q,
    sourceFile: "CPR-Calc-Renal-Physiology.json",
    bankType: "school-practice",
    qLevel: 2,
    difficulty: "medium",
  })),
};

export const CALC_BANK_VERSION = "v1";
export const CALC_BANK_LOAD_FLAG = "rxt-calc-bank-loaded-" + CALC_BANK_VERSION;

/**
 * One-time importer: merges the calc bank into rxt-question-banks. Idempotent —
 * uses CALC_BANK_LOAD_FLAG so it only runs once per version. Bumps version to
 * re-import after edits.
 */
export function ensureCalcBankImported() {
  try {
    if (typeof localStorage === "undefined") return false;
    if (localStorage.getItem(CALC_BANK_LOAD_FLAG) === "true") return false;
    const existing = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    let changed = false;
    for (const [filename, qs] of Object.entries(CALC_BANK_FILES)) {
      if (!existing[filename] || existing[filename].length !== qs.length) {
        existing[filename] = qs;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem("rxt-question-banks", JSON.stringify(existing));
      try {
        window.dispatchEvent(new CustomEvent("rxt-question-banks-updated"));
      } catch {}
    }
    localStorage.setItem(CALC_BANK_LOAD_FLAG, "true");
    return changed;
  } catch (e) {
    console.warn("ensureCalcBankImported failed:", e);
    return false;
  }
}

/**
 * Flat list of all calc questions for direct calc-drill mode. Merges:
 *   1. Built-in school-practice calc questions (CALC_BANK_FILES)
 *   2. Any user-uploaded bank questions in rxt-question-banks tagged
 *      cognitiveType === "physiology-calc"
 *
 * Dedupes by stem prefix so re-uploads / reimports don't duplicate the drill.
 */
export function getAllCalcQuestions() {
  const builtIn = Object.values(CALC_BANK_FILES).flat();
  let uploaded = [];
  try {
    if (typeof localStorage !== "undefined") {
      const banks = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
      const builtInFilenames = new Set(Object.keys(CALC_BANK_FILES));
      uploaded = Object.entries(banks)
        .filter(([filename]) => !builtInFilenames.has(filename))
        .flatMap(([filename, qs]) =>
          (Array.isArray(qs) ? qs : []).filter(
            (q) => q && q.stem && q.choices && q.correct && q.cognitiveType === "physiology-calc"
          )
        );
    }
  } catch (e) {
    console.warn("getAllCalcQuestions: failed to read uploaded banks:", e);
  }
  const seen = new Set();
  const merged = [];
  for (const q of [...builtIn, ...uploaded]) {
    const key = String(q.stem || "").slice(0, 80).toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(q);
  }
  return merged;
}
