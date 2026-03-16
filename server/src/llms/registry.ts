/**
 * LLM adapter registry.
 * Maps model names to adapter instances or factory functions.
 * LlamaCppAdapter models support optional config: baseUrl, timeoutMs, upstreamModelName.
 */

import type { LLMAdapter } from "./base";
import { DummyAdapter } from "./dummy";
import { GroqAdapter } from "./groq";
import type { LlamaCppConfig } from "./llama_cpp";
import { LlamaCppAdapter } from "./llama_cpp";

type AdapterOrFactory = LLMAdapter | (() => LLMAdapter);

const adapters = new Map<string, AdapterOrFactory>();

adapters.set("dummy", new DummyAdapter());

// Phase-1 evaluation models (Option A): all use LlamaCppAdapter with shared env config.
// Optional overrides per model: baseUrl, timeoutMs, upstreamModelName.
// Lazy init so server starts without LLAMA_CPP_BASE_URL.
const createLlamaAdapter = (config?: LlamaCppConfig) => () =>
  new LlamaCppAdapter(config);

// Phase-1 lineup (labels for logging / comparison):
// 1) llama3.1-8b-instruct
// 2) qwen2.5-7b-instruct
// 3) mistral-7b-instruct
// 4) phi-3-mini-instruct

adapters.set("groq-llama3-70b", () => new GroqAdapter({ upstreamModel: "llama-3.3-70b-versatile" }));

adapters.set("llama3.1-8b-instruct", createLlamaAdapter());
adapters.set("qwen2.5-7b-instruct", createLlamaAdapter());
adapters.set("mistral-7b-instruct", createLlamaAdapter());
adapters.set("phi-3-mini-instruct", createLlamaAdapter());

/**
 * Get the adapter for a given model name.
 * @throws Error if the model is not registered
 */
export function getAdapter(modelName: string): LLMAdapter {
  const entry = adapters.get(modelName);
  if (!entry) {
    throw new Error(`Unknown model: ${modelName}`);
  }
  const adapter = typeof entry === "function" ? entry() : entry;
  return adapter;
}

/**
 * List all registered model names.
 * Order is fixed for Phase-1 comparisons.
 */
export function listModels(): string[] {
  return [
    "dummy",
    "groq-llama3-70b",
    "llama3.1-8b-instruct",
    "qwen2.5-7b-instruct",
    "mistral-7b-instruct",
    "phi-3-mini-instruct",
  ];
}
