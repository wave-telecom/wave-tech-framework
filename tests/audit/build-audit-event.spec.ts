import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuditEvent,
  diff,
  resolveOperationKind,
} from '../../src/audit/build-audit-event';
import type { AuditActor } from '../../src/audit/audit-actor';
import { Logger } from '../../src/core/logger';

const actor: AuditActor = { actorId: 'user-1', correlationId: 'corr-1' };

describe('resolveOperationKind', () => {
  it('maps create -> CREATE and delete -> DELETE', () => {
    expect(resolveOperationKind('create', null)).toBe('CREATE');
    expect(resolveOperationKind('delete', { id: 1 })).toBe('DELETE');
  });

  it('maps update -> UPDATE', () => {
    expect(resolveOperationKind('update', { id: 1 })).toBe('UPDATE');
  });

  it('resolves upsert by presence of the previous row', () => {
    expect(resolveOperationKind('upsert', null)).toBe('CREATE');
    expect(resolveOperationKind('upsert', { id: 1 })).toBe('UPDATE');
  });
});

describe('diff', () => {
  it('returns null when either side is missing', () => {
    expect(diff(null, { a: 1 })).toBeNull();
    expect(diff({ a: 1 }, null)).toBeNull();
  });

  it('reports only the changed fields as { from, to }', () => {
    expect(diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({
      b: { from: 2, to: 3 },
    });
  });

  it('captures added and removed keys', () => {
    expect(diff({ a: 1 }, { a: 1, c: 9 })).toEqual({
      c: { from: undefined, to: 9 },
    });
  });

  it('is JSON-safe (Date -> ISO string)', () => {
    const before = { at: new Date('2020-01-01T00:00:00.000Z') };
    const after = { at: new Date('2021-01-01T00:00:00.000Z') };
    expect(diff(before, after)).toEqual({
      at: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
    });
  });
});

describe('buildAuditEvent', () => {
  it('builds a CREATE event: Created suffix, snapshot = after, no changes', () => {
    const event = buildAuditEvent({
      model: 'Broker',
      operation: 'create',
      before: null,
      after: { id: 42, name: 'ACME' },
      actor,
    });

    expect(event.resourceType).toBe('Broker');
    expect(event.resourceId).toBe('42');
    expect(event.eventType).toBe('Audit.BrokerCreated');
    expect(event.payload.operation).toBe('CREATE');
    expect(event.payload.actorId).toBe('user-1');
    expect(event.payload.correlationId).toBe('corr-1');
    expect(event.payload.changes).toBeNull();
    expect(event.payload.snapshot).toEqual({ id: 42, name: 'ACME' });
    expect(typeof event.id).toBe('string');
    expect(typeof event.payload.occurredAt).toBe('string');
  });

  it('builds a DELETE event: Deleted suffix, snapshot = before', () => {
    const event = buildAuditEvent({
      model: 'Broker',
      operation: 'delete',
      before: { id: 7, name: 'old' },
      after: null,
      actor,
    });

    expect(event.eventType).toBe('Audit.BrokerDeleted');
    expect(event.payload.operation).toBe('DELETE');
    expect(event.payload.snapshot).toEqual({ id: 7, name: 'old' });
    expect(event.payload.changes).toBeNull();
  });

  it('omits changes on UPDATE when computeDiff is false (default)', () => {
    const event = buildAuditEvent({
      model: 'Broker',
      operation: 'update',
      before: { id: 1, name: 'a' },
      after: { id: 1, name: 'b' },
      actor,
    });

    expect(event.eventType).toBe('Audit.BrokerUpdated');
    expect(event.payload.changes).toBeNull();
    expect(event.payload.snapshot).toEqual({ id: 1, name: 'b' });
  });

  it('computes changes on UPDATE when computeDiff is true', () => {
    const event = buildAuditEvent({
      model: 'Broker',
      operation: 'update',
      before: { id: 1, name: 'a' },
      after: { id: 1, name: 'b' },
      actor,
      computeDiff: true,
    });

    expect(event.payload.changes).toEqual({ name: { from: 'a', to: 'b' } });
  });

  it('resolves upsert suffix from the previous row', () => {
    const created = buildAuditEvent({
      model: 'Broker', operation: 'upsert', before: null, after: { id: 1 }, actor,
    });
    const updated = buildAuditEvent({
      model: 'Broker', operation: 'upsert', before: { id: 1 }, after: { id: 1 }, actor,
    });

    expect(created.eventType).toBe('Audit.BrokerCreated');
    expect(updated.eventType).toBe('Audit.BrokerUpdated');
  });

  it('honors a custom eventPrefix and disables it with an empty string', () => {
    const prefixed = buildAuditEvent({
      model: 'Broker', operation: 'create', before: null, after: { id: 1 }, actor,
      eventPrefix: 'History.',
    });
    const bare = buildAuditEvent({
      model: 'Broker', operation: 'create', before: null, after: { id: 1 }, actor,
      eventPrefix: '',
    });

    expect(prefixed.eventType).toBe('History.BrokerCreated');
    expect(bare.eventType).toBe('BrokerCreated');
  });

  it('reads resourceId from a configurable idField', () => {
    const event = buildAuditEvent({
      model: 'UserProfile',
      operation: 'update',
      before: { userId: 'u-9' },
      after: { userId: 'u-9' },
      actor,
      idField: 'userId',
    });

    expect(event.resourceId).toBe('u-9');
  });

  describe('when the primary key is absent', () => {
    beforeEach(() => {
      vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });

    it('emits an empty resourceId and warns instead of the literal "undefined"', () => {
      const event = buildAuditEvent({
        model: 'Broker',
        operation: 'create',
        before: null,
        after: { name: 'no-id-here' },
        actor,
      });

      expect(event.resourceId).toBe('');
      expect(event.resourceId).not.toBe('undefined');
      expect(Logger.warn).toHaveBeenCalledOnce();
    });
  });
});
