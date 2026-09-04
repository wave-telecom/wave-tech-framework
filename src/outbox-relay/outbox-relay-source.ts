import type { RelayEvent } from './relay-event';

/**
 * What a bounded context must provide for its outbox to be drained by the
 * relay. Implementations own the storage details (which table, which columns
 * mark delivery, what "pending" means) — the relay only sequences the calls.
 *
 * `claimPendingBatch` must be a plain read, not a lock: the relay guarantees a
 * single drain runs at a time across all replicas, so claim-by-lock is
 * unnecessary, and holding a transaction across the delivery network call is
 * exactly the failure mode the relay exists to remove.
 */
export interface OutboxRelaySource {
  /** Oldest-first batch of events not yet delivered, at most `limit` of them. */
  claimPendingBatch: (limit: number) => Promise<RelayEvent[]>;
  /** Marks events as delivered so no later claim returns them again. */
  markDelivered: (ids: string[]) => Promise<void>;
  /**
   * Takes one undeliverable event (rejected by the sink's contract) out of the
   * pending set so it cannot poison every subsequent drain. How it is recorded
   * — and how an operator puts it back — is the implementation's contract.
   */
  park: (id: string, reason: string) => Promise<void>;
}

/**
 * Optional retention capability of an outbox store. Deliberately a separate
 * interface: draining and purging are different jobs on different cadences,
 * and a source may support one without the other.
 *
 * The criterion is delivery, not routing: a delivered row is transport
 * history whatever sink carried it, while pending and parked rows
 * (`published = false`) are NEVER purged — parked is the error queue, and it
 * waits for an operator.
 */
export interface OutboxPurgeSource {
  /**
   * Deletes at most `batchSize` delivered rows whose `published_at` is older
   * than the cutoff; returns how many were deleted. Idempotent: re-running
   * deletes whatever remains.
   */
  purgeDeliveredBatch: (olderThan: Date, batchSize: number) => Promise<number>;
}
