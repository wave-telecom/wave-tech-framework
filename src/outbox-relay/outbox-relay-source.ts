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
