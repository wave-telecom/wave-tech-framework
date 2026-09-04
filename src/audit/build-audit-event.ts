import { randomUUID } from 'node:crypto';
import type { AuditActor } from './audit-actor';
import { Logger } from '../core/logger';
import { EVENTS_API_SINK } from '../outbox-relay/event-sink';

export type AuditableOperation = 'create' | 'update' | 'delete' | 'upsert';
export type OperationKind = 'CREATE' | 'UPDATE' | 'DELETE';

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Shape written to the audit transport (`outbox`) table. Matches the
 * standardized columns; published/publishedAt/createdAt use their DB defaults.
 * `sink` routes the row to the platform events bus — the writer decides the
 * route, the relay only obeys it.
 */
export interface AuditEvent {
  id: string;
  resourceId: string;
  resourceType: string;
  eventType: string;
  payload: Record<string, JsonValue | null>;
  sink: string;
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

/**
 * PascalCase/camelCase -> snake_case, lowercased: `PipelineStage` ->
 * `pipeline_stage`. The event-entity segment of the eventType.
 */
export function toEventEntity(model: string): string {
  return model
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

interface BuildArgs {
  /** The producing module, the first eventType segment (e.g. 'billing'). */
  module: string;
  model: string;
  operation: AuditableOperation;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: AuditActor;
  /** When true, compute the field-level diff for UPDATE events. Default: true. */
  computeDiff?: boolean;
  /**
   * The entity segment of the eventType. Default: the model name in
   * snake_case (`PipelineStage` -> `pipeline_stage`).
   */
  eventEntity?: string;
  /** Primary-key field read for `resourceId`. Default: 'id'. */
  idField?: string;
  /** Delivery sink stamped on the row. Default: the platform events bus. */
  sink?: string;
}

export function buildAuditEvent({
  module,
  model,
  operation,
  before,
  after,
  actor,
  computeDiff = true,
  eventEntity,
  idField = 'id',
  sink = EVENTS_API_SINK,
}: BuildArgs): AuditEvent {
  const op = resolveOperationKind(operation, before);
  const action = op === 'CREATE' ? 'created' : op === 'DELETE' ? 'deleted' : 'updated';
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
    // Audit travels the platform events bus unless the module deliberately
    // routes it elsewhere — routing is decided here, at emission, never
    // inferred from the event name by the transport.
    sink,
    // `<module>.<entity>.<action>`, all lowercase: `billing.broker.updated`.
    eventType: `${module}.${eventEntity ?? toEventEntity(model)}.${action}`,
    payload: {
      operation: op,
      occurredAt: new Date().toISOString(),
      // Named after the change_history column it lands in downstream.
      changedBy: actor.actorId,
      correlationId: actor.correlationId,
      /** The channel that originated the change (`x-request-channel`). */
      requestChannel: actor.requestChannel,
      changes: op === 'CREATE' || !computeDiff ? null : diff(before, after),
      snapshot: op === 'DELETE' ? toJsonSafe(before) : toJsonSafe(after),
    },
  };
}
