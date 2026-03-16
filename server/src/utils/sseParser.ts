/**
 * Parses an OpenAI-compatible SSE stream.
 * Yields each text token from choices[0].delta.content.
 */

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

export async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array> | null
): AsyncGenerator<string, void, unknown> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data) as StreamChunk;
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            yield content;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
