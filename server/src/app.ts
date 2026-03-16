/**
 * LLM Playground backend.
 * Express server with /health and /chat endpoints.
 */

import dotenv from "dotenv";
import path from "path";

// Load .env from project root (parent of server/) when running from server/
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config(); // server/.env overrides if present
import express from "express";
import cors from "cors";
import { healthHandler } from "./routes/health";
import { chatHandler } from "./routes/chat";
import { chatRagHandler } from "./routes/chatRag";
import { docsUploadHandler } from "./routes/docs";
import { modelsHandler } from "./routes/models";
import { upstreamStatusHandler } from "./routes/upstream";
import { uploadPdf } from "./middleware/upload";
import { logger } from "./utils/logger";

const PORT = Number(process.env.PORT) || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

const app = express();

// JSON body parsing
app.use(express.json());

// CORS: allow frontend origin
app.use(
  cors({
    origin: CORS_ORIGIN,
  })
);

// Routes
app.get("/health", healthHandler);
app.get("/models", modelsHandler);
app.get("/upstream/status", upstreamStatusHandler);
app.post("/chat", chatHandler);
app.post("/chat/rag", chatRagHandler);
app.post("/docs/upload", uploadPdf, docsUploadHandler);

app.listen(PORT, () => {
  logger.info({ port: PORT, cors_origin: CORS_ORIGIN }, "Server started");
});
