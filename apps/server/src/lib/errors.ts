export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'FORBIDDEN', message);

/** Error raised by an upstream AI provider. */
export class ProviderError extends HttpError {
  constructor(provider: string, message: string, public upstreamStatus?: number, details?: unknown) {
    super(upstreamStatus === 401 || upstreamStatus === 403 ? 400 : 502, 'PROVIDER_ERROR', `[${provider}] ${message}`, details);
  }
}
