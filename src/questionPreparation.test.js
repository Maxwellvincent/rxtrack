import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./llmBridge.js", () => ({ questionPreparationCapabilities: vi.fn() }));
import { withQuestionAIRouting } from "./engine/mcq.js";
import { questionPreparationCapabilities } from "./llmBridge.js";
import { questionPreparationDeps, questionPreparationStatus, questionPreparationBudget, resetQuestionProviderLimit, QUESTION_PREPARATION_BUDGET_MS } from "./questionPreparation.js";

beforeEach(() => { resetQuestionProviderLimit(); questionPreparationCapabilities.mockResolvedValue({ writer: "ollama-cloud", reviewer: "codex" }); });
afterEach(() => { vi.useRealTimers(); });
it("bounds background time by the number of missing questions", () => {
  expect(questionPreparationBudget(5)).toBe(600000);
  expect(questionPreparationBudget(15)).toBe(675000);
  expect(questionPreparationBudget(20)).toBe(900000);
  expect(questionPreparationBudget(200)).toBe(900000);
  expect(questionPreparationBudget(NaN)).toBe(600000);
  expect(questionPreparationBudget(15, true)).toBe(2700000);
  expect(questionPreparationBudget(20, true)).toBe(3600000);
  expect(questionPreparationBudget(200, true)).toBe(3600000);
});
describe("question preparation routing", () => {
  it("fails promptly instead of silently using local Ollama when the route is unavailable", async () => {
    questionPreparationCapabilities.mockResolvedValue(null);
    const call = vi.fn();
    await expect(questionPreparationDeps(call)).rejects.toThrow("provider route is unavailable");
    expect(call).not.toHaveBeenCalled();
  });
  it("uses Codex for both independent calls while preserving strict routing", async () => {
    const call = vi.fn().mockResolvedValue({});
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft", {}, 8000, undefined, undefined, { timeoutMs: 1234 });
    await deps.reviewAIJSON("system", "review", {}, 8000, undefined, undefined, { timeoutMs: 987 });
    expect(call.mock.calls.every(args => args[6].bridgeBackend === "codex" && args[6].bridgeOnly && args[6].bridgeBackendOnly)).toBe(true);
    expect(deps.reviewBatchSize).toBe(5);
    expect(deps.prepareBatchSize).toBe(5);
    expect(deps.prepareConcurrency).toBe(3);
    expect(deps.releaseVerifiedFirst).toBe(true);
    expect(deps.maxPreparationMs).toBe(QUESTION_PREPARATION_BUDGET_MS);
    expect(QUESTION_PREPARATION_BUDGET_MS).toBe(600000);
  });
  it("switches drafts and subsequent reviews after a real usage limit", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("You've hit your usage limit. Try again in 2 hours")).mockResolvedValue({ ready: true });
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft");
    await deps.reviewAIJSON("system", "review");
    expect(call.mock.calls.map(args => args[6].bridgeBackend)).toEqual(["codex", "ollama-cloud", "ollama-cloud"]);
    expect(call.mock.calls.slice(1).every(args => args[6].bridgeModelTier === "routine")).toBe(true);
  });
  it("falls through on transient provider failures without disguising them as a usage limit", async () => {
    for (const message of ["network failure", "timeout", "invalid JSON"]) {
      const call = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue({questions:[]});
      const deps = await questionPreparationDeps(call);
      await deps.callAIJSON("system", "draft");
      expect(call.mock.calls.map(args=>args[6].bridgeBackend)).toEqual(["codex","ollama-cloud"]);
    }
    const contentFailure = vi.fn().mockRejectedValue(new Error("source review failed"));
    const deps = await questionPreparationDeps(contentFailure);
    await expect(deps.callAIJSON("system", "draft")).rejects.toThrow("source review failed");
    expect(contentFailure).toHaveBeenCalledTimes(1);
  });
  it("preserves the original deadline when switching providers and rechecks Codex later", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const call = vi.fn().mockImplementationOnce(async () => { vi.setSystemTime(1400); throw new Error("Rate limit reached; retry in 2 seconds"); }).mockResolvedValue({});
    const deps = await questionPreparationDeps(call);
    await deps.callAIJSON("system", "draft", {}, 1000, undefined, undefined, { timeoutMs: 1000 });
    expect(call.mock.calls[1][6].timeoutMs).toBe(600);
    vi.setSystemTime(3500);
    await deps.callAIJSON("system", "next draft");
    expect(call.mock.calls[2][6].bridgeBackend).toBe("codex");
  });
});
it("retries one empty cloud reply inside the original deadline", async () => {
  const call = vi.fn().mockRejectedValueOnce(new Error("You've hit your usage limit"))
    .mockRejectedValueOnce(new Error("bridge 502: all backends failed | ollama-cloud: empty reply"))
    .mockResolvedValue({ questions: [] });
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON("system", "draft", {}, 1000, undefined, undefined, { timeoutMs: 10000 });
  expect(call.mock.calls.map(args => args[6].bridgeBackend)).toEqual(["codex", "ollama-cloud", "ollama-cloud"]);
  const next = await questionPreparationDeps(call);
  expect(next.prepareConcurrency).toBe(1);
});

