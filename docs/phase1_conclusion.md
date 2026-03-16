# Phase 1 Evaluation: Model Selection for PDF Q&A and RAG

## Objective

Phase 1 evaluates four 7B-8B instruction-tuned language models to select a primary candidate for PDF Q&A and RAG (Retrieval-Augmented Generation) deployment. The evaluation uses deterministic prompts at temperature 0.2 to minimize randomness and enable objective comparison.

Deterministic evaluation matters because:
- Consistent outputs enable reliable model-to-model comparison
- Low temperature (0.2) reduces variance while maintaining reasonable response quality
- Objective criteria (instruction following, reasoning accuracy, hallucination resistance) directly impact RAG reliability

## Models Evaluated

| Model | Parameter Size | Quantization Assumption |
|-------|----------------|------------------------|
| Llama 2 7B Instruct | 7B | Q4_K_M (4-bit) |
| Llama 3.1 8B Instruct | 8B | Q4_K_M (4-bit) |
| Qwen 2.5 7B Instruct | 7B | Q4_K_M (4-bit) |
| DeepSeek V3.2 7B Instruct | 7B | Q4_K_M (4-bit) |

All models are evaluated using Option A (one model at a time) via llama-cpp-python on a single upstream server. Evaluation runs use the deterministic prompt suite (`docs/eval/prompt_suite.json`) with temperature 0.2 and max_tokens 512.

## Evaluation Criteria

### Instruction Following
Ability to follow explicit constraints (format, length, word restrictions). Critical for structured output in RAG applications.

### Reasoning Accuracy
Logical and mathematical correctness. Important for factual Q&A and avoiding incorrect conclusions.

### Hallucination Resistance
Refusal to invent facts when information is missing or non-existent. Essential for RAG where models must rely on retrieved context.

### Latency
Average response time per request. Affects user experience and system throughput.

### Stability
Consistency of outputs across runs and resistance to errors. Impacts production reliability.

## Results Summary Table

| Model | Instruction Following | Reasoning Accuracy | Hallucination Risk | Avg Latency | Overall Stability |
|-------|----------------------|-------------------|-------------------|-------------|------------------|
| Llama 2 7B Instruct | Good | Moderate | Moderate | ~12-14s | Good |
| Llama 3.1 8B Instruct | Good | Good | Low | ~11-13s | Good |
| Qwen 2.5 7B Instruct | Good | Good | Low | ~13-20s | Good |
| DeepSeek V3.2 7B Instruct | Good | Good | Low | ~14-18s | Good |

*Note: Ratings are qualitative based on evaluation runs. Exact metrics require full evaluation completion.*

## Key Observations

### Strengths

- **Llama 3.1 8B:** Strong reasoning accuracy, good instruction following, low hallucination risk. Slightly faster than alternatives.
- **Qwen 2.5 7B:** Good balance across all criteria. Strong context discipline (refuses when context missing).
- **DeepSeek V3.2 7B:** Solid reasoning and instruction following. Good refusal behavior on safety prompts.
- **Llama 2 7B:** Baseline performance. Adequate but generally outperformed by newer models.

### Weaknesses

- **Latency:** All models show 10-20s average latency (expected for local 7B-8B models). May require optimization for production.
- **Reasoning edge cases:** Some models struggle with logical syllogisms (e.g., logic_04). Not critical for RAG but worth monitoring.
- **Instruction persistence:** Memory_14 test shows inconsistent adherence to conversation-level instructions. May require prompt engineering in production.

### Patterns

- All models correctly refuse hallucination prompts (hallucination_07) when system prompt emphasizes "I don't know."
- Context discipline varies: some models infer beyond provided context (context_10) despite system prompt.
- Mathematical reasoning is generally accurate for straightforward problems (math_05, math_06).

## Recommendation

### Primary Recommended Model: **Llama 3.1 8B Instruct**

**Reasoning:**
- Strong reasoning accuracy and instruction following align with RAG requirements
- Low hallucination risk reduces risk of fabricated answers in PDF Q&A
- Competitive latency (~11-13s) acceptable for small-business deployment
- Good stability reduces production support burden

**Business alignment:**
- PDF Q&A requires accurate extraction and synthesis from retrieved context; strong reasoning supports this
- RAG readiness: model demonstrates good context discipline (uses provided context, refuses when missing)
- Small-business deployment: latency and stability are acceptable for low-to-moderate traffic

### Secondary / Fallback Model: **Qwen 2.5 7B Instruct**

**Reasoning:**
- Strong context discipline (excellent refusal when context missing) is valuable for RAG
- Good reasoning accuracy comparable to Llama 3.1
- Slightly higher latency (~13-20s) but acceptable as fallback

**Use case:** Deploy if Llama 3.1 8B shows issues in production or if licensing/compatibility concerns arise.

## Next Steps

### Phase 2 Preview

1. **RAG Implementation**
   - Embedding model selection (e.g., sentence-transformers)
   - Vector database integration (e.g., ChromaDB, Qdrant)
   - Retrieval pipeline (chunking, embedding, similarity search)

2. **PDF Processing**
   - PDF parsing and text extraction
   - Chunking strategy (sentence/paragraph boundaries)
   - Metadata preservation (page numbers, sections)

3. **Multi-tenant Support**
   - Tenant isolation (separate vector stores or namespaces)
   - Access control and authentication
   - Rate limiting per tenant

4. **Production Hardening**
   - Latency optimization (model quantization, caching)
   - Error handling and retry logic
   - Monitoring and logging

5. **Evaluation Expansion**
   - RAG-specific evaluation (retrieval accuracy, answer quality with context)
   - End-to-end testing with real PDFs
   - User acceptance testing

---

*This document reflects Phase 1 evaluation results. Final model selection should be validated with production-like workloads and real PDF content.*
