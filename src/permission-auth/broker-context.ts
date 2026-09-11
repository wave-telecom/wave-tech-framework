import type { FastifyRequest } from 'fastify';
import { BrokerContextNotResolvedError } from './broker-context-not-resolved-error';

/** The broker scope `registerPermissionAuth` resolved for the in-flight request. Never empty. */
export interface BrokerContext {
  readonly scope: readonly string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `registerPermissionAuth`'s hook. Absent on public paths. */
    brokerContext?: BrokerContext;
  }
}

/**
 * The broker scope resolved for this request. Every route this hook actually
 * protects gets one — a missing context here is a route-wiring defect
 * (e.g. this route bypasses the hook somehow), not something a caller
 * triggered, hence the `500` instead of a `4xx`.
 */
export function requireBrokerContext(request: FastifyRequest): BrokerContext {
  if (request.brokerContext === undefined) {
    throw new BrokerContextNotResolvedError();
  }

  return request.brokerContext;
}
