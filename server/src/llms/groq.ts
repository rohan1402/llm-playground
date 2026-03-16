/**
 * LLM adapter for Groq API (OpenAI-compatible format).
 * Calls POST https://api.groq.com/openai/v1/chat/completions
 */

import type { ChatRequest, ChatResponse, LLMAdapter } from "./base";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

export class GroqApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "GROQ_NOT_CONFIGURED"
      | "GROQ_UNREACHABLE"
      | "GROQ_TIMEOUT"
      | "GROQ_BAD_RESPONSE"
  ) {
    super(message);
    this.name = "GroqApiError";
    Object.setPrototypeOf(this, GroqApiError.prototype);
  }
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

export interface GroqConfig {
  apiKey?: string;
  upstreamModel?: string;
  timeoutMs?: number;
}

export class GroqAdapter implements LLMAdapter {
  private readonly apiKey: string;
  private readonly upstreamModel: string;
  private readonly timeoutMs: number;

  constructor(config?: GroqConfig) {
    const apiKey = config?.apiKey ?? process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new GroqApiError(
        "GROQ_API_KEY is not set. Add it to .env or environment.",
        "GROQ_NOT_CONFIGURED"
      );
    }
    this.apiKey = apiKey;
    this.upstreamModel = config?.upstreamModel ?? "llama3-70b-8192";
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.upstreamModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.max_tokens ?? 512,
      stream: false,
    };

    let response: Response;
    try {
      response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new GroqApiError(
          `Groq request timed out after ${this.timeoutMs}ms`,
          "GROQ_TIMEOUT"
        );
      }
      throw new GroqApiError(
        err instanceof Error ? err.message : "Failed to reach Groq API",
        "GROQ_UNREACHABLE"
      );
    }
    clearTimeout(timeoutId);

    const rawText = await response.text();

    if (!response.ok) {
      const preview = rawText.slice(0, 300).replace(/\n/g, " ");
      throw new GroqApiError(
        `Groq API returned ${response.status}: ${preview}`,
        "GROQ_BAD_RESPONSE"
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new GroqApiError(
        `Invalid JSON from Groq API: ${rawText.slice(0, 150)}`,
        "GROQ_BAD_RESPONSE"
      );
    }

    const parsed = data as OpenAIResponse;
    const choices = parsed?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new GroqApiError(
        "Groq response missing choices array",
        "GROQ_BAD_RESPONSE"
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

    return {
      reply,
      usage: Object.keys(usage ?? {}).length > 0 ? usage : null,
      upstream_log: { base_url: GROQ_API_URL, model_sent: this.upstreamModel },
    };
  }
}
