# RXTrack Learning Hub — Integrated Architecture and Roadmap

**Status:** planning baseline for future implementation  
**North star:** move from separate lecture, quiz, mental-model, and Anki tools to one evidence-grounded learning loop that can take a lecture from upload to durable clinical reasoning.

## 1. What the hub should optimize

The hub should optimize four outcomes together:

1. **Coverage:** every block objective is encountered and tested.
2. **Understanding:** the learner can explain the mechanism and predict consequences.
3. **Transfer:** the learner can apply it to an unfamiliar patient or changed variable.
4. **Retention:** recurring blockers become targeted retrieval and Anki repair items.

The system should never optimize card count, atom count, or quiz count by itself. Those are means. The useful unit is a repaired or strengthened relationship:

```text
lecture evidence → objective → mechanism → patient reasoning → retrieval → transfer → spaced repair
```

## 2. Existing foundation

Already built and reusable:

- `pdftotext -layout` fast path through the local bridge, with OCR fallback.
- Per-page lecture chunks, slide objective evidence, and objective-aware extraction.
- Microdetail preservation: exceptions, quantitative details, bold terms, and clinical discriminators.
- Hierarchical atoms (`anchor`, `core`, `supporting`, `discriminator`) with parent/detail links.
- Objective-first question generation with ExamSoft/STEP-style exemplars.
- Question deduplication and requested-count safeguards.
- Lecture benchmark tooling using the Heme/Porphyrias lecture as a calibration case.
- Per-lecture study flow, mental models, study guides, objective linking, and mastery/progress stores.
- Adaptive Teach/Recognize/Test engine foundations.
- Anki ingestion, recognition-bank generation, and AnkiConnect infrastructure.
- Targeted PDF re-extraction that preserves the existing lecture identity and progress.

These should remain one shared foundation. Do not create separate extraction, objective, or question systems for the tutor.

## 3. Canonical knowledge model

The app should model the lecture as a graph, not as a flat summary.

```text
Block
 └─ Objective
     └─ Anchor concept
         ├─ supporting detail
         ├─ discriminator / contrast
         ├─ mechanism edge
         ├─ patient presentation
         ├─ lab finding
         ├─ treatment / intervention
         ├─ source lecture page
         ├─ school question exemplar
         └─ learner evidence / Anki relationship
```

Every important node should have stable IDs and provenance:

- `blockId`
- `lectureId`
- `objectiveId` / SOM code when available
- `atomId`
- `sourcePage`
- `sourceText`
- `sourceKind` (`lecture`, `school`, `learner`, `reference`)
- `confidence` and `lastVerified`

The graph must distinguish **what the lecture teaches** from **helpful outside context**. Lecture evidence and block objectives remain authoritative for scope; school questions teach style; reference material can enrich but cannot silently redefine lecture truth.

## 4. Obsidian relationship

Obsidian should be an optional authoring and inspection surface, not the runtime source of truth.

RXTrack remains authoritative for:

- timed sessions
- objective coverage
- answer history and mastery
- blockers
- question provenance
- Anki draft approval and sync status

RXTrack can export or sync Markdown with stable wikilinks:

```text
[[Objective: DM-29-03]]
[[Atom: HMB synthase deficiency]]
[[Disease: Acute intermittent porphyria]]
[[Lecture: Heme synthesis and porphyrias]]
```

This gives the learner backlinks and visual graph navigation without forcing the live tutor to parse a vault on every turn. A later import can accept user-authored corrections or relationships after validation.

## 5. Patient-centered tutoring mode

The patient-centered model is the tutoring policy. It should replace “summarize then quiz” as the default lecture walkthrough.

```text
patient → focused question → learner commitment → targeted feedback
→ one mechanism → prediction → clinical consequence → contrast → transfer
```

Rules:

- Do not begin with a comprehensive summary.
- Ask one focused question at a time.
- Correct answers add one new mechanism.
- Partial answers preserve the correct part and repair one connection.
- Incorrect answers step backward one causal link and provide a clue.
- “I do not know” reduces the problem rather than advancing.
- Contrasts are introduced through changed patients before showing a table.
- Treatment follows mechanism.
- Mastery requires a correct application to a new patient, not repetition.

The internal dependency map should be built before the session but kept hidden until the learner has constructed enough of the model to benefit from an integrated view.

## 6. Timed 30/45/60-minute sessions

The session controller should allocate time, not force a fixed number of questions.

### 30 minutes

- objective map and orientation: 2 minutes
- two or three anchor patients: 15 minutes
- one high-yield contrast: 6 minutes
- unseen retrieval: 5 minutes
- blocker capture and next review: 2 minutes

### 45 minutes

- orientation: 3 minutes
- progressive mechanism construction: 20 minutes
- contrasts and treatment: 10 minutes
- unseen retrieval: 8 minutes
- teach-back and review plan: 4 minutes

### 60 minutes

- full mechanism construction
- multiple contrast patients
- novel-variable prediction
- teach-back and targeted Anki drafts

If time runs short, the controller should preserve objective coverage and unresolved blockers, not simply stop at an arbitrary question count.

## 7. Fast and responsive runtime

The tutor must not resend the entire lecture on every turn.

### Pre-session work

Generate and cache:

- objective dependency map
- objective-to-atom index
- candidate patient sequence
- disease/contrast links
- lecture evidence snippets
- likely follow-up questions
- existing related Anki cards and prior misses

### Live turn budget

```text
session state read                 <100 ms
graph/evidence retrieval           <500 ms
first streamed tokens              <2 sec target
normal turn completion             <10–15 sec target
hard fallback                      25 sec
```

Use the local bridge and a fast model for normal turns, stream the answer, prefetch the next likely turn while the learner reads, cache deterministic pathway rules, and use cloud fallback only when necessary. A slow deep explanation should be an explicit “go deeper” action rather than blocking the normal flow.

