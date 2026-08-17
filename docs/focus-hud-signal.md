# Telling focus-hud what is being studied

`src/focusHudSignal.js` publishes an activity signal that focus-hud reads to
attribute study time to the right area and lecture, without anyone starting a
timer by hand. Both apps run under the same Firebase account, so this is a
shared document rather than a network call between them: no CORS, no running
peer, and it works when either app is closed.

## Using it

Wrap a study activity for its lifetime:

```js
import { trackFocusHudActivity } from "./focusHudSignal.js";

// When a question set, lecture, or review begins:
const stop = trackFocusHudActivity("questions", {
  detail: "ER DLA 1: Nutrition and Aging",  // shown in focus-hud
  externalRef: lectureId,                    // matched against activities
});

// When it ends — including on unmount:
stop();
```

`kind` is `"questions"`, `"lecture"`, or `"review"`. The signal heartbeats every
30s, pauses while the tab is hidden, and is deleted on `stop()`. focus-hud
treats anything older than 90s as finished, so a crashed tab cannot leave a
session looking active.

## Where to call it

Anywhere an activity has a clear start and end — a question-set component's
mount/unmount, a lecture player, a review session. It is fire-and-forget: a
failed write returns `false` and never throws, because studying must not break
when optional bookkeeping does.

## Matching lectures

focus-hud maps a signal to an activity whose `externalRef` equals the signal's
`kind`, falling back to the currently selected area. To attribute work to a
specific lecture, pass the lecture title as `detail` — focus-hud's Anki sync
already extracts the same titles from AnKing deck paths, so the two line up.

Full contract: `focus-hud/docs/rxtrack-contract.md`.
