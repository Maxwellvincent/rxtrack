# LEC 12 — Cardiac Action Potentials & Excitation–Contraction Coupling

> This is a **reference example** of the markdown a lecture upload expects.
> Produce files like this with `pdf2md <slides.pdf>` (or local marker / Datalab),
> eyeball them, then drop them into the **Lecture PDF** slot. `.md` skips OCR entirely.

<!--
WHAT THE APP KEYS OFF (why this file is shaped this way):

1. FILENAME → lecture number + type.
   detectLectureNumber() reads the name. Use  "LEC 12 - Title.md"  or
   "LEC12_Title.md". Session types recognized: LEC, SG, TBL, DLA, LAB.
   The .md extension is stripped from the derived title automatically.

2. OBJECTIVES.
   - CPR-style blocks: an "SOM.XXXX  objective text" table is parsed
     DIRECTLY (no AI) — highest fidelity. One code + one sentence per row.
   - Any block: a plain "## Learning Objectives" numbered list is parsed
     by AI. Include it even if you also have SOM codes.

3. KEY TERMS / must-test facts.
   **Bold** survives markdown → highYieldDetails auto-extraction pulls
   bolded terms + their defining phrase. Bold the testable nouns.

4. PAGES (optional).
   Marker/Datalab emit "{0}--------------------" separators (page id,
   0-indexed, ≥20 dashes). Keep them if present — they give per-page
   chunks + slide-image anchoring. Plain text with no separators = 1 page.
   Do NOT hand-add them; only keep what the OCR tool produced.
-->

## Learning Objectives

| Code | Objective |
| --- | --- |
| SOM.CPR.12.1 | Describe the ionic basis of each phase (0–4) of the fast-response cardiac action potential. |
| SOM.CPR.12.2 | Contrast fast-response and slow-response action potentials and identify where each occurs. |
| SOM.CPR.12.3 | Explain how the funny current (I_f) sets the rate of SA-node automaticity. |
| SOM.CPR.12.4 | Diagram the sequence of excitation–contraction coupling in a ventricular myocyte. |
| SOM.CPR.12.5 | Predict the effect of sympathetic and parasympathetic tone on heart rate and conduction. |

*(If your school uses a plain list instead of SOM codes, this works too:)*

1. Describe the ionic basis of phases 0–4 of the fast cardiac action potential.
2. Contrast fast- vs slow-response action potentials.
3. Explain how the funny current sets SA-node automaticity.

{0}--------------------

## Fast-Response Action Potential

The ventricular myocyte fires a **fast-response action potential**. Its upstroke
is driven by **voltage-gated Na+ channels** (phase 0), giving a steep depolarization.

- **Phase 0 — rapid depolarization:** fast **Na+** influx.
- **Phase 1 — initial repolarization:** transient **K+ efflux** (I_to).
- **Phase 2 — plateau:** **Ca2+** influx via **L-type calcium channels** balances K+ efflux. This plateau is what makes cardiac muscle refractory long enough to prevent tetany.
- **Phase 3 — repolarization:** delayed-rectifier **K+ efflux** dominates.
- **Phase 4 — resting potential:** set by **inward-rectifier K+ (I_K1)**, near −90 mV.

{1}--------------------

## Slow-Response Action Potential (SA & AV nodes)

The **SA node** fires a **slow-response action potential** with no true resting
potential. The **funny current (I_f)**, a slow inward Na+ current, drives the
gradual phase-4 depolarization that gives the node its **automaticity**. Upstroke
here depends on **Ca2+**, not Na+, so it is slower.

**Sympathetic** stimulation increases I_f (faster rate, positive chronotropy);
**parasympathetic** (vagal, ACh) increases K+ conductance and slows the rate.

{2}--------------------

## Excitation–Contraction Coupling

1. Action potential travels down the **T-tubule**.
2. **L-type Ca2+ channels** open → small Ca2+ influx.
3. That triggers **calcium-induced calcium release** from the **sarcoplasmic reticulum** via **ryanodine receptors (RyR2)**.
4. Cytosolic Ca2+ binds **troponin C** → cross-bridge cycling → contraction.
5. **SERCA** pumps Ca2+ back into the SR; **NCX** extrudes the rest → relaxation.
