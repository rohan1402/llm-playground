# API Contract

## POST /chat
Request:
{
  "model": "string",
  "messages": [{"role":"system"|"user"|"assistant","content":"string"}],
  "temperature": number (optional, default 0.2),
  "max_tokens": number (optional, default 512)
}

Response:
{
  "request_id": "string",
  "model": "string",
  "reply": "string",
  "latency_ms": number,
  "usage": { "prompt_tokens": number|null, "completion_tokens": number|null, "total_tokens": number|null },
  "error": { "message": "string", "code": "string" } | null
}
