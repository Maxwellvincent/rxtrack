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

Style profile version 4 removes keyword-derived order percentages. The prompt
boundary strips those fields from older persisted profiles as well, preserving
ordinary descriptive features and existing source/outcome metadata. Localization
and plural structure lead-ins are descriptive task categories, not depth judgments.
