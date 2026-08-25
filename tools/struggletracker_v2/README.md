# Struggle Tracker v2.0 — Mental-Map Repair

Struggle Tracker detects repeated `Again` answers, classifies difficult cards,
supports intentional Study Holds, and exports unresolved work to RXtrack.

## Mental-map rewrite workflow

While reviewing a two-field Basic card, choose:

`Struggle Tracker → 🧭 Propose Mental-Map Rewrite`

Default review shortcut on macOS: `⌘⇧M`. Change
`mental_map_rewrite_shortcut` in the add-on configuration to another Qt key
sequence, or set it to an empty string to disable the shortcut.

The add-on sends the card plus its existing concept/lecture classification to
the configured local LLM bridge. It requests:

- a diagnosis of why the original card is difficult;
- the card's position in the larger mechanism;
- a one-target replacement front;
- a short functional/causal replacement back.

Nothing changes until the learner approves the preview. On approval, the
add-on preserves existing image/audio references, updates the note, adds the
tag `struggle::mental-map-refactored`, releases Study Hold, and returns the
card to normal Anki scheduling.

Cloze and Image Occlusion notes are protected from automatic rewriting because
changing their structure may create or delete cards.

## RXtrack export

Every active Deep Review/Persistent card and unresolved Study Hold is exported
to `~/Documents/rxtrack-routine/struggle-tracker-export.json`.

Export runs from the Tools menu and automatically when Anki closes.

The export also includes the last 30 days of review activity grouped by deck
and calendar day. RXtrack's sync process conservatively matches those deck
paths to lecture titles and records one Anki pass per matched lecture per day.
Repeated exports use stable IDs, so they do not duplicate lecture passes.
