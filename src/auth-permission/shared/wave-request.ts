import type { IncomingHttpHeaders } from 'node:http';

/**
 * The minimal request shape this module's transport-agnostic logic needs —
 * satisfied natively by Express's `Request` (which prototype-chains onto
 * Node's `http.IncomingMessage`, so `rawHeaders` is already top-level) and by
 * a small per-request conversion on the Fastify side, where `rawHeaders`
 * lives nested under `request.raw` instead. Deliberately excludes `ip`
 * (needed only by the Fastify-only rate-limit key generator, read directly
 * off the native request there) and `params` (not populated yet on Express
 * at the point this module's middleware runs, so including it would
 * silently mean different things per framework).
 */
export interface WaveRequest {
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly query?: unknown;
}
