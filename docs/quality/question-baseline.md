# Question quality baseline — Phase 1

The owner-only More → Admin diagnostics → Question quality baseline tool downloads
an allowlisted local packet from hydrated retained generated-question and school-bank
stores. It samples up to 48 generated items, spread across lectures, and up to 12
each from homework, ESoft and IMCQ. It does not write to study stores or call an AI
provider. Contested/abbreviated originals are excluded from reference sampling;
generated defects remain available for review. Figures must be checked in the
original source. A local packet is not a medical approval or an unseen holdout.

For each item, review the original source and record:

1. Actual reasoning: direct recall; interpretation plus one relationship; or two
   connected relationships with a downstream prediction. Sentence count, patient
   demographics, Bloom verbs and words such as “because” do not establish depth.
2. Whether the stem supplies every necessary clue, with no invented finding in
   the explanation. Check age, time course and patient-specific assertions.
3. Support for the key and discriminating clues on the original lecture page,
   including tables/figures. A model-generated atom alone is not original evidence.
4. One best answer; homogeneous plausible alternatives; no synonyms presented as
   distinct options, missing image, truncated option or choice shortcut.
5. Matched school wording and inferential burden for the same concept. Relevant
   homework/ESoft/IMCQ templates outrank unrelated stylistic resemblance.
6. A new tested relationship/endpoint versus superficial rewrites and repeated keys.
7. A concise explanation connecting actual clues to the key and the closest rival.

Use verdict pass / revise / withhold / needs-source-review. Leave unreviewed fields
null. Distinguish critical key/source defects from language or variety concerns.
Record denominators and unavailable source/figure checks in any report; never
publish a medical accuracy rate for unreviewed items.

Existing uploaded references may already have entered generation prompts. Reserve
future examples explicitly before using them as held-out evaluation. Never label a
previously used reference set “unseen.” No learner answers count toward reviewing
question quality, and no review changes historical scores automatically.

Style profile version 5 removes keyword-derived order percentages. The prompt
boundary strips those fields from older persisted profiles as well, preserving
ordinary descriptive features and existing source/outcome metadata. Localization
and plural structure lead-ins are descriptive task categories, not depth judgments.

## First sampled failure regressions

The downloaded 2026-10-30 packet contained 48 generated items from 30 lecture
pools and 36 original reference samples. It represents retained history, not only
the latest generation policy. Private item-level editorial findings remain outside
the repository; no learner scores were changed.

A continuation-only original and a reference to an unavailable prior question now
fail style-reference eligibility. These originals remain stored. Complete-inventory
subtraction (recover two tissue layers and identify the missing one) is direct
recall even if a reviewer claims otherwise. When at least 150 normalized characters
of lecture text are available, reasoning verification requires original-lecture
support: one quote for first/second order and two for third order. Extracted facts
remain labeled separately in the review catalog. Facts-only sources without an
available lecture retain their existing behavior; this is not equivalent to
original-lecture verification. Existing historical approval stamps are not a claim
that every previously stored item has been re-reviewed under the new source gate.


## Objective-balanced construction references

Compact drafting and review reserve examples across the allocated objectives before
repeating a topic. Their example budget grows from two to at most six for multi-
objective batches. The shared selector retains source eligibility checks and
relevance ranking; incomplete and image-dependent references cannot fill a gap.
Each compact example carries candidate objective links and their basis so the
model can distinguish a school-code match from vocabulary overlap. These links
are retrieval hints, not saved curriculum mappings or evidence of medical truth.
Original lecture evidence remains the factual authority.

Regression coverage demonstrates that three distinct objective references reach
both compact writer and reviewer even when the input begins with several examples
of only the first topic. This verifies prompt construction, not an improvement in
medical accuracy or patient-vignette quality. Evaluate fresh output separately for
necessary source-supported clues, homogeneous distractors, one best answer, actual
reasoning depth, and a new relationship rather than a repeated answer route.


## Example-first construction

The shared writer/reviewer context now assigns a matching textual example to
each allocated objective rather than leaving the model to choose from an unlabeled
style list. A stable content-derived template ID survives subset/reordering. The
assignment exposes the original stem, option structure, source kind and candidate
match basis without treating a school key as lecture evidence. Complete textual
clickers may provide a task scaffold; unavailable figures and incomplete originals
remain excluded. Unmatched objectives explicitly have no assigned school template;
broader examples are labeled general style only.

