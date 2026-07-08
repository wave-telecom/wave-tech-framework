import type { AuditTransactionClient } from './audit-context';
import { auditContextStorage, getAuditContext } from './audit-context';
import { getAuditedClient } from './registry';

/**
 * Opens (or joins) an audited transaction and puts its client in the ALS so the
 * audit extension writes each event into the SAME transaction as the business
 * write. Always use this instead of a raw prisma.$transaction for audited writes.
 */
export function withTransaction<T>(
  fn: (tx: AuditTransactionClient)=> Promise<T>,
): Promise<T> {
  const ctx = getAuditContext();

  // Already in a transaction -> join it (single commit).
  if (ctx.tx) return fn(ctx.tx);

  return getAuditedClient().$transaction((tx) =>
    auditContextStorage.run({ tx }, () => fn(tx)),
  );
}
