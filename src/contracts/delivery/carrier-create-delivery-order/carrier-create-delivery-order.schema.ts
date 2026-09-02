import { z } from 'zod';

/** Recipient details carried on the wire contract between a BSS module and a carrier adapter. */
export const carrierRecipientSchema = z.object({
  name: z.string().min(1),
  document: z.string().min(1),
  phone: z.string().min(1),
  addressStreet: z.string().min(1),
  addressNumber: z.string().min(1),
  addressComplement: z.string().min(1).nullable(),
  addressNeighborhood: z.string().min(1),
  addressCity: z.string().min(1),
  addressState: z.string().min(1),
  addressZipCode: z.string().min(1),
});

/**
 * Request contract for creating a delivery order at the carrier. Carries every
 * field of the BSS module's own `DeliveryOrder` (plus its `Recipient`) — the
 * network adapter is responsible for deciding, from `resourceType` and
 * whatever else it needs, whether and how to translate the order into the
 * vendor's own wire format.
 */
export const carrierCreateDeliveryOrderRequestSchema = z.object({
  id: z.string().min(1),
  brokerId: z.string().min(1),
  externalCode: z.string().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  purchaseOrderId: z.string().min(1),
  resourceId: z.string().min(1).nullable(),
  resourceType: z.string().min(1).nullable(),
  deliveryConfigId: z.string().min(1),
  deliveryStatus: z.string().min(1),
  recipient: carrierRecipientSchema,
});

/**
 * Response contract on a successful creation. Every field besides the status
 * itself may come back `null` — a network adapter is free to not know (or not
 * have received yet from the vendor) any of them.
 */
export const carrierCreateDeliveryOrderResponseSchema = z.object({
  providerTrackingCode: z.string().min(1).nullable(),
  providerTrackingUrl: z.string().min(1).nullable(),
  estimatedDelivery: z.string().min(1).nullable(),
  slaDays: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
