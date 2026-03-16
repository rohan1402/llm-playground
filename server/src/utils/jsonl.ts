/**
 * JSONL audit logger for chat requests.
 * Appends one JSON line per /chat request to logs/chat.jsonl.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "chat.jsonl");

export interface ChatAuditEntry {
  timestamp: string;
  request_id: string;
  model: string;
  messages?: unknown;
  last_user_message?: string | undefined;
  latency_ms: number;
  error_code?: string | undefined;
  /** Upstream fields for model-switching verification */
  requested_model?: string;
  upstream_base_url?: string;
  upstream_model_sent?: string;
}

/**
 * Ensure the logs directory exists.
 */
function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Append one JSON line to the chat audit log.
 */
export function appendChatAudit(entry: ChatAuditEntry): void {
  ensureLogDir();
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(LOG_FILE, line);
}
