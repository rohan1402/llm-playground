/**
 * RAG evaluation harness.
 *
 * Usage: npm run eval:rag -- --docId <doc_id> [--baseUrl URL] [--model MODEL]
 * Input: data/eval/<doc_id>.jsonl
 *   Each line: { qid, question, answerable, evidence_pages? }
 * Output:
 *   CSV:   data/eval/rag_results_<doc_id>_<model>_<ts>.csv
 *   JSONL: data/eval/rag_answers_<doc_id>_<model>_<ts>.jsonl (full answers + citations)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const EVAL_DIR = path.join(DATA_DIR, "eval");

interface EvalRow {
  qid: number | string;
  question: string;
  answerable: boolean;
  evidence_pages?: number[];
}

interface RagSource {
  page: number;
  chunk_id: string;
  text: string;
}

interface RagResponse {
  answer: string;
  citations: Array<{ doc_id: string; page: number; quote: string; chunk_id: string }>;
  sources: RagSource[];
  is_answer_in_doc: boolean;
  latency_ms: number;
  token_usage: { prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null };
  error?: { message: string; code: string };
}

function parseArgs(): { docId: string; baseUrl: string; model: string } {
  const args = process.argv.slice(2);
  let docId = "";
  let baseUrl = "http://localhost:3000";
  let model = "groq-llama3-70b";
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === "--docId" && next) { docId = next; i++; }
    else if (args[i] === "--baseUrl" && next) { baseUrl = next; i++; }
    else if (args[i] === "--model" && next) { model = next; i++; }
  }
  return { docId, baseUrl, model };
}

async function callRag(baseUrl: string, docId: string, question: string, model: string): Promise<RagResponse> {
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/rag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, doc_id: docId, model, top_k: 8 }),
    });
    const data = (await res.json()) as RagResponse;
    if (data.error?.message?.includes("429") && attempt < maxRetries) {
      const wait = 60000 * (attempt + 1);
      console.log(`    Rate limited, waiting ${wait / 1000}s before retry...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return data;
  }
  throw new Error("Max retries exceeded");
}

function retrievalHit(res: RagResponse, evidencePages?: number[]): boolean {
  if (!evidencePages || evidencePages.length === 0) return true;
  const sourcedPages = new Set((res.sources ?? []).map((s) => s.page));
  const citedPages = new Set((res.citations ?? []).map((c) => c.page));
  return evidencePages.some((p) => sourcedPages.has(p) || citedPages.has(p));
}

function citationValid(res: RagResponse): boolean {
  if (res.error) return false;
  const notFound = /not found in the provided document/i.test(res.answer);
  if (notFound) return true;
  return (res.citations ?? []).length > 0;
}

async function run(): Promise<void> {
  const { docId, baseUrl, model } = parseArgs();
  if (!docId) {
    console.error("Usage: npm run eval:rag -- --docId <doc_id> [--baseUrl URL] [--model MODEL]");
    process.exit(1);
  }

  const inputPath = path.join(EVAL_DIR, `${docId}.jsonl`);
  if (!fs.existsSync(inputPath)) {
    console.error("Input not found:", inputPath);
    process.exit(1);
  }

  const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const rows: EvalRow[] = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line) as EvalRow); } catch { /* skip */ }
  }

  if (rows.length === 0) {
    console.error("No valid rows in", inputPath);
    process.exit(1);
  }

  console.log(`RAG eval: doc=${docId} model=${model} base=${baseUrl} rows=${rows.length}`);
  console.log("");

  const csvLines: string[] = ["qid,question,retrieval_hit,citation_valid,latency_ms,cited_pages"];
  const answerLines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i > 0) await new Promise((r) => setTimeout(r, 10000));
    const res = await callRag(baseUrl, docId, row.question, model);
    const retHit = retrievalHit(res, row.evidence_pages);
    const citValid = citationValid(res);
    const latency = res.latency_ms ?? 0;
    const citedPages = (res.citations ?? []).map((c) => c.page).join(";");

    csvLines.push(
      `${row.qid},"${row.question.replace(/"/g, '""')}",${retHit},${citValid},${latency},"${citedPages}"`
    );

    answerLines.push(JSON.stringify({
      qid: row.qid,
      question: row.question,
      answerable: row.answerable,
      evidence_pages: row.evidence_pages ?? [],
      model,
      answer: res.answer,
      citations: res.citations ?? [],
      sources_pages: (res.sources ?? []).map((s) => s.page),
      is_answer_in_doc: res.is_answer_in_doc,
      retrieval_hit: retHit,
      citation_valid: citValid,
      latency_ms: latency,
      token_usage: res.token_usage,
      error: res.error ?? null,
    }));

    const status = res.error ? `ERROR: ${res.error.message.slice(0, 60)}` : `ret=${retHit} cit=${citValid}`;
    console.log(`  [${row.qid}] ${status} latency=${latency}ms`);
  }

  const modelSlug = model.replace(/[^a-z0-9-]/gi, "_");
  const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  fs.mkdirSync(EVAL_DIR, { recursive: true });

  const csvPath = path.join(EVAL_DIR, `rag_results_${docId}_${modelSlug}_${ts}.csv`);
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf8");

  const answersPath = path.join(EVAL_DIR, `rag_answers_${docId}_${modelSlug}_${ts}.jsonl`);
  fs.writeFileSync(answersPath, answerLines.join("\n"), "utf8");

  console.log("");
  console.log("CSV written to", csvPath);
  console.log("Answers written to", answersPath);
  console.log("");
  console.log(csvLines.join("\n"));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
