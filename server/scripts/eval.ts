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
  temperatures: number[];
} {
  const args = process.argv.slice(2);
  let baseUrl = process.env.EVAL_API_BASE_URL ?? "http://localhost:3000";
  let models = [...DEFAULT_MODELS];
  let concurrency = 1;
  let temperatures: number[] = [];

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
    } else if ((args[i] === "--temperature" || args[i] === "--temperatures") && next) {
      // Accept both --temperature 0.2 and --temperatures 0,0.2,0.7
      temperatures = next
        .split(",")
        .map((t) => parseFloat(t.trim()))
        .filter((t) => !isNaN(t) && t >= 0 && t <= 2);
      i++;
    }
  }

  return { baseUrl, models, concurrency, temperatures };
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

// --- Run all prompts for one temperature ---

async function runForTemperature(
  baseUrl: string,
  toEvaluate: string[],
  prompts: PromptItem[],
  meta: PromptSuiteMeta,
  concurrency: number
): Promise<void> {
  const runId = `run_${Date.now()}`;
  const timestampStr = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const outputPath = path.join(OUTPUT_DIR, `results_${meta.name}_${timestampStr}.jsonl`);

  const tasks: { model: string; prompt: PromptItem }[] = [];
  for (const model of toEvaluate) {
    for (const prompt of prompts) {
      tasks.push({ model, prompt });
    }
  }

  console.log(`\n[temp=${meta.temperature}] Running ${tasks.length} tasks (${toEvaluate.length} models × ${prompts.length} prompts)...`);

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

  const lines = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(outputPath, lines);
  console.log(`\n[temp=${meta.temperature}] Results written to ${outputPath}`);

  const succeeded = results.filter((r) => !r.error && r.http_status >= 200 && r.http_status < 300).length;
  console.log(`[temp=${meta.temperature}] ${succeeded}/${results.length} succeeded`);
}

// --- Main ---

async function main(): Promise<void> {
  const { baseUrl, models, concurrency, temperatures } = parseArgs();

  // Default to prompt suite temperature if none specified
  const suite = (() => {
    if (!fs.existsSync(PROMPT_SUITE_PATH)) {
      console.error("Prompt suite not found:", PROMPT_SUITE_PATH);
      process.exit(1);
    }
    return JSON.parse(fs.readFileSync(PROMPT_SUITE_PATH, "utf-8")) as PromptSuite;
  })();

  if (!suite.meta?.name || !Array.isArray(suite.prompts)) {
    console.error("Invalid prompt suite format");
    process.exit(1);
  }

  const tempsToRun = temperatures.length > 0 ? temperatures : [suite.meta.temperature];

  console.log("Phase 1 eval runner");
  console.log("  baseUrl:", baseUrl);
  console.log("  models:", models.join(", "));
  console.log("  concurrency:", concurrency);
  console.log("  temperatures:", tempsToRun.join(", "));

  // Fetch available models once
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

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Run once per temperature, writing a separate JSONL file each time
  for (const temp of tempsToRun) {
    const meta = { ...suite.meta, temperature: temp };
    await runForTemperature(baseUrl, toEvaluate, suite.prompts, meta, concurrency);
  }

  console.log(`\nDone. ${tempsToRun.length} temperature(s) × ${toEvaluate.length} model(s) complete.`);
  console.log("Run `npm run analyze:temp` to see the ablation comparison.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
