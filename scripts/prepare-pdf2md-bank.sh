#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /absolute/path/to/source.pdf [output-directory]" >&2
  exit 2
fi

SOURCE="$1"
OUTDIR="${2:-$(dirname "$SOURCE")/$(basename "$SOURCE" .pdf) - pdf2md}"
mkdir -p "$OUTDIR"

# pdf2md writes its Markdown and page images next to the source. Use a temporary
# copy so the original folder stays untouched, then stage the complete bundle.
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
cp "$SOURCE" "$TMPDIR/source.pdf"
/Users/louismaxwell/.local/bin/pdf2md --mode fast --llm none "$TMPDIR/source.pdf"

MD="$TMPDIR/source/source.md"
if [[ ! -f "$MD" ]]; then
  MD="$(find "$TMPDIR" -type f -name 'source.md' -print -quit)"
fi
[[ -f "$MD" ]] || { echo "pdf2md did not produce source.md" >&2; exit 1; }
cp "$MD" "$OUTDIR/$(basename "$SOURCE" .pdf).md"
find "$(dirname "$MD")" -maxdepth 1 -type f \( -name '*.jpeg' -o -name '*.jpg' -o -name '*.png' \) -exec cp {} "$OUTDIR" \;
printf 'Prepared pdf2md bundle: %s\n' "$OUTDIR"
