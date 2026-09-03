import { z } from 'zod';
import {
  carrierDeliveryStatusSchema,
  carrierRecipientSchema,
  carrierResourceTypeSchema,
} from '../carrier-delivery-order-common.schema.js';

/**
 * Request contract for cancelling a delivery order at the carrier. Carries
 * every field of the BSS module's own `DeliveryOrder` (plus its `Recipient`)
 * — same rationale as the create request — plus the cancellation `reason`.
 */
export const carrierCancelDeliveryOrderRequestSchema = z.object({
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
  reason: z.string().min(1),
});

/**
 * Response contract on a successful cancellation request. A carrier never
 * carries delivery data (tracking code/URL, ETA, SLA) on a cancellation
 * response — the only thing worth reporting is whether the cancellation
 * already completed (`CANCELLED`) or is still pending on the carrier's side
 * (`CANCELLING`, the common case: most vendors only ever acknowledge that a
 * cancellation request was accepted, not that it finished).
 */
export const carrierCancelDeliveryOrderResponseSchema = z.object({
  status: z.enum(['CANCELLED', 'CANCELLING']),
});
