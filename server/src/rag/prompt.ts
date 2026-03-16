/**
 * RAG prompt builder: strict contract for answer-only-from-context.
 * Caps total context to fit models with small context windows (e.g. 2048 tokens).
 */

import type { Chunk } from "./types";

const CHARS_PER_TOKEN = 4;
const LOCAL_MAX_CONTEXT_TOKENS = 1000;
const CLOUD_MAX_CONTEXT_TOKENS = Number(process.env.RAG_MAX_CONTEXT_TOKENS) || 3000;

const SYSTEM_PREFIX = `You must answer ONLY using the provided context chunks. Do NOT use outside knowledge.
If the answer is not supported by the context, respond exactly: "Not found in the provided document."
Every key claim must include a citation with page number.
Citations must reference exact text from the retrieved chunks.
If multiple pages support the answer, cite multiple pages.

Additional Safety Rule:
For medication dosing, repletion, or management instructions, require explicit supporting text in the context.
If unclear or incomplete, do not infer or supplement.
This document may not be a complete medical reference.`;

export function buildRagPrompt(question: string, chunks: Chunk[], model?: string): string {
  const isCloud = model?.startsWith("groq") ?? false;
  const maxTokens = isCloud ? CLOUD_MAX_CONTEXT_TOKENS : LOCAL_MAX_CONTEXT_TOKENS;
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const parts: string[] = [];
  for (const c of chunks) {
    const s = `[Page ${c.page_start}${c.page_end !== c.page_start ? `-${c.page_end}` : ""}] (chunk ${c.chunk_id}):\n${c.text}`;
    if (totalChars + s.length > maxChars && parts.length > 0) break;
    parts.push(s);
    totalChars += s.length;
  }
  const context = parts.join("\n\n---\n\n");

  return `${SYSTEM_PREFIX}

## Context

${context}

## Question

${question}

## Answer (use citations [Page N] for each claim)
`;
}
