2026-05-06

Post-Lab Memory Consolidation Quiz Spec
This document defines the type of post-lab questions the quiz system should generate before the learner transitions to vignette-style application. The target user is an early medical student using active recall and spaced repetition, with a preference for concise, high-yield prompts that test core understanding without requiring long stems or diagnostic reasoning.
Primary goal
The quiz should strengthen memory consolidation immediately after lab or lecture exposure by testing recognition, recall, mechanism flow, definitions, pattern recognition, and simple interpretation. These questions should come before full clinical vignettes because the learner is still building the raw concept map needed to reason through patient cases.
Question style
Questions should be:
	•	Short to medium length.
	•	Directly answerable from foundational physiology/histology/anatomy knowledge.
	•	Focused on one idea at a time.
	•	Free of unnecessary distractors or story details.
	•	Written in a way that feels like a professor’s post-lab quiz, not a board-style case.
	•	Designed to make the learner retrieve a concept, relationship, formula, direction of change, or structural identification.
Questions should not initially rely on:
	•	Long patient vignettes.
	•	Multi-step diagnostic reasoning.
	•	Hidden diagnoses.
	•	Excessive lab interpretation unless the tested concept is basic and targeted.
Core categories to generate
1. Definition and identification questions
Use these to test whether the learner can name or recognize a concept.
Examples of structure:
	•	“Define physiologic dead space.”
	•	“What structures make up the glomerular filtration barrier?”
	•	“What is DLCO measuring?”
	•	“Which vessel runs at the corticomedullary junction?”
Best use:
	•	New topics.
	•	Histology labs.
	•	Anatomy structure review.
	•	First-pass physiology concepts.
2. Formula and relationship questions
Use these when the concept depends on a known relationship, equation, or proportional rule.
Examples of structure:
	•	“Write the relationship between minute ventilation and alveolar ventilation.”
	•	“If alveolar ventilation decreases by 50%, what happens to PaCO2?”
	•	“How does increasing tidal volume affect the fraction of each breath that is dead space?”
Best use:
	•	Pulmonary physiology.
	•	Renal physiology.
	•	Cardiovascular physiology.
	•	Acid-base and gas laws.
3. Direction-of-change questions
These are high-yield because they force conceptual prediction without requiring a full case.
Examples of structure:
	•	“How does DLCO change in emphysema?”
	•	“What happens to V/Q at the apex of the upright lung?”
	•	“What happens to physiologic dead space in pulmonary embolism?”
	•	“What happens to TLC and RV in obstructive lung disease?”
Best use:
	•	Physiology topics with comparisons.
	•	Mechanism-heavy systems.
	•	Review after diagrams, graphs, or lab demonstrations.
4. Structure-function questions
These connect anatomy/histology to physiology and are especially useful for lab review.
Examples of structure:
	•	“Why does the cortex appear granular?”
	•	“Why does the medulla look striated?”
	•	“Why do podocyte pedicels matter for filtration?”
	•	“Why does pulmonary fibrosis lower DLCO?”
Best use:
	•	Histology labs.
	•	Gross anatomy with function integration.
	•	Organ-system lab practical prep.
5. Compare-and-contrast questions
These help learners separate look-alike concepts that commonly get confused.
Examples of structure:
	•	“Anatomic dead space vs physiologic dead space.”
	•	“PCT vs DCT under light microscopy.”
	•	“Cortical vs juxtamedullary nephron.”
	•	“Obstructive vs restrictive pattern in lung volumes.”
Best use:
	•	Topics with paired concepts.
	•	Review after confusion is detected.
	•	Retrieval practice before Anki card creation or refinement.
6. Stepwise mechanism / pathway questions
These should test a sequence, signaling cascade, or physiologic flow.
Examples of structure:
	•	“Outline the signaling steps after E/NE bind a beta-adrenergic receptor.”
	•	“Trace blood flow from the renal artery to the glomerulus.”
	•	“Trace urine flow from collecting duct to urethra.”
	•	“Describe the Gq pathway used by the alpha-1 receptor.”
Best use:
	•	Pharmacology.
	•	Physiology pathways.
	•	Embryology sequences.
	•	Anatomy flow-type content.
7. Numeric plug-in questions
These should involve short calculations with one or two steps, not long quantitative problems.
Examples of structure:
	•	“Given TV, RR, and dead space, calculate alveolar ventilation.”
	•	“Given IRV, TV, ERV, and RV, calculate VC and TLC.”
Best use:
	•	Pulmonary physiology.
	•	Cardiovascular formulas.
	•	Renal clearance basics.
8. Region-based or graph/diagram interpretation questions
These should ask the learner to explain what changes across a structure or along a gradient.
Examples of structure:
	•	“How do ventilation and perfusion change from apex to base?”
	•	“Where is V/Q greater than 1?”
	•	“Which structures are found in the cortical labyrinth vs medullary ray?”
