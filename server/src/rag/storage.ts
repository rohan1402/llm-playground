/**
 * Document storage: persist per-page text + metadata under ./data/docs/<doc_id>/
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { DocMeta, DocPage } from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DOCS_DIR = path.join(DATA_DIR, "docs");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDocDir(docId: string): string {
  return path.join(DOCS_DIR, docId);
}

export function saveDoc(docId: string, meta: DocMeta, pages: DocPage[]): void {
  ensureDir(DOCS_DIR);
  const dir = getDocDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "pages.json"), JSON.stringify(pages, null, 2), "utf8");
}

export function loadDocMeta(docId: string): DocMeta | null {
  const p = path.join(getDocDir(docId), "meta.json");
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as DocMeta;
}

export function loadDocPages(docId: string): DocPage[] | null {
  const p = path.join(getDocDir(docId), "pages.json");
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as DocPage[];
}

export function docExists(docId: string): boolean {
  return fs.existsSync(path.join(getDocDir(docId), "meta.json"));
}

export function listDocIds(): string[] {
  if (!fs.existsSync(DOCS_DIR)) return [];
  const entries = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && fs.existsSync(path.join(DOCS_DIR, e.name, "meta.json"))).map((e) => e.name);
}
