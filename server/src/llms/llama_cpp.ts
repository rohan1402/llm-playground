/**
 * LLM adapter for local OpenAI-compatible servers (llama.cpp, llama-cpp-python).
 * Calls POST {baseUrl}/v1/chat/completions.
 */

import type { ChatRequest, ChatResponse, LLMAdapter } from "./base";

/** Optional configuration for LlamaCppAdapter. Overrides env vars when provided. */
export interface LlamaCppConfig {
  baseUrl?: string;
  timeoutMs?: number;
  /** Model name sent to the OpenAI-compatible server. If not set, uses req.model. */
  upstreamModelName?: string;
}

/** Error thrown by LlamaCppAdapter with a stable code for client handling. */
export class LlamaCppError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "LLAMA_CPP_NOT_CONFIGURED"
      | "LLAMA_CPP_UNREACHABLE"
      | "LLAMA_CPP_TIMEOUT"
      | "LLAMA_CPP_BAD_RESPONSE"
  ) {
    super(message);
    this.name = "LlamaCppError";
    Object.setPrototypeOf(this, LlamaCppError.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 512;

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAIChoice {
  message?: { content?: string };
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
}

export class LlamaCppAdapter implements LLMAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly chatPath: string;
  /** If set, sent to upstream; else uses req.model */
  private readonly upstreamModelName: string | undefined;

  constructor(config?: LlamaCppConfig) {
    const baseUrl =
      config?.baseUrl?.trim() ?? process.env.LLAMA_CPP_BASE_URL?.trim();
    if (!baseUrl) {
      throw new LlamaCppError(
        "LLAMA_CPP_BASE_URL is not set. Add it to .env or environment.",
        "LLAMA_CPP_NOT_CONFIGURED"
      );
    }
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.chatPath = (process.env.LLAMA_CPP_CHAT_PATH ?? "v1/chat/completions").replace(/^\//, "");

    const timeoutStr = config?.timeoutMs ?? process.env.LLAMA_CPP_TIMEOUT_MS;
    this.timeoutMs =
      timeoutStr !== undefined ? Number(timeoutStr) || DEFAULT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    this.upstreamModelName = config?.upstreamModelName;
  }

  /** Expose upstream config for audit logging (e.g. on error before chat completes). */
  getUpstreamInfo(requestedModel: string): { base_url: string; model_sent: string } {
    const modelSent = this.upstreamModelName ?? requestedModel ?? "local-model";
    return { base_url: this.baseUrl, model_sent: modelSent };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/${this.chatPath}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.upstreamModelName ?? req.model ?? "local-model",
      messages: req.messages as OpenAIChatMessage[],
      temperature: req.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
      stream: false, // require JSON response (some servers default to SSE)
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new LlamaCppError(
          `Request timed out after ${this.timeoutMs}ms`,
          "LLAMA_CPP_TIMEOUT"
        );
      }
      throw new LlamaCppError(
        err instanceof Error ? err.message : "Failed to reach llama.cpp server",
        "LLAMA_CPP_UNREACHABLE"
      );
    }
    clearTimeout(timeoutId);

    const rawText = await response.text();

    if (!response.ok) {
      const preview = rawText.slice(0, 200).replace(/\n/g, " ");
      throw new LlamaCppError(
        `llama.cpp server returned ${response.status}: ${preview}`,
        "LLAMA_CPP_BAD_RESPONSE"
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      const preview = rawText.slice(0, 150).replace(/\n/g, " ");
      throw new LlamaCppError(
        `Invalid JSON from llama.cpp server. Preview: ${preview || "(empty)"}`,
        "LLAMA_CPP_BAD_RESPONSE"
      );
    }

    const parsed = data as OpenAIResponse;
    const choices = parsed?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new LlamaCppError(
        "Response missing choices array or empty",
        "LLAMA_CPP_BAD_RESPONSE"
      );
    }

    const content = choices[0]?.message?.content;
    const reply = typeof content === "string" ? content : "";

    const u = parsed.usage;
    const usage = u
      ? {
          ...(u.prompt_tokens !== undefined && { prompt_tokens: u.prompt_tokens }),
          ...(u.completion_tokens !== undefined && { completion_tokens: u.completion_tokens }),
          ...(u.total_tokens !== undefined && { total_tokens: u.total_tokens }),
        }
      : null;

    const modelSent = this.upstreamModelName ?? req.model ?? "local-model";
    return {
      reply,
      usage: Object.keys(usage ?? {}).length > 0 ? usage : null,
      upstream_log: { base_url: this.baseUrl, model_sent: modelSent },
    };
  }
}
