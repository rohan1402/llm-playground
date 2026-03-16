/**
 * PDF parsing: extract text per page.
 * Uses unpdf extractText with mergePages: false.
 */

import type { DocPage } from "./types";

export async function extractPagesFromPdf(buffer: Buffer): Promise<DocPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { totalPages, text: textArray } = await extractText(pdf, { mergePages: false });
  const pages: DocPage[] = [];
  for (let i = 0; i < totalPages && i < textArray.length; i++) {
    const text = (textArray[i] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: i + 1, text });
  }
  return pages;
}
