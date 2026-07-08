import { describe, expect, it } from 'vitest';
import { getAuditActor } from '../../src/audit/audit-actor';
import {
  setHookContext,
  setHookCorrelationId,
  setHookUserId,
} from '../../src/core/hooks';

describe('getAuditActor', () => {
  it('reads actorId and correlationId from the request hook context', () => {
    setHookContext(() => {
      setHookUserId('user-123');
      setHookCorrelationId('corr-abc');

      expect(getAuditActor()).toEqual({
        actorId: 'user-123',
        correlationId: 'corr-abc',
      });
    });
  });

  it('falls back to null when there is no hook context', () => {
    expect(getAuditActor()).toEqual({ actorId: null, correlationId: null });
  });
});
