#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: extract-natalie-supplemental.mjs input.pdf output.md");

const dir = mkdtempSync(join(tmpdir(), "rxtrack-natalie-"));
const textPath = join(dir, "deck.txt");
try {
  execFileSync("pdftotext", ["-layout", input, textPath]);
  const pages = readFileSync(textPath, "utf8").split("\f");
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const signature = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const answerFor = (answerPage, choices) => {
    const text = normalize(answerPage);
    const explicit = text.match(/correct\s+answer\s*=\s*([A-H])\b/i)
      || text.match(/\b([A-H])\s*-\s*correct\s+answer\b/i)
      || text.match(/^([A-H])[.)]?\s+rationale\s*:/i)
      || text.match(/(?:^|\s)([A-H])\s*$/i);
    if (explicit?.[1] && choices[explicit[1].toUpperCase()]) return explicit[1].toUpperCase();
    const leading = text.match(/^([A-H])[.)]?\s+(.{2,120})/i);
    if (leading?.[1]) {
      const letter = leading[1].toUpperCase();
      const choice = signature(choices[letter]);
      const answerLead = signature(leading[2]);
      if (choice && (answerLead.startsWith(choice.slice(0, 28)) || choice.startsWith(answerLead.slice(0, 28)))) return letter;
    }
    return null;
  };
  const extracted = [];
  const seen = new Set();
  for (let pageIndex = 0; pageIndex < pages.length - 1; pageIndex++) {
    const text = normalize(pages[pageIndex]);
    // A Markdown derivative cannot faithfully preserve a visual prompt. Keep those slides out
    // instead of inventing a complete-looking question without its required image.
    if (!text || /(?:\bfigure\b|\bfig\.|\bimage\b|\bshown\b|\barrow\b|\blabel(?:ed|led|s|ing)?\b|\bidentify the organ\b|\bhistological slide\b|\bCT scan\b)/i.test(text)) continue;
    const markers = [...text.matchAll(/(?:^|\s)([A-H])[.)]\s+/g)];
    const letters = [...new Set(markers.map((match) => match[1].toUpperCase()))];
    if (letters.length < 3 || letters.length > 8 || !markers.length) continue;
    const firstChoice = markers[0].index || 0;
    const stem = normalize(text.slice(0, firstChoice));
    if (stem.length < 40 || (!stem.includes("?") && !/\bwhich\b/i.test(stem))) continue;
    const choices = {};
    markers.forEach((marker, index) => {
      const start = (marker.index || 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? text.length;
      choices[marker[1].toUpperCase()] = normalize(text.slice(start, end))
        .split(/\bFollow-up question\s*:/i)[0]
        .trim();
    });
    const correct = answerFor(pages[pageIndex + 1], choices);
    if (!correct) continue;
    const key = signature(stem);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let explanation = normalize(pages[pageIndex + 1]);
    if (explanation.length > 900) explanation = `${explanation.slice(0, 900).trim()}...`;
    extracted.push({ stem, choices, correct, explanation, sourcePage: pageIndex + 1 });
  }

  const questions = extracted.map((question, index) => {
    const choices = Object.entries(question.choices).map(([letter, value]) => `${letter}. ${value}`).join("\n");
    return `${index + 1}. ${question.stem}\n${choices}`;
  }).join("\n\n");
  const answers = extracted.map((question, index) => `Q${index + 1}: ${question.correct} - Source slide ${question.sourcePage}. ${question.explanation}`).join("\n");
  writeFileSync(output, `# Natalie Cumulative PLG - verified supplemental questions\n\n${questions}\n\nAnswer Key\n${answers}\n`);
  console.log(JSON.stringify({ pages: pages.length - 1, questions: extracted.length, sourcePages: extracted.map((item) => item.sourcePage) }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
