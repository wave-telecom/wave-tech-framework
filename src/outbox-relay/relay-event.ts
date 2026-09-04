/**
 * The transport-agnostic shape of one outbox event on its way to the events
 * bus. It mirrors the wave-events-api ingestion item on purpose: a bounded
 * context adapts its outbox rows into this shape once, and every piece of the
 * relay (batching, delivery, settlement) works on it without knowing where the
 * row came from.
 */
export interface RelayEvent {
  /** The producer's outbox row id (UUID). Doubles as the dedupe anchor downstream. */
  id: string;
  /** The producing service, e.g. "wave-billing-api". */
  source: string;
  eventType: string;
  resourceType: string;
  /** The aggregate instance the event is about (UUID). */
  resourceId: string;
  /**
   * The broker the change belongs to, promoted out of the payload
   * (`payload.brokerId`, or the audit envelope's `snapshot.brokerId`).
   * Null when the row carries no broker.
   */
  broker: string | null;
  /** Opaque payload owned by the producer. The bus does not validate its shape. */
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp of when the change happened in the producer. */
  occurredAt: string;
  correlationId?: string;
  /** Explicit dedupe key. The bus defaults it to "<source>:<id>" when absent. */
  idempotencyKey?: string;
  /**
   * The delivery sink the row was routed to (the outbox `sink` column) —
   * relay-internal routing metadata: a multi-sink composition can dispatch on
   * it, and the events API simply strips it on ingest.
   */
  sink: string | null;
}
