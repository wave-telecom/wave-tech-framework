import { z } from 'zod';
import { usageAccountSchema, usageBalanceSchema } from '../sync-balance-common.schema.js';

/**
 * Request contract for syncing a subscriber's balance snapshot from a
 * network-adapter-side integrator (e.g. TIM/OCS). Carries the caller's own
 * `Account` plus its last-known `Balance` (used to preserve
 * `accountId`/`createdAt`/`brokerId`/`metadata` across the sync) — the
 * provider is responsible for producing a fresh `Balance` from whatever
 * upstream system it fronts.
 */
export const syncBalanceRequestSchema = z.object({
  account: usageAccountSchema,
  balance: usageBalanceSchema,
});

/**
 * Response contract on a successful sync: the (possibly updated) `Account`
 * alongside the freshly-synced `Balance`.
 */
export const syncBalanceResponseSchema = z.object({
  account: usageAccountSchema,
  balance: usageBalanceSchema,
});
