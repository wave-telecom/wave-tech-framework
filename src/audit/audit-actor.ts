import { getHookCorrelationId, getHookRequestChannel, getHookUserId } from '../core/hooks';

/**
 * Actor/request-context resolvers for audit events, backed by the framework's
 * per-request hook context (opened by the `setContext` middleware). Single
 * source of coupling with the hooks — if the source changes, change it here.
 */
export interface AuditActor {
  actorId: string | null;
  correlationId: string | null;
  /** The channel that originated the change (`x-request-channel` header). */
  requestChannel: string | null;
}

export function getAuditActor(): AuditActor {
  return {
    actorId: getHookUserId() ?? null,
    correlationId: getHookCorrelationId() ?? null,
    requestChannel: getHookRequestChannel() ?? null,
  };
}
