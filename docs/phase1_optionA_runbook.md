# Phase 1 Option A: One Model at a Time

This runbook describes the **sequential benchmarking workflow** for Phase-1 models. One upstream server runs on one port and loads **one .gguf file at a time**. To evaluate a different model, you stop the upstream server, start it with a new .gguf, then run the eval for that model only.

**Why Option A?** Prevents "false comparisons" where labels change (llama2 vs llama3.1) but the upstream model stays the same. Each eval run targets exactly the model currently loaded.

---

## Standard Evaluation Settings

| Setting | Value |
|---------|-------|
| Temperature | 0.2 |
| Max tokens | 512 |
| System prompt | `You are a helpful assistant. If you are unsure or lack information, say "I don't know" clearly.` |

These are defined in `docs/eval/prompt_suite.json` and used by the eval runner.

---

## GGUF File Placeholders

| Model ID | GGUF filename (example) |
|----------|-------------------------|
| llama3.1-8b-instruct | `Llama-3.1-8B-Instruct-GGUF/Llama-3.1-8B-Instruct-Q4_K_M.gguf` |
| qwen2.5-7b-instruct | `Qwen2.5-7B-Instruct-GGUF/qwen2.5-7b-instruct-q4_k_m.gguf` |
| mistral-7b-instruct | `Mistral-7B-Instruct-GGUF/mistral-7b-instruct.Q4_K_M.gguf` |
| phi-3.5-mini-instruct | `Phi-3.5-Mini-Instruct-GGUF/phi-3.5-mini-instruct.Q4_K_M.gguf` |

Replace with your actual paths. Different quantization suffixes (Q4_K_M, Q5_K_M, etc.) are fine.

---

## Procedure for Each Model Run

### 1. Stop the upstream server

- If using `llama-cpp-python`: Ctrl+C the process.
- If using `llama.cpp` server: stop the process.

### 2. Start upstream with the target GGUF

**llama-cpp-python** (OpenAI-compatible server):

```bash
# Example: llama3.1-8b-instruct
python -m llama_cpp.server \
  --model /path/to/Llama-3.1-8B-Instruct-GGUF/Llama-3.1-8B-Instruct-Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8082

# Example: qwen2.5-7b-instruct
python -m llama_cpp.server \
  --model /path/to/Qwen2.5-7B-Instruct-GGUF/qwen2.5-7b-instruct-q4_k_m.gguf \
  --host 0.0.0.0 \
  --port 8082

# Example: mistral-7b-instruct
python -m llama_cpp.server \
  --model /path/to/Mistral-7B-Instruct-GGUF/mistral-7b-instruct.Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8082

# Example: phi-3.5-mini-instruct
python -m llama_cpp.server \
  --model /path/to/Phi-3.5-Mini-Instruct-GGUF/phi-3.5-mini-instruct.Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8082
```

**llama.cpp server** (if using the standalone server binary):

```bash
# Example: llama3.1-8b-instruct
./llama-server \
  -m /path/to/Llama-3.1-8B-Instruct-GGUF/Llama-3.1-8B-Instruct-Q4_K_M.gguf \
  -c 2048 \
  --port 8082
```

Ensure `.env` has `LLAMA_CPP_BASE_URL=http://localhost:8082` (or the port you use).

### 3. Verify upstream via GET /upstream/status

```bash
curl http://localhost:3000/upstream/status
```

Expected (reachable):

```json
{
  "baseUrl": "http://localhost:8082",
  "reachable": true,
  "latency_ms": 5,
  "upstream": {
    "model_id": "llama-2-7b-instruct.Q4_K_M.gguf",
    "raw": { ... }
  },
  "error": null
}
```

- `reachable` must be `true`.
- `upstream.model_id` shows the model the server reports (often the GGUF filename). **Confirm it matches the model you intended to load.**

### 4. Run the eval runner (for this model only)

From the **server** directory:

```bash
cd server

# Default runs only llama3.1-8b-instruct. Pass --models for the model you loaded:
npm run eval                                      # when llama3.1 is loaded
npm run eval -- --models qwen2.5-7b-instruct      # when qwen is loaded
npm run eval -- --models mistral-7b-instruct      # when mistral is loaded
npm run eval -- --models phi-3.5-mini-instruct    # when phi-3.5 mini is loaded
```

**Important:** Always pass `--models <single-model>` matching the loaded GGUF. The default is `llama3.1-8b-instruct` only; do not run eval with multiple models while one GGUF is loaded.

### 5. Save results

Results are written to `eval/results_<suite>_<timestamp>.jsonl`. Optionally rename or copy to keep a clear history:

```bash
cp eval/results_phase1_prompt_suite_v1_20260208_123456.jsonl eval/results_llama2-7b-instruct.jsonl
```

---

## Checklist: Before You Trust Results

- [ ] **Upstream verified:** `GET /upstream/status` returned `reachable: true` before the eval.
- [ ] **Model ID matches:** `upstream.model_id` in the response corresponds to the GGUF you loaded (e.g. filename or similar).
- [ ] **Single-model eval:** You ran `npm run eval -- --models <model-id>` for the model that was loaded, not all four at once.
- [ ] **Logs confirm:** `server/logs/chat.jsonl` includes `requested_model`, `upstream_base_url`, `upstream_model_sent` for each request. If `requested_model` and `upstream_model_sent` differ from the actual loaded model, investigate.

---

## How This Prevents "Same Model Behind Different Labels"

1. **One GGUF per run:** You physically swap the model file between runs. There is no way for "llama2" and "llama3.1" to be the same model in the same run.
2. **`/upstream/status` identity check:** Before each eval, you verify which model the upstream server reports. If it still shows the previous model, you know you need to restart with the correct GGUF.
3. **Single-model eval:** Running `--models llama3.1-8b-instruct` when only llama3.1 is loaded ensures all results in that file are from that model. No mixing.
4. **Audit logs:** `logs/chat.jsonl` persists `requested_model` and `upstream_model_sent` for every request, so you can audit later whether the labels matched the actual upstream model.

---

## See Also

- [Phase 1 Evaluation Runbook](eval/runbook.md) – Full eval configuration and CLI options.
