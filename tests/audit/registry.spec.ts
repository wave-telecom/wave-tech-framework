import { describe, expect, it } from 'vitest';
import { getAuditedClient, registerAuditedClient } from '../../src/audit/registry';

describe('audited client registry', () => {
  // Runs first: module state is fresh per test file, so no client is set yet.
  it('throws a helpful error before a client is registered', () => {
    expect(() => getAuditedClient()).toThrowError(/not registered/i);
  });

  it('returns the registered extended client', () => {
    const client = { $transaction: () => Promise.resolve(undefined) } as never;
    registerAuditedClient(client);
    expect(getAuditedClient()).toBe(client);
  });
});
