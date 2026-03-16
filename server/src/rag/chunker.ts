/**
 * Deterministic chunking with overlap.
 * Target ~500 tokens per chunk, ~17.5% overlap.
 * Splits at sentence boundaries within pages to keep chunks focused.
 */

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_RATIO = 0.175;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface TextSpan {
  text: string;
  page: number;
}

function splitIntoSentences(text: string, page: number): TextSpan[] {
  const parts = text.split(/(?<=[.!?;:\n])\s+/);
  return parts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, page }));
}

export function chunkPages(
  docId: string,
  pages: Array<{ page: number; text: string }>
): Array<{ chunk_id: string; doc_id: string; text: string; page_start: number; page_end: number; token_count: number }> {
  const allSpans: TextSpan[] = [];
  for (const { page, text } of pages) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    allSpans.push(...splitIntoSentences(trimmed, page));
  }

  const chunks: Array<{
    chunk_id: string;
    doc_id: string;
    text: string;
    page_start: number;
    page_end: number;
    token_count: number;
  }> = [];

  let spanIdx = 0;
  let chunkIndex = 0;

  while (spanIdx < allSpans.length) {
    let currentText = "";
    let pageStart = allSpans[spanIdx]!.page;
    let pageEnd = pageStart;
    const startIdx = spanIdx;

    while (spanIdx < allSpans.length) {
      const span = allSpans[spanIdx]!;
      const candidate = currentText ? currentText + " " + span.text : span.text;
      if (estimateTokens(candidate) > TARGET_TOKENS && currentText.length > 0) {
        break;
      }
      currentText = candidate;
      pageEnd = span.page;
      spanIdx++;
    }

    if (currentText.trim().length > 0) {
      chunkIndex++;
      chunks.push({
        chunk_id: `${docId}_chunk_${chunkIndex}`,
        doc_id: docId,
        text: currentText.trim(),
        page_start: pageStart,
        page_end: pageEnd,
        token_count: estimateTokens(currentText),
      });

      const overlapSpans = Math.max(1, Math.floor((spanIdx - startIdx) * OVERLAP_RATIO));
      spanIdx = Math.max(spanIdx - overlapSpans, startIdx + 1);
    }
  }

  return chunks;
}
