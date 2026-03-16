/**
 * POST /chat/rag: RAG chat with PDF context.
 */

import type { Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../llms/registry";
import { docExists } from "../rag/storage";
import { TransformersEmbeddingProvider } from "../rag/embedding";
import { getVectorStore } from "../rag/vectorStore";
import { getEmbeddingDimension } from "../rag/embedding";
import { buildRagPrompt } from "../rag/prompt";
import { buildCitations } from "../rag/citations";
import { rerankByKeywords } from "../rag/rerank";
import { appendRagAudit } from "../utils/ragLog";
import { logger } from "../utils/logger";

const RAG_BODY_SCHEMA = z.object({
  question: z.string().min(1),
  doc_id: z.string().min(1),
  model: z.string().min(1),
  top_k: z.number().int().min(1).max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const DEFAULT_TOP_K = 8;
const RETRIEVAL_OVERSAMPLE = 4; // fetch N * top_k, then rerank down to top_k

export async function chatRagHandler(req: Request, res: Response): Promise<void> {
  const requestId = uuidv4();
  const start = Date.now();

  const parsed = RAG_BODY_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    logger.warn({ request_id: requestId, error: msg }, "RAG validation failed");
    res.status(400).json({
      answer: "",
      citations: [],
      is_answer_in_doc: false,
      latency_ms: Date.now() - start,
      token_usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message: msg, code: "VALIDATION_ERROR" },
    });
    return;
  }

  const { question, doc_id, model, top_k, temperature } = parsed.data;
  const k = top_k ?? DEFAULT_TOP_K;

  if (!docExists(doc_id)) {
    logger.warn({ request_id: requestId, doc_id }, "RAG: doc not found");
    res.status(404).json({
      answer: "",
      citations: [],
      is_answer_in_doc: false,
      latency_ms: Date.now() - start,
      token_usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message: `Document ${doc_id} not found`, code: "DOC_NOT_FOUND" },
    });
    return;
  }

  let adapter;
  try {
    adapter = getAdapter(model);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown model";
    logger.warn({ request_id: requestId, model }, "RAG: unknown model");
    res.status(400).json({
      answer: "",
      citations: [],
      is_answer_in_doc: false,
      latency_ms: Date.now() - start,
      token_usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message: msg, code: "UNKNOWN_MODEL" },
    });
    return;
  }
  const embeddingProvider = new TransformersEmbeddingProvider();
  const store = getVectorStore(getEmbeddingDimension());

  try {
    const vecs = await embeddingProvider.embed([question]);
    const qVec = vecs[0];
    if (!qVec) throw new Error("Embedding failed");
    let retrieved = await store.query(qVec, k * RETRIEVAL_OVERSAMPLE, doc_id);
    logger.info(
      {
        request_id: requestId,
        num_retrieved: retrieved.length,
        top_chunks: retrieved.slice(0, 5).map((r) => ({
          chunk_id: r.chunk.chunk_id,
          score: r.score.toFixed(4),
          pages: `${r.chunk.page_start}-${r.chunk.page_end}`,
          preview: r.chunk.text.slice(0, 120),
        })),
      },
      "RAG: pre-rerank retrieval"
    );
    retrieved = rerankByKeywords(retrieved, question).slice(0, k);
    logger.info(
      {
        request_id: requestId,
        top_after_rerank: retrieved.slice(0, 5).map((r) => ({
          chunk_id: r.chunk.chunk_id,
          score: r.score.toFixed(4),
          pages: `${r.chunk.page_start}-${r.chunk.page_end}`,
          preview: r.chunk.text.slice(0, 120),
        })),
      },
      "RAG: post-rerank retrieval"
    );
    const chunks = retrieved.map((r) => r.chunk);

    const prompt = buildRagPrompt(question, chunks, model);
    logger.info(
      { request_id: requestId, prompt_length: prompt.length, prompt_tokens_est: Math.ceil(prompt.length / 4) },
      "RAG: prompt built"
    );
    const chatResult = await adapter.chat({
      model,
      messages: [
        { role: "system", content: "You must answer ONLY using the provided context. Cite page numbers for every claim." },
        { role: "user", content: prompt },
      ],
      temperature: temperature ?? 0.2,
      max_tokens: model.startsWith("groq") ? 1024 : 256,
    });

    const answer = chatResult.reply?.trim() ?? "";
    const notFound = /not found in the provided document/i.test(answer);
    const citations = buildCitations(answer, chunks, doc_id);

    const latency = Date.now() - start;

    appendRagAudit({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      doc_id,
      model,
      question,
      latency_ms: latency,
      top_k: k,
      num_chunks_retrieved: chunks.length,
    });

    const sources = chunks.map((c) => ({
      page: c.page_start,
      chunk_id: c.chunk_id,
      text: c.text,
    }));

    res.json({
      answer,
      citations,
      sources,
      is_answer_in_doc: !notFound,
      latency_ms: latency,
      token_usage: chatResult.usage
        ? {
            prompt_tokens: chatResult.usage.prompt_tokens ?? null,
            completion_tokens: chatResult.usage.completion_tokens ?? null,
            total_tokens: chatResult.usage.total_tokens ?? null,
          }
        : { prompt_tokens: null, completion_tokens: null, total_tokens: null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "RAG error";
    logger.error({ request_id: requestId, err }, "RAG failed");
    res.status(500).json({
      answer: "",
      citations: [],
      is_answer_in_doc: false,
      latency_ms: Date.now() - start,
      token_usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message: msg, code: "RAG_ERROR" },
    });
  }
}
