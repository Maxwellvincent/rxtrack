# Image occlusion — design for the next session

Status: **designed, not built.** Requested 2026-08-07. Read
[`README.md`](./README.md) first — the two constraints there govern this feature more than
anything below.

## What it is, and why it is not what we already have

Anki-style image occlusion: cover a labelled part of a figure, recall what is under the cover,
reveal, grade yourself.

This is a genuinely different unit from what the lecture flow does today. Today a figure is a
**stimulus** — it sits above a generated vignette, and the question is prose. Occlusion makes the
image **the question itself**. Nothing about the existing path changes; this is added alongside.

It earns its place because a diagram of the HPA axis has maybe eight labels on it, and naming
them cold is a different skill from answering a vignette about one of them. Anatomy, histology
slides and pathway diagrams are all label-dense in a way prose questions cannot cheaply cover.

## The constraint that decides the design

**Do not make him draw boxes for an hour before he is allowed to study.**

The whole protocol exists because passive prep work is where studying dies. A feature that asks
for twenty minutes of rectangle-dragging per lecture will be used once. Anki's occlusion editor
is exactly this, and it is why most people never use it.

So: **masks are proposed automatically, and editing them is optional.** Manual drawing exists as
the fallback for when the proposal is wrong, not as the way in.

This is the single most important thing to get right. If the auto-proposal turns out to be too
poor to ship, the honest move is to say so and reconsider — not to quietly fall back on making
him do the work by hand.

## Where masks come from

Marker's figures come from slide decks, so most carry **printed text labels** — "anterior
pituitary", "colloid", "zona glomerulosa". That is the tractable target: occlude the label text,
recall the term.

The vision call already happens once per figure at ingest (`labelCandidates` in
`src/lectureFigures.js`). Extend that reply to include the labels it can read and where they sit:

```json
{ "kind": "diagram", "shows": "...",
  "labels": [ { "text": "zona glomerulosa", "box": [0.11, 0.42, 0.19, 0.06] } ] }
```

Boxes normalized `[x, y, w, h]` in 0–1 so rendering never depends on the stored pixel size.

**Known risk, must be measured before building the rest:** vision models are mediocre at precise
coordinates. Before any UI work, spend one session step on a spike — run 10 Lecture 01 figures
through the bridge asking for label boxes, render them over the image, and look. If boxes land
within a label's width the feature works; if they are scattered, the auto path is dead and the
whole design needs rethinking. **Do not build the editor before this spike passes.**

Rejected alternative: OCR (tesseract) for text positions. More accurate on boxes, but it returns
every scrap of text including axis numbers and slide furniture, and it cannot tell a structure
label from a citation. The vision model at least knows what a structure is.

## The study unit

One occlusion round = **one figure, up to five masks**, matching `ROUND_SIZE` and the existing
promise: small, finishable, ends by offering the next.

Per mask: show the figure with that one label covered → recall aloud or in your head → reveal →
rate confidence 1–5, exactly as `AtomQuiz` does. Hide-one, not hide-all: hide-all is a harder
mode worth having later behind a toggle, never the default.

Grading is **reveal-and-judge**, not typing. Typing is slow, punishes spelling, and adds friction
at the exact moment attention is scarce. The confidence rating already carries the signal.

Records go to the same calibration log (`stores/calibrationByBlock.js`) with `concept` set to the
label text, so occlusion misses show up in the same accuracy curve and landmine list. No second
scoring system.

## Data model

Masks hang off the figure that already exists on the lecture doc:

```js
images: [{ file, url, kind, shows, context,
           masks: [{ id, box: [x, y, w, h], label, source: "auto" | "hand" }] }]
```

Small enough for Firestore; the JPEG stays in Storage. `source` matters: a hand-corrected mask
must survive a relabel, so a re-run may replace `auto` masks and must never touch `hand` ones.

## Build order

1. **Spike the boxes.** 10 figures, render proposals, judge by eye. Gate — everything else waits.
2. **Extend the label call** to return `labels[]`, defaulting to `[]` so today's path is untouched.
3. **Render + verify** masks in the figure review grid — see the boxes before trusting them.
4. **Occlusion round**: reuse the round shell, swap the question body.
5. **Editing**: drag to move/resize, click to delete, draw to add. Last, deliberately — if the
   proposals are good it may barely be needed.

Steps 1–2 are the risky half; 3–5 are ordinary UI work.

## Open decisions

- Are occlusion rounds a separate button, or interleaved with atom rounds in one lecture?
  Interleaved is better studying and more state to get right.
- Do occlusion misses feed objective mastery the way atom misses do?
- Histology micrographs mostly have **no printed labels**. Occlusion may only apply to diagrams —
  which is fine, but it means "add occlusions" must not appear on figures that cannot support it.

## Do not

- Do not ship an empty editor and call it done because the user "can draw their own".
- Do not put the occlusion editor in the path between picking a folder and studying.
- Do not build a second confidence/grading system.
