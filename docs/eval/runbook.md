# Phase 1 Evaluation Runbook

The eval runner runs a fixed prompt suite against selected models and saves results to `eval/` for comparison.

> **Option A (one model at a time):** If your upstream server loads only one .gguf at a time, use the [Phase 1 Option A Runbook](../phase1_optionA_runbook.md). It describes how to swap models between runs and avoid "same model behind different labels" mistakes.

## Prerequisites

- Backend running (`npm run dev` in server/)
- **Before benchmarking, verify [GET /upstream/status](http://localhost:3000/upstream/status) shows the expected upstream model.** If all Phase-1 models share the same `upstream.model_id`, you are testing one model under multiple labels.
- Models available via GET /models (e.g. llama-cpp server running for Phase-1 models)
- Prompt suite at `docs/eval/prompt_suite.json`

## How to Run

From the **server** directory:

```bash
cd server
npm run eval
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVAL_API_BASE_URL` | `http://localhost:3000` | Backend API base URL |

### CLI Options

| Option | Description |
|--------|-------------|
| `--baseUrl <url>` | Override API base URL |
| `--models <list>` | Comma-separated model IDs (default: llama2-7b-instruct only, Option A) |
| `--concurrency <N>` | Max parallel requests (default: 1, sequential) |

## Examples

**Default run (one model: llama2-7b-instruct, for Option A):**
```bash
npm run eval
```

**Run for a specific model (pass the model currently loaded):**
```bash
npm run eval -- --models llama3.1-8b-instruct
```

**Custom base URL:**
```bash
EVAL_API_BASE_URL=http://localhost:8080 npm run eval
```

**Or via CLI:**
```bash
npm run eval -- --baseUrl http://localhost:8080
```

**Evaluate only specific models:**
```bash
npm run eval -- --models llama3.1-8b-instruct,qwen2.5-7b-instruct
```

**Run with concurrency 2 (faster, but may stress local models):**
```bash
npm run eval -- --concurrency 2
```

## Output

- **Directory:** `eval/` (at repo root)
- **File:** `eval/results_<suite_name>_<YYYYMMDD_HHMMSS>.jsonl`
- **Format:** One JSON object per line (JSONL)

Each record includes: `run_id`, `timestamp`, `model`, `prompt_id`, `category`, `prompt`, `system_prompt`, `temperature`, `max_tokens`, `reply`, `latency_ms`, `usage`, `error`, `http_status`.

## Summary

After the run, a summary is printed to stdout:

- Total requests
- Succeeded / failed counts
- Avg latency per model (excluding failures)
- Error counts by error code
