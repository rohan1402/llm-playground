/**
 * Extract citations from model answer + retrieved chunks.
 * Ensures citation.quote is a substring of the chunk text.
 */

import type { Chunk, Citation } from "./types";

/**
 * Matches common citation formats:
 *   [Page 84], [Page 84-86], (Page 84), (Page 84-86),
 *   [page 84], (p. 84), [p84], Page 84, etc.
 */
const PAGE_CITATION_PATTERNS = [
  /[\[(]Page\s*(\d+)(?:\s*[-–]\s*(\d+))?[\])]/gi,
  /[\[(]p\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?[\])]/gi,
  /(?:^|[^a-z])Page\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi,
];

function extractCitedPages(answer: string): number[] {
  const pages = new Set<number>();
  for (const regex of PAGE_CITATION_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(answer)) !== null) {
      const start = parseInt(m[1] ?? "1", 10);
      const end = m[2] != null ? parseInt(m[2], 10) : start;
      for (let p = start; p <= end; p++) pages.add(p);
    }
  }
  return Array.from(pages);
}

export function buildCitations(
  answer: string,
  chunks: Chunk[],
  docId: string
): Citation[] {
  const cited = extractCitedPages(answer);
  const out: Citation[] = [];

  for (const page of cited) {
    const chunk = chunks.find(
      (c) => page >= c.page_start && page <= c.page_end
    );
    if (!chunk) continue;
    const quote = chunk.text.slice(0, 200).trim();
    if (!quote) continue;
    out.push({
      doc_id: docId,
      page,
      quote,
      chunk_id: chunk.chunk_id,
    });
  }

  return out;
}
