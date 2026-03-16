/**
 * API client for LLM Playground backend.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export interface ChatResponse {
  request_id: string;
  model: string;
  reply: string;
  latency_ms: number;
  usage: ChatUsage;
  error: { message: string; code: string } | null;
}

export interface UpstreamStatus {
  baseUrl: string;
  reachable: boolean;
  latency_ms: number | null;
  upstream: { model_id: string | null; raw: unknown };
  error: { message: string; code: string } | null;
}

export async function fetchModels(): Promise<string[]> {
  const res = await fetch(`${API_URL}/models`);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const data = (await res.json()) as { models: string[] };
  return data.models;
}

export async function fetchUpstreamStatus(): Promise<UpstreamStatus> {
  const res = await fetch(`${API_URL}/upstream/status`);
  const data = (await res.json()) as UpstreamStatus;
  return data;
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const data = (await res.json()) as ChatResponse;
  if (!res.ok) throw new Error(data.error?.message || `Request failed: ${res.status}`);
  return data;
}
