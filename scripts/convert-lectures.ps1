# convert-lectures.ps1 - batch-convert lecture folders to markdown with pdf2md.
#
# pdf2md already takes a directory (it switches marker into batch mode); this
# wraps it for several folders at once and, more usefully, tells you afterwards
# which decks came out suspiciously thin. That is the signature of a scanned,
# image-only PDF whose text layer is empty, and those are the ones worth a
# second pass with -ForceOcr.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless the
# file has a BOM, so a stray unicode arrow breaks the parser.
#
# Usage:
#   .\scripts\convert-lectures.ps1 -Folders "D:\Endocrine","D:\Neuro"
#   .\scripts\convert-lectures.ps1 -Folders "D:\Scanned" -ForceOcr
#   .\scripts\convert-lectures.ps1 -Folders "D:\Endocrine" -WhatIfOnly   # report only
#
# Output lands beside each source PDF (pdf2md's default), so the .md files sit
# in the same folder you point the app's Folder import at.

param(
    [Parameter(Mandatory = $true)][string[]]$Folders,
    [switch]$ForceOcr,
    [switch]$WhatIfOnly,
    # Marker writes each result into its own subfolder alongside the extracted
    # images. Copy the .md files up so the app's folder import is one
    # multi-select instead of a trip through 24 subfolders.
    [switch]$NoFlatten,
    # A markdown file smaller than this almost certainly means no text layer.
    [int]$ThinKb = 3
)

function Copy-MarkdownUp($folder) {
    $moved = 0
    foreach ($dir in Get-ChildItem -LiteralPath $folder -Directory -ErrorAction SilentlyContinue) {
        $md = Get-ChildItem -LiteralPath $dir.FullName -Filter *.md -File -ErrorAction SilentlyContinue |
              Sort-Object Length -Descending | Select-Object -First 1
        if (-not $md) { continue }
        $dest = Join-Path $folder ($dir.Name + ".md")
        if (Test-Path -LiteralPath $dest) { continue }
        Copy-Item -LiteralPath $md.FullName -Destination $dest
        $moved++
    }
    return $moved
}

$ErrorActionPreference = 'Continue'

function Get-Pdfs($folder) { Get-ChildItem -LiteralPath $folder -Filter *.pdf -File -ErrorAction SilentlyContinue }
function Get-Mds($folder) { Get-ChildItem -LiteralPath $folder -Filter *.md -File -Recurse -ErrorAction SilentlyContinue }

$report = @()

foreach ($folder in $Folders) {
    if (-not (Test-Path -LiteralPath $folder)) {
        Write-Host "MISSING  $folder" -ForegroundColor Red
        continue
    }

    $pdfs = Get-Pdfs $folder
    Write-Host ""
    Write-Host "=== $folder - $($pdfs.Count) PDFs ===" -ForegroundColor Cyan

    if ($WhatIfOnly) {
        $pdfs | ForEach-Object { "  " + [math]::Round($_.Length / 1MB, 1) + " MB  " + $_.Name }
        continue
    }

    $started = Get-Date
    if ($ForceOcr) { pdf2md $folder none -ForceOcr } else { pdf2md $folder }
    $elapsed = (Get-Date) - $started

    if (-not $NoFlatten) {
        $flattened = Copy-MarkdownUp $folder
        if ($flattened -gt 0) { Write-Host "  flattened $flattened markdown files into the folder root" }
    }

    # Only the top level now: the flattened copies are the ones to import.
    $mds = Get-ChildItem -LiteralPath $folder -Filter *.md -File -ErrorAction SilentlyContinue
    $thin = $mds | Where-Object { $_.Length -lt ($ThinKb * 1KB) }
    $mins = [math]::Round($elapsed.TotalMinutes, 1)

    Write-Host "  done in $mins min - $($pdfs.Count) PDFs, $($mds.Count) markdown files" -ForegroundColor Green
    if ($pdfs.Count -ne $mds.Count) {
        Write-Host "  WARNING: $($pdfs.Count) PDFs but $($mds.Count) .md - some decks did not convert" -ForegroundColor Yellow
    }
    if ($thin.Count -gt 0) {
        Write-Host "  $($thin.Count) look image-only (under $ThinKb KB of text) - rerun those with -ForceOcr:" -ForegroundColor Yellow
        $thin | ForEach-Object { "    " + $_.Name }
    }

    $report += [pscustomobject]@{
        Folder   = $folder
        Pdfs     = $pdfs.Count
        Markdown = $mds.Count
        Thin     = $thin.Count
        Minutes  = $mins
    }
}

if ($report.Count -gt 0) {
    Write-Host ""
    Write-Host "=== summary ===" -ForegroundColor Cyan
    $report | Format-Table -AutoSize
    Write-Host "Next: open the block in the app, then use the Folder button in the header"
    Write-Host "and select that folder's .md files."
}
