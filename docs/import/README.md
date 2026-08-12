# Importing lectures, objectives, exams — the `.md` fast path

The four uploaders (**Lecture**, **Question Bank**, **Block Objectives**, **Exam
result**) now accept `.pdf`, `.md`, `.markdown`, `.txt`. A `.md`/`.txt` upload
**skips pdfjs + OCR entirely** — the text feeds the parser directly. This is the
fastest and most reliable path because you verify the text once before it enters
the app; no scanned-PDF / OCR-failure risk.

See **`EXAMPLE-lecture.md`** for the exact shape and inline notes on what the app
keys off (filename → lecture number, SOM table vs. AI list, **bold** → key terms,
`{N}---` page separators).

## Bulk workflow — a folder of lectures across the next few days

The PDF → markdown step is the slow part; everything after is fast. Batch it.

### 1. Convert the whole folder to markdown (one command)

You have the global `pdf2md` tool (marker + LLM cleanup). Run it over the folder:

```bash
# one file
pdf2md "Week1/LEC 12 - Cardiac APs.pdf"

# whole folder (bash)
for f in Week1/*.pdf; do pdf2md "$f"; done
```

```powershell
# whole folder (PowerShell)
Get-ChildItem Week1 -Filter *.pdf | ForEach-Object { pdf2md $_.FullName }
```

marker preserves **bold**, tables, and headings — exactly what objective/key-term
extraction wants. Convert overnight; it is the only slow step.

#### Flags that decide how long it takes

```
pdf2md [--ocr] [--llm claude|ollama|none] [--mode balanced|fast] <file>
```

- **`--ocr`** forces full-page OCR. Leave it off for slide decks and anything
  exported from PowerPoint or Word — those carry a text layer, and marker only
  block-OCRs the garbled parts. Turn it on for scanned or photographed handouts.
- **`--llm`** picks the cleanup pass that repairs tables and section headers.
  Default is `claude` when `ANTHROPIC_API_KEY` is set, else `ollama` when a
  server answers, else `none`.

Rough wall time for one ~12-page PDF on an M-series Mac, models already cached:

| `--llm` | Time | When to use |
| --- | --- | --- |
| `none` | ~30s | Clean digital slides. Batch a whole block this way. |
| `ollama` | ~9 min | Offline, or the deck is table-heavy and you cannot spend API credit. |
| `claude` | in between | Table-heavy decks when the key is set. |

Local cleanup is roughly 18x slower than skipping it, so do not reach for
`--llm ollama` on a whole term's worth of files. Convert the folder with
`--llm none`, skim, and re-run only the decks whose tables came out mangled.

Secrets and overrides live in `~/.config/pdf2md/env` (chmod 600):
`ANTHROPIC_API_KEY`, `PDF2MD_LLM`, `PDF2MD_CLAUDE_MODEL`, `PDF2MD_OLLAMA_MODEL`.

The Ollama backend runs through a local subclass in
`~/.config/pdf2md/pdf2md_services.py`, which works around two upstream marker
bugs: the stock service drops `$defs` from nested response schemas, and it
encodes page images as WEBP, which Ollama's image loader cannot decode. Both are
fixed there rather than in the venv, so a marker upgrade will not undo them.

### 2. Name the files so the app reads the lecture number

`detectLectureNumber()` reads the filename. Keep the OCR tool's name or rename to:

```
LEC 12 - Cardiac Action Potentials.md
SG 3 - Heart Failure Cases.md          # session types: LEC, SG, TBL, DLA, LAB
```

### 3. Skim each `.md` (2–3 min/file)

Confirm the objectives block survived and key terms are bolded. Fix obvious OCR
garble. This is the whole point of `.md` — you catch problems before upload, not
after a silent bad OCR.

### 4. Upload

Open the block → **Add content** → **Lecture PDF** slot → select **all** the
`.md` files at once (the input is `multiple`). They queue and process
sequentially. Objectives extract automatically.

- **Block objectives doc** (the official SOM objectives list) → **Block
  Objectives** slot. Import once per block; lecture objectives align to it.
- **Instructor Q&A decks** → **Question Bank** slot.

### First-week-only shortcut

Convert just `Week1/`, skim, upload. You do not need the whole term done to start
— the block accepts more lectures any time.

## Which slot for which file

| File you have | Slot | Extracted |
| --- | --- | --- |
| Lecture slides | **Lecture PDF** | text + objectives + bold key terms |
| Official block objectives list | **Block Objectives** | imported objective master list (aligns lectures) |
| Instructor practice Q&A | **Question Bank** | questions → testable facts pinned to matched lecture |
| Graded exam feedback | **Exam result** | weak-area topics |
