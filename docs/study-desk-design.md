# Study Desk design

Direction approved August 28, 2026. Sources: the user's Inspiration Library,
Soft Study Console, Zen Dojo Study Dashboard, and Clinical Trial Command Deck.

The application uses warm paper, ink/slate text, restrained teal actions,
blue success, amber caution, and rose errors. States retain text/icons and
active controls have outlines: color is not the only signal. Saved dark mode
is preserved; new users default to light. System sans replaces condensed
headlines and monospace UI prose, retaining the 18px root/readability floor.

Shared shell, tabs, buttons, Today cards, block metrics, and lecture rows adopt
the new presentation. Today leads with the work and moves detailed block
statistics below it. Existing mental-model and guide disclosure remains intact.
Small screens get horizontally scrollable workspace navigation and a collapsed
block rail by default when no sidebar preference has been saved.

No data migrations, provider changes, generated-question changes, or scheduling
changes are part of this release. Legacy inline-styled tools retain their own
theme objects; they are not all individually redesigned in this first rollout.

Verification uses actual components with clearly labeled sample data, not a
live account. Production signed-in history and external Anki sync must not be
claimed verified by that fixture. Existing unrelated exam-bank edits remain
outside this change.
