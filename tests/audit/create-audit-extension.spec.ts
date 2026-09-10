import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuditExtension } from '../../src/audit/create-audit-extension';
import type { AuditConfig } from '../../src/audit/create-audit-extension';
import { Logger } from '../../src/core/logger';

const config: AuditConfig = {
  Broker: {
    operations: new Set(['upsert']),
    emitOn: new Set(['CREATE', 'UPDATE']),
  },
};

/**
 * Minimal stand-in for a Prisma client: `defineExtension`'s factory only needs
 * `$extends`, and echoing its argument back lets the spec inspect what the
 * factory registered.
 */
const fakeClient = () => {
  const received: unknown[] = [];
  return {
    received,
    $extends(arg: unknown) {
      received.push(arg);
      return this;
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAuditExtension enabled switch', () => {
  it('registers the interception hook by default', () => {
    const client = fakeClient();
    (createAuditExtension(config, { module: 'billing' }) as (c: unknown) => unknown)(client);

    const registered = client.received[0] as { name: string; query?: unknown };
    expect(registered.name).toBe('audit-extension');
    expect(registered.query).toBeDefined();
  });

  it('enabled: false registers a named no-op — no hook, nothing intercepted', () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const client = fakeClient();
    (createAuditExtension(config, { module: 'billing', enabled: false }) as (c: unknown) => unknown)(client);

    const registered = client.received[0] as { name: string; query?: unknown };
    expect(registered.name).toBe('audit-extension (disabled)');
    expect(registered.query).toBeUndefined();
  });

  it('shouts at boot when disabled, so a misconfigured environment is visible', () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    createAuditExtension(config, { module: 'usage', enabled: false });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Audit extension DISABLED for module "usage"'));
  });

  it('stays silent and active with enabled: true', () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    createAuditExtension(config, { module: 'usage', enabled: true });

    expect(warn).not.toHaveBeenCalled();
  });
});
