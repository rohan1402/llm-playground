/**
 * Simple keyword-boost re-ranking.
 * Chunks containing question terms are promoted; helps when embeddings miss exact phrasing.
 */

import type { Chunk } from "./types";

const STOPWORDS = new Set([
  "how", "what", "when", "where", "why", "who", "which", "do", "does", "did",
  "is", "are", "was", "were", "the", "a", "an", "in", "on", "at", "to", "for",
  "of", "and", "or", "if", "my", "i", "me", "can", "should", "would", "could",
]);

function extractKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

export function rerankByKeywords(
  results: Array<{ chunk: Chunk; score: number }>,
  question: string
): Array<{ chunk: Chunk; score: number }> {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return results;

  const textLower = (c: Chunk) => c.text.toLowerCase();
  return [...results].sort((a, b) => {
    const aHits = keywords.filter((k) => textLower(a.chunk).includes(k)).length;
    const bHits = keywords.filter((k) => textLower(b.chunk).includes(k)).length;
    if (aHits !== bHits) return bHits - aHits; // more keyword matches first
    return b.score - a.score; // tiebreak by vector score
  });
}