it("shows active writing and independent review without counting them as ready", () => {
  expect(questionPreparationStatus({ diagnostics: { calls: [
    { stage: "draft", status: "running" }, { stage: "review", status: "running" },
    { stage: "draft", status: "complete" },
  ] } })).toBe("Writing 1 batch · Checking 1 batch");
});
it("bounds repeated empty preparation rounds", async () => {
  const deps = await questionPreparationDeps(vi.fn());
  expect(deps.maxEmptyRounds).toBe(3);
});

it("does not repeat a fallback already exhausted by the preparation route",async()=>{
 const call=vi.fn().mockRejectedValueOnce(new Error("Codex usage limit reached")).mockRejectedValue(new Error("Ollama Cloud HTTP 429"));
 const deps=await questionPreparationDeps(call);
 await expect(withQuestionAIRouting(deps.callAIJSON)("system","draft")).rejects.toThrow("Codex usage limit reached. Ollama Cloud HTTP 429");
 expect(call).toHaveBeenCalledTimes(2);
});

it("uses local Ollama after Codex and cloud capacity failures and keeps reviews local", async () => {
  questionPreparationCapabilities.mockResolvedValue({ writer: "codex", reviewer: "codex", fallbackWriter: "ollama-cloud", localWriter: "ollama" });
  const call = vi.fn().mockRejectedValueOnce(new Error("Codex usage limit reached"))
    .mockRejectedValueOnce(new Error("Ollama Cloud HTTP 429"))
    .mockResolvedValue({ questions: [] });
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON("system", "draft");
  await deps.reviewAIJSON("system", "independent review");
  expect(call.mock.calls.map(args => args[6].bridgeBackend)).toEqual(["codex", "ollama-cloud", "ollama", "ollama"]);
  expect(call.mock.calls.every(args => args[6].bridgePurpose === "lecture-questions")).toBe(true);
  const retry = await questionPreparationDeps(call);
  expect(retry.prepareBatchSize).toBe(3);
  expect(retry.reviewBatchSize).toBe(3);
  expect(retry.prepareConcurrency).toBe(1);
});

it("supports an explicitly advertised local-only question bridge", async () => {
  questionPreparationCapabilities.mockResolvedValue({ writer: "ollama", reviewer: "ollama", localWriter: "ollama" });
  const call = vi.fn().mockResolvedValue({});
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON("system", "draft");
  expect(call.mock.calls[0][6].bridgeBackend).toBe("ollama");
  expect(deps.prepareConcurrency).toBe(1);
  expect(deps.parallelIndependentReview).toBe(false);
});

it("shows when local Ollama is processing questions", () => {
  expect(questionPreparationStatus({ diagnostics: { calls: [{ stage: "draft", status: "running", provider: "ollama" }] } }))
    .toBe("Local Ollama · Writing 1 batch");
});

it("shows when DeepSeek is processing questions", () => {
  expect(questionPreparationStatus({ diagnostics: { calls: [{ stage: "review", status: "running", provider: "ollama-cloud", model: "deepseek-v4-pro" }] } }))
    .toBe("DeepSeek · Checking 1 batch");
});

