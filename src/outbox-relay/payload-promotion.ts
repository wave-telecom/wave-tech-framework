/**
 * Helpers for the per-module outbox-row -> RelayEvent mappers. Payloads that
 * carry the audit envelope (see `@wave-tech/framework/audit`) embed their own
 * `occurredAt` and `correlationId`; these helpers promote them to the relay
 * event's top-level fields when present and usable. The events API strips its
 * own copies on ingest, so promotion only decides which value wins — the
 * payload itself travels verbatim.
 */

const DEFAULT_MAX_CORRELATION_ID_LENGTH = 256;

/**
 * The payload's `occurredAt` when it is a parseable date, normalized to ISO;
 * otherwise the fallback (typically the outbox row's created_at).
 */
export function promoteOccurredAt(
  payload: Record<string, unknown>,
  fallback: Date,
): string {
  const candidate = payload.occurredAt;
  if (typeof candidate === 'string' && !Number.isNaN(Date.parse(candidate))) {
    return new Date(candidate).toISOString();
  }
  return fallback.toISOString();
}

/**
 * The broker the change belongs to: the payload's `brokerId`, or — for the
 * audit envelope, where the row lives under `snapshot` — the snapshot's
 * `brokerId`. Modules that call the same boundary `tenantId` (wave-usage-api)
 * are covered by the equivalent fallbacks: it is the same platform identity
 * under another column name, and `brokerId` always wins when both exist.
 * Null when nothing carries a usable string.
 */
export function promoteBrokerId(payload: Record<string, unknown>): string | null {
  const snapshot = payload.snapshot as Record<string, unknown> | null | undefined;
  const candidate =
    payload.brokerId ?? snapshot?.brokerId ?? payload.tenantId ?? snapshot?.tenantId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * The payload's `correlationId` when it is a non-empty string within the
 * events API's length limit (256 unless overridden); otherwise undefined.
 */
export function promoteCorrelationId(
  payload: Record<string, unknown>,
  maxLength: number = DEFAULT_MAX_CORRELATION_ID_LENGTH,
): string | undefined {
  const candidate = payload.correlationId;
  if (
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= maxLength
  ) {
    return candidate;
  }
  return undefined;
}
