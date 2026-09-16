import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CreateRateLimitOptions } from '@fastify/rate-limit';
import { TooManyRequestsError } from './errors/too-many-requests-error';

export type RateLimitCheck = (request: FastifyRequest) => Promise<void>;

/**
 * Builds a per-request rate-limit check on top of `@fastify/rate-limit`'s
 * low-level `createRateLimit` API — deliberately not its automatic per-route
 * wiring (`global: true`, the plugin's default). That wiring attaches itself
 * via an `onRoute` hook fired only for routes registered *after* the plugin
 * has finished booting, and `registerPermissionAuth` is synchronous: it
 * cannot `await` the plugin's own registration before returning, and a
 * caller's very next line typically registers its actual routes — which
 * would then silently never get rate-limited. `createRateLimit` sidesteps
 * this: `app.createRateLimit` is only read lazily, on the first real
 * request, by which point `.ready()` has necessarily already resolved and
 * the plugin is fully booted regardless of when its `register()` settled.
 *
 * `isAllowed` on `@fastify/rate-limit`'s own verdict is misleadingly named
 * for this use — it's `true` only for an allow-listed key bypassing the
 * check entirely. The actual "is this request over budget" verdict is
 * `isExceeded`.
 */
export function createRateLimitCheck(
  app: FastifyInstance,
  options: CreateRateLimitOptions,
): RateLimitCheck {
  let checkRateLimit: ReturnType<FastifyInstance['createRateLimit']> | undefined;

  return async (request) => {
    if (checkRateLimit === undefined) {
      checkRateLimit = app.createRateLimit(options);
    }

    const verdict = await checkRateLimit(request);
    if (!verdict.isAllowed && verdict.isExceeded) {
      throw new TooManyRequestsError('Rate limit exceeded for this credential');
    }
  };
}