it("prefers the advertised DeepSeek quality tier before routine and escalation cloud fallbacks", async () => {
  questionPreparationCapabilities.mockResolvedValue({
    writer: "codex", reviewer: "codex", fallbackWriter: "ollama-cloud", localWriter: "ollama",
    cloudTiers: [
      { tier: "routine", model: "gemma4:31b" },
      { tier: "escalation", model: "kimi-k3" },
      { tier: "quality", model: "deepseek-v4-pro" },
    ],
  });
  const call = vi.fn()
    .mockRejectedValueOnce(new Error("Codex usage limit reached"))
    .mockRejectedValueOnce(new Error("DeepSeek HTTP 429"))
    .mockRejectedValueOnce(new Error("Gemma HTTP 429"))
    .mockResolvedValue({ questions: [] });
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON("system", "draft");
  expect(call.mock.calls.map(args => args[6].bridgeModelTier)).toEqual([
    undefined, "quality", "routine", "escalation",
  ]);
});

it("tries Kimi before local when the routine cloud tier is limited", async () => {
  questionPreparationCapabilities.mockResolvedValue({ writer: 'codex', reviewer: 'codex', fallbackWriter: 'ollama-cloud', localWriter: 'ollama', cloudTiers: [{tier:'routine',model:'gemma4:31b'},{tier:'escalation',model:'kimi-k3'}] });
  const call = vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached'))
    .mockRejectedValueOnce(new Error('HTTP 429'))
    .mockResolvedValue({questions:[]});
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON('system','draft');
  await deps.reviewAIJSON('system','review');
  expect(call.mock.calls.map(args=>[args[6].bridgeBackend,args[6].bridgeModelTier])).toEqual([
    ['codex',undefined],['ollama-cloud','routine'],['ollama-cloud','escalation'],['ollama-cloud','escalation'],
  ]);
});
it("reaches local after all configured cloud tiers exhaust their allowance", async () => {
  questionPreparationCapabilities.mockResolvedValue({ writer: 'codex', reviewer: 'codex', fallbackWriter: 'ollama-cloud', localWriter: 'ollama', cloudTiers: [{tier:'routine'},{tier:'escalation'},{tier:'quality'}] });
  const call = vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached'))
    .mockRejectedValueOnce(new Error('HTTP 429')).mockRejectedValueOnce(new Error('HTTP 402')).mockRejectedValueOnce(new Error('HTTP 402'))
    .mockResolvedValue({questions:[]});
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON('system','draft');
  await deps.reviewAIJSON('system','review');
  expect(call.mock.calls.map(args=>args[6].bridgeBackend)).toEqual(['codex','ollama-cloud','ollama-cloud','ollama-cloud','ollama','ollama']);
  expect(deps.isLocalPreparation()).toBe(true);
});

