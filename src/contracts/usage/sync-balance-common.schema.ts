import { z } from 'zod';

/**
 * Mirrors `wave-usage-api`'s own `Account` entity
 * (`src/accounts/domain/entities/Account.ts`) — copied, not imported, since
 * that repo isn't a package `wave-tech-framework` can depend on.
 */
export const usageAccountSchema = z.object({
  id: z.uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  tenantId: z.uuid(),
  externalCode: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

/**
 * Mirrors `wave-usage-api`'s `CatalogProduct` domain entity
 * (`src/api/domain/entities/CatalogProduct.ts`).
 */
export const usageCatalogProductBillingTypeSchema = z.enum([
  'PREPAID',
  'POSTPAID',
  'CONTROL',
]);

export const usageCatalogProductRecurrenceSchema = z.enum([
  'SPOT',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);

export const usageCatalogProductFeatureSchema = z.object({
  icon: z.string(),
  name: z.string(),
});

export const usageCatalogProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  billingType: usageCatalogProductBillingTypeSchema,
  recurrence: usageCatalogProductRecurrenceSchema,
  features: z.array(usageCatalogProductFeatureSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  brokerId: z.uuid(),
  externalCode: z.string().optional(),
});

/**
 * Mirrors `wave-usage-api`'s `ProductComponent` domain entity
 * (`src/api/domain/entities/ProductComponent.ts`).
 */
export const usageProductComponentTypeSchema = z.enum([
  'DATA',
  'VOICE',
  'SMS',
  'ZERO_RATING',
  'SPONSORED_USAGE',
]);

export const usageProductComponentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: usageProductComponentTypeSchema,
  unlimited: z.boolean(),
  unit: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  brokerId: z.uuid(),
  icon: z.string().optional(),
  externalCode: z.string().optional(),
});

/**
 * Mirrors `wave-usage-api`'s `Balance` domain entity and its
 * `BalanceProduct`/`BalanceProductComponent`/`BalanceCredit` shapes
 * (`src/api/domain/entities/Balance.ts`) — as wire primitives, not the domain
 * classes themselves.
 */
export const usageBalanceProductComponentSchema = z.object({
  productComponent: usageProductComponentSchema,
  unit: z.string(),
  totalAmount: z.number(),
  usedAmount: z.number(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
});

export const usageBalanceProductSchema = z.object({
  catalogProduct: usageCatalogProductSchema,
  productComponents: z.array(usageBalanceProductComponentSchema),
});

export const usageBalanceCreditTypeSchema = z.enum(['credit', 'gift', 'cashback']);

export const usageBalanceCreditSchema = z.object({
  type: usageBalanceCreditTypeSchema,
  value: z.number(),
  updatedAt: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const usageBalanceSchema = z.object({
  accountId: z.uuid(),
  products: z.array(usageBalanceProductSchema),
  balanceCredits: z.array(usageBalanceCreditSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  brokerId: z.uuid(),
  metadata: z.record(z.string(), z.unknown()),
});
