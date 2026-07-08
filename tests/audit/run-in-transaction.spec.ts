import { describe, expect, it, vi } from 'vitest';
import {
  type AuditTransactionClient,
  auditContextStorage,
  getAuditContext,
} from '../../src/audit/audit-context';
import { registerAuditedClient } from '../../src/audit/registry';
import { withTransaction } from '../../src/audit/run-in-transaction';

const fakeTx = { marker: 'tx' } as unknown as AuditTransactionClient;

describe('withTransaction', () => {
  it('opens a new transaction and exposes tx through the audit context', async () => {
    const $transaction = vi.fn((fn: (tx: AuditTransactionClient) => Promise<unknown>) =>
      fn(fakeTx),
    );
    registerAuditedClient({ $transaction } as never);

    let seenInsideCtx: AuditTransactionClient | undefined;
    const result = await withTransaction((tx) => {
      seenInsideCtx = getAuditContext().tx;
      expect(tx).toBe(fakeTx);
      return Promise.resolve('done');
    });

    expect(result).toBe('done');
    expect($transaction).toHaveBeenCalledOnce();
    // The active tx is propagated through the ALS so the extension writes into it.
    expect(seenInsideCtx).toBe(fakeTx);
  });

  it('joins the existing transaction instead of opening a nested one', async () => {
    const $transaction = vi.fn();
    registerAuditedClient({ $transaction } as never);

    const outerTx = { marker: 'outer' } as unknown as AuditTransactionClient;

    const result = await auditContextStorage.run({ tx: outerTx }, () =>
      withTransaction((tx) => {
        expect(tx).toBe(outerTx);
        return Promise.resolve('joined');
      }),
    );

    expect(result).toBe('joined');
    // Already inside a transaction -> must NOT open another (single commit).
    expect($transaction).not.toHaveBeenCalled();
  });
});
