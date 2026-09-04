import type { RelayEvent } from './relay-event';

/**
 * The sink name of the platform events bus (wave-events-api). Written by the
 * audit extension on every outbox row it emits, and the default a
 * PrismaOutboxRelaySource claims — routing is decided by the WRITER of the
 * row, never inferred from event naming. Rows with `sink = NULL` have no
 * route and are claimed by nobody (fail-closed).
 */
export const EVENTS_API_SINK = 'events-api';

/**
 * The delivery outcome for one event, keyed by the ORIGIN id — the outbox row
 * id from the {@link RelayEvent}, not whatever id the destination assigned.
 * `duplicate` means the destination had already stored the event; the relay
 * treats it exactly like `accepted`, which is what makes replays safe.
 */
export interface DeliveryResult {
  id: string;
  status: 'accepted' | 'duplicate';
}

/**
 * A delivery failure worth retrying: network error, timeout, or a 5xx from the
 * destination. Replaying the same batch later is safe — the destination
 * deduplicates on the idempotency key.
 */
export class RetryableSinkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'RetryableSinkError';
  }
}

/**
 * A delivery failure retrying cannot fix.
 *
 * - `contract`: the destination rejected the request body (HTTP 400). At batch
 *   granularity this hides which event is at fault, so the relay retries the
 *   batch item by item and parks the offender.
 * - `configuration`: the destination rejected the caller (HTTP 401). No event
 *   is at fault — the whole run must stop and someone has to fix the setup.
 */
export class NonRetryableSinkError extends Error {
  constructor(readonly kind: 'contract' | 'configuration', message: string) {
    super(message);
    this.name = 'NonRetryableSinkError';
  }
}

/** Where the relay delivers events to — an HTTP API, a broker, anything. */
export interface EventSink {
  /** Delivers a batch. Results come back in input order, keyed by origin id. */
  deliverBatch: (events: RelayEvent[]) => Promise<DeliveryResult[]>;
  /** Delivers a single event. Used to isolate the offender in a rejected batch. */
  deliverOne: (event: RelayEvent) => Promise<DeliveryResult>;
}
