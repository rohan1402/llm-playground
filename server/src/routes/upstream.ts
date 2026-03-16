/**
 * GET /upstream/status
 * Probes the OpenAI-compatible llama server to verify reachability and report loaded model.
 */

import type { Request, Response } from "express";
import { fetchWithTimeout } from "../utils/fetch";

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const STATUS_TIMEOUT_MS = 10_000; // Longer when upstream is busy (e.g. during eval)

interface UpstreamStatusResponse {
  baseUrl: string;
  reachable: boolean;
  latency_ms: number | null;
  upstream: {
    model_id: string | null;
    raw: unknown;
  };
  error: { message: string; code: string } | null;
}

function trimRaw(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (obj.data && Array.isArray(obj.data)) {
      const arr = obj.data as unknown[];
      return {
        ...obj,
        data: arr.slice(0, 5).map((item) => {
          if (item && typeof item === "object" && "id" in item) {
            return { id: (item as { id: unknown }).id };
          }
          return item;
        }),
      };
    }
  }
  return data;
}

export async function upstreamStatusHandler(_req: Request, res: Response): Promise<void> {
  const baseUrl = process.env.LLAMA_CPP_BASE_URL?.trim();

  if (!baseUrl) {
    const payload: UpstreamStatusResponse = {
      baseUrl: "",
      reachable: false,
      latency_ms: null,
      upstream: { model_id: null, raw: null },
      error: {
        message: "LLAMA_CPP_BASE_URL is not set",
        code: "LLAMA_CPP_NOT_CONFIGURED",
      },
    };
    res.json(payload);
    return;
  }

  const normalized = baseUrl.replace(/\/$/, "");

  // Try /v1/models first (OpenAI-compatible). Retry once if busy (e.g. during eval).
  const modelsUrl = `${normalized}/v1/models`;
  const start = Date.now();

  const fetchModels = () =>
    fetchWithTimeout(modelsUrl, {
      method: "GET",
      timeoutMs: STATUS_TIMEOUT_MS,
    });

  let response: FetchResponse;
  try {
    response = await fetchModels();
  } catch (firstErr) {
    // Retry once when upstream is busy (e.g. during eval)
    try {
      response = await fetchModels();
    } catch {
      throw firstErr;
    }
  }

  const latencyMs = Date.now() - start;

  try {
    if (!response.ok) {
      // /v1/models not supported (e.g. 404) – try /health
      try {
        const healthUrl = `${normalized}/health`;
        const healthStart = Date.now();
        const healthRes = await fetchWithTimeout(healthUrl, {
          method: "GET",
          timeoutMs: STATUS_TIMEOUT_MS,
        });
        const healthLatency = Date.now() - healthStart;
        if (healthRes.ok) {
          let raw: unknown = null;
          try {
            raw = await healthRes.json();
          } catch {
            raw = { ok: true };
          }
          const payload: UpstreamStatusResponse = {
            baseUrl: normalized,
            reachable: true,
            latency_ms: healthLatency,
            upstream: { model_id: null, raw: trimRaw(raw) },
            error: null,
          };
          res.json(payload);
          return;
        }
      } catch {
        /* fall through to error response */
      }
      const text = await response.text();
      let raw: unknown = null;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = { _preview: text.slice(0, 200) };
      }
      const payload: UpstreamStatusResponse = {
        baseUrl: normalized,
        reachable: false,
        latency_ms: latencyMs,
        upstream: { model_id: null, raw: trimRaw(raw) },
        error: {
          message: `GET /v1/models returned ${response.status}`,
          code: "UPSTREAM_ERROR",
        },
      };
      res.json(payload);
      return;
    }

    const data = (await response.json()) as unknown;
    const trimmed = trimRaw(data);

    let modelId: string | null = null;
    const obj = data as Record<string, unknown>;
    if (obj && typeof obj === "object" && Array.isArray(obj.data)) {
      const arr = obj.data as Array<{ id?: string }>;
      const ids = arr.filter((item) => item?.id).map((item) => item.id as string);
      modelId = ids.length > 0 ? ids.join(", ") : null;
    }

    const payload: UpstreamStatusResponse = {
      baseUrl: normalized,
      reachable: true,
      latency_ms: latencyMs,
      upstream: { model_id: modelId, raw: trimmed },
      error: null,
    };
    res.json(payload);
    return;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isAbort = err instanceof Error && err.name === "AbortError";

    // Fallback: try /health
    try {
      const healthUrl = `${normalized}/health`;
      const healthStart = Date.now();
      const healthRes = await fetchWithTimeout(healthUrl, {
        method: "GET",
        timeoutMs: STATUS_TIMEOUT_MS,
      });
      const healthLatency = Date.now() - healthStart;

      if (healthRes.ok) {
        let raw: unknown = null;
        try {
          raw = await healthRes.json();
        } catch {
          raw = { ok: true };
        }
        const payload: UpstreamStatusResponse = {
          baseUrl: normalized,
          reachable: true,
          latency_ms: healthLatency,
          upstream: { model_id: null, raw: trimRaw(raw) },
          error: null,
        };
        res.json(payload);
        return;
      }
    } catch {
      // Fallback failed, use original error
    }

    const message = isAbort
      ? `Request timed out after ${STATUS_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : "Failed to reach upstream";
    const code = isAbort ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE";

    const payload: UpstreamStatusResponse = {
      baseUrl: normalized,
      reachable: false,
      latency_ms: latencyMs,
      upstream: { model_id: null, raw: null },
      error: { message, code },
    };
    res.json(payload);
  }
}
