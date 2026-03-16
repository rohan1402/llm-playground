/**
 * POST /chat route.
 * Validates request, calls LLM adapter, returns response per API contract.
 */

import type { Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../llms/registry";
import type { LLMAdapter } from "../llms/base";
import { hasErrorCode } from "../utils/errors";
import { appendChatAudit } from "../utils/jsonl";
import { logger } from "../utils/logger";

const PHASE1_MODELS = new Set([
  "llama3.1-8b-instruct",
  "qwen2.5-7b-instruct",
  "mistral-7b-instruct",
  "phi-3.5-mini-instruct",
]);

function getUpstreamInfoFromAdapter(
  adapter: LLMAdapter,
  requestedModel: string
): { base_url: string; model_sent: string } | null {
  const a = adapter as { getUpstreamInfo?: (m: string) => { base_url: string; model_sent: string } };
  return a.getUpstreamInfo?.(requestedModel) ?? null;
}

// Zod schema for POST /chat body (per API contract)
const chatBodySchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })
  ),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
});

export type ChatRequestBody = z.infer<typeof chatBodySchema>;

export async function chatHandler(req: Request, res: Response): Promise<void> {
  const requestId = uuidv4();
  const startTime = Date.now();

  logger.info({ request_id: requestId, path: "/chat" }, "Chat request received");

  // Validate request body
  const parseResult = chatBodySchema.safeParse(req.body);

  if (!parseResult.success) {
    const message = parseResult.error.issues.map((i) => i.message).join("; ");
    logger.warn({ request_id: requestId, error: message }, "Validation failed");
    appendChatAudit({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      model: req.body?.model ?? "unknown",
      messages: req.body?.messages,
      latency_ms: Date.now() - startTime,
      error_code: "VALIDATION_ERROR",
    });
    res.status(400).json({
      request_id: requestId,
      model: req.body?.model ?? "",
      reply: "",
      latency_ms: Date.now() - startTime,
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message, code: "VALIDATION_ERROR" },
    });
    return;
  }

  const body = parseResult.data;
  const { model } = body;

  // Get adapter (unknown model -> 400; adapter init error e.g. LLAMA_CPP_NOT_CONFIGURED -> 500)
  let adapter;
  try {
    adapter = getAdapter(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown model";
    const code = hasErrorCode(err) ? err.code : "UNKNOWN_MODEL";
    const status = hasErrorCode(err) ? 500 : 400;

    logger.warn({ request_id: requestId, model, err }, status === 400 ? "Unknown model" : "Adapter init error");
    appendChatAudit({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      model,
      messages: body.messages,
      latency_ms: Date.now() - startTime,
      error_code: code,
    });
    res.status(status).json({
      request_id: requestId,
      model,
      reply: "",
      latency_ms: Date.now() - startTime,
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message, code },
    });
    return;
  }

  const chatReq = {
    model: body.model,
    messages: body.messages,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.max_tokens !== undefined && { max_tokens: body.max_tokens }),
  };

  // ── Streaming path ──────────────────────────────────────────────────────
  if (body.stream && typeof adapter.chatStream === "function") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullReply = "";
    try {
      for await (const token of adapter.chatStream(chatReq)) {
        fullReply += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      const latencyMs = Date.now() - startTime;
      res.write(`data: ${JSON.stringify({ done: true, latency_ms: latencyMs })}\n\n`);
      res.end();

      const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content;
      appendChatAudit({
        timestamp: new Date().toISOString(),
        request_id: requestId,
        model,
        messages: body.messages,
        ...(lastUserMsg !== undefined && { last_user_message: lastUserMsg }),
        latency_ms: latencyMs,
        requested_model: model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stream error";
      const code = hasErrorCode(err) ? err.code : "STREAM_ERROR";
      logger.error({ request_id: requestId, model, err }, "Stream error");
      res.write(`data: ${JSON.stringify({ error: message, code })}\n\n`);
      res.end();
    }
    return;
  }

  // ── Non-streaming path (eval scripts + RAG unaffected) ──────────────────
  try {
    const result = await adapter.chat(chatReq);
    const latencyMs = Date.now() - startTime;

    const usage = result.usage
      ? {
          prompt_tokens: result.usage.prompt_tokens ?? null,
          completion_tokens: result.usage.completion_tokens ?? null,
          total_tokens: result.usage.total_tokens ?? null,
        }
      : { prompt_tokens: null, completion_tokens: null, total_tokens: null };

    const upstream = result.upstream_log ?? getUpstreamInfoFromAdapter(adapter, model);
    const upstreamModelSent = upstream?.model_sent ?? "";

    if (PHASE1_MODELS.has(model) && !upstreamModelSent) {
      logger.warn(
        { request_id: requestId, model, upstream_model_sent: upstreamModelSent },
        "Phase-1 model has empty upstream_model_sent; verify upstream switching"
      );
    }

    logger.info({ request_id: requestId, model, latency_ms: latencyMs }, "Chat completed");

    const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content;
    appendChatAudit({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      model,
      messages: body.messages,
      ...(lastUserMsg !== undefined && { last_user_message: lastUserMsg }),
      latency_ms: latencyMs,
      requested_model: model,
      ...(upstream && {
        upstream_base_url: upstream.base_url,
        upstream_model_sent: upstream.model_sent,
      }),
    });

    res.json({
      request_id: requestId,
      model,
      reply: result.reply,
      latency_ms: latencyMs,
      usage,
      error: null,
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Adapter error";
    const code = hasErrorCode(err) ? err.code : "ADAPTER_ERROR";

    logger.error({ request_id: requestId, model, err }, "Adapter error");

    const upstream = getUpstreamInfoFromAdapter(adapter, model);
    appendChatAudit({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      model,
      messages: body.messages,
      latency_ms: latencyMs,
      error_code: code,
      requested_model: model,
      ...(upstream && {
        upstream_base_url: upstream.base_url,
        upstream_model_sent: upstream.model_sent,
      }),
    });

    res.status(500).json({
      request_id: requestId,
      model,
      reply: "",
      latency_ms: latencyMs,
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      error: { message, code },
    });
  }
}
