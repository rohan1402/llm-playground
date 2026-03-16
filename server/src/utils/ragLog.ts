/**
 * JSONL audit logger for RAG requests.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs");
const RAG_LOG = path.join(LOG_DIR, "rag.jsonl");

export interface RagAuditEntry {
  timestamp: string;
  request_id: string;
  doc_id: string;
  model: string;
  question: string;
  latency_ms: number;
  top_k?: number;
  num_chunks_retrieved?: number;
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function appendRagAudit(entry: RagAuditEntry): void {
  ensureLogDir();
  fs.appendFileSync(RAG_LOG, JSON.stringify(entry) + "\n", "utf8");
}