it("uses advertised OpenRouter then OpenAI question fallbacks before local Ollama", async () => {
  questionPreparationCapabilities.mockResolvedValue({
    writer: "codex", reviewer: "codex", fallbackWriter: "ollama-cloud", localWriter: "ollama",
    fallbackWriters: ["ollama-cloud", "openrouter", "openai", "ollama"],
  });
  const call = vi.fn()
    .mockRejectedValueOnce(new Error("Codex usage limit reached"))
    .mockRejectedValueOnce(new Error("Ollama Cloud HTTP 429"))
    .mockRejectedValueOnce(new Error("OpenRouter HTTP 429"))
    .mockResolvedValue({ questions: [] });
  const deps = await questionPreparationDeps(call);
  await deps.callAIJSON("system", "draft");
  await deps.reviewAIJSON("system", "review");
  expect(call.mock.calls.map(args => args[6].bridgeBackend)).toEqual([
    "codex", "ollama-cloud", "openrouter", "openai", "openai",
  ]);
});
it('switches to the bounded prompt on the first local fallback and identifies its evidence catalog',async()=>{
 questionPreparationCapabilities.mockResolvedValue({writer:'codex',reviewer:'codex',fallbackWriter:'ollama-cloud',localWriter:'ollama',localModel:'qwen3:8b'});
 const selected=vi.fn();
 const call=vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached')).mockRejectedValueOnce(new Error('Ollama Cloud HTTP 429')).mockResolvedValue({reviews:[]});
 const deps=await questionPreparationDeps(call);
 await deps.reviewAIJSON('system','large cloud catalog',{},1600,undefined,undefined,{localPrompt:'bounded local catalog',onPromptSelected:selected});
 expect(call.mock.calls.map(args=>args[1])).toEqual(['large cloud catalog','large cloud catalog','bounded local catalog']);
 expect(selected).toHaveBeenLastCalledWith('bounded local catalog');
 expect(call.mock.calls[2][6]).not.toHaveProperty('localPrompt');
 vi.useFakeTimers();vi.setSystemTime(Date.now()+61000);
 await deps.callAIJSON('system','next cloud request',{},1600,undefined,undefined,{localPrompt:'next local request'});
 expect(call.mock.calls[3][6].bridgeBackend).toBe('ollama');
 expect(call.mock.calls[3][1]).toBe('next local request');
});
it('uses batched starts and switches the next scheduling wave to the local policy automatically',async()=>{
 questionPreparationCapabilities.mockResolvedValue({writer:'codex',reviewer:'codex',fallbackWriter:'ollama-cloud',localWriter:'ollama'});
 const call=vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached')).mockRejectedValueOnce(new Error('Ollama Cloud HTTP 429')).mockResolvedValue({});
 const deps=await questionPreparationDeps(call);
 expect(deps.preparationPolicy()).toMatchObject({prepareBatchSize:5,starterBatchSize:5,reviewBatchSize:5});
 await deps.callAIJSON('system','prompt');
 expect(deps.preparationPolicy()).toMatchObject({prepareConcurrency:1,prepareBatchSize:3,starterBatchSize:3,reviewBatchSize:3,prepareSpareCandidates:0});
});
it('returns to Codex automatically when the bridge confirms a successful request started after the recorded limit',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);
 questionPreparationCapabilities.mockResolvedValue({writer:'codex',reviewer:'codex',fallbackWriter:'ollama-cloud',localWriter:'ollama'});
 const call=vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached; try again in 2 hours')).mockRejectedValueOnce(new Error('Ollama Cloud HTTP 429')).mockResolvedValue({});
 const first=await questionPreparationDeps(call);await first.callAIJSON('system','draft');
 vi.setSystemTime(2000);
 questionPreparationCapabilities.mockResolvedValue({writer:'codex',reviewer:'codex',fallbackWriter:'ollama-cloud',localWriter:'ollama',codexReadyAt:1500});
 const recovered=await questionPreparationDeps(call);await recovered.callAIJSON('system','new draft');
 expect(call.mock.calls.at(-1)[6].bridgeBackend).toBe('codex');
});
it('does not treat a pre-limit successful request as recovery',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);
 questionPreparationCapabilities.mockResolvedValue({writer:'codex',reviewer:'codex',fallbackWriter:'ollama-cloud',localWriter:'ollama',codexReadyAt:900});
 const call=vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached')).mockRejectedValueOnce(new Error('Ollama Cloud HTTP 429')).mockResolvedValue({});
 const first=await questionPreparationDeps(call);await first.callAIJSON('system','draft');
 const next=await questionPreparationDeps(call);await next.callAIJSON('system','new draft');
 expect(call.mock.calls.at(-1)[6].bridgeBackend).toBe('ollama');
});
it('bounds local output headroom without changing cloud budgets or forwarding internal prompt hints',async()=>{
 questionPreparationCapabilities.mockResolvedValue({writer:'ollama',reviewer:'ollama',localWriter:'ollama'});
 const call=vi.fn().mockResolvedValue({});const deps=await questionPreparationDeps(call);
 await deps.callAIJSON('system','draft',{},8000,undefined,undefined,{localMaxTokens:3000});
 expect(call.mock.calls[0][3]).toBe(3000);expect(call.mock.calls[0][6]).not.toHaveProperty('localMaxTokens');
});