## 8. Verifiable medical tutoring

Every tutor response should be structured and evidence-bearing:

```json
{
  "feedback": "...",
  "mechanismAdded": "...",
  "nextQuestion": "...",
  "learnerState": "shaky",
  "objectiveIds": ["..."],
  "atomIds": ["..."],
  "evidence": [{"page": 12, "text": "..."}],
  "scope": "lecture-supported",
  "confidence": "high"
}
```

Before display, validate:

- evidence exists for the claimed lecture fact;
- objective and atom links are real;
- upstream/downstream direction is internally consistent;
- the answer addresses the learner's actual response;
- no unsupported outside fact is presented as lecture content;
- the next question targets the detected gap;
- a diagnosis/treatment claim is not contradicted by the source.

If validation fails, narrow the response or label it as outside-lecture context. Never invent a citation or silently fill a missing detail.

## 9. Learner-state and blocker model

The tutor should track more than right/wrong:

- `new`: not yet encountered
- `understood`: correct reasoning in the taught case
- `shaky`: correct or guessed answer with uncertain reasoning
- `blocker`: explicit misconception or repeated failure
- `mastered`: correct reasoning on a new patient or changed variable

Classify blockers as:

- **K — knowledge:** missing fact
- **C — concept:** does not understand the entity
- **R — reasoning:** facts known but connection is wrong
- **Q — question interpretation:** misunderstood what was asked

Persist the learner's wording, the broken link, the corrected relationship, recurrence count, and source evidence. This powers both the next tutor turn and later retrieval.

## 10. Anki feedback loop

The supplied Anki model should be the canonical card policy. It governs creation, repair, strengthening, cloze selection, Extra, visual layout, and quality checks.

Cards should be drafted only when a blocker is persistent, clinically important, or represents a meaningful relationship. A single wrong guess should normally trigger tutoring, not a new card.

```text
tutor turn
→ blocker classification
→ recurrence / importance check
→ mechanism repair
→ Front + Extra draft
→ lecture-evidence validation
→ duplicate search against Anki
→ user approval
→ AnkiConnect write (optional)
```

Draft records should preserve:

- source lecture/objective/atom
- learner's original reasoning
- blocker type (`K/C/R/Q`)
- “what I thought → why it failed → correct relationship”
- Front and Extra
- evidence and provenance
- duplicate candidates
- approval and sync status

Existing Anki scheduling, media, note types, and clozes must not be overwritten silently. Repair mode should offer strengthen, replace, or create-new choices with a diff preview.

## 11. Question-generation integration

The same graph should feed all question types:

- recognition: identify a known relationship
- direction: predict increase/decrease or upstream/downstream
- mechanism: explain why
- clinical consequence: predict the finding
- patient identification: distinguish similar diseases
- intervention: choose or explain treatment
- novel prediction: change one variable

ExamSoft/IMCQ examples remain the style authority. Lecture evidence and objectives remain the content authority. The tutor and exam modes share atoms and provenance but differ in feedback timing and verbosity.

## 12. Recommended implementation sequence

### Stage 1 — Shared graph and evidence contracts

- Define stable node/edge schemas.
- Add evidence references to atoms and objectives.
- Build fast objective/atom/page retrieval.
- Export optional Obsidian Markdown with stable links.

### Stage 2 — Session planner

- Add 30/45/60-minute presets.
- Precompute dependency map and candidate patient sequence.
- Add session state, timer, phase, and objective coverage.
- Add streaming and latency instrumentation.

### Stage 3 — Patient tutor MVP

- Implement one-patient-at-a-time interaction.
- Add answer evaluation, targeted feedback, and follow-up selection.
- Add blocker classification and learner-state transitions.
- Add evidence display and validation failures.

### Stage 4 — Adaptive transfer

- Add contrast patients, treatment reasoning, and changed-variable prediction.
- Require transfer evidence before marking an atom mastered.
- Feed prior misses and Anki relationships into retrieval.

### Stage 5 — Anki repair loop

- Implement blocker persistence and recurrence thresholds.
- Generate Front + Extra drafts using the supplied policy.
- Add duplicate detection and approval/diff UI.
- Add explicit AnkiConnect write with scheduling preservation.

### Stage 6 — Orchestration and measurement

- Add Today queue for unfinished objectives, blockers, and spaced retrieval.
- Track objective coverage, transfer accuracy, blocker recurrence, card acceptance, and latency.
- Use the Heme/Porphyrias benchmark plus representative lectures to regression-test extraction and tutoring evidence.

## 13. Success metrics

Technical:

- first visible tutor response <2 seconds
- median complete turn <10 seconds
- 95th percentile complete turn <25 seconds
- cached retrieval <500 ms
- no unsupported evidence claims in validation tests

Learning:

- objective coverage per session
- transfer accuracy on unseen patients
- repeated blocker rate
- time-to-repair for K/C/R/Q gaps
- delayed retrieval accuracy
- Anki draft acceptance and duplicate rejection rate

Product:

- sessions completed within selected time budget
- learner interruption/retry rate
- percent of sessions ending with a clear next action
- lecture replacement/re-extraction success
- cloud/local fallback success rate

## 14. Guardrails

- Do not let AI concept extraction silently redefine the objective scope.
- Do not mark mastery from repetition alone.
- Do not create cards indiscriminately.
- Do not write to Anki without approval.
- Do not hide uncertainty behind confident prose.
- Do not use live web crawling as a blocking dependency for normal turns.
- Do not duplicate OCR, objective, or question-generation pipelines.
- Preserve authentic school questions and provenance.

This roadmap makes the lecture the spine, the graph the connective tissue, the patient tutor the active teaching loop, and Anki the durable repair/retention layer.
