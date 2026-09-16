import type { BrokerContext } from '../broker-context';

/**
 * Augments the non-generic `Express.Request` global namespace — not
 * `express-serve-static-core`'s generic `Request<P, ResBody, ReqBody,
 * ReqQuery, LocalsObj>` interface directly, which would fail to merge
 * (`TS2428: All declarations of 'Request' must have identical type
 * parameters`). This is the extension point `@types/express` itself
 * publishes for exactly this purpose, and it compiles even in a consumer
 * that doesn't have `@types/express` installed at all. The `namespace`
 * keyword is unavoidable here — it's how `@types/express` itself declares
 * this exact extension point, not a stylistic choice.
 *
 * A real Express `Request` already satisfies `WaveRequest` natively (it
 * prototype-chains onto Node's `http.IncomingMessage`, so `headers` and
 * `rawHeaders` are already top-level) — unlike the Fastify integration,
 * nothing here needs a conversion function.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own augmentation shape
  namespace Express {
    interface Request {
      /** Set by `expressRegisterPermissionAuth`'s middleware. Absent on public paths. */
      brokerContext?: BrokerContext;
    }
  }
}

export {};
