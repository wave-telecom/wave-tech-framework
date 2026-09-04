import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EventSink } from '../../src/outbox-relay/event-sink';
import {
  NonRetryableSinkError,
  RetryableSinkError,
} from '../../src/outbox-relay/event-sink';
import type { OutboxRelaySource } from '../../src/outbox-relay/outbox-relay-source';
import type { RelayEvent } from '../../src/outbox-relay/relay-event';
import { OutboxRelayService } from '../../src/outbox-relay/outbox-relay-service';

function makeEvent(id: string, payload: Record<string, unknown> = { some: 'data' }): RelayEvent {
  return {
    id,
    source: 'some-producer-api',
    eventType: 'subscription.created',
    resourceType: 'subscription',
    resourceId: '22222222-2222-4222-8222-222222222222',
    broker: null,
    sink: 'events-api',
    payload,
    occurredAt: '2026-08-20T10:00:00.000Z',
  };
}

describe('OutboxRelayService', () => {
  let source: OutboxRelaySource;
  let sink: EventSink;

  beforeEach(() => {
    source = {
      claimPendingBatch: vi.fn(),
      markDelivered: vi.fn().mockResolvedValue(undefined),
      park: vi.fn().mockResolvedValue(undefined),
    };
    sink = {
      deliverBatch: vi.fn(),
      deliverOne: vi.fn(),
    };
  });

  const makeService = (batchSize = 3, maxBatchBytes = 100_000) =>
    new OutboxRelayService(source, sink, { batchSize, maxBatchBytes });

  describe('planDelivery', () => {
    it('splits by count', () => {
      const events = ['a', 'b', 'c', 'd', 'e'].map((id) => makeEvent(id));

      const plan = makeService(2).planDelivery(events);

      expect(plan.chunks.map((chunk) => chunk.map((event) => event.id)))
        .toEqual([['a', 'b'], ['c', 'd'], ['e']]);
      expect(plan.oversized).toEqual([]);
    });

    it('splits by serialized size', () => {
      const big = 'x'.repeat(400);
      const events = ['a', 'b', 'c'].map((id) => makeEvent(id, { big }));

      // Each event serializes to ~630 bytes; two exceed 1260 only with the
      // third, so the split lands after the second.
      const plan = makeService(10, 1360).planDelivery(events);

      expect(plan.chunks.map((chunk) => chunk.map((event) => event.id)))
        .toEqual([['a', 'b'], ['c']]);
    });

    it('parks an event that alone exceeds the size limit and keeps the rest', () => {
      const events = [
        makeEvent('small'),
        makeEvent('huge', { blob: 'x'.repeat(2_000) }),
        makeEvent('small-2'),
      ];

      const plan = makeService(10, 1_000).planDelivery(events);

      expect(plan.oversized).toHaveLength(1);
      expect(plan.oversized[0].id).toBe('huge');
      expect(plan.oversized[0].reason).toContain('byte');
      expect(plan.chunks.flat().map((event) => event.id)).toEqual(['small', 'small-2']);
    });
  });

  describe('deliverChunk', () => {
    it('returns every id delivered when the batch is accepted', async () => {
      vi.mocked(sink.deliverBatch).mockResolvedValue([
        { id: 'a', status: 'accepted' },
        { id: 'b', status: 'duplicate' },
      ]);

      const outcome = await makeService().deliverChunk([makeEvent('a'), makeEvent('b')]);

      // `duplicate` is a success: the destination already had the event.
      expect(outcome).toEqual({ deliveredIds: ['a', 'b'], parked: [] });
    });

    it('isolates the offender when the batch is rejected by contract', async () => {
      vi.mocked(sink.deliverBatch).mockRejectedValue(
        new NonRetryableSinkError('contract', 'batch rejected'),
      );
      vi.mocked(sink.deliverOne).mockImplementation((event) => {
        if (event.id === 'poison') {
          return Promise.reject(new NonRetryableSinkError('contract', 'invalid resourceId'));
        }
        return Promise.resolve({ id: event.id, status: 'accepted' as const });
      });

      const outcome = await makeService()
        .deliverChunk([makeEvent('a'), makeEvent('poison'), makeEvent('b')]);

      expect(outcome.deliveredIds).toEqual(['a', 'b']);
      expect(outcome.parked).toEqual([{ id: 'poison', reason: 'invalid resourceId' }]);
    });

    it('propagates retryable errors so the workflow step retries the chunk', async () => {
      vi.mocked(sink.deliverBatch).mockRejectedValue(new RetryableSinkError('503'));

      await expect(makeService().deliverChunk([makeEvent('a')]))
        .rejects.toBeInstanceOf(RetryableSinkError);
    });

    it('propagates configuration errors instead of parking anything', async () => {
      vi.mocked(sink.deliverBatch).mockRejectedValue(
        new NonRetryableSinkError('configuration', '401'),
      );

      await expect(makeService().deliverChunk([makeEvent('a')]))
        .rejects.toBeInstanceOf(NonRetryableSinkError);
      expect(sink.deliverOne).not.toHaveBeenCalled();
    });

    it('aborts isolation on a retryable error, leaving the rest pending', async () => {
      vi.mocked(sink.deliverBatch).mockRejectedValue(
        new NonRetryableSinkError('contract', 'batch rejected'),
      );
      vi.mocked(sink.deliverOne)
        .mockResolvedValueOnce({ id: 'a', status: 'accepted' })
        .mockRejectedValueOnce(new RetryableSinkError('outage mid-isolation'));

      await expect(makeService().deliverChunk([makeEvent('a'), makeEvent('b')]))
        .rejects.toBeInstanceOf(RetryableSinkError);
    });
  });

  describe('settle', () => {
    it('marks delivered ids and parks the rejected ones', async () => {
      await makeService().settle({
        deliveredIds: ['a', 'b'],
        parked: [{ id: 'poison', reason: 'invalid' }],
      });

      expect(source.markDelivered).toHaveBeenCalledWith(['a', 'b']);
      expect(source.park).toHaveBeenCalledWith('poison', 'invalid');
    });
  });

  describe('claimBatch', () => {
    it('claims with the configured batch size', async () => {
      vi.mocked(source.claimPendingBatch).mockResolvedValue([]);

      await makeService(42).claimBatch();

      expect(source.claimPendingBatch).toHaveBeenCalledWith(42);
    });
  });
});
