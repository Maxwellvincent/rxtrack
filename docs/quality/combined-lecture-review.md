# Combined slides and notes review

Lecture Progress now records slides and notes with one explicit action. The two authoritative records commit in one Firestore transaction; failures cannot leave a slide-only or notes-only session. A stable event ID prevents retry duplication. The completion queue receives the same next-review date as the notes model. Closed-book grading remains optional and saves its review activity in the same transaction.

Old slide-only history is preserved and labeled historical. No old activity is inferred to contain notes. Review completion is exposure, not objective mastery. Full automated suite: 2,276 passed, 37 skipped. Targeted UI and transaction checks pass. Signed-in save/reload verification remains outstanding.

## Phase 5 follow-through

Today now uses the same atomic combined save for lecture-linked retrieval reviews. Standalone models retain their own save path and do not invent lecture activity. The action guard prevents overlapping saves; failed saves keep the review open. A null next-review date explicitly clears completion reminders rather than falling back to the legacy interval list.

An explicit completed slides-and-notes pass schedules a follow-up in 24 hours, including when the old reminder was overdue. Ordinary notes edits retain the earlier conservative behavior. This is an exposure follow-up, not a successful retrieval grade or new objective credit; existing recall history remains intact.

Regression suite: 2,280 passed, 37 skipped. Build, scoped lint and patch checks pass. Signed-in persistence and cross-day behavior remain pending; no production study records were changed during automated checks.
