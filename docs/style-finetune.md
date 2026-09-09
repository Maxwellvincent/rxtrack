# SGU style-specialist model

RXTrack now supports a conservative feedback loop for style learning. The app's prompt feedback improves immediately; model-weight learning is periodic and local-only.

## Build training data

Export reviewed ExamSoft/IMCQ questions (plus optional ratings) as JSON or JSONL, then run:

```bash
node scripts/build-style-dataset.mjs questions.json tmp/style-training.jsonl
```

The builder excludes homework, unrated/failed items, and non-ExamSoft/IMCQ sources. It preserves the question-writing pattern while keeping lecture facts separate from style references.

## Fine-tune locally

Use the resulting JSONL with a LoRA/QLoRA trainer (Unsloth, Axolotl, or MLX) on a local base model. Export/quantize the adapter to an Ollama model, for example:

```bash
ollama create rxtrack-sgu-style -f Modelfile
```

Then point the bridge at it:

```bash
launchctl setenv LLM_BRIDGE_OLLAMA_TEXT rxtrack-sgu-style
uid=$(id -u); launchctl kickstart -k gui/$uid/com.louis.llm-bridge
```

Keep the independent reviewer enabled. Fine-tuning teaches writing style; it does not certify medical correctness.
