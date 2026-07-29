"""Fast PDF -> markdown for decks that already have a text layer.

Marker renders layout models over every page: ~7 minutes for a 44-page deck on a
GTX 1060, so a 24-lecture folder is nearly three hours. pdftext (same authors,
already a marker dependency) reads the existing text layer instead: 0.4 seconds
for that same deck, and on a real Endocrine lecture it recovered the identical 13
SOM objective codes marker did.

So: use this when the PDFs have a text layer (check first with --probe), and keep
marker for scanned decks, where there is no text layer to read and the layout
models are the only way in.

What you give up versus marker: headings, bold spans, tables and extracted slide
images. What you keep: all the text, which is what objective extraction reads.

Usage:
  python fast_md.py --probe  "D:\\Lectures\\Endocrine"
  python fast_md.py          "D:\\Lectures\\Endocrine"
  python fast_md.py          "D:\\A" "D:\\B" --out "D:\\md"
"""
import argparse
import os
import sys
import time
from glob import glob

import pypdfium2 as pdfium
from pdftext.extraction import plain_text_output

# Below this many characters per page, the text layer is not worth reading and
# the deck needs real OCR.
THIN_CHARS_PER_PAGE = 120


def probe(path, sample_pages=12):
    """Characters per page from the existing text layer, without converting."""
    doc = pdfium.PdfDocument(path)
    try:
        pages = len(doc)
        sample = min(pages, sample_pages)
        chars = sum(len(doc[i].get_textpage().get_text_bounded() or "") for i in range(sample))
        return pages, chars // max(1, sample)
    finally:
        doc.close()


def convert(path, out_dir):
    text = plain_text_output(path, sort=True)
    name = os.path.splitext(os.path.basename(path))[0]
    dest = os.path.join(out_dir, name + ".md")
    with open(dest, "w", encoding="utf-8") as fh:
        # A title line so the markdown chunker has a heading to split on; the
        # app reads type/number/title from the filename regardless.
        fh.write("# " + name + "\n\n" + text)
    return dest, len(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folders", nargs="+")
    ap.add_argument("--out", default=None, help="output dir (default: beside the PDFs)")
    ap.add_argument("--probe", action="store_true", help="report text layers, convert nothing")
    args = ap.parse_args()

    total, converted, needs_ocr = 0, 0, []
    started = time.time()

    for folder in args.folders:
        pdfs = sorted(glob(os.path.join(folder, "*.pdf")))
        if not pdfs:
            print(f"no PDFs in {folder}")
            continue
        out_dir = args.out or folder
        os.makedirs(out_dir, exist_ok=True)
        print(f"\n=== {folder} - {len(pdfs)} PDFs ===")

        for pdf in pdfs:
            total += 1
            name = os.path.basename(pdf)
            try:
                pages, per_page = probe(pdf)
            except Exception as e:  # a corrupt file should not stop the folder
                print(f"  SKIP  {name}: {e}")
                continue

            if per_page < THIN_CHARS_PER_PAGE:
                needs_ocr.append(name)
                print(f"  OCR   {name} ({per_page} chars/page, {pages}p) - needs marker -ForceOcr")
                continue
            if args.probe:
                print(f"  ok    {name} ({per_page} chars/page, {pages}p)")
                continue

            try:
                dest, chars = convert(pdf, out_dir)
                converted += 1
                print(f"  {chars:>7,} chars  {os.path.basename(dest)}")
            except Exception as e:
                print(f"  FAIL  {name}: {e}")

    secs = round(time.time() - started, 1)
    print(f"\n{converted}/{total} converted in {secs}s")
    if needs_ocr:
        print(f"{len(needs_ocr)} need real OCR (run those through pdf2md -ForceOcr):")
        for n in needs_ocr:
            print("  " + n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
