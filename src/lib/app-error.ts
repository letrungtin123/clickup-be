export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  /** Optional machine-readable extras sent as `error.details` (e.g. KNOWLEDGE_VERSION_CONFLICT). Never secrets. */
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
