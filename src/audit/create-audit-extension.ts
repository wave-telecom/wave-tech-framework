import { Prisma } from '@prisma/client';
import { getAuditActor } from './audit-actor';
import { getAuditContext } from './audit-context';
import type { AuditableOperation, OperationKind } from './build-audit-event';
import { buildAuditEvent, resolveOperationKind } from './build-audit-event';
import { getAuditedClient } from './registry';
import { Logger } from '../core/logger';

export interface AuditRule {
  /** Prisma operations that are intercepted for this model. */
  operations: Set<AuditableOperation>;
  /** Which resolved kinds actually emit an audit event. */
  emitOn: Set<OperationKind>;
  /**
   * When true (the default), compute the field-level diff (payload.changes)
   * for UPDATE events. Disabling it skips the extra findUnique that reads the
   * previous row to build the diff.
   */
  diff?: boolean;
  /**
   * The entity segment of the eventType. Default: the model name in
   * snake_case (`PipelineStage` -> `pipeline_stage`).
   */
  eventEntity?: string;
  /** Primary-key field read for `resourceId`. Default: 'id'. */
  idField?: string;
}

/** model name -> rule. NEVER include the audit transport model itself (recursion). */
export type AuditConfig = Record<string, AuditRule>;

export interface AuditExtensionOptions {
  /**
   * The producing module, the first segment of every eventType
   * (`<module>.<entity>.<action>`, all lowercase — e.g. `billing.broker.updated`).
   */
  module: string;
  /** Lowercased Prisma model name for the audit transport table. Default: 'outbox'. */
  transportModel?: string;
  /**
   * The delivery sink stamped on every emitted row — which relay drains this
   * module's audit events. Default: the platform events bus
   * ({@link EVENTS_API_SINK}). Override only when a module's audit deliberately
   * travels another bus; the relay claiming that sink must exist.
   */
  sink?: string;
  /** Actor/request-context resolver. Default: reads the framework request hooks. */
  resolveActor?: typeof getAuditActor;
}

const BULK_OPS = new Set(['createMany', 'updateMany', 'deleteMany']);
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The "before" row is needed to resolve the kind of an upsert, for the snapshot
 * of a delete, and to compute the diff of an update (only when diff is on).
 */
const needsBefore = (op: AuditableOperation, wantsDiff: boolean): boolean =>
  op === 'upsert' || op === 'delete' || (op === 'update' && wantsDiff);

// Structural view used to dispatch dynamically on the tx inside the extension
// (the public `tx` is the consumer's fully-typed PrismaClient).
interface Delegate { findUnique: (a: unknown)=> Promise<unknown> }
type TxWithTransport = Record<string, Delegate>
  & Record<string, { create: (a: unknown)=> Promise<unknown> }>;
type TxDispatch = Record<string, Record<string, (a: unknown)=> Promise<unknown>>>;

// Prisma surfaces the current transaction to query extensions via this internal
// param. `_createItxClient` rebuilds a client bound to that interactive tx.
// Both are INTERNAL Prisma APIs (undocumented) — validated on 6.8. If a Prisma
// upgrade changes them, only the auto-wrap / raw-$transaction convenience breaks;
// the official `withTransaction` (ALS) path keeps working.
interface InternalTransaction { kind?: 'itx' | 'batch' }
interface ClientWithItx { _createItxClient: (tx: InternalTransaction)=> unknown }

/**
 * Builds the audit Prisma Client extension for a given audit config. The API
 * passes its own config; everything else (before-capture, atomic write, guards,
 * event contract) is provided here.
 */
export function createAuditExtension(config: AuditConfig, options: AuditExtensionOptions) {
  const { module, sink } = options;
  const transportModel = options.transportModel ?? 'outbox';
  const resolveActor = options.resolveActor ?? getAuditActor;

  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'audit-extension',
      query: {
        $allModels: {
          async $allOperations({ args, query, model, operation, ...rest }) {
            const rule = model ? config[model] : undefined;
            if (!model || !rule?.operations.has(operation as AuditableOperation)) {
              return query(args);
            }

            Logger.debug(`Audited model "${model}" is being written via "${operation}". The audit event will be emitted atomically.`);

            if (BULK_OPS.has(operation)) {
              const msg = `Bulk operation "${operation}" is not allowed on audited model "${model}". Use withTransaction with a create/update/delete loop.`;
              Logger.error(msg);
              throw new Error(msg);
            }

            const auditedOp = operation as AuditableOperation;
            const wantsDiff = rule.diff ?? true;

            // Captures `before`, runs the business op via `query(args)` (which
            // executes in the CURRENT tx), then writes the outbox row on the
            // SAME tx. Never re-dispatches through the client here.
            const emit = async (tx: TxWithTransport): Promise<Record<string, unknown> | null> => {
              const before = needsBefore(auditedOp, wantsDiff)
                ? ((await tx[lowerFirst(model)].findUnique({
                    where: (args as { where?: unknown }).where,
                  })) as Record<string, unknown> | null)
                : null;

              const after = (await query(args)) as Record<string, unknown> | null;

              const kind = resolveOperationKind(auditedOp, before);
              if (rule.emitOn.has(kind)) {
                await tx[transportModel].create({
                  data: buildAuditEvent({
                    module,
                    model,
                    operation: auditedOp,
                    before,
                    after,
                    actor: resolveActor(),
                    computeDiff: wantsDiff,
                    eventEntity: rule.eventEntity,
                    idField: rule.idField,
                    sink,
                  }),
                });
              }
              Logger.debug(`Audited model "${model}" emitted an event for "${operation}".`);
              return after;
            };

            // (1) Official path: tx propagated through the ALS (withTransaction).
            const ctx = getAuditContext();
            if (ctx.tx) return emit(ctx.tx as unknown as TxWithTransport);

            // (2) Otherwise, detect the current tx from Prisma's internal params.
            // Covers a raw `prisma.$transaction(async tx => ...)` AND the
            // re-dispatch from the auto-wrap in (3). `_createItxClient` gives us a
            // client bound to that interactive tx, so the outbox write lands in
            // the same commit.
            const internalTx = (
              rest as { __internalParams?: { transaction?: InternalTransaction } }
            ).__internalParams?.transaction;

            if (internalTx?.kind === 'batch') {
              const msg = `Audited model "${model}" cannot be written inside a batch $transaction([...]). Use withTransaction or a raw interactive $transaction(async (tx) => ...).`;
              Logger.error(msg);
              throw new Error(msg);
            }

            if (internalTx?.kind === 'itx') {
              Logger.debug(`Audited model "${model}" is being written inside a raw interactive $transaction. The audit event will be emitted atomically.`);
              const itxClient = (client as unknown as ClientWithItx)._createItxClient(internalTx);
              return emit(itxClient as TxWithTransport);
            }

            // (3) No transaction at all -> auto-wrap: open one and re-dispatch the
            // op ON the tx (so `query` runs in it); the re-invocation lands on (2)
            // as 'itx' and emits the event atomically.
            return getAuditedClient().$transaction((tx) =>
              (tx as unknown as TxDispatch)[lowerFirst(model)][operation](args),
            );
          },
        },
      },
    }),
  );
}

/** Set of audited model names — feed the CI consistency test (see README §9). */
export const auditedModelsOf = (config: AuditConfig): Set<string> => new Set(Object.keys(config));
