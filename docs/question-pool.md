# Prepared questions and bounded exam generation

Integrated Exam settings has **Prepare questions for later**. This runs in the
app-wide background job center; navigation within RXtrack is safe, but closing
or refreshing the website stops the remaining work. Already completed questions
are saved in Firestore and reused when starting an exam. This is not a durable
server worker or an automatic recurring task.

## Persistence and freshness

- `users/{uid}/questionPool/{sha256}` stores each structurally valid generated
  question, lecture, difficulty, objective links, source signature and run ID.
- `users/{uid}/questionGenerations/{id}` stores run status, timing, ready count,
  cache hits, errors and question IDs. Both collections are owner-only.
- Source signatures cover lecture text, objective content, atoms, school
  exemplars and difficulty. Increment `POOL_VERSION` after prompt changes.
- Pool IDs hash the block and normalized stem. Assignment is atomic with the
  session write: a question cannot be assigned to two sessions. Assigned means
  included in a session, conservatively excluding it even if never answered.
- Previous session questions and available quiz calibration stems also filter
  repeat candidates. Semantic matching is heuristic, not a guarantee that two
  differently worded questions test different concepts.
- A question can be structurally valid without being medically correct. The
  pool is not independently validated against an exam or a clinical reference.

## Speed and safety

Two lecture workers run concurrently. The bridge gets 90 seconds per exam
request; the overall lecture attempt gets 180 seconds. Failed/quota-exhausted
transports stop queued generation; only incomplete successful responses retry.
An abort stops waiting and cancels fetch where supported, but a provider or CLI
may still finish work already accepted. No model, key or paid tier was changed.

Questions are saved individually before an exam is launched. A timed exam with
missing slots does not start; retry fills those slots using the existing pool.
The timer is stamped in the assignment transaction, after generation finishes.
Preparation itself never records an answer, score, or mastery change.

Provider/model and usage are not returned uniformly by the current bridge and
cloud API, so run metadata labels routing as existing bridge/cloud and keeps
model/token/cost fields null rather than inventing estimates. Firestore storage
and reads/writes use the project's existing quota/billing.

Current scope: Integrated Exams and their preparation path. Lecture quizzes do
not yet consume this pool, and practice still opens after its set is prepared
(not incremental question streaming). Neither school-style difficulty nor real
exam-score prediction is calibrated by this change.

## Verification

`firebase emulators:exec --only firestore --project demo-rxtrack-pool 'npx vitest run src/questionPool.integration.test.js'`

This checks real SDK persistence, assignment collisions, timer duration, owner
access and cross-user denial without writing to the live account.
