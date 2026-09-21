#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { extractTypedHighYield } from "../src/engine/extractHighYield.js";
import { generateFromAtoms } from "../src/engine/mcq.js";
import { scoreLectureAtoms, scoreQuestionUsage } from "../src/engine/lectureBenchmark.js";
import { parseBridgeJSON } from "../src/llmBridge.js";

const execFileAsync = promisify(execFile);
const pdf = "/Users/louismaxwell/Downloads/Medical School/Term 2/DM/Lectures/DM+Lecture+29-Heme+synthesis+and+Porphyrias.pdf";
const gold = JSON.parse(await readFile("benchmarks/heme-porphyrias.gold.json", "utf8"));
const objectiveText = {
  "1267": "Explain the significance and stepwise pathway of heme synthesis from glycine and succinyl-CoA to heme.",
  "1268": "Differentiate the regulation of heme synthesis in the liver and erythroid cells.",
  "1269": "Describe ALA synthase and evaluate pyridoxine deficiency effects on heme synthesis.",
  "1270": "Describe ALA dehydratase and evaluate the effects of lead poisoning.",
  "1271": "Classify porphyrias by photosensitivity, abdominal pain, and neuropsychiatric features.",
  "1272": "Describe the metabolic basis, deficient enzyme, and accumulated metabolites in acute intermittent porphyria.",
  "1273": "Discuss the molecular basis for hemin treatment of acute intermittent porphyria.",
  "1274": "Explain why phenobarbital should be avoided in acute intermittent porphyria.",
  "1275": "Describe congenital erythropoietic porphyria clinical and laboratory findings.",
  "1276": "Explain porphyria cutanea tarda clinical and laboratory findings.",
};
const objectives = Object.entries(objectiveText).map(([suffix, text]) => ({
  id: `SOM.MK.I.BPM2.3.DM.2.BCHM.${suffix}`,
  code: `SOM.MK.I.BPM2.3.DM.2.BCHM.${suffix}`,
  objective: text,
}));

async function callAIJSON(system, prompt, fallback, maxTokens = 8000) {
  const response = await fetch("http://127.0.0.1:4319/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, prompt, json: true, maxTokens }),
  });
  if (!response.ok) throw new Error(`bridge ${response.status}`);
  const body = await response.json();
  return parseBridgeJSON(body.text) || fallback;
}

const { stdout: lectureText } = await execFileAsync("pdftotext", ["-layout", pdf, "-"], { maxBuffer: 4 * 1024 * 1024 });
console.log(`Source: ${pdf}`);
console.log(`Lecture text: ${lectureText.length.toLocaleString()} characters`);

const extraction = await extractTypedHighYield(lectureText, {
  lectureTitle: "DM 29 — Heme Synthesis and Porphyrias",
  lectureType: "LEC",
  objectives,
  slideObjectiveCodes: objectives.map((objective) => objective.code),
}, { callAIJSON, timeoutMs: 600_000, bridgeTimeoutMs: 300_000, maxTokens: 5000 });
if (extraction.error) throw new Error(`Extraction failed: ${extraction.error}`);
console.log(`Atoms extracted: ${extraction.atoms.length}`);

const generated = await generateFromAtoms({
  atoms: extraction.atoms,
  objectives,
  lectureText,
  subject: "Heme Synthesis and Porphyrias",
  difficulty: "medium",
  count: extraction.atoms.length,
}, { callAIJSON, skipQuestionAudit: true, maxTokens: 12000 });
if (generated.error) throw new Error(`Question generation failed: ${generated.error}`);
console.log(`Questions generated: ${generated.questions.length}`);

const extractionScore = scoreLectureAtoms({ atoms: extraction.atoms, gold: gold.facts, objectives });
const questionScore = scoreQuestionUsage({ questions: generated.questions, gold: gold.facts });
const report = {
  lecture: gold.lecture,
  sourceCharacters: lectureText.length,
  atoms: extraction.atoms.length,
  questions: generated.questions.length,
  extraction: {
    coreRecall: extractionScore.coreRecall,
    detailRecall: extractionScore.detailRecall,
    objectiveCoverage: extractionScore.objectiveCoverage,
    rows: extractionScore.rows,
  },
  questionUsage: {
    coverage: questionScore.coverage,
    detailUseRate: questionScore.detailUseRate,
    rows: questionScore.rows,
  },
};
await writeFile("/private/tmp/rxtrack-heme-atoms.json", JSON.stringify(extraction.atoms, null, 2));
await writeFile("/private/tmp/rxtrack-heme-questions.json", JSON.stringify(generated.questions, null, 2));
await writeFile("/private/tmp/rxtrack-heme-benchmark.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
