import type { EventSink } from './event-sink';
import { NonRetryableSinkError } from './event-sink';
import type { OutboxRelaySource } from './outbox-relay-source';
import type { RelayEvent } from './relay-event';

export interface OutboxRelayServiceOptions {
  /** Events claimed per cycle and the ceiling of each delivery request. */
  batchSize: number;
  /** Serialized-size ceiling of one delivery request, in bytes. */
  maxBatchBytes: number;
}

export interface ParkedEvent {
  id: string;
  reason: string;
}

export interface DeliveryPlan {
  chunks: RelayEvent[][];
  /** Events that alone exceed the request size limit — undeliverable as-is. */
  oversized: ParkedEvent[];
}

export interface ChunkOutcome {
  deliveredIds: string[];
  parked: ParkedEvent[];
}

/**
 * One drain cycle, decomposed into the granular operations the durable
 * workflow checkpoints between: claim (db read), plan (pure), deliver
 * (network), settle (db write). No step holds a database transaction across
 * the network call, and nothing here knows about DBOS — the class is plain
 * code, unit-testable with fakes.
 */
export class OutboxRelayService {
  constructor(
    private readonly source: OutboxRelaySource,
    private readonly sink: EventSink,
    private readonly options: OutboxRelayServiceOptions,
  ) {}

  claimBatch(): Promise<RelayEvent[]> {
    return this.source.claimPendingBatch(this.options.batchSize);
  }

  /**
   * Splits a claimed batch into delivery requests bounded by count and by
   * serialized size. Pure and deterministic: the workflow may recompute it on
   * replay from the checkpointed claim result.
   */
  planDelivery(events: RelayEvent[]): DeliveryPlan {
    const chunks: RelayEvent[][] = [];
    const oversized: ParkedEvent[] = [];

    let current: RelayEvent[] = [];
    let currentBytes = 0;

    for (const event of events) {
      const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');

      if (eventBytes > this.options.maxBatchBytes) {
        oversized.push({
          id: event.id,
          reason: `Event serializes to ${eventBytes} bytes, above the ${this.options.maxBatchBytes}-byte request limit`,
        });
        continue;
      }

      const wouldOverflow =
        current.length >= this.options.batchSize ||
        currentBytes + eventBytes > this.options.maxBatchBytes;

      if (wouldOverflow && current.length > 0) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
      }

      current.push(event);
      currentBytes += eventBytes;
    }

    if (current.length > 0) chunks.push(current);

    return { chunks, oversized };
  }

  /**
   * Delivers one chunk. A contract rejection (HTTP 400) of the whole batch
   * hides which event is at fault, so the chunk is retried item by item and
   * only the offenders come back marked for parking. Retryable errors and
   * configuration errors propagate: the workflow's step retry policy owns the
   * former, and the latter must abort the run.
   */
  async deliverChunk(chunk: RelayEvent[]): Promise<ChunkOutcome> {
    try {
      const results = await this.sink.deliverBatch(chunk);
      return { deliveredIds: results.map((result) => result.id), parked: [] };
    } catch (error) {
      if (error instanceof NonRetryableSinkError && error.kind === 'contract') {
        return this.isolateContractOffenders(chunk);
      }
      throw error;
    }
  }

  /** Applies a delivery outcome to the source. Retry-safe: both writes are idempotent. */
  async settle(outcome: ChunkOutcome): Promise<void> {
    await this.source.markDelivered(outcome.deliveredIds);
    for (const parked of outcome.parked) {
      await this.source.park(parked.id, parked.reason);
    }
  }

  private async isolateContractOffenders(chunk: RelayEvent[]): Promise<ChunkOutcome> {
    const deliveredIds: string[] = [];
    const parked: ParkedEvent[] = [];

    for (const event of chunk) {
      try {
        const result = await this.sink.deliverOne(event);
        deliveredIds.push(result.id);
      } catch (error) {
        if (error instanceof NonRetryableSinkError && error.kind === 'contract') {
          parked.push({ id: event.id, reason: error.message });
          continue;
        }
        // A retryable or configuration error mid-isolation aborts the chunk.
        // The step retry replays it from the top; already-delivered events
        // come back as duplicates, which the sink reports as success.
        throw error;
      }
    }

    return { deliveredIds, parked };
  }
}
