/**
 * POST /docs/upload: multipart PDF upload.
 * Returns { doc_id, title, num_pages }.
 */

import type { Request, Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { extractPagesFromPdf } from "../rag/pdf";
import { chunkPages } from "../rag/chunker";
import { saveDoc } from "../rag/storage";
import { getEmbeddingDimension, TransformersEmbeddingProvider } from "../rag/embedding";
import { getVectorStore } from "../rag/vectorStore";
import { logger } from "../utils/logger";

const DATA_DIR = path.resolve(process.cwd(), "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export async function docsUploadHandler(req: Request, res: Response): Promise<void> {
  const start = Date.now();
  const requestId = uuidv4();

  const file = (req as Request & { file?: { path: string; originalname: string } }).file;
  if (!file) {
    logger.warn({ request_id: requestId }, "POST /docs/upload: no file");
    res.status(400).json({
      error: { message: "No PDF file uploaded", code: "NO_FILE" },
    });
    return;
  }

  const filePath = file.path;
  const title = file.originalname.replace(/\.pdf$/i, "") || "document";

  try {
    ensureUploadDir();
    const buffer = fs.readFileSync(filePath);
    const pages = await extractPagesFromPdf(buffer);
    fs.unlinkSync(filePath);

    const docId = `doc_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const meta = {
      doc_id: docId,
      title,
      num_pages: pages.length,
      created_at: new Date().toISOString(),
    };

    saveDoc(docId, meta, pages);
    const chunks = chunkPages(docId, pages);

    const embeddingProvider = new TransformersEmbeddingProvider();
    const vectors = await embeddingProvider.embed(chunks.map((c) => c.text));

    const storedChunks = chunks.map((c, i) => ({
      ...c,
      vector: vectors[i] ?? [],
    }));

    const store = getVectorStore(getEmbeddingDimension());
    await store.upsert(storedChunks);

    const latency = Date.now() - start;
    logger.info(
      { request_id: requestId, doc_id: docId, num_pages: pages.length, num_chunks: chunks.length },
      "Document uploaded"
    );

    res.status(200).json({
      doc_id: docId,
      title,
      num_pages: pages.length,
      latency_ms: latency,
    });
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const message = err instanceof Error ? err.message : "Upload failed";
    logger.error({ request_id: requestId, err }, "Document upload failed");
    res.status(500).json({
      error: { message, code: "UPLOAD_ERROR" },
    });
  }
}
