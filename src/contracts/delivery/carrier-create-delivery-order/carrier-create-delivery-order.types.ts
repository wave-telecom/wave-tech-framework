import type { z } from 'zod';
import type {
  carrierCreateDeliveryOrderRequestSchema,
  carrierCreateDeliveryOrderResponseSchema,
} from './carrier-create-delivery-order.schema';

export type CarrierCreateDeliveryOrderRequest =
  z.infer<typeof carrierCreateDeliveryOrderRequestSchema>;
export type CarrierCreateDeliveryOrderResponse =
  z.infer<typeof carrierCreateDeliveryOrderResponseSchema>;
