import { describe, expect, it, vi } from 'vitest';
import {
  PrismaOutboxRelaySource,
  toRelayEvent,
  type StandardOutboxClient,
  type StandardOutboxRow,
} from '../../src/outbox-relay/prisma-outbox-relay-source';

const row = (overrides: Partial<StandardOutboxRow> = {}): StandardOutboxRow => ({
  id: '3f9a3a2e-0000-4000-8000-000000000001',
  resourceId: '3f9a3a2e-0000-4000-8000-00000000aaaa',
  resourceType: 'Broker',
  eventType: 'billing.broker.created',
  payload: { operation: 'CREATE' },
  idempotencyKey: null,
  published: false,
  publishedAt: null,
  parkedAt: null,
  parkReason: null,
  sink: 'events-api',
  createdAt: new Date('2026-09-01T10:15:01.000Z'),
  ...overrides,
});

const makeFakeClient = (rows: StandardOutboxRow[] = []) => {
  const findMany = vi.fn().mockResolvedValue(rows);
  const updateMany = vi.fn().mockResolvedValue({ count: rows.length });
  const update = vi.fn().mockResolvedValue(row());
  const deleteMany = vi.fn().mockResolvedValue({ count: rows.length });
  const client = { outbox: { findMany, updateMany, update, deleteMany } } as StandardOutboxClient;
  return { client, findMany, updateMany, update, deleteMany };
};

describe('toRelayEvent', () => {
  it('maps the outbox row onto the relay transport shape with the given source', () => {
    const event = toRelayEvent(
      row({
        eventType: 'billing.broker.updated',
        payload: {
          operation: 'UPDATE',
          occurredAt: '2026-09-01T10:15:00.000Z',
          correlationId: 'corr-123',
          changes: { name: { from: 'a', to: 'b' } },
        },
      }),
      'wave-billing-api',
    );

    expect(event).toMatchObject({
      source: 'wave-billing-api',
      eventType: 'billing.broker.updated',
      resourceType: 'Broker',
      occurredAt: '2026-09-01T10:15:00.000Z',
      correlationId: 'corr-123',
      idempotencyKey: undefined,
    });
  });

  it('falls back to created_at when the payload occurredAt is unusable', () => {
    const event = toRelayEvent(row({ payload: { occurredAt: 'not-a-date' } }), 'x');

    expect(event.occurredAt).toBe('2026-09-01T10:15:01.000Z');
  });

  it('carries the outbox idempotency key when the row has one', () => {
    const event = toRelayEvent(row({ idempotencyKey: 'broker-created-abc' }), 'x');

    expect(event.idempotencyKey).toBe('broker-created-abc');
  });

  it('promotes brokerId from the payload root to the event broker', () => {
    const event = toRelayEvent(row({ payload: { brokerId: 'broker-1' } }), 'x');

    expect(event.broker).toBe('broker-1');
  });

  it('promotes brokerId from the audit snapshot when the root has none', () => {
    const event = toRelayEvent(
      row({ payload: { operation: 'UPDATE', snapshot: { id: 'r-1', brokerId: 'broker-2' } } }),
      'x',
    );

    expect(event.broker).toBe('broker-2');
  });

  it('sets broker to null when the payload carries no brokerId', () => {
    const event = toRelayEvent(row({ payload: { operation: 'CREATE', snapshot: { id: 'r-1' } } }), 'x');

    expect(event.broker).toBeNull();
  });
});

describe('PrismaOutboxRelaySource', () => {
  it('claims only pending, unparked rows of its sink, oldest first, bounded by the limit', async () => {
    const { client, findMany } = makeFakeClient([row()]);
    const source = new PrismaOutboxRelaySource(client, 'wave-billing-api');

    const events = await source.claimPendingBatch(50);

    expect(findMany).toHaveBeenCalledWith({
      where: { sink: 'events-api', published: false, parkedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('wave-billing-api');
  });

  it('marks delivered rows published with a publication timestamp', async () => {
    const { client, updateMany } = makeFakeClient();
    const source = new PrismaOutboxRelaySource(client, 'x');

    await source.markDelivered(['a', 'b']);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: { published: true, publishedAt: expect.any(Date) },
    });
  });

  it('does not touch the database when there is nothing to settle', async () => {
    const { client, updateMany } = makeFakeClient();
    const source = new PrismaOutboxRelaySource(client, 'x');

    await source.markDelivered([]);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('parks an undeliverable event without pretending it was published', async () => {
    const { client, update } = makeFakeClient();
    const source = new PrismaOutboxRelaySource(client, 'x');

    await source.park('dead-event', 'payload rejected by the events API');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'dead-event' },
      data: { parkedAt: expect.any(Date), parkReason: 'payload rejected by the events API' },
    });
  });

  it('claims the sink it was constructed for — routing is the row writer decision', async () => {
    const { client, findMany } = makeFakeClient([]);
    const source = new PrismaOutboxRelaySource(client, 'wave-billing-api', 'kafka');

    await source.claimPendingBatch(10);

    expect(findMany).toHaveBeenCalledWith({
      where: { sink: 'kafka', published: false, parkedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  });

  it('carries the row sink on the relay event', () => {
    expect(toRelayEvent(row({ sink: 'kafka' }), 'x').sink).toBe('kafka');
    expect(toRelayEvent(row({ sink: null }), 'x').sink).toBeNull();
  });
});

describe('PrismaOutboxRelaySource.purgeDeliveredBatch', () => {
  const CUTOFF = new Date('2026-08-05T00:00:00.000Z');

  it('selects delivered rows older than the cutoff and deletes them by id', async () => {
    const delivered = [
      row({ id: 'old-1', published: true, publishedAt: new Date('2026-08-01T00:00:00.000Z') }),
      row({ id: 'old-2', published: true, publishedAt: new Date('2026-08-02T00:00:00.000Z') }),
    ];
    const { client, findMany, deleteMany } = makeFakeClient(delivered);
    const source = new PrismaOutboxRelaySource(client, 'x');

    const deleted = await source.purgeDeliveredBatch(CUTOFF, 100);

    // Sink-agnostic on purpose: delivered is transport history whatever bus
    // carried it. Pending/parked never match (published = false).
    expect(findMany).toHaveBeenCalledWith({
      where: { published: true, publishedAt: { lt: CUTOFF } },
      orderBy: { publishedAt: 'asc' },
      take: 100,
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1', 'old-2'] } } });
    expect(deleted).toBe(2);
  });

  it('short-circuits without a delete when nothing is eligible', async () => {
    const { client, deleteMany } = makeFakeClient([]);
    const source = new PrismaOutboxRelaySource(client, 'x');

    const deleted = await source.purgeDeliveredBatch(CUTOFF, 100);

    expect(deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
