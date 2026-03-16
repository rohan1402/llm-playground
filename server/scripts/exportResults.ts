import * as fs from "node:fs";
import * as path from "node:path";

interface EvalRecord {
  model?: unknown;
  prompt_id?: unknown;
  category?: unknown;
  prompt?: unknown;
  reply?: unknown;
  latency_ms?: unknown;
}

interface FormattedRecord {
  promptId: string;
  category: string;
  prompt: string;
  reply: string;
  latency: string;
}

function toText(value: unknown, fallback = "N/A"): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function formatLatency(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)} ms`;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return `${Math.round(numeric)} ms`;
    }
  }
  return "N/A";
}

function sanitizeFilePart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "unknown_model";
}

function main(): void {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error("Missing input file path. Usage: ts-node scripts/exportResults.ts <path-to-jsonl>");
    process.exit(1);
  }

  const inputPath = path.isAbsolute(inputArg)
    ? inputArg
    : path.resolve(process.cwd(), inputArg);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let fileContent = "";
  try {
    fileContent = fs.readFileSync(inputPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read file: ${message}`);
    process.exit(1);
  }

  const rawLines = fileContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rawLines.length === 0) {
    console.error(`Input file is empty or contains no JSONL entries: ${inputPath}`);
    process.exit(1);
  }

  const records: FormattedRecord[] = [];
  let invalidLineCount = 0;
  let modelName = "unknown_model";

  for (const line of rawLines) {
    let parsed: EvalRecord;
    try {
      parsed = JSON.parse(line) as EvalRecord;
    } catch {
      invalidLineCount += 1;
      continue;
    }

    if (modelName === "unknown_model" && typeof parsed.model === "string" && parsed.model.trim().length > 0) {
      modelName = parsed.model.trim();
    }

    records.push({
      promptId: toText(parsed.prompt_id),
      category: toText(parsed.category),
      prompt: toText(parsed.prompt, ""),
      reply: toText(parsed.reply, ""),
      latency: formatLatency(parsed.latency_ms),
    });
  }

  if (records.length === 0) {
    console.error("No valid JSON entries were found in the input file.");
    process.exit(1);
  }

  const serverRoot = path.resolve(__dirname, "..");
  const exportsDir = path.join(serverRoot, "exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const outputPath = path.join(
    exportsDir,
    `${sanitizeFilePart(modelName)}_formatted_results.txt`
  );

  const separator = "-".repeat(60);
  const outputLines: string[] = [];

  for (const record of records) {
    outputLines.push(separator);
    outputLines.push(`Prompt ID: ${record.promptId}`);
    outputLines.push(`Category: ${record.category}`);
    outputLines.push(`Latency: ${record.latency}`);
    outputLines.push("");
    outputLines.push("PROMPT:");
    outputLines.push(record.prompt);
    outputLines.push("");
    outputLines.push("RESPONSE:");
    outputLines.push(record.reply);
    outputLines.push("");
  }

  outputLines.push(separator);

  try {
    fs.writeFileSync(outputPath, outputLines.join("\n"), "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to write output file: ${message}`);
    process.exit(1);
  }

  if (invalidLineCount > 0) {
    console.warn(`Skipped ${invalidLineCount} invalid JSONL line(s).`);
  }

  console.log(`Results exported successfully to ${outputPath}`);
}

main();
