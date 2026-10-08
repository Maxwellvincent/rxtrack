# Lecture question preparation

Local Ollama stays serial because competing drafts otherwise queue ahead of review.
An explicitly configured desktop bridge advertises Codex as the preferred writer
and reviewer, with Ollama Cloud as the quota fallback, through
`/health.questionPreparation`.

For that route, lecture quizzes use three overlapping jobs with five candidates and
five independent verdicts per batch. Each completion is saved immediately and frees
its slot for a replacement batch. Missing reviews, unsupported source quotes,
insufficient reasoning depth and duplicates remain excluded. Accepted questions and
in-flight reservations share the same objective allocation; concurrent work cannot
double-credit an objective. Rejections inform subsequent fresh candidates.
Only dispatched batches consume retry attempts; waiting for reserved slots to
finish review does not reduce the refill budget.
Capable batch-review routes draft up to two spare alternatives when a later batch
has fewer candidates than the batch limit. Reservations and saved quiz counts
still cover only actual missing slots. Rejection feedback is scoped to the
objectives being retried, so unrelated failures do not displace the useful lesson.

All writing/review/repair calls share one preparation deadline: six minutes for the
configured Codex route, four minutes for the serial default. Preparation finishes
as soon as the requested count passes review; the ceiling permits a refill wave.
Codex handles both drafting and separate review requests until it returns an actual
usage/rate/quota limit. Then drafting and separate review requests use Ollama Cloud;
keeping an exhausted Codex reviewer would strand the fallback writer. These are
separate passes with source checks, not independent providers during fallback.
The limit is remembered across reloads in local storage. An explicit retry interval
is honored; otherwise Codex is rechecked after 15 minutes. The switch preserves the
remaining original deadline. Timeouts, outages, invalid JSON and medical rejections
are not usage limits and do not trigger this fallback. Lecture preparation never
falls through to paid Gemini/Anthropic APIs. An incomplete batch remains explicitly
incomplete.

Compact reviews cite numbered excerpts from the actual retrieved lecture text and
extracted facts. The engine resolves those IDs back to source text before checking
reasoning depth. Unknown IDs fail closed; legacy exact quotations remain supported.
This removes transcription failures without replacing independent medical review
or relaxing the connected-reasoning and answer-choice-shortcut checks.
Retrieval chunks each original page independently and labels each pinned quotation
context separately. Removing objective slides must not manufacture an excerpt
across a gap; every catalog citation must remain contiguous in the original source.

## Desktop bridge setup

Apply `scripts/bridge-question-cloud.patch` to the existing bridge after its previous
cancellation patch. It contains no credentials. The private credential file is
`~/.config/rxtrack/ollama-cloud.key`; never include it in the repository or browser.
Set `LLM_BRIDGE_QUESTION_CLOUD=on` for the bridge service and restart it.
`LLM_BRIDGE_QUESTION_MODEL` optionally changes the fallback model; default is `gemma4:31b`.
Ordinary bridge traffic retains its existing routing. Without the opt-in flag,
private key and available Codex executable, the application keeps local serial
preparation. This configuration is specific to lecture quizzes on the configured
desktop; it does not establish cloud access for other devices.

## Output latency

Compact drafting and review responses use unindented JSON and concise metadata.
Draft plans keep short causal clauses and only the source quotations needed to
establish the relationships. Every question retains its full stem, all options,
key explanation, rationale for every choice, objective attribution and independent
source/depth review. Nothing is truncated to satisfy a byte limit.

The NB08 comparison requested 15 fresh questions across nine objectives. The prior
route completed 15/15 in 252 seconds; compact output completed 15/15 in 228 seconds
(about 10% faster in that run). This is a single comparison, not a guaranteed timing
for every lecture or provider load. A lower drafting-effort experiment did not
reliably fill the batch and was rejected; Codex retains its configured effort for
both writing and review. The quota-triggered Ollama Cloud fallback is preserved.

### Progressive practice and bounded reserve

Lecture quizzes open after three independently reviewed questions (or the requested count for shorter quizzes). Later accepted batches append to the same session without resetting answers. The header retains the requested total. If preparation stops short, practice remains available and explicitly reports the shortfall. At the available-question frontier, Next waits while preparation is active. Exiting prevents late callbacks from reopening the quiz; already accepted questions remain saved.

Practice options exposes an opt-in reserve of at most three fresh questions per quiz, one drafting attempt and a shared 90-second drafting/review budget. It waits until foreground preparation finishes and uses the same Codex-first, quota-aware Ollama Cloud route. It never marks reserve questions seen or completed.

Preparation reuses only independently verified relationship quotations that still occur in the current lecture as objective scaffolds. This does not reuse old scenarios and does not bypass review. On a first run, the existing objective question-plan contract constructs the source-grounded plan; subsequent runs can reuse verified relationships.

A review whose sole defect is weak_explanation can provide a prose-only correction. Stem, choices, correct key and objective IDs must be identical. The corrected explanation and option rationales undergo a separate full review once; unsupported facts, ambiguous keys and reasoning shortcuts still require a new question.
