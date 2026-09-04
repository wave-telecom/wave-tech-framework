import { z } from 'zod';

/**
 * Request contract to quote shipping price and SLA for a destination zip code.
 * The network adapter decides which vendor endpoint/wire format to translate
 * this into — the BSS module only ever asks for a quote by zip code.
 */
export const carrierQuoteShippingRequestSchema = z.object({
  zipCode: z.string().regex(/^\d{8}$/, 'zipCode must be 8 digits'),
});

/**
 * Response contract on a successful quote. Both fields are always present —
 * unlike order creation, there is no partial/unknown-yet state for a quote.
 */
export const carrierQuoteShippingResponseSchema = z.object({
  slaDays: z.number().int().nonnegative(),
  priceInCents: z.number().int().nonnegative(),
});
