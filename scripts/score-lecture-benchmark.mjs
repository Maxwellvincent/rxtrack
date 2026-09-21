#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { scoreLectureAtoms, scoreQuestionUsage } from "../src/engine/lectureBenchmark.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function load(path, fallback) {
  if (!path) return fallback;
  const value = JSON.parse(await readFile(path, "utf8"));
  return value?.questions || value?.atoms || value;
}

const goldPath = arg("--gold") || "benchmarks/heme-porphyrias.gold.json";
const atomsPath = arg("--atoms");
const questionsPath = arg("--questions");
if (!atomsPath) {
  console.error("Usage: node scripts/score-lecture-benchmark.mjs --atoms atoms.json [--questions questions.json] [--gold ledger.json]");
  process.exit(2);
}

const gold = JSON.parse(await readFile(goldPath, "utf8"));
const atoms = await load(atomsPath, []);
const questions = await load(questionsPath, []);
const objectives = [...new Map(gold.facts.flatMap((fact) => (fact.objectiveIds || []).map((id) => [id, { id }])))].map(([, value]) => value);
const extraction = scoreLectureAtoms({ atoms, gold: gold.facts, objectives });
const report = {
  lecture: gold.lecture,
  extraction: {
    goldFacts: extraction.goldCount,
    capturedFacts: extraction.capturedCount,
    coreRecall: extraction.coreRecall,
    detailRecall: extraction.detailRecall,
    objectiveCoverage: extraction.objectiveCoverage,
  },
};
if (questionsPath) report.questions = scoreQuestionUsage({ questions, gold: gold.facts });
console.log(JSON.stringify(report, null, 2));
