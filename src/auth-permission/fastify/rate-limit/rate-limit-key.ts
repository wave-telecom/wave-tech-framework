import type { FastifyRequest } from 'fastify';
import { readApiKeys, readBearerToken } from '../../shared/read-credentials';
import { toWaveRequest } from '../to-wave-request';

/**
 * The default `keyGenerator` for `PermissionAuthOptions.rateLimit`: buckets
 * by the credential itself (the API key or session token presented) rather
 * than by `request.ip`. Grouping by IP would conflate every caller behind
 * the same NAT/gateway into one bucket and let a single leaked credential
 * roam free across IPs; grouping by credential does the opposite of both.
 * Falls back to `request.ip` only when no credential was presented at all
 * (still useful to cap unauthenticated request floods). Every API key
 * presented gets its own bucket checked, since any one of them may be the
 * one that authenticates.
 */
export function credentialRateLimitKeys(
  apiKeyHeaders: readonly string[],
  authorizationHeader: string,
): (request: FastifyRequest) => string[] {
  return (request) => {
    const waveRequest = toWaveRequest(request);
    const apiKeys = readApiKeys(waveRequest, apiKeyHeaders);
    if (apiKeys.length > 0) {
      return apiKeys;
    }
    return [readBearerToken(waveRequest, authorizationHeader) ?? request.ip];
  };
}
