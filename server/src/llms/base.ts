/**
 * LLM adapter interface.
 * All adapters must implement this interface to be used by the chat endpoint.
 */

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  reply: string;
  usage?: ChatUsage | null;
  /** Optional upstream metadata for audit logging. Not sent to client. */
  upstream_log?: {
    base_url: string;
    model_sent: string;
  };
}

export interface LLMAdapter {
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream?(req: ChatRequest): AsyncGenerator<string, void, unknown>;
}
