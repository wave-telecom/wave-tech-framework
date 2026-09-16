import { BrokerContextNotResolvedError } from './errors/broker-context-not-resolved-error';

/**
 * The broker scope `registerPermissionAuth`/`expressRegisterPermissionAuth`
 * resolved for the in-flight request. Never empty.
 */
export interface BrokerContext {
  readonly scope: readonly string[];
}

/**
 * The broker scope resolved for this request. Every route this hook actually
 * protects gets one — a missing context here is a route-wiring defect
 * (e.g. this route bypasses the hook somehow), not something a caller
 * triggered, hence the `500` instead of a `4xx`.
 *
 * Framework-neutral by design: the actual `brokerContext?: BrokerContext`
 * augmentation of the real request type lives next to each framework's own
 * orchestrator (`to-wave-request.ts` for Fastify, `express/express-request.ts`
 * for Express), never here — this file is on the shared export path, and an
 * Express-only consumer resolving a `declare module 'fastify'` augmentation
 * here would drag in an unresolvable `fastify` type import for no reason.
 */
export function requireBrokerContext(request: { brokerContext?: BrokerContext }): BrokerContext {
  if (request.brokerContext === undefined) {
    throw new BrokerContextNotResolvedError();
  }

  return request.brokerContext;
}
