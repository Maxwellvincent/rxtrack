import { useState, useEffect, useRef } from "react";

// Normal ranges — [low, high, unit, display name]
// Sex-specific labs use male/female midpoints; flag as approximate where relevant.
const LAB_REF = [
  // Electrolytes / BMP
  { terms: ["sodium", "na\\+", "serum na"], name: "Sodium (Na+)", low: 136, high: 145, unit: "mEq/L" },
  { terms: ["potassium", "k\\+", "serum k"], name: "Potassium (K+)", low: 3.5, high: 5.0, unit: "mEq/L" },
  { terms: ["chloride", "cl-", "serum cl"], name: "Chloride (Cl-)", low: 98, high: 106, unit: "mEq/L" },
  { terms: ["bicarbonate", "hco3-", "hco3", "bicarb"], name: "Bicarbonate (HCO3-)", low: 22, high: 29, unit: "mEq/L" },
  { terms: ["bun", "blood urea nitrogen"], name: "BUN", low: 7, high: 20, unit: "mg/dL" },
  { terms: ["creatinine", "cr "], name: "Creatinine", low: 0.6, high: 1.2, unit: "mg/dL" },
  { terms: ["glucose", "blood glucose", "serum glucose"], name: "Glucose", low: 70, high: 100, unit: "mg/dL" },
  { terms: ["calcium", "ca2\\+", "serum ca"], name: "Calcium (Ca2+)", low: 8.5, high: 10.5, unit: "mg/dL" },
  { terms: ["phosphate", "phosphorus", "phos"], name: "Phosphate", low: 2.5, high: 4.5, unit: "mg/dL" },
  { terms: ["magnesium", "mg2\\+", "serum mg"], name: "Magnesium (Mg2+)", low: 1.5, high: 2.5, unit: "mEq/L" },
  { terms: ["uric acid"], name: "Uric Acid", low: 2.4, high: 7.0, unit: "mg/dL" },

  // CBC
  { terms: ["wbc", "white blood cell", "leukocyte"], name: "WBC", low: 4500, high: 11000, unit: "cells/μL", scale: 1000 },
  { terms: ["hemoglobin", "hgb", "hb "], name: "Hemoglobin", low: 12.0, high: 17.5, unit: "g/dL", note: "12–16 F, 13.5–17.5 M" },
  { terms: ["hematocrit", "hct"], name: "Hematocrit", low: 36, high: 52, unit: "%", note: "36–48% F, 41–53% M" },
  { terms: ["platelet", "plt"], name: "Platelets", low: 150000, high: 400000, unit: "cells/μL", scale: 1000 },
  { terms: ["mcv"], name: "MCV", low: 80, high: 100, unit: "fL" },
  { terms: ["mchc"], name: "MCHC", low: 32, high: 36, unit: "g/dL" },
  { terms: ["rdw"], name: "RDW", low: 11.5, high: 14.5, unit: "%" },
  { terms: ["reticulocyte", "retic"], name: "Reticulocytes", low: 0.5, high: 2.5, unit: "%" },

  // LFTs
  { terms: ["ast", "sgot"], name: "AST", low: 10, high: 40, unit: "U/L" },
  { terms: ["alt", "sgpt"], name: "ALT", low: 7, high: 56, unit: "U/L" },
  { terms: ["alkaline phosphatase", "alp", "alk phos"], name: "ALP", low: 44, high: 147, unit: "U/L" },
  { terms: ["total bilirubin", "bilirubin", "bili"], name: "Bilirubin (total)", low: 0.1, high: 1.2, unit: "mg/dL" },
  { terms: ["direct bilirubin", "conjugated bilirubin"], name: "Bilirubin (direct)", low: 0.0, high: 0.3, unit: "mg/dL" },
  { terms: ["albumin", "serum albumin"], name: "Albumin", low: 3.5, high: 5.0, unit: "g/dL" },
  { terms: ["total protein", "serum protein"], name: "Total Protein", low: 6.0, high: 8.3, unit: "g/dL" },
  { terms: ["ggt", "gamma-gt"], name: "GGT", low: 8, high: 61, unit: "U/L" },
  { terms: ["amylase"], name: "Amylase", low: 28, high: 100, unit: "U/L" },
  { terms: ["lipase"], name: "Lipase", low: 10, high: 140, unit: "U/L" },
  { terms: ["ldh", "lactate dehydrogenase"], name: "LDH", low: 105, high: 333, unit: "U/L" },

  // Thyroid
  { terms: ["tsh", "thyroid-stimulating hormone"], name: "TSH", low: 0.4, high: 4.0, unit: "mIU/L" },
  { terms: ["free t4", "ft4"], name: "Free T4", low: 0.8, high: 1.8, unit: "ng/dL" },
  { terms: ["total t4", "thyroxine"], name: "T4 (total)", low: 5.0, high: 12.0, unit: "μg/dL" },
  { terms: ["t3"], name: "T3", low: 80, high: 200, unit: "ng/dL" },

  // Cardiac
  { terms: ["troponin i", "troponin t", "troponin"], name: "Troponin", low: 0, high: 0.04, unit: "ng/mL" },
  { terms: ["bnp", "b-natriuretic peptide"], name: "BNP", low: 0, high: 100, unit: "pg/mL" },
  { terms: ["ck-mb", "ck mb"], name: "CK-MB", low: 0, high: 5, unit: "%" },
  { terms: ["ck", "cpk", "creatine kinase"], name: "CK", low: 22, high: 198, unit: "U/L" },

  // Lipids
  { terms: ["ldl", "ldl-c"], name: "LDL", low: 0, high: 100, unit: "mg/dL", note: "Optimal <100" },
  { terms: ["hdl", "hdl-c"], name: "HDL", low: 40, high: 999, unit: "mg/dL", note: "Low <40 (M), <50 (F)" },
  { terms: ["triglycerides", "trig"], name: "Triglycerides", low: 0, high: 150, unit: "mg/dL" },
  { terms: ["total cholesterol", "cholesterol"], name: "Cholesterol (total)", low: 0, high: 200, unit: "mg/dL" },

  // ABG
  { terms: ["ph ", "arterial ph", "blood ph"], name: "pH (arterial)", low: 7.35, high: 7.45, unit: "" },
  { terms: ["paco2", "pco2"], name: "PaCO2", low: 35, high: 45, unit: "mmHg" },
  { terms: ["pao2", "po2"], name: "PaO2", low: 80, high: 100, unit: "mmHg" },
  { terms: ["o2 sat", "sao2", "o2sat", "oxygen saturation"], name: "O2 Saturation", low: 95, high: 100, unit: "%" },

  // Coagulation
  { terms: ["inr"], name: "INR", low: 0.8, high: 1.2, unit: "" },
  { terms: ["pt ", "prothrombin time"], name: "PT", low: 11, high: 13, unit: "sec" },
  { terms: ["ptt", "aptt", "partial thromboplastin"], name: "PTT", low: 25, high: 35, unit: "sec" },

  // Inflammatory / other
  { terms: ["esr", "erythrocyte sedimentation"], name: "ESR", low: 0, high: 20, unit: "mm/hr" },
  { terms: ["crp", "c-reactive protein"], name: "CRP", low: 0, high: 3, unit: "mg/L" },
  { terms: ["hba1c", "a1c", "hemoglobin a1c"], name: "HbA1c", low: 0, high: 5.7, unit: "%" },
  { terms: ["ferritin", "serum ferritin"], name: "Ferritin", low: 15, high: 200, unit: "ng/mL" },
  { terms: ["serum iron", "iron"], name: "Iron", low: 60, high: 170, unit: "μg/dL" },
  { terms: ["tibc"], name: "TIBC", low: 250, high: 370, unit: "μg/dL" },
  { terms: ["vitamin b12", "b12", "cobalamin"], name: "Vitamin B12", low: 200, high: 900, unit: "pg/mL" },
  { terms: ["folate", "folic acid"], name: "Folate", low: 2, high: 20, unit: "ng/mL" },
  { terms: ["psa", "prostate-specific antigen"], name: "PSA", low: 0, high: 4, unit: "ng/mL" },
  { terms: ["cortisol", "serum cortisol"], name: "Cortisol (AM)", low: 6, high: 23, unit: "μg/dL" },
  { terms: ["acth"], name: "ACTH", low: 7, high: 63, unit: "pg/mL" },
  { terms: ["aldosterone"], name: "Aldosterone", low: 1, high: 16, unit: "ng/dL" },
  { terms: ["renin", "plasma renin"], name: "Renin (plasma)", low: 0.5, high: 4.0, unit: "ng/mL/hr" },
  { terms: ["insulin", "serum insulin"], name: "Insulin (fasting)", low: 2, high: 25, unit: "μIU/mL" },
  { terms: ["osmolality", "serum osmolality", "plasma osmolality"], name: "Serum Osmolality", low: 285, high: 295, unit: "mOsm/kg" },
  { terms: ["urine osmolality"], name: "Urine Osmolality", low: 50, high: 1200, unit: "mOsm/kg" },
  { terms: ["anion gap"], name: "Anion Gap", low: 8, high: 12, unit: "mEq/L" },
];

