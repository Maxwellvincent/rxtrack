# Combined slides and notes review

Lecture Progress now records slides and notes with one explicit action. The two authoritative records commit in one Firestore transaction; failures cannot leave a slide-only or notes-only session. A stable event ID prevents retry duplication. The completion queue receives the same next-review date as the notes model. Closed-book grading remains optional and saves its review activity in the same transaction.

Old slide-only history is preserved and labeled historical. No old activity is inferred to contain notes. Review completion is exposure, not objective mastery. Full automated suite: 2,276 passed, 37 skipped. Targeted UI and transaction checks pass. Signed-in save/reload verification remains outstanding.
