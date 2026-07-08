import { randomUUID } from 'node:crypto';
import type { AuditActor } from './audit-actor';
import { Logger } from '../core/logger';

export type AuditableOperation = 'create' | 'update' | 'delete' | 'upsert';
export type OperationKind = 'CREATE' | 'UPDATE' | 'DELETE';

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Shape written to the audit transport (`outbox`) table. Matches the
 * standardized columns; published/publishedAt/createdAt use their DB defaults.
 */
export interface AuditEvent {
  id: string;
  resourceId: string;
  resourceType: string;
  eventType: string;
  payload: Record<string, JsonValue | null>;
}

/**
 * Resolves the semantic kind of a write. For `upsert` the presence of a
 * previous row (`before`) decides between an insert and an update.
 */
export function resolveOperationKind(
  operation: AuditableOperation,
  before: unknown,
): OperationKind {
  if (operation === 'create') return 'CREATE';
  if (operation === 'delete') return 'DELETE';
  if (operation === 'upsert') return before ? 'UPDATE' : 'CREATE';
  return 'UPDATE';
}

/** Date -> ISO string, Decimal -> toJSON(), etc. — safe for a JSON column. */
function toJsonSafe(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Shallow diff of changed fields (field -> { from, to }). */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): JsonValue | null {
  if (!before || !after) return null;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return toJsonSafe(changes);
}

interface BuildArgs {
  model: string;
  operation: AuditableOperation;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: AuditActor;
  /** When true, compute the field-level diff for UPDATE events. Default: false. */
  computeDiff?: boolean;
  /**
   * Prepended to the eventType, e.g. 'Audit.' -> 'Audit.BrokerCreated'.
   * Default: 'Audit.'. Pass '' to disable.
   */
  eventPrefix?: string;
  /** Primary-key field read for `resourceId`. Default: 'id'. */
  idField?: string;
}

export function buildAuditEvent({
  model,
  operation,
  before,
  after,
  actor,
  computeDiff = false,
  eventPrefix = 'Audit.',
  idField = 'id',
}: BuildArgs): AuditEvent {
  const op = resolveOperationKind(operation, before);
  const suffix = op === 'CREATE' ? 'Created' : op === 'DELETE' ? 'Deleted' : 'Updated';
  const source = after ?? before ?? {};

  const rawId = (source as Record<string, unknown>)[idField];
  if (rawId === undefined || rawId === null) {
    Logger.warn(
      `Audit event for "${model}" has no "${idField}" value; resourceId will be empty. `
      + 'Set "idField" on the audit rule if this model uses a different primary key.',
    );
  }

  return {
    id: randomUUID(),
    resourceType: model,
    resourceId: rawId === undefined || rawId === null ? '' : String(rawId),
    eventType: `${eventPrefix}${model}${suffix}`,
    payload: {
      operation: op,
      occurredAt: new Date().toISOString(),
      actorId: actor.actorId,
      correlationId: actor.correlationId,
      changes: op === 'CREATE' || !computeDiff ? null : diff(before, after),
      snapshot: op === 'DELETE' ? toJsonSafe(before) : toJsonSafe(after),
    },
  };
}
