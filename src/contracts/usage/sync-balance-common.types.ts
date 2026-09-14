import type { z } from 'zod';
import type {
  usageAccountSchema,
  usageCatalogProductSchema,
  usageProductComponentSchema,
  usageBalanceProductComponentSchema,
  usageBalanceProductSchema,
  usageBalanceCreditSchema,
  usageBalanceSchema,
} from './sync-balance-common.schema';

export type Account = z.infer<typeof usageAccountSchema>;
export type CatalogProduct = z.infer<typeof usageCatalogProductSchema>;
export type ProductComponent = z.infer<typeof usageProductComponentSchema>;
export type BalanceProductComponent = z.infer<typeof usageBalanceProductComponentSchema>;
export type BalanceProduct = z.infer<typeof usageBalanceProductSchema>;
export type BalanceCredit = z.infer<typeof usageBalanceCreditSchema>;
export type Balance = z.infer<typeof usageBalanceSchema>;
