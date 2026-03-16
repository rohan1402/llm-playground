# LLM Playground (Phase 0)

Goal: A chat UI to compare multiple LLMs under identical conditions.

Scope:
- Express + TypeScript backend with /health and /chat
- Pluggable LLM adapter interface + registry
- React + Vite frontend with chat + model dropdown + settings (temperature/max tokens)
- Basic metrics: latency, token usage if available
- Logging: append JSONL per request

Non-scope (later):
- PDFs, RAG, embeddings, vector DB
- Auth / multi-tenant
