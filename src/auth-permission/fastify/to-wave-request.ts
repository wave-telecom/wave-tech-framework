import type { FastifyRequest } from 'fastify';
import type { BrokerContext } from '../broker-context';
import type { WaveRequest } from '../shared/wave-request';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `registerPermissionAuth`'s hook. Absent on public paths. */
    brokerContext?: BrokerContext;
  }
}

/**
 * Fastify nests the raw Node request under `.raw`, so `rawHeaders` isn't
 * top-level the way `WaveRequest` (and a real Express `Request`) expects —
 * this is the one small per-request conversion the Fastify side needs that
 * Express doesn't.
 */
export function toWaveRequest(request: FastifyRequest): WaveRequest {
  return {
    headers: request.headers,
    rawHeaders: request.raw.rawHeaders,
    query: request.query,
  };
}