Best use:
	•	Spatial anatomy.
	•	Histology slides.
	•	Physiology graphs and regional trends.
Difficulty progression
The system should move through a staged progression:
	1.	Foundational recall: definitions, labels, formula naming, structure ID.
	2.	Concept linkage: compare/contrast, structure-function, direction-of-change.
	3.	Mechanism prediction: what happens if a variable rises, falls, or is blocked.
	4.	Mini-application: short scenario without a full vignette.
	5.	Full vignette: only after the user demonstrates stable recall of the above.
This means the app should not jump straight from fact learning into classic board-style patient stems. The learner first needs rapid retrieval reps on the building blocks.
Stem design rules
Each question stem should follow these rules:
	•	One tested objective per item.
	•	One clean sentence when possible.
	•	Two sentences max for standard recall questions.
	•	Numeric questions may have one setup line plus the actual prompt.
	•	Avoid decorative wording.
	•	Avoid “all of the following except” style unless specifically requested.
	•	Avoid ambiguous prompts like slide headings that do not actually ask anything.
Good example:
	•	“What happens to alveolar dead space in pulmonary embolism?”
Bad example:
	•	“Second Messenger Systems — Binding of E/NE to Beta adrenergic receptor”
If a source note is a heading rather than a question, the system should rewrite it into a true testable prompt automatically.
Answer format expectations
Even when the app is generating only questions, it should internally assume the expected answer is:
	•	Short.
	•	High-yield.
	•	Specific.
	•	Focused on the main tested idea.
Examples:
	•	“Gs -> adenylate cyclase -> cAMP -> PKA.”
	•	“Ventilated but not perfused alveoli.”
	•	“Decreased, due to reduced surface area.”
The system should prefer prompts where a concise, memorable answer exists.
Why this style works
This question style supports the learner’s current study method: Anki-centered, high-yield, concise retrieval with short micro-learning loops rather than long first-pass deep dives. It matches early consolidation better than vignettes because it isolates one concept at a time, making errors easier to detect and correct.
When to introduce mini-scenarios
Mini-scenarios can be used once the learner has basic recall. These are not full vignettes; they are short conceptual setups.
Examples:
	•	“A patient has a pulmonary embolism in one lung segment. What happens to alveolar dead space there?”
	•	“A patient has emphysema with destroyed alveolar walls. What happens to DLCO?”
	•	“A patient doubles respiratory rate but halves tidal volume. What happens to alveolar ventilation?”
These are ideal bridge questions between raw recall and full case interpretation.
Topic-specific implementation for pulmonary modules
For pulmonary physiology, the app should heavily emphasize:
	•	Lung volumes and capacities.
	•	Minute ventilation vs alveolar ventilation.
	•	Dead space categories.
	•	V/Q relationships.
	•	Apex vs base lung differences.
	•	DLCO and what increases or decreases it.
	•	Obstructive vs restrictive patterns.
	•	Hypoventilation vs diffusion/perfusion problems.
Question types for pulmonary should repeatedly test:
	•	Definitions.
	•	Equations.
	•	Direction of change.
	•	Mechanism explanation.
	•	Short calculations.
	•	Regional comparisons.
Question generation template
Use this internal generation pattern:
	1.	Identify the core concept.
	2.	Choose one question type from the categories above.
	3.	Write a direct stem testing only that concept.
	4.	Ensure the answer can be stated in 1–3 lines.
	5.	Prefer mechanisms, relationships, or distinctions over trivia.
	6.	Reserve long clinical reasoning for later quiz modes.
Example prompt patterns for implementation
The app should be able to generate prompts in forms like:
	•	“Define X.”
	•	“What is the difference between X and Y?”
	•	“What happens to X in Y?”
	•	“Why does X occur in Y?”
	•	“Trace the pathway from X to Y.”
	•	“Calculate X given these values.”
	•	“Which structure is found in region X?”
	•	“How does X change from region A to region B?”
Exclusion rules
Avoid overusing:
	•	Pure trivia with no conceptual value.
	•	Overly long lists unless they are clinically essential.
	•	Full board-style stems too early.
	•	Questions where the learner must infer what is being asked from a title.
	•	Multi-concept questions unless the mode is explicitly advanced.
Success criteria
A successful post-lab memory-consolidation quiz should feel like:
	•	“I know what concept this is testing.”
	•	“I can answer in a sentence or two.”
	•	“This helps me separate similar concepts.”
	•	“This prepares me for Anki and then vignettes.”
It should not feel like:
	•	“I need to diagnose a disease from a hidden clue.”
	•	“This stem is longer than the concept.”
	•	“I know the topic, but I do not know what the question is asking.”
One-line product summary
This quiz mode is a pre-vignette, memory-consolidation layer that tests foundational concepts using short, direct, mechanism-focused questions before the learner advances to full clinical reasoning.