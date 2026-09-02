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
 * Request contract for cancelling a delivery order at the carrier. Carries
 * every field of the BSS module's own `DeliveryOrder` (plus its `Recipient`)
 * — same rationale as the create request — plus the cancellation `reason`.
 */
export const carrierCancelDeliveryOrderRequestSchema = z.object({
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
