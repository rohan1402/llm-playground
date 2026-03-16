# LLM Playground — Local Model Benchmarking & RAG

A two-phase project that benchmarks open-weight language models locally (via llama-cpp-python) and then wires the best performer into a production-quality RAG pipeline that answers questions over uploaded PDFs with page-number citations.

[![CI](https://github.com/rohan1402/llm-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/rohan1402/llm-playground/actions/workflows/ci.yml)

**Stack:** Node.js · Express · TypeScript · React · Vite
**Author:** Rohan Pant — MS Data Science, Rutgers University

---

## Table of Contents

- [Project Overview](#project-overview)
- [Phase 1 — Model Benchmarking](#phase-1--model-benchmarking)
- [Phase 2 — RAG Pipeline](#phase-2--rag-pipeline)
- [Benchmark Results](#benchmark-results)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Evaluation Harness](#evaluation-harness)
- [Environment Variables](#environment-variables)
- [Repo Layout](#repo-layout)

---

## Project Overview

| Phase | Goal | Models |
|-------|------|--------|
| Phase 1 | Benchmark local 7B–8B models on instruction-following, reasoning, hallucination resistance, and latency | Llama 3.1 8B · Qwen 2.5 7B · Mistral 7B · Phi-3.5 Mini |
| Phase 2 | RAG over uploaded PDFs; compare local models against a cloud baseline | All Phase-1 models + Groq Llama 3 70B |

All local models run as quantized GGUFs (Q4_K_M) served through an OpenAI-compatible llama-cpp-python endpoint. **Option A** — one GGUF at a time — prevents "same-model-different-label" measurement artifacts.

---

## Phase 1 — Model Benchmarking

### Prompt Suite

14 deterministic prompts across **9 capability categories** at `temperature=0.2`, `max_tokens=512`.

| Category | What it measures |
|----------|-----------------|
| Instruction Following | Obeys explicit constraints (format, length, word exclusions) |
| Format Control | Strict output-length adherence |
| Reasoning | Deductive / syllogistic correctness |
| Mathematical Reasoning | Arithmetic accuracy with step-by-step work |
| Hallucination Resistance | Refuses to invent facts; returns "I don't know" |
| Context Discipline | Uses only provided context; refuses when context is missing |
| Conciseness | Accurate single-sentence definitions |
| Structured Output | Multi-part structured responses |
| Safety / Refusal | Declines unethical requests |

Prompt suite definition: [`docs/eval/prompt_suite.json`](docs/eval/prompt_suite.json)
Full spec with expected answers: [`docs/eval/prompt_suite.md`](docs/eval/prompt_suite.md)

---

## Phase 2 — RAG Pipeline

Answers natural-language questions over uploaded PDFs with **page-number citations**.

**Eval set (10 questions):** 7 answerable (grounded in the document) + 3 unanswerable (out-of-domain or missing context)
**Metrics:** retrieval hit rate · citation validity rate · latency

---

## Benchmark Results

### Phase 1 — Instruction-Following & Reasoning (14 prompts)

| Model | Overall Accuracy | Avg Latency | Reasoning | Safety | Hallucination |
|-------|-----------------|-------------|-----------|--------|---------------|
| **Qwen 2.5 7B Instruct** | **89%** | **4,935 ms** | 100% | 100% | 100% |
| **Llama 3.1 8B Instruct** | **86%** | **4,726 ms** | 75% | 100% | 100% |
| Phi-3.5 Mini Instruct | 71% | 9,316 ms | 100% | 100% | 0% |
| Mistral 7B Instruct | 54% | 14,398 ms | 75% | 0% | 0% |

> Tested on Apple Silicon (local CPU inference). All models run as Q4_K_M GGUFs via llama-cpp-python.
> Scored across 14 prompts × 9 categories. Full results: [`eval/`](eval/)

**Key findings:**
- Qwen 2.5 7B edges out Llama 3.1 8B on accuracy (89% vs 86%) at nearly identical speed (~4.7–4.9 s)
- **All 4 models failed `context_10`** — when chlorophyll wasn't mentioned in the provided context, every model hallucinated an answer instead of saying "I don't know." A universal context-discipline failure worth noting
- Mistral and DeepSeek both provided actual exam-cheating methods when asked (safety_13 failure)
- `logic_03` (syllogism) tripped up Llama 3.1, Mistral, and DeepSeek — all answered "Yes" when the correct answer is "No"

### Phase 2 — RAG over PDF (10 questions)

| Model | Avg Latency | Retrieval Hit | Citation Valid | Notes |
|-------|-------------|---------------|----------------|-------|
| **Groq Llama 3 70B** ☁️ | **669 ms** | 80 % | 90 % | Cloud API — not local inference |
| Phi-3.5 Mini Instruct | 21,487 ms | 80 % | **100 %** | Best citation accuracy locally |
| Qwen 2.5 7B Instruct | 38,433 ms | 80 % | **100 %** | Tied best citation; slower |
| Llama 3.1 8B Instruct | 29,272 ms | 80 % | 90 % | Best balance of speed + accuracy |
| Mistral 7B Instruct | 35,726 ms | 80 % | 80 % | Lowest citation rate locally |

> Retrieval hit rate is identical (80%) across all local models because the same vector retrieval pipeline is shared.
> The 2 misses are questions whose evidence pages were not retrieved (qids 4 & 7).
> Full CSVs: [`server/data/eval/`](server/data/eval/)

**Key findings:**
- Groq (cloud 70B) delivers **~40× lower latency** than local 8B models at the cost of API dependency
- Phi-3.5 Mini achieves the highest citation rate (100%) despite being the smallest local model
- Llama 3.1 8B offers the best local latency-accuracy tradeoff for RAG

---

## Architecture

```
llm-playground/
├── web/               # React + Vite chat UI
├── server/            # Express + TypeScript API
│   ├── src/
│   │   ├── routes/    # /health  /models  /chat  /chat/rag  /docs/upload
│   │   ├── llms/      # Adapters: llama-cpp, Groq
│   │   ├── rag/       # Chunking, embedding, vector store, retrieval
│   │   ├── middleware/ # File upload (multer)
│   │   └── utils/     # Logger (pino)
│   ├── scripts/
│   │   ├── eval.ts        # Phase-1 eval runner
│   │   ├── evalRag.ts     # Phase-2 RAG eval runner
│   │   └── exportResults.ts
│   └── data/
│       ├── docs/          # Per-page text extracted from uploaded PDFs
│       └── eval/          # RAG eval inputs + result CSVs/JSONLs
├── docs/
│   ├── eval/              # Prompt suite (JSON + Markdown)
│   ├── phase1_conclusion.md
│   └── phase1_optionA_runbook.md
└── eval/                  # Phase-1 JSONL result files
```

**RAG data flow:**

```
PDF upload → page extraction (unpdf) → chunking → embedding (@xenova/transformers)
→ vector store (in-memory or Qdrant)

Question → embed → similarity search (top-k chunks) → LLM → answer + page citations
```

---

## Quick Start

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18+ |
| Python | 3.9+ |
| llama-cpp-python | latest |
| GGUF model files | Q4_K_M recommended |

### 1. Install Python deps

```bash
pip install -r requirements.txt
```

### 2. Download a GGUF model

```bash
# Example: Llama 3.1 8B Q4_K_M from HuggingFace
# Place in a directory of your choice, then set LLAMA_CPP_BASE_URL accordingly
```

### 3. Start the local inference server

```bash
python -m llama_cpp.server \
  --model /path/to/Llama-3.1-8B-Instruct-Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8082
```

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env: set LLAMA_CPP_BASE_URL=http://localhost:8082
# Optional: add GROQ_API_KEY for cloud Groq inference
```

### 5. Start the backend

```bash
cd server
npm install
npm run dev      # runs on http://localhost:8080
```

### 6. Start the frontend

```bash
cd web
npm install
npm run dev      # runs on http://localhost:5173
```

---

## Evaluation Harness

### Phase 1 — Instruction / Reasoning prompts

Run while the target GGUF is loaded in the upstream server:

```bash
cd server
npm run eval -- --models llama3.1-8b-instruct   # swap model name to match loaded GGUF
```

Output: `eval/results_phase1_prompt_suite_v2_<timestamp>.jsonl`

See [`docs/phase1_optionA_runbook.md`](docs/phase1_optionA_runbook.md) for the full one-model-at-a-time procedure that prevents measurement artifacts.

### Phase 2 — RAG over PDF

```bash
# 1. Upload a PDF
curl -X POST -F "file=@your.pdf" http://localhost:8080/docs/upload
# → { "doc_id": "doc_...", "title": "...", "num_pages": N }

# 2. Create an eval input file
#    server/data/eval/<doc_id>.jsonl — one question JSON object per line

# 3. Run the RAG eval
cd server
npm run eval:rag -- --docId <doc_id> --model llama3.1-8b-instruct
```

Output: CSV + JSONL under `server/data/eval/`

---

## Environment Variables

See [`.env.example`](.env.example) for all options. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Backend port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `LLAMA_CPP_BASE_URL` | `http://localhost:8082` | Local llama-cpp-python server |
| `LLAMA_CPP_TIMEOUT_MS` | `60000` | Request timeout (ms) |
| `GROQ_API_KEY` | — | Groq cloud API key (optional) |
| `VECTOR_STORE` | `memory` | `memory` (default) or `qdrant` |
| `QDRANT_URL` | — | Required when `VECTOR_STORE=qdrant` |

For persistent vector storage (survives restarts), run Qdrant locally:

```bash
docker run -p 6333:6333 qdrant/qdrant
# then set VECTOR_STORE=qdrant in .env
```

---

## Repo Layout

```
.
├── .env.example
├── .gitignore
├── README.md
├── requirements.txt          ← Python deps for llama-cpp-python
├── docs/                     ← Design docs, runbooks, eval spec
├── eval/                     ← Phase-1 JSONL result files
├── server/                   ← Node/Express backend + eval scripts
└── web/                      ← React/Vite frontend
```

---

## Models Used

| Model | Size | Quantization | Source |
|-------|------|--------------|--------|
| Llama 3.1 8B Instruct | 8B | Q4_K_M | Meta / HuggingFace |
| Qwen 2.5 7B Instruct | 7B | Q4_K_M | Alibaba / HuggingFace |
| Mistral 7B Instruct v0.3 | 7B | Q4_K_M | Mistral AI / HuggingFace |
| Phi-3.5 Mini Instruct | 3.8B | IQ4_XS | Microsoft / HuggingFace |
| Groq Llama 3 70B | 70B | Cloud | Groq API |

---

## License

MIT
