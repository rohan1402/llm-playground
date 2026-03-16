/**
 * Error utilities for adapter error handling.
 */

/** Type guard: error has a code property (e.g. LlamaCppError, custom adapter errors). */
export function hasErrorCode(err: unknown): err is { message: string; code: string } {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}
