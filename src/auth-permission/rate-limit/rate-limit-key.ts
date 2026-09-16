import type { FastifyRequest } from 'fastify';
import { readApiKey, readBearerToken } from '../shared/read-credentials';
import { toWaveRequest } from '../to-wave-request';

/**
 * The default `keyGenerator` for `PermissionAuthOptions.rateLimit`: buckets
 * by the credential itself (the API key or session token presented) rather
 * than by `request.ip`. Grouping by IP would conflate every caller behind
 * the same NAT/gateway into one bucket and let a single leaked credential
 * roam free across IPs; grouping by credential does the opposite of both.
 * Falls back to `request.ip` only when no credential was presented at all
 * (still useful to cap unauthenticated request floods).
 */
export function credentialRateLimitKey(
  apiKeyHeader: string,
  authorizationHeader: string,
): (request: FastifyRequest) => string {
  return (request) => {
    const waveRequest = toWaveRequest(request);
    return (
      readApiKey(waveRequest, apiKeyHeader) ??
      readBearerToken(waveRequest, authorizationHeader) ??
      request.ip
    );
  };
}
