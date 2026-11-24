/**
 * An error that will fail the same way on every retry
 * (bad credentials, missing package.json, unsupported framework...).
 * The worker turns it into a BullMQ UnrecoverableError so the job
 * fails immediately instead of burning its remaining attempts.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function isNonRetryableError(error: unknown): error is NonRetryableError {
  return error instanceof NonRetryableError;
}
