import { getHookCorrelationId, getHookUserId } from '../core/hooks';

/**
 * Actor/correlation resolvers for audit events, backed by the framework's
 * per-request hook context (opened by the `setContext` middleware). Single
 * source of coupling with the hooks — if the source changes, change it here.
 */
export interface AuditActor {
  actorId: string | null;
  correlationId: string | null;
}

export function getAuditActor(): AuditActor {
  return {
    actorId: getHookUserId() ?? null,
    correlationId: getHookCorrelationId() ?? null,
  };
}
