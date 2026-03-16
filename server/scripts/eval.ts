/**
 * Phase 1 evaluation runner.
 * Runs a prompt suite against selected models and saves results to eval/.
 *
 * Usage: npm run eval [-- --models <model-id> --baseUrl URL --concurrency N]
 *        Default: llama3.1-8b-instruct only. Pass --models for the model currently loaded (Option A).
 */

import * as fs from "node:fs";
import * as path from "node:path";

// --- Config ---

const REPO_ROOT = path.resolve(process.cwd(), "..");
const PROMPT_SUITE_PATH = path.join(REPO_ROOT, "docs", "eval", "prompt_suite.json");
const OUTPUT_DIR = path.join(REPO_ROOT, "eval");
// Option A: one model at a time. Default to single model; pass --models for the loaded model.
const DEFAULT_MODELS = ["llama3.1-8b-instruct"];
const REQUEST_TIMEOUT_MS = 120_000;

// --- Types ---

interface PromptSuiteMeta {
  name: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
}

interface PromptItem {
  id: string;
  category: string;
  prompt: string;
}

interface PromptSuite {
  meta: PromptSuiteMeta;
  prompts: PromptItem[];
}

interface ChatResponse {
  request_id: string;
  model: string;
  reply: string;
  latency_ms: number;
  usage: { prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null };
  error: { message: string; code: string } | null;
}

interface EvalRecord {
  run_id: string;
  timestamp: string;
  model: string;
  prompt_id: string;
  category: string;
  prompt: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  reply: string;
  latency_ms: number;
  usage: ChatResponse["usage"] | null;
  error: string | null;
  error_code: string | null;
  http_status: number;
}

// --- Args ---

function parseArgs(): {
  baseUrl: string;
  models: string[];
  concurrency: number;
} {
  const args = process.argv.slice(2);
  let baseUrl = process.env.EVAL_API_BASE_URL ?? "http://localhost:3000";
  let models = [...DEFAULT_MODELS];
  let concurrency = 1;

  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === "--baseUrl" && next) {
      baseUrl = next;
      i++;
    } else if (args[i] === "--models" && next) {
      models = next.split(",").map((m) => m.trim()).filter(Boolean);
      i++;
    } else if (args[i] === "--concurrency" && next) {
      const n = parseInt(next, 10);
      concurrency = Math.max(1, Number.isNaN(n) ? 1 : n);
      i++;
    }
  }

  return { baseUrl, models, concurrency };
}

// --- Fetch ---

