import { countRawHeader } from './raw-headers';
import type { WaveRequest } from './wave-request';

export function readApiKey(request: WaveRequest, apiKeyHeader: string): string | undefined {
  const header = request.headers[apiKeyHeader];
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

/**
 * Reads the session token out of `Authorization: Bearer <token>`. Anything
 * that doesn't conform — a repeated header, a different scheme, an empty
 * token — resolves as `undefined`, the same as the header being absent
 * entirely: this is a credential lookup, not validation, and a caller with a
 * malformed header must not be told anything more than one with no header
 * at all.
 */
export function readBearerToken(
  request: WaveRequest,
  authorizationHeader: string,
): string | undefined {
  const header = request.headers[authorizationHeader];
  if (Array.isArray(header) || countRawHeader(request.rawHeaders, authorizationHeader) > 1) {
    return undefined;
  }

  const match = typeof header === 'string' ? /^Bearer (.+)$/i.exec(header) : null;
  return match?.[1];
}
