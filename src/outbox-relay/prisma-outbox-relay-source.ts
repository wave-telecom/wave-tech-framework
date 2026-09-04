import { Logger } from '../core/logger';
import { EVENTS_API_SINK } from './event-sink';
import type { OutboxPurgeSource, OutboxRelaySource } from './outbox-relay-source';
import type { RelayEvent } from './relay-event';
import { promoteBrokerId, promoteCorrelationId, promoteOccurredAt } from './payload-promotion';

/**
 * The standardized outbox row every adopting module shares (see
 * docs/outbox-relay.md): the audit transport columns plus first-class parking.
 * Structural on purpose — the consumer's generated Prisma `Outbox` type
 * satisfies it without any cast.
 */
export interface StandardOutboxRow {
  id: string;
  resourceId: string;
  resourceType: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string | null;
  published: boolean;
  publishedAt: Date | null;
  parkedAt: Date | null;
  parkReason: string | null;
  /**
   * Which delivery sink drains this row, decided by the WRITER (the audit
   * extension stamps {@link EVENTS_API_SINK}). NULL = no route: nothing
   * claims it — fail-closed for legacy/unrouted rows.
   */
  sink: string | null;
  createdAt: Date;
}

/**
 * The slice of the consumer's PrismaClient the source needs. Structural so the
 * framework compiles without a generated `Outbox` model; the consumer's real
 * client satisfies it as long as the table follows the standardized columns.
 */
export interface StandardOutboxClient {
  outbox: {
    findMany: (args: {
      where:
        | { sink: string; published: boolean; parkedAt: null }
        | { published: boolean; publishedAt: { lt: Date } };
      orderBy: { createdAt: 'asc' | 'desc' } | { publishedAt: 'asc' | 'desc' };
      take: number;
    }) => Promise<StandardOutboxRow[]>;
    updateMany: (args: {
      where: { id: { in: string[] } };
      data: { published: boolean; publishedAt: Date };
    }) => Promise<unknown>;
    update: (args: {
      where: { id: string };
      data: { parkedAt: Date; parkReason: string };
    }) => Promise<unknown>;
    deleteMany: (args: {
      where: { id: { in: string[] } };
    }) => Promise<{ count: number }>;
  };
}

/**
 * Adapts one standardized outbox row into the relay's transport shape.
 *
 * `occurredAt` and `correlationId` are promoted out of the payload when the
 * payload carries them (the audit envelope does); the events API strips its
 * own copies on ingest, so promotion here only decides which value wins.
 * Everything else in the payload travels verbatim — the bus does not validate
 * payload shape, consumers do.
 */
export function toRelayEvent(row: StandardOutboxRow, source: string): RelayEvent {
  const payload = row.payload as Record<string, unknown>;

  return {
    id: row.id,
    source,
    eventType: row.eventType,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    broker: promoteBrokerId(payload),
    payload,
    occurredAt: promoteOccurredAt(payload, row.createdAt),
    correlationId: promoteCorrelationId(payload),
    idempotencyKey: row.idempotencyKey ?? undefined,
    sink: row.sink,
  };
}

/**
 * The standardized `outbox` table as a relay source: `published` means
 * "delivered to the events API" and `published_at` records when. No lock is
 * taken on claim — the relay's DBOS queue guarantees a single drain across
 * replicas — and no transaction spans the delivery call.
 *
 * Parking is first-class: a parked row keeps `published = false` but leaves
 * the pending set via `parked_at`. Manual reprocess after fixing the cause:
 * clear `parked_at`/`park_reason`.
 *
 * Claims are scoped to ONE sink: routing is decided by whoever wrote the row
 * (the `sink` column), never inferred from event naming — domain events on
 * another bus and unrouted legacy rows (`sink = NULL`) are invisible by
 * construction. One relay instance per sink; see the multi-sink section of
 * docs/outbox-relay.md.
 *
 * A module whose table diverges from the standardized columns implements its
 * own {@link OutboxRelaySource} instead.
 */
export class PrismaOutboxRelaySource implements OutboxRelaySource, OutboxPurgeSource {
  constructor(
    private readonly database: StandardOutboxClient,
    /** The producing service, e.g. "wave-sales-api" — the RelayEvent source. */
    private readonly source: string,
    /** The delivery sink this relay drains. Default: the platform events bus. */
    private readonly sink: string = EVENTS_API_SINK,
  ) {}

  async claimPendingBatch(limit: number): Promise<RelayEvent[]> {
    const rows = await this.database.outbox.findMany({
      where: { sink: this.sink, published: false, parkedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return rows.map((row) => toRelayEvent(row, this.source));
  }

  /**
   * Retention: deletes at most `batchSize` DELIVERED rows older than the
   * cutoff, oldest first. Sink-agnostic on purpose — a delivered row is
   * transport history whatever bus carried it. Two phases because Prisma's
   * deleteMany has no LIMIT; idempotent, so a retried step deletes what
   * remains. Pending and parked rows (`published = false`) never match.
   */
  async purgeDeliveredBatch(olderThan: Date, batchSize: number): Promise<number> {
    const rows = await this.database.outbox.findMany({
      where: { published: true, publishedAt: { lt: olderThan } },
      orderBy: { publishedAt: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) return 0;

    const { count } = await this.database.outbox.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return count;
  }

  async markDelivered(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.database.outbox.updateMany({
      where: { id: { in: ids } },
      data: { published: true, publishedAt: new Date() },
    });
  }

  async park(id: string, reason: string): Promise<void> {
    Logger.error('[PrismaOutboxRelaySource] Parking undeliverable outbox event', {
      data: { outboxEventId: id, reason },
    });
    await this.database.outbox.update({
      where: { id },
      data: { parkedAt: new Date(), parkReason: reason },
    });
  }
}