const UNIT_PAT = "(?:mEq\\/L|mmol\\/L|mg\\/dL|g\\/dL|μg\\/dL|ng\\/dL|ng\\/mL|pg\\/mL|U\\/L|IU\\/L|mIU\\/L|mmHg|mm\\/hr|mg\\/L|fL|mOsm(?:ol)?\\/kg(?:\\s*H2O)?|μIU\\/mL|ng\\/mL\\/hr|cells\\/μL|%|sec|/μL)?";
const NUM_PAT = "[\\d,]+(?:\\.\\d+)?";
// A vignette states a value as a report line ("Sodium: 107"), a bare space
// ("Potassium 2.4"), or natural prose ("sodium of 126", "glucose is 20", "was
// 2.4") — up to two connecting words, so it still stops before an unrelated
// number elsewhere in the sentence.
const SEP_PAT = "(?:\\s*:\\s*|\\s+(?:[a-zA-Z]+\\s+){0,2})";

// Build one big regex from all lab terms
function buildRegex() {
  // Sort longest terms first to prevent partial matches
  const entries = LAB_REF.flatMap((lab, labIdx) =>
    lab.terms.map((term) => ({ term, labIdx }))
  ).sort((a, b) => b.term.length - a.term.length);

  const termGroup = entries.map((e) => `(?:${e.term})`).join("|");
  // Capture: full match, term, number, optional unit
  return {
    re: new RegExp(`(${termGroup})${SEP_PAT}(${NUM_PAT})\\s*${UNIT_PAT}`, "gi"),
    entries,
  };
}

