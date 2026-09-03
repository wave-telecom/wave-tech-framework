import { z } from 'zod';

/**
 * The 27 Brazilian federative units (UF). Mirrors `wave-billing-api`'s
 * `UF_ENUM` (`src/core/presentation/schemas/address.ts`) — copied, not
 * imported, since that repo has no public package entrypoint.
 */
export const carrierAddressStateSchema = z.enum([
  'RO',
  'AC',
  'AM',
  'RR',
  'PA',
  'AP',
  'TO',
  'MA',
  'PI',
  'CE',
  'RN',
  'PB',
  'PE',
  'AL',
  'SE',
  'BA',
  'MG',
  'ES',
  'RJ',
  'SP',
  'PR',
  'SC',
  'RS',
  'MS',
  'MT',
  'GO',
  'DF',
]);

/** The kind of resource a delivery order fulfils. Only SIM cards today. */
export const carrierResourceTypeSchema = z.enum(['SIM']);

/**
 * Mirrors `wave-delivery-api`'s own `DeliveryStatus` domain enum
 * (`src/domain/enums/delivery-status.ts`) — copied, not imported, since that
 * repo isn't a package `wave-tech-framework` can depend on.
 */
export const carrierDeliveryStatusSchema = z.enum([
  'CREATED',
  'DISPATCHED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'CANCELLING',
  'CANCELLED',
  'CANCELLED_ERROR',
]);

/** Recipient details carried on the wire contract between a BSS module and a carrier adapter. */
export const carrierRecipientSchema = z.object({
  name: z.string().min(1),
  document: z.string().min(1),
  // Combines wave-billing-api's phone.ts fields (countryCode 1-3 digits +
  // areaCode 2 digits + phoneNumber 8-9 digits) into a single flat field.
  phone: z.string().regex(/^\+?\d{1,3}\d{2}\d{8,9}$/),
  addressStreet: z.string().min(1),
  addressNumber: z.string().min(1),
  addressComplement: z.string().min(1).nullable(),
  addressNeighborhood: z.string().min(1),
  addressCity: z.string().min(1),
  addressState: carrierAddressStateSchema,
  addressZipCode: z.string().regex(/^\d{8}$/),
});
