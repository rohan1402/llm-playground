/**
 * Health check route.
 */

import type { Request, Response } from "express";

export function healthHandler(_req: Request, res: Response): void {
  res.json({ ok: true });
}
