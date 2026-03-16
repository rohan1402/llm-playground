/**
 * Multer middleware for PDF upload.
 */

import multer from "multer";
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

export const uploadPdf = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
}).single("file");
