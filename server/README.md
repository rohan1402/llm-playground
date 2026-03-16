# LLM Playground Server

Node + Express + TypeScript backend with pluggable LLM adapters.

## Running

```bash
cd server
npm install
npm run dev
```

Default port: 8080 (override with `PORT`).

## Phase-1 Models (Option A)

The backend exposes four Phase-1 models via `GET /models`:

- `llama3.1-8b-instruct`
- `qwen2.5-7b-instruct`
- `mistral-7b-instruct`
- `phi-3.5-mini-instruct`

All four entries share the same OpenAI-compatible upstream (`LLAMA_CPP_BASE_URL`).  
With **Option A**, you run **one** llama.cpp / llama-cpp-python server at a time with a selected GGUF; the backend model name is used for logging and comparison labels only.

### Upstream llama.cpp server

Set `LLAMA_CPP_BASE_URL` to your local server's base URL. The adapter calls:

```text
POST {LLAMA_CPP_BASE_URL}/v1/chat/completions
```

**Example `.env`:**

```env
LLAMA_CPP_BASE_URL=http://localhost:8082
LLAMA_CPP_TIMEOUT_MS=60000
```

**Example curl** (backend running on port 8080):

```bash
curl -X POST http://localhost:8080/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1-8b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

If `LLAMA_CPP_BASE_URL` is not set or unreachable, requests to these models return HTTP 500 with an appropriate error code (e.g. `LLAMA_CPP_NOT_CONFIGURED`).

### Manual Test Checklist (Phase-1)

1. **Start upstream with Mistral GGUF** on port 8082:
   ```bash
   python3 -m llama_cpp.server \
     --model /path/to/mistral-7b-instruct.Q4_K_M.gguf \
     --host 0.0.0.0 \
     --port 8082
   ```
2. **Start backend + frontend**:
   ```bash
   cd server && npm run dev
   # in another terminal
   cd web && npm run dev
   ```
3. **In the UI** (http://localhost:5173):
   - Select `mistral-7b-instruct` in the model dropdown.
   - Send a simple message (e.g. “Hello Mistral”).
4. **Verify response and metrics**:
   - UI shows a valid reply.
   - Latency and token usage (if available) are displayed.
5. **Verify audit log**:
   - Open `server/logs/chat.jsonl`.
   - Confirm the latest entry has `model: "mistral-7b-instruct"` and appropriate `requested_model` / `upstream_model_sent`.
6. **Repeat for Phi-3.5**:
   - Restart llama.cpp with a Phi-3.5 Mini Instruct GGUF.
   - Select `phi-3.5-mini-instruct` in the UI.
   - Send a message and confirm the same checks as above.
