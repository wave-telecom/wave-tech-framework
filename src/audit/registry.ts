import type { AuditTransactionClient } from './audit-context';

/**
 * The extended Prisma client (client.$extends(auditExtension)) registered by the
 * app at boot. Shared by withTransaction (to open transactions) and by the
 * extension's auto-wrap path.
 */
export interface AuditClient {
  $transaction: <T>(fn: (tx: AuditTransactionClient)=> Promise<T>)=> Promise<T>;
}

let auditClient: AuditClient | undefined;

export const registerAuditedClient = (client: AuditClient): void => {
  auditClient = client;
};

export const getAuditedClient = (): AuditClient => {
  if (!auditClient) {
    throw new Error(
      'Audited Prisma client not registered. Call registerAuditedClient(client.$extends(auditExtension)) at boot.',
    );
  }
  return auditClient;
};
