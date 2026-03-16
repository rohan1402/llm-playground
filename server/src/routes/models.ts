/**
 * GET /models route.
 * Returns list of available model names.
 */

import type { Request, Response } from "express";
import { listModels } from "../llms/registry";

export function modelsHandler(_req: Request, res: Response): void {
  res.json({ models: listModels() });
}
