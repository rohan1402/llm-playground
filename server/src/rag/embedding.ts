/**
 * EmbeddingProvider: embed(texts) -> vectors.
 * Uses @xenova/transformers (all-MiniLM-L6-v2) for local embeddings.
 */

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

type Extractor = (x: string | string[], opts?: { pooling?: string; normalize?: boolean }) => Promise<{ tolist: () => number[] | number[][] }>;

let pipeline: Extractor | null = null;

async function getPipeline(): Promise<Extractor> {
  if (pipeline) return pipeline;
  const { pipeline: p } = await import("@xenova/transformers");
  pipeline = (await p("feature-extraction", MODEL, { quantized: true })) as Extractor;
  return pipeline;
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const ext = await getPipeline();
    const output = await ext(texts, { pooling: "mean", normalize: true });
    const raw = output.tolist();
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows.map((r) => (Array.isArray(r) ? (r as number[]) : [r as number]));
  }
}

export function getEmbeddingDimension(): number {
  return DIM;
}
