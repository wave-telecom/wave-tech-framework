import { getHookCorrelationId } from '../core';

/**
 * Builds the `x-correlation-id` header for an outbound request, propagating
 * the correlation id of the in-flight request when present. Returns an empty
 * object when no correlation id is in scope so it can always be spread into
 * a request's headers — sending an empty header value would be worse than
 * omitting it, since it would defeat the downstream generation of a fresh id.
 */
export const correlationHeaders = (): Record<string, string> => {
  const correlationId = getHookCorrelationId();
  return correlationId ? { 'x-correlation-id': correlationId } : {};
};
