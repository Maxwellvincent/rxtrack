#!/usr/bin/env node
// Exercise the production MCQ generator and its separate reasoning review against a lecture PDF.
// Writes a local report only; never records learner answers or uploads lecture documents.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { generateMcqs, auditGeneratedQuestions, normalizeQuestions } from '../src/engine/mcq.js';
import { parseBridgeJSON } from '../src/llmBridge.js';

const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const pdf = option('--pdf', null);
const output = option('--output', '/tmp/rxtrack-question-reasoning-report.json');
if (!pdf) throw new Error('Pass --pdf with an existing lecture PDF.');
const { stdout: lectureText } = await promisify(execFile)('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 8 * 1024 * 1024 });
const objectiveLines = lectureText.split(/\f/).find(page => /Lecture objectives/i.test(page)) || '';
const objectives = [...objectiveLines.matchAll(/(SOM\.[A-Z0-9.]+)\s+([\s\S]*?)(?=SOM\.[A-Z0-9.]+|$)/g)]
  .map((match) => ({ id: match[1], objective: match[2].replace(/\s+/g, ' ').trim() }));
const chosen = process.argv.includes("--all-objectives") ? objectives : objectives.filter(objective => /hydrocephalus|composition.*disease|intracranial pressure/i.test(objective.objective));
if (!chosen.length) throw new Error('No relevant objectives found; provide a PDF with extractable lecture objectives.');
const bridge = process.env.RXT_BRIDGE_URL || 'http://127.0.0.1:4319';
const calls = [];
const rawCalls = [];
const callAIJSON = async (system, prompt, fallback, maxTokens = 7000) => {
  const started = Date.now();
  const response = await fetch(`${bridge}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system, prompt, json: true, maxTokens }), signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`AI bridge returned ${response.status}`);
  const body = await response.json();
  const parsed = parseBridgeJSON(body.text);
  rawCalls.push({ system, parsed });
  await writeFile(`${output}.calls.json`, JSON.stringify(rawCalls, null, 2));
  calls.push({ provider: body.backend || 'existing bridge', elapsedMs: Date.now() - started, review: system.includes('editor') });
  process.stdout.write(`Completed ${system.includes('editor') ? 'review' : 'generation'} call in ${Math.round((Date.now() - started) / 1000)}s\n`);
  return parsed || fallback;
};
const config = { subject: 'NB 06 Transport within the CNS', lectureText,
  objectives: chosen, count: Math.max(1, Number(option("--count", 4)) || 4), difficulty: 'hard', generationVersion: 'v2', requireReasoningAudit: true,
  focusNotes: 'Generate exactly two second-order and two third-order questions. Third-order must integrate two distinct supplied relationships; select an objective permitting integration. Explicitly list the shortest necessary reasoningSteps. Use clinical-application and mechanism tasks with different final asks.',
};
const repairFrom = option('--repair-from', null);
const candidates = repairFrom ? JSON.parse(await readFile(repairFrom, 'utf8')).flatMap(call => (call.parsed?.reviews || []).flatMap(review => review.replacement ? [review.replacement] : [])) : [];
const result = repairFrom
  ? await auditGeneratedQuestions(normalizeQuestions({ questions: candidates }).map(question => ({ ...question, generationVersion: 'v2' })), config, { callAIJSON, auditMaxTokens: 7000, skipRepair: true })
  : await generateMcqs(config, { callAIJSON, maxTokens: 9000, auditMaxTokens: 7000 });
const counts = Object.fromEntries(['first-order', 'second-order', 'third-order'].map(order => [order,
  (result.questions || []).filter(q => q.orderLevel === order && q.reasoningAudit?.status === 'verified').length]));
const report = { sourcePdf: pdf, createdAt: new Date().toISOString(), counts, calls,
  establishedBothOrders: counts['second-order'] > 0 && counts['third-order'] > 0, ...result };
await writeFile(output, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify({ output, counts, establishedBothOrders: report.establishedBothOrders, error: result.error || null })}\n`);
if (!report.establishedBothOrders) process.exitCode = 1;
