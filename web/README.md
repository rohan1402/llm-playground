# LLM Playground (Frontend)

React + Vite + TypeScript chat UI for comparing LLMs.

## Running

```bash
cd web
npm install
npm run dev
```

The app runs at http://localhost:5173 and calls the backend API. Set `VITE_API_URL` to match your backend (default: `http://localhost:3000`).

**Example `.env` in project root:**

```env
VITE_API_URL=http://localhost:3000
```

## Features

- **Chat UI** – Message list, input, send with Enter (Shift+Enter for newline)
- **Model dropdown** – Choose model (llama3.1-8b-instruct, qwen2.5-7b-instruct, mistral-7b-instruct, phi-3.5-mini-instruct)
- **Settings** – Temperature (0–2), max tokens (1–4096)
- **Metrics** – Latency (ms), token usage when available