async function fetchModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`);
  if (!res.ok) throw new Error(`GET /models failed: ${res.status}`);
  const data = (await res.json()) as { models?: string[] };
  return Array.isArray(data.models) ? data.models : [];
}

async function postChat(
  baseUrl: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<{ data: ChatResponse; httpStatus: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${baseUrl.replace(/\/$/, "")}/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);
  const data = (await res.json()) as ChatResponse;
  return { data, httpStatus: res.status };
}

// --- Run one task ---

async function runTask(
  baseUrl: string,
  model: string,
  prompt: PromptItem,
  meta: PromptSuiteMeta,
  runId: string
): Promise<EvalRecord> {
  const startWall = Date.now();
  const messages = [
    { role: "system" as const, content: meta.system_prompt },
    { role: "user" as const, content: prompt.prompt },
  ];

  let data: ChatResponse;
  let httpStatus: number;

  try {
    const result = await postChat(
      baseUrl,
      model,
      messages,
      meta.temperature,
      meta.max_tokens,
      REQUEST_TIMEOUT_MS
    );
    data = result.data;
    httpStatus = result.httpStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      run_id: runId,
      timestamp: new Date().toISOString(),
      model,
      prompt_id: prompt.id,
      category: prompt.category,
      prompt: prompt.prompt,
      system_prompt: meta.system_prompt,
      temperature: meta.temperature,
      max_tokens: meta.max_tokens,
      reply: "",
      latency_ms: Date.now() - startWall,
      usage: null,
      error: message,
      error_code: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
      http_status: 0,
    };
  }

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    model,
    prompt_id: prompt.id,
    category: prompt.category,
    prompt: prompt.prompt,
    system_prompt: meta.system_prompt,
    temperature: meta.temperature,
    max_tokens: meta.max_tokens,
    reply: data.reply ?? "",
    latency_ms: data.latency_ms ?? Date.now() - startWall,
    usage: data.usage ?? null,
    error: data.error?.message ?? null,
    error_code: data.error?.code ?? null,
    http_status: httpStatus,
  };
}

// --- Main ---

async function main(): Promise<void> {
  const { baseUrl, models, concurrency } = parseArgs();

  console.log("Phase 1 eval runner");
  console.log("  baseUrl:", baseUrl);
  console.log("  models:", models.join(", "));
  console.log("  concurrency:", concurrency);

  // Load prompt suite
  if (!fs.existsSync(PROMPT_SUITE_PATH)) {
    console.error("Prompt suite not found:", PROMPT_SUITE_PATH);
    process.exit(1);
  }

  const suite = JSON.parse(fs.readFileSync(PROMPT_SUITE_PATH, "utf-8")) as PromptSuite;
  const { meta, prompts } = suite;

  if (!meta?.name || !Array.isArray(prompts)) {
    console.error("Invalid prompt suite format");
    process.exit(1);
  }

  // Fetch available models
  let availableModels: string[];
  try {
    availableModels = await fetchModels(baseUrl);
  } catch (err) {
    console.error("Failed to fetch models:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const toEvaluate = models.filter((m) => {
    if (availableModels.includes(m)) return true;
    console.warn(`[skip] Model not available: ${m}`);
    return false;
  });

  if (toEvaluate.length === 0) {
    console.error("No models to evaluate");
    process.exit(1);
  }

  const runId = `run_${Date.now()}`;
  const timestamp = new Date();
  const timestampStr = timestamp.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);

  const outputDir = OUTPUT_DIR;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(
    outputDir,
    `results_${meta.name}_${timestampStr}.jsonl`
  );

  // Build tasks: (model, prompt) pairs
  const tasks: { model: string; prompt: PromptItem }[] = [];
  for (const model of toEvaluate) {
    for (const prompt of prompts) {
      tasks.push({ model, prompt });
    }
  }

  console.log(`\nRunning ${tasks.length} tasks (${toEvaluate.length} models × ${prompts.length} prompts)...\n`);

  const results: EvalRecord[] = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(({ model, prompt }) => runTask(baseUrl, model, prompt, meta, runId))
    );
    results.push(...batchResults);

    for (const r of batchResults) {
      const status = r.error ? "FAIL" : "OK";
      const short = r.reply.slice(0, 40).replace(/\n/g, " ");
      console.log(`  [${status}] ${r.model} / ${r.prompt_id}: ${short}${r.reply.length > 40 ? "..." : ""}`);
    }
  }

  // Write JSONL
  const lines = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(outputPath, lines);
  console.log(`\nResults written to ${outputPath}`);

  // Summary
  const total = results.length;
  const succeeded = results.filter((r) => !r.error && r.http_status >= 200 && r.http_status < 300).length;
  const failed = total - succeeded;

  const byModel = new Map<string, { latencies: number[]; errors: number }>();
  for (const r of results) {
    if (!byModel.has(r.model)) byModel.set(r.model, { latencies: [], errors: 0 });
    const entry = byModel.get(r.model)!;
    if (!r.error && r.http_status >= 200 && r.http_status < 300) {
      entry.latencies.push(r.latency_ms);
    } else {
      entry.errors++;
    }
  }

  const errorCounts = new Map<string, number>();
  for (const r of results) {
    if (r.error_code) {
      errorCounts.set(r.error_code, (errorCounts.get(r.error_code) ?? 0) + 1);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total requests: ${total}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log("\nAvg latency_ms per model (exclude failures):");
  for (const [model, { latencies }] of byModel) {
    const avg =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    console.log(`  ${model}: ${avg !== null ? avg.toFixed(0) : "N/A"} ms`);
  }
  if (errorCounts.size > 0) {
    console.log("\nError counts by code:");
    for (const [code, count] of errorCounts) {
      console.log(`  ${code}: ${count}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
