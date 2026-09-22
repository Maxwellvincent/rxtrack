#!/usr/bin/env node
/**
 * Measure one grounded tutor turn, not a whole lecture/question-bank build.
 * This is the latency and evidence gate for the future patient-centered tutor.
 *
 * Usage:
 *   node scripts/run-tutor-turn-benchmark.mjs [--pdf /path/to/lecture.pdf]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { parseBridgeJSON } from "../src/llmBridge.js";

const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const fixturePath = arg("--case", "") === "lecture30"
  ? "benchmarks/lecture30-jaundice-continuity.json"
  : null;
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : null;
const pdf = arg(
  "--pdf",
  fixture?.sourcePdf || "/Users/louismaxwell/Downloads/Medical School/Term 2/DM/Lectures/DM+Lecture+29-Heme+synthesis+and+Porphyrias.pdf",
);
const { stdout: rawText } = await execFileAsync("pdftotext", ["-layout", pdf, "-"], { maxBuffer: 4 * 1024 * 1024 });
const lectureText = rawText.replace(/\s+/g, " ").trim();
const evidence = lectureText.slice(0, 9000);
const prompt = fixture ? `
You are continuing an active patient-centered tutoring session. Do not restart.
The learner already understands the completed concepts below. The latest shaky
concept must be tested once before advancing. Ask exactly one focused question
and wait for the learner; do not provide the answer.
Return ONLY JSON:
{
  "patient": "short retrieval patient",
  "question": "one focused question",
  "objective": "the concept being retrieved",
  "evidence": [{"page": null, "quote": "short supporting phrase"}],
  "scope": "lecture-supported",
  "continuation": true
}

COMPLETED:
${fixture.completed.join("\n- ")}
SHAKY:
${fixture.shaky.join("\n- ")}
RESUME REQUIREMENT:
${fixture.resume.requiredFirstQuestion}
NEXT CONCEPT AFTER RETRIEVAL:
${fixture.resume.nextConceptAfterRetrieval}

LECTURE EVIDENCE:
${evidence}
` : `
You are the patient-centered RXTrack tutor. Use only the supplied lecture evidence.
Do not summarize the lecture. Give one short patient and ask one focused question.
The patient should test a mechanism from heme synthesis or porphyria.
Return ONLY JSON:
{
  "patient": "short vignette",
  "question": "one focused reasoning question",
  "objective": "the objective being tested",
  "evidence": [{"page": null, "quote": "exact short supporting phrase"}],
  "scope": "lecture-supported"
}

LECTURE EVIDENCE:
${evidence}
`;
const started = performance.now();
const response = await fetch("http://127.0.0.1:4319/complete", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    system: "Medical education tutor. Be accurate, concise, and evidence-grounded.",
    prompt,
    json: true,
    maxTokens: 700,
  }),
});
const elapsedMs = Math.round(performance.now() - started);
if (!response.ok) throw new Error(`bridge ${response.status}`);
const body = await response.json();
const result = parseBridgeJSON(body.text);
const text = JSON.stringify(result || {});
const hasShape = Boolean(result?.patient && result?.question && result?.objective && Array.isArray(result?.evidence));
const continuationTerms = fixture ? ["urine", "conjugated", "unconjugated"] : [];
const continuationQuestion = fixture
  ? continuationTerms.filter((term) => `${result?.question || ""} ${result?.patient || ""}`.toLowerCase().includes(term.toLowerCase())).length >= 2
  : true;
const evidenceGrounded = (result?.evidence || []).some((item) => {
  const quote = String(item?.quote || "").trim().toLowerCase();
  return quote.length >= 8 && evidence.toLowerCase().includes(quote);
});
const report = {
  pdf,
  provider: body.backend || "bridge",
  elapsedMs,
  firstVisibleTokenMs: null,
  target: { firstVisibleTokenMs: 2000, completeTurnMs: 25000 },
  withinCompleteTurnTarget: elapsedMs <= 25_000,
  hasExpectedShape: hasShape,
  evidenceGrounded,
  continuationQuestion,
  response: result,
};
console.log(JSON.stringify(report, null, 2));
if (!hasShape || !evidenceGrounded || !continuationQuestion || elapsedMs > 25_000) process.exitCode = 1;
