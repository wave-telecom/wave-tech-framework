import { describe, expect, it } from 'vitest';
import { getAuditActor } from '../../src/audit/audit-actor';
import {
  setHookContext,
  setHookCorrelationId,
  setHookRequestChannel,
  setHookUserId,
} from '../../src/core/hooks';

describe('getAuditActor', () => {
  it('reads actorId, correlationId and requestChannel from the request hook context', () => {
    setHookContext(() => {
      setHookUserId('user-123');
      setHookCorrelationId('corr-abc');
      setHookRequestChannel('console');

      expect(getAuditActor()).toEqual({
        actorId: 'user-123',
        correlationId: 'corr-abc',
        requestChannel: 'console',
      });
    });
  });

  it('falls back to null when there is no hook context', () => {
    expect(getAuditActor()).toEqual({
      actorId: null,
      correlationId: null,
      requestChannel: null,
    });
  });
});
