import type { z } from 'zod';
import type {
  carrierCancelDeliveryOrderRequestSchema,
  carrierCancelDeliveryOrderResponseSchema,
} from './carrier-cancel-delivery-order.schema';

export type CarrierCancelDeliveryOrderRequest =
  z.infer<typeof carrierCancelDeliveryOrderRequestSchema>;
export type CarrierCancelDeliveryOrderResponse =
  z.infer<typeof carrierCancelDeliveryOrderResponseSchema>;
