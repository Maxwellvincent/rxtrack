#!/usr/bin/env node
// Runs the real draft/audit/repair engine against a private lecture fixture.
// Does not save questions or learner progress into the app.
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { generateMcqs, auditGeneratedQuestions } from "../src/engine/mcq.js";
import { parseBridgeJSON } from "../src/llmBridge.js";

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const fixture = option("--fixture", "");
if (!fixture) throw new Error("Use --fixture <private generation config JSON> --output <report JSON>");
const cfg = JSON.parse(await readFile(fixture, "utf8"));
const output = option("--output", "/tmp/rxtrack-generation-benchmark.json");
// Stay local unless the caller deliberately opts into the bridge (whose
// configured fallback may send content to an external subscription provider).
const direct = !process.argv.includes("--bridge");
const calls = [];
const started = performance.now();
const budget = Number(option("--budget-ms", "240000"));
const callAIJSON = async (system, prompt, fallback, maxTokens, _provider, _temperature, options = {}) => {
  const stage = /Independently audit/.test(prompt) ? "review" : /^Repair every/.test(prompt) ? "repair" : "draft";
  const timing = { stage, promptChars: prompt.length, maxTokens };
  calls.push(timing);
  const start = performance.now();
  console.log(JSON.stringify({ event: "started", ...timing }));
  try {
    const remaining = budget - (performance.now() - started);
    if (remaining <= 0) throw new Error("Benchmark preparation time budget exhausted");
    const request = direct ? {
      model: option("--model", "qwen2.5:7b"),
      prompt: `${system}\n\nReply with ONLY valid JSON. No markdown fence, no commentary.\n\n${prompt}`,
      format: "json", stream: false, think: false, keep_alive: "10m",
      options: { num_ctx: 8192, temperature: 0.35, num_predict: maxTokens },
    } : { system, prompt, json: true, maxTokens, backend: option("--backend", options.bridgeBackend || "ollama") };
    const response = await fetch(direct ? "http://localhost:11434/api/generate" : "http://127.0.0.1:4319/complete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(remaining))),
    });
    if (!response.ok) throw new Error(`Local provider HTTP ${response.status}`);
    const body = await response.json();
    const raw = direct ? body.response : body.text;
    Object.assign(timing, {
      backend: direct ? request.model : body.backend, responseChars: raw?.length || 0,
      promptTokens: body.prompt_eval_count, outputTokens: body.eval_count,
      promptSeconds: body.prompt_eval_duration / 1e9, outputSeconds: body.eval_duration / 1e9,
      doneReason: body.done_reason,
    });
    const result = parseBridgeJSON(raw);
    timing.result = result;
    if (!result) throw new Error("Malformed JSON response");
    return result;
  } catch (error) {
    timing.error = error.message;
    throw error;
  } finally {
    timing.seconds = Math.round((performance.now() - start) / 100) / 10;
    console.log(JSON.stringify({ event: "finished", ...timing, result: undefined }));
    await writeFile(output, JSON.stringify({ calls, elapsedSeconds: (performance.now() - started) / 1000 }, null, 2));
  }
};
const reviewFile = option("--review-only", "");
const draft = reviewFile ? JSON.parse(await readFile(reviewFile, "utf8")) : null;
const questions = draft?.calls?.find(call => call.stage === "draft")?.result?.questions;
const cachedReviewFile = option("--repair-from", "");
const cachedReviews = cachedReviewFile ? JSON.parse(await readFile(cachedReviewFile, "utf8")).calls.filter(call => call.stage === "review") : [];
let cachedIndex = 0;
const reviewAIJSON = cachedReviewFile ? (...params) => {
  if (cachedIndex < cachedReviews.length) return Promise.resolve(cachedReviews[cachedIndex++].result);
  return callAIJSON(...params);
} : callAIJSON;
const result = reviewFile
  ? await auditGeneratedQuestions(questions || [], { ...cfg, promptProfile: "compact" }, { callAIJSON, reviewAIJSON, skipRepair: !cachedReviewFile })
  : await generateMcqs(cfg, { callAIJSON });
const report = { requested: cfg.count, accepted: result.questions?.length || 0, elapsedSeconds: (performance.now() - started) / 1000, result, calls };
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ requested: report.requested, accepted: report.accepted, seconds: Math.round(report.elapsedSeconds), error: result.error, output }));