function findLab(term) {
  const lower = term.toLowerCase();
  return LAB_REF.find((lab) =>
    lab.terms.some((t) => new RegExp(`^${t}$`, "i").test(lower))
  );
}

export function parseText(text) {
  const { re } = buildRegex();
  const parts = [];
  let last = 0;
  let match;
  re.lastIndex = 0;

  while ((match = re.exec(text)) !== null) {
    const [full, term, numStr] = match;
    const lab = findLab(term.trim());
    if (!lab) continue;

    if (match.index > last) {
      parts.push({ type: "text", content: text.slice(last, match.index) });
    }
    const rawNum = numStr.replace(/,/g, "");
    let value = parseFloat(rawNum);
    // Some labs reported in thousands (WBC 15 = 15,000)
    if (lab.scale && value < 1000) value = value * lab.scale;

    parts.push({ type: "lab", raw: full, value, lab });
    last = match.index + full.length;
  }
  if (last < text.length) parts.push({ type: "text", content: text.slice(last) });
  return parts;
}

function LabPopover({ lab, value, onClose }) {
  const ref = useRef(null);
  const isHigh = value > lab.high;
  const isLow = lab.low > 0 && value < lab.low;
  const isNormal = !isHigh && !isLow;
  const status = isHigh ? "↑ Elevated" : isLow ? "↓ Low" : "Normal";
  const statusColor = isNormal ? "text-good" : "text-bad";

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <span
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 min-w-[180px] rounded border border-border bg-bg-elevated shadow-lg"
      style={{ fontSize: "11px" }}
    >
      <span className="block border-b border-border px-3 py-1.5 font-semibold text-text-1">{lab.name}</span>
      <span className="block px-3 py-1.5 text-text-3">
        Normal: {lab.low}–{lab.high === 999 ? "–" : lab.high} {lab.unit}
      </span>
      {lab.note && <span className="block px-3 pb-1 text-text-3 opacity-70">{lab.note}</span>}
      <span className={`block border-t border-border px-3 py-1.5 font-mono font-bold ${statusColor}`}>
        {status}
      </span>
    </span>
  );
}

export function LabAnnotatedText({ text, className }) {
  const [openIdx, setOpenIdx] = useState(null);
  const parts = parseText(text || "");

  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{p.content}</span>;
        return (
          <span key={i} className="relative inline-block">
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="underline decoration-dotted underline-offset-2 cursor-pointer text-text-1 hover:text-accent transition-colors"
              title="Click to see normal range"
            >
              {p.raw}
            </button>
            {openIdx === i && (
              <LabPopover lab={p.lab} value={p.value} onClose={() => setOpenIdx(null)} />
            )}
          </span>
        );
      })}
    </span>
  );
}
