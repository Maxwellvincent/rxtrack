#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: ocr-pdf.mjs input.pdf output.txt");

const dir = mkdtempSync(join(tmpdir(), "rxtrack-ocr-"));
try {
  const prefix = join(dir, "page");
  execFileSync("pdftoppm", ["-png", "-r", "180", input, prefix], { stdio: "inherit" });
  const images = readdirSync(dir).filter((name) => name.endsWith(".png")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const pages = images.map((name, index) => {
    const base = join(dir, `ocr-${index + 1}`);
    execFileSync("tesseract", [join(dir, name), base, "--psm", "3"], { stdio: ["ignore", "ignore", "inherit"] });
    process.stderr.write(`OCR ${index + 1}/${images.length}\r`);
    return readFileSync(`${base}.txt`, "utf8").trim();
  });
  writeFileSync(output, pages.join("\n\f\n"));
  process.stderr.write(`\nWrote ${pages.length} OCR pages to ${output}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
