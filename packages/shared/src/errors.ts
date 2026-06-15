export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed.") {
    super(message, 400, "VALIDATION_ERROR", false);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super(message, 401, "UNAUTHORIZED", false);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, 403, "FORBIDDEN", false);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Record not found.") {
    super(message, 404, "NOT_FOUND", false);
  }
}

export class SourceFetchError extends AppError {
  constructor(message: string, retryable = true) {
    super(message, 503, "SOURCE_FETCH_ERROR", retryable);
  }
}

export class PermanentSourceError extends AppError {
  constructor(message: string) {
    super(message, 503, "PERMANENT_SOURCE_ERROR", false);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
