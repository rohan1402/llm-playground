/**
 * Dummy LLM adapter for testing and development.
 * Returns a fixed placeholder reply (does not echo the user message).
 */

import type { ChatRequest, ChatResponse, LLMAdapter } from "./base";

export class DummyAdapter implements LLMAdapter {
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    return {
      reply:
        "This is a placeholder response from the dummy model. Switch to 'llama-local' in the model dropdown to use a real LLM.",
      usage: null,
    };
  }

  async *chatStream(_req: ChatRequest): AsyncGenerator<string, void, unknown> {
    const words = "This is a placeholder response from the dummy model.".split(" ");
    for (const word of words) {
      yield word + " ";
      await new Promise((r) => setTimeout(r, 40));
    }
  }
}
