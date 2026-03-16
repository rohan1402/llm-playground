/**
 * VectorStore: upsert chunks, query by vector.
 * Uses Qdrant REST API (run: docker run -p 6333:6333 qdrant/qdrant).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Chunk } from "./types";
import { fetchWithTimeout } from "../utils/fetch";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DOCS_DIR = path.join(DATA_DIR, "docs");

const COLLECTION = "rag_chunks";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface StoredChunk extends Chunk {
  vector: number[];
}

export interface VectorStore {
  upsert(chunks: StoredChunk[]): Promise<void>;
  query(vector: number[], topK: number, filterDocId?: string): Promise<Array<{ chunk: Chunk; score: number }>>;
}

function getBaseUrl(): string {
  const url = process.env.QDRANT_URL ?? "http://localhost:6333";
  return url.replace(/\/$/, "");
}

async function ensureCollection(baseUrl: string, dim: number): Promise<void> {
  const res = await fetchWithTimeout(
    `${baseUrl}/collections/${COLLECTION}`,
    { method: "GET", timeoutMs: 5000 }
  );
  if (res.ok) return;

  const createRes = await fetchWithTimeout(
    `${baseUrl}/collections/${COLLECTION}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vectors: { size: dim, distance: "Cosine" },
      }),
      timeoutMs: 10_000,
    }
  );
  if (!createRes.ok) {
    const t = await createRes.text();
    throw new Error(`Qdrant create collection failed: ${createRes.status} ${t}`);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * In-memory vector store with disk persistence.
 * Vectors are saved per doc in data/docs/<doc_id>/vectors.json and loaded on demand.
 * Uses brute-force cosine similarity. Swappable with Qdrant via getVectorStore().
 */
export class InMemoryVectorStore implements VectorStore {
  private entries: Array<{ chunk: Chunk; vector: number[] }> = [];
  private loadedDocs = new Set<string>();

  private getVectorsPath(docId: string): string {
    return path.join(DOCS_DIR, docId, "vectors.json");
  }

  private loadFromDisk(docId: string): void {
    if (this.loadedDocs.has(docId)) return;
    this.loadedDocs.add(docId);
    const p = this.getVectorsPath(docId);
    if (!fs.existsSync(p)) return;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const stored = JSON.parse(raw) as StoredChunk[];
      for (const c of stored) {
        this.entries.push({
          chunk: {
            chunk_id: c.chunk_id,
            doc_id: c.doc_id,
            text: c.text,
            page_start: c.page_start,
            page_end: c.page_end,
            token_count: c.token_count,
          },
          vector: c.vector,
        });
      }
    } catch { /* ignore corrupt files */ }
  }

  private saveToDisk(docId: string, chunks: StoredChunk[]): void {
    const dir = path.join(DOCS_DIR, docId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.getVectorsPath(docId), JSON.stringify(chunks), "utf8");
  }

  async upsert(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    for (const c of chunks) {
      this.entries.push({
        chunk: {
          chunk_id: c.chunk_id,
          doc_id: c.doc_id,
          text: c.text,
          page_start: c.page_start,
          page_end: c.page_end,
          token_count: c.token_count,
        },
        vector: c.vector,
      });
    }
    const docId = chunks[0]!.doc_id;
    this.loadedDocs.add(docId);
    const allForDoc = this.entries
      .filter((e) => e.chunk.doc_id === docId)
      .map((e) => ({ ...e.chunk, vector: e.vector }));
    this.saveToDisk(docId, allForDoc);
  }

  async query(
    vector: number[],
    topK: number,
    filterDocId?: string
  ): Promise<Array<{ chunk: Chunk; score: number }>> {
    if (filterDocId != null) {
      this.loadFromDisk(filterDocId);
    }
    let filtered = this.entries;
    if (filterDocId != null) {
      filtered = this.entries.filter((e) => e.chunk.doc_id === filterDocId);
    }
    const scored = filtered.map((e) => ({
      chunk: e.chunk,
      score: cosineSimilarity(vector, e.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

let memoryStoreInstance: InMemoryVectorStore | null = null;

/**
 * Returns the vector store based on VECTOR_STORE env var.
 * - "memory" (default): InMemoryVectorStore (singleton), no Docker required
 * - "qdrant": QdrantVectorStore, requires Qdrant at QDRANT_URL
 */
export function getVectorStore(dim?: number): VectorStore {
  const kind = (process.env.VECTOR_STORE ?? "memory").toLowerCase();
  const dimVal = dim ?? 384;
  if (kind === "qdrant") {
    return new QdrantVectorStore(undefined, dimVal);
  }
  if (!memoryStoreInstance) {
    memoryStoreInstance = new InMemoryVectorStore();
  }
  return memoryStoreInstance;
}

export class QdrantVectorStore implements VectorStore {
  private baseUrl: string;
  private dim: number;

  constructor(baseUrl?: string, dim?: number) {
    this.baseUrl = baseUrl ?? getBaseUrl();
    this.dim = dim ?? 384;
  }

  async upsert(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await ensureCollection(this.baseUrl, this.dim);

    const points = chunks.map((c) => ({
      id: uuidv4(),
      vector: c.vector,
      payload: {
        chunk_id: c.chunk_id,
        doc_id: c.doc_id,
        text: c.text,
        page_start: c.page_start,
        page_end: c.page_end,
        token_count: c.token_count,
      },
    }));

    const res = await fetchWithTimeout(
      `${this.baseUrl}/collections/${COLLECTION}/points`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Qdrant upsert failed: ${res.status} ${t}`);
    }
  }

  async query(
    vector: number[],
    topK: number,
    filterDocId?: string
  ): Promise<Array<{ chunk: Chunk; score: number }>> {
    const filter =
      filterDocId != null
        ? {
            must: [{ key: "doc_id", match: { value: filterDocId } }],
          }
        : undefined;

    const body: Record<string, unknown> = {
      vector,
      limit: topK,
      with_payload: true,
    };
    if (filter) body.filter = filter;

    const res = await fetchWithTimeout(
      `${this.baseUrl}/collections/${COLLECTION}/points/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Qdrant search failed: ${res.status} ${t}`);
    }

    const data = (await res.json()) as { result?: Array<{ payload?: Record<string, unknown>; score?: number }> };
    const results = data.result ?? [];
    return results.map((r) => {
      const p = r.payload ?? {};
      const chunk: Chunk = {
        chunk_id: String(p.chunk_id ?? ""),
        doc_id: String(p.doc_id ?? ""),
        text: String(p.text ?? ""),
        page_start: Number(p.page_start ?? 1),
        page_end: Number(p.page_end ?? 1),
        token_count: Number(p.token_count ?? 0),
      };
      return { chunk, score: r.score ?? 0 };
    });
  }
}
