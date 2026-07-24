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
