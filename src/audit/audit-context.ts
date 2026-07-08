import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';

/**
 * The Prisma interactive-transaction client. Because `@prisma/client` is a peer
 * dependency, this type resolves to the CONSUMER's generated client (with its
 * own models) at their compile time — so callers get a fully-typed `tx` with no
 * cast. We omit the connection-level methods that don't exist inside an
 * interactive transaction.
 */
export type AuditTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Context carried through the async chain of an audited write. It exists only
 * to propagate the active transaction (`tx`) from `withTransaction` down to
 * the audit extension, so the audit event is written in the SAME transaction as
 * the business write. Actor/correlation are read from the request hooks at emit
 * time (see audit-actor.ts), not stored here.
 */
export interface AuditContext {
  tx?: AuditTransactionClient;
}

export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/** Current audit context, or an empty one when outside an audited transaction. */
export function getAuditContext(): AuditContext {
  return auditContextStorage.getStore() ?? {};
}
