/**
 * RAG types: chunks, docs, citations.
 */

export interface DocPage {
  page: number;
  text: string;
}

export interface DocMeta {
  doc_id: string;
  title: string;
  num_pages: number;
  created_at: string;
}

export interface Chunk {
  chunk_id: string;
  doc_id: string;
  text: string;
  page_start: number;
  page_end: number;
  token_count: number;
}

export interface ChunkWithVector extends Chunk {
  vector: number[];
}

export interface Citation {
  doc_id: string;
  page: number;
  quote: string;
  chunk_id: string;
}

export interface RagRequest {
  question: string;
  doc_id: string;
  model: string;
  top_k?: number;
  temperature?: number;
}

export interface RagResponse {
  answer: string;
  citations: Citation[];
  is_answer_in_doc: boolean;
  follow_up_question?: string;
  latency_ms: number;
  token_usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  };
  error?: { message: string; code: string };
}
