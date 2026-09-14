import type { z } from 'zod';
import type { syncBalanceRequestSchema, syncBalanceResponseSchema } from './sync-balance.schema';

export type SyncBalanceRequest = z.infer<typeof syncBalanceRequestSchema>;
export type SyncBalanceResponse = z.infer<typeof syncBalanceResponseSchema>;
