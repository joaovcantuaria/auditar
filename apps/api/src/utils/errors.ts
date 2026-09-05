import { ErrorCodes, type ErrorCode } from '@auditar/shared';

/**
 * Typed application error carrying an HTTP status code, a machine-readable
 * error code and an optional offending field, so the global error handler can
 * serialize it into the ApiError response shape.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCode, message: string, field?: string) =>
  new AppError(400, code, message, field);

export const unauthorized = (message = 'Não autorizado') =>
  new AppError(401, ErrorCodes.INVALID_CREDENTIALS, message);

export const forbidden = (message = 'Acesso negado') =>
  new AppError(403, ErrorCodes.INSUFFICIENT_PERMISSIONS, message);

export const notFound = (code: ErrorCode, message: string) =>
  new AppError(404, code, message);
