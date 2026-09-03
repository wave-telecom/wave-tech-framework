import { z } from 'zod';
import {
  carrierDeliveryStatusSchema,
  carrierRecipientSchema,
  carrierResourceTypeSchema,
} from '../carrier-delivery-order-common.schema.js';

/**
 * Request contract for creating a delivery order at the carrier. Carries every
 * field of the BSS module's own `DeliveryOrder` (plus its `Recipient`) — the
 * network adapter is responsible for deciding, from `resourceType` and
 * whatever else it needs, whether and how to translate the order into the
 * vendor's own wire format.
 */
export const carrierCreateDeliveryOrderRequestSchema = z.object({
  id: z.uuid(),
  brokerId: z.uuid(),
  externalCode: z.string().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  purchaseOrderId: z.string().min(1),
  resourceId: z.string().min(1).nullable(),
  resourceType: carrierResourceTypeSchema.nullable(),
  deliveryConfigId: z.uuid(),
  deliveryStatus: carrierDeliveryStatusSchema,
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
