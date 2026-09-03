import { describe, expect, it } from 'vitest';
import {
  promoteBrokerId,
  promoteCorrelationId,
  promoteOccurredAt,
} from '../../src/outbox-relay/payload-promotion';

const CREATED_AT = new Date('2026-08-20T10:00:00.000Z');

describe('promoteOccurredAt', () => {
  it('promotes a parseable payload occurredAt, normalized to ISO', () => {
    expect(promoteOccurredAt({ occurredAt: '2026-08-19T08:30:00.000Z' }, CREATED_AT))
      .toBe('2026-08-19T08:30:00.000Z');
    expect(promoteOccurredAt({ occurredAt: '2026-08-19T08:30:00+02:00' }, CREATED_AT))
      .toBe('2026-08-19T06:30:00.000Z');
  });

  it('falls back when the payload carries no occurredAt', () => {
    expect(promoteOccurredAt({}, CREATED_AT)).toBe('2026-08-20T10:00:00.000Z');
  });

  it('falls back when the payload occurredAt is not a date', () => {
    expect(promoteOccurredAt({ occurredAt: 'not-a-date' }, CREATED_AT))
      .toBe('2026-08-20T10:00:00.000Z');
    expect(promoteOccurredAt({ occurredAt: 1755592200000 }, CREATED_AT))
      .toBe('2026-08-20T10:00:00.000Z');
  });
});

describe('promoteBrokerId', () => {
  it('promotes brokerId from the payload root', () => {
    expect(promoteBrokerId({ brokerId: 'broker-1' })).toBe('broker-1');
  });

  it('falls back to the audit snapshot brokerId', () => {
    expect(promoteBrokerId({ snapshot: { brokerId: 'broker-2' } })).toBe('broker-2');
  });

  it('prefers the payload root over the snapshot', () => {
    expect(promoteBrokerId({ brokerId: 'root', snapshot: { brokerId: 'snap' } })).toBe('root');
  });

  it('falls back to tenantId — the same boundary under another column name', () => {
    expect(promoteBrokerId({ tenantId: 'tenant-1' })).toBe('tenant-1');
    expect(promoteBrokerId({ snapshot: { tenantId: 'tenant-2' } })).toBe('tenant-2');
  });

  it('prefers brokerId over tenantId when both exist', () => {
    expect(promoteBrokerId({ brokerId: 'broker-1', tenantId: 'tenant-1' })).toBe('broker-1');
    expect(
      promoteBrokerId({ tenantId: 'tenant-1', snapshot: { brokerId: 'broker-2' } }),
    ).toBe('broker-2');
  });

  it('returns null when nothing carries a usable string', () => {
    expect(promoteBrokerId({})).toBeNull();
    expect(promoteBrokerId({ brokerId: '' })).toBeNull();
    expect(promoteBrokerId({ brokerId: 42 })).toBeNull();
    expect(promoteBrokerId({ snapshot: null })).toBeNull();
    expect(promoteBrokerId({ snapshot: { brokerId: null } })).toBeNull();
    expect(promoteBrokerId({ tenantId: 42, snapshot: { tenantId: '' } })).toBeNull();
  });
});

describe('promoteCorrelationId', () => {
  it('promotes a usable string', () => {
    expect(promoteCorrelationId({ correlationId: 'corr-42' })).toBe('corr-42');
  });

  it('ignores a correlationId that is not a usable string', () => {
    expect(promoteCorrelationId({})).toBeUndefined();
    expect(promoteCorrelationId({ correlationId: 42 })).toBeUndefined();
    expect(promoteCorrelationId({ correlationId: '' })).toBeUndefined();
    expect(promoteCorrelationId({ correlationId: 'x'.repeat(257) })).toBeUndefined();
  });

  it('keeps a correlationId exactly at the length limit', () => {
    const atLimit = 'x'.repeat(256);
    expect(promoteCorrelationId({ correlationId: atLimit })).toBe(atLimit);
  });

  it('honors a custom length limit', () => {
    expect(promoteCorrelationId({ correlationId: 'x'.repeat(20) }, 10)).toBeUndefined();
    expect(promoteCorrelationId({ correlationId: 'x'.repeat(300) }, 512))
      .toBe('x'.repeat(300));
  });
});