Writers may reuse sentence scaffolding, familiar phrases, clue sequence and lead-in
format. A fresh adaptation must change a meaningful relationship, observation or
endpoint; an unchanged original stays original-bank practice. The drafting plan
can retain templateId, retainedPattern and changedRelationship for independent
review. These model-authored claims are not approval or proof of use. Existing
plans without these fields remain valid legacy records. All keys, clues and
explanations still require lecture support. Topic-specific synthesis/transport
warnings are included only for matching subject/objective/atom context, reducing
irrelevant material in other compact prompts.

Tests cover example assignment, unkeyed text clickers, missing matches and
preserving untrusted adaptation claims. Passing these tests does not demonstrate
fresh model output quality. Live evaluation remains a separate boundary.


Template retrieval additionally searches the full eligible textual bank for
specific contiguous objective phrases, using the stem and keyed option rather
than all distractors. It requires three content words, or two with a distinctive
long term, and records candidate-template-phrase separately from school-code and
candidate-overlap evidence. This recovers examples such as primary motor cortex
and lateral corticospinal cases missed by the whole-objective overlap threshold.
It does not loosen persistent school/objective alignment rules or award coverage.
The local NB31 fixture now assigns examples to all three allocated objectives;
this is reference retrieval verification, not fresh-output quality validation.


## Bounded targeted repair

Preparation enables one targeted repair pass for partially accepted batches.
Only rejected items enter that request; already accepted stems are retained.
Repair instructions preserve the valid objective, template, patient setting and
endpoint, and target the reported giveaway or ambiguity with source-supported
changes. Missing discriminators cannot be fabricated to force the key. Every
repair is independently re-reviewed with recursive repair disabled. A failed
repair leaves previously accepted work intact. Wholly rejected batches use fresh
refill feedback by default; focused final-slot preparation retains its existing
repair capability. Explicit skipRepair remains respected, and all calls share the
preparation deadline.

Regression tests cover both an accepted repair and a rejected repair in a mixed
batch, ensuring only the rejected item is sent and accepted work survives. They
verify control flow, not model-generated clinical quality. No additional live
provider run was performed for this implementation.


## Repeatable complete-flow diagnostic

`scripts/benchmark-question-generation.mjs` uses Vite SSR loading for the real app
module graph, including JSON/JSX dependencies. It writes only a private local audit
report. `--prepare --production-policy --allow-repair --count 3 --max-attempts 1`
exercises a bounded draft/review/partial-repair/re-review attempt with zero spare
candidates. Omit `--allow-repair` to keep the diagnostic repair-free. Direct local
Ollama remains the default; `--bridge --backend codex` deliberately opts into the
configured external service and requires authorization for the private payload.
The shared budget still applies; this bounded run is not production refill yield.


## Mixed-source template context

The app's source loader includes the lifetime bank library, including ESoft,
IMCQ, homework and in-class uploads. Template matching now considers the full
eligible bank before prompt budgeting. Each objective retains a primary reference
(preferring a relevant ESoft/school example), plus relevant supporting examples
from distinct source kinds. Primary plus supporting references are bounded to
eight across the plan; unrelated examples are never forced in to meet a source
quota. In-class spelling/metadata aliases and explicit homework metadata are
recognized. Clickers remain task-pattern evidence, not inferred key authority.

New generationEvidence.templateReferences records which source kinds and template
IDs were supplied, separately from a model's claimed template choice. It is prompt
provenance, not independent verification or proof that every reference was used.
A mixed-source regression includes many homework examples before a relevant ESoft,
IMCQ and in-class item and checks that all four types reach the plan. Prior NB31
and the separately authorized NB28 live fixtures contain only Week12 homework;
those runs cannot establish mixed-source live performance.


## Objective ownership validation

Writing and review context now includes the lecture's explicit objective inventory,
including unallocated neighboring objectives, labeled as scope rather than factual
evidence. Reviewers are asked to quote the assigned objective clause and describe
the actual tested relationship. Shared lecture vocabulary or a relevant template
does not establish ownership. This addresses drift between adjacent tasks such as
receptor characteristics and fiber classification without inventing a remapping.

For objective-linked strict review, an approved question requires an explicit
positive alignment verdict. A negative verdict is blocking even when other checks
pass. When a structured clause claim is returned, its ID must match the question,
its clause must occur in the assigned objective, and its tested relationship must
be nonempty. Accepted structured claims are stored as bounded review metadata.
This validates the claim's reference, not its semantic truth; legacy reviewers may
still provide only the explicit positive verdict. Historical questions, answers,
counts and objective links are not rewritten. Tests cover negative/missing verdicts,
neighboring-clause errors and source inventory inclusion. No fresh live model
validation was performed for this change.
