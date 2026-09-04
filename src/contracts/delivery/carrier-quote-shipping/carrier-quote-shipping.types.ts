import type { z } from 'zod';
import type {
  carrierQuoteShippingRequestSchema,
  carrierQuoteShippingResponseSchema,
} from './carrier-quote-shipping.schema';

export type CarrierQuoteShippingRequest = z.infer<typeof carrierQuoteShippingRequestSchema>;
export type CarrierQuoteShippingResponse = z.infer<typeof carrierQuoteShippingResponseSchema>;
