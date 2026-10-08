# Lecture question preparation

Local Ollama stays serial because competing drafts otherwise queue ahead of review.
An explicitly configured desktop bridge can advertise separate Ollama Cloud writing
and Codex review resources through `/health.questionPreparation`.

For that route, lecture quizzes use two overlapping jobs with five candidates and
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

All writing/review/repair calls share one preparation deadline. Neither cloud writing
nor Codex review may silently switch backend or fall through to paid Gemini/Anthropic
APIs. An incomplete batch remains explicitly incomplete.

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
`LLM_BRIDGE_QUESTION_MODEL` optionally changes the writer; default is `gemma4:31b`.
Ordinary bridge traffic retains its existing routing. Without the opt-in flag,
private key and available Codex executable, the application keeps local serial
preparation. This configuration is specific to lecture quizzes on the configured
desktop; it does not establish cloud access for other devices.
