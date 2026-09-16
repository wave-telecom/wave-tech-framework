import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyRateLimit, { type CreateRateLimitOptions } from '@fastify/rate-limit';
import type { PermissionValidator } from './api-key/permission-validator';
import type { SessionTokenVerifier } from './session-token/session-token-verifier';
import { PermissionValidatorUnauthorizedError } from './errors/permission-validator-unauthorized-error';
import { PermissionDeniedError } from './errors/permission-denied-error';
import type { RouteProperties } from './route-properties';
import { checkApiKeyPermission } from './api-key/check-api-key-permission';
import { authenticateWithSessionToken } from './session-token/authenticate-with-session-token';
import { readApiKey, readBearerToken } from './shared/read-credentials';
import { credentialRateLimitKey } from './rate-limit/rate-limit-key';
import { createRateLimitCheck } from './rate-limit/rate-limit-check';

/** Header clients must send carrying their API key. */
export const API_KEY_HEADER = 'x-api-key';
/** Header clients may send a session token in, as `Bearer <token>`. */
export const AUTHORIZATION_HEADER = 'authorization';
/** Header a caller sends to restrict a multi-broker scope to a single target. */
export const BROKER_ID_HEADER = 'x-broker-id';
/** Shape limit on `BROKER_ID_HEADER`'s value, matching wave-auth-api's own `brokerId` contract. */
export const BROKER_ID_MAX_LENGTH = 100;
/** Paths every route in this hook's app leaves unauthenticated by default. */
export const PUBLIC_PATHS = ['/', '/management/health', '/docs'];

export interface PermissionAuthOptions {
  validator: PermissionValidator;
  /** `"METHOD path"` (the route's own declared path, `:params` included) -> what it requires. */
  routes: Readonly<Record<string, RouteProperties>>;
  /** Paths that bypass authentication, matched by exact value or as a prefix. */
  publicPaths?: string[];
  apiKeyHeader?: string;
  /** Required when any route in `routes` sets `acceptsSessionToken: true`. */
  sessionTokenVerifier?: SessionTokenVerifier;
  authorizationHeader?: string;
  brokerIdHeader?: string;
  brokerIdMaxLength?: number;
  /**
   * Opts every route this hook protects into rate limiting (backed by
   * `@fastify/rate-limit`'s `createRateLimit`, see `rate-limit-check.ts`),
   * bucketed by the presented credential rather than `request.ip` by
   * default (see `credentialRateLimitKey`) — pass a `keyGenerator` to
   * override that. A request over budget throws `TooManyRequestsError`
   * (`429`). Omitted entirely by default: this hook runs inside a shared
   * framework used by many independently deployed services with very
   * different traffic profiles, so there's no default this module could
   * pick that would fit all of them. Many Wave services already
   * rate-limit at the infrastructure/gateway layer instead (e.g.
   * wave-auth-api's own Cloud Armor config) and don't need this at all.
   * Only applies to the route-map hook itself, not to `assertHasPermission`
   * used standalone outside the route map.
   */
  rateLimit?: CreateRateLimitOptions;
}

/** Checks a single `RouteProperties` requirement for an already-authenticated request. */
export type AssertHasPermission = (
  request: FastifyRequest,
  route: RouteProperties,
) => Promise<void>;

function isPublicPath(path: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * A plain index access (`routes[key]`) types as `RouteProperties`, not
 * `RouteProperties | undefined` — `Record` doesn't model a missing key. This
 * wrapper's declared return type is what actually carries the possibility of
 * a miss through to the caller.
 */
function findRoute(
  routes: Readonly<Record<string, RouteProperties>>,
  routeKey: string,
): RouteProperties | undefined {
  return routes[routeKey];
}

/**
 * Registers an `onRequest` hook that authenticates and authorizes every
 * request against wave-auth-api, and returns the same check bound to
 * `validator` for use outside the route map (e.g. a vendor webhook whose
 * permission isn't one of this app's own routes).
 *
 * Rate limiting is opt-in via `options.rateLimit` (see its doc comment) —
 * omitted by default, since this hook runs inside a shared framework with no
 * single traffic profile that would fit every consuming service.
 *
 * The order of checks is contractual, not stylistic:
 *
 * 1. public path -> passes without touching the network;
 * 2. rate limit exceeded for the presented credential (or IP, absent one)
 *    -> `429`, before any credential is even read for real, so a flood of
 *    guesses gets throttled before it can reach `validate()` or a token
 *    verification;
 * 3. neither `x-api-key` nor a valid `Authorization: Bearer` present ->
 *    `401`, even before routing decides, so a caller with no credential
 *    can't tell an existing route from a nonexistent one by omitting it;
 * 4. path didn't match any route Fastify knows about -> returns without
 *    throwing, letting Fastify's own 404 handling take over;
 * 5. route matched but has no entry in `routes` -> `403` (deny by
 *    default), without ever reaching the network;
 * 6. `x-api-key` present -> the existing validate-against-wave-auth-api
 *    path, unconditionally, regardless of `acceptsSessionToken`;
 * 7. otherwise only a bearer token was presented -> `401` unless the route
 *    set `acceptsSessionToken: true`, in which case the token is verified
 *    offline instead and never reaches `validate()` — see
 *    `authenticateWithSessionToken`;
 * 8. broker id header malformed -> `400`, also without reaching the
 *    network;
 * 9. denied verdict or empty scope -> `403`;
 * 10. scope spans more than one broker on a route that requires exactly
 *    one -> `400`. This one comes *after* the verdict because only the
 *    verdict (or the token's claims) reveals how many brokers the scope
 *    actually has.
 */
export function registerPermissionAuth(
  app: FastifyInstance,
  options: PermissionAuthOptions,
): AssertHasPermission {
  const publicPaths = options.publicPaths ?? PUBLIC_PATHS;
  const apiKeyHeader = options.apiKeyHeader ?? API_KEY_HEADER;
  const authorizationHeader = options.authorizationHeader ?? AUTHORIZATION_HEADER;
  const brokerIdHeader = options.brokerIdHeader ?? BROKER_ID_HEADER;
  const brokerIdMaxLength = options.brokerIdMaxLength ?? BROKER_ID_MAX_LENGTH;

  for (const [routeKey, route] of Object.entries(options.routes)) {
    if (route.acceptsSessionToken === true && options.sessionTokenVerifier === undefined) {
      throw new Error(
        `${routeKey} sets acceptsSessionToken but registerPermissionAuth was not given a sessionTokenVerifier`,
      );
    }
  }

  // `global: false`: this hook does its own per-request check via
  // `createRateLimit` (see rate-limit-check.ts) instead of the plugin's
  // automatic per-route wiring, which doesn't reach routes a caller
  // registers right after this synchronous function returns.
  const checkRateLimit =
    options.rateLimit === undefined
      ? undefined
      : createRateLimitCheck(app, {
          keyGenerator: credentialRateLimitKey(apiKeyHeader, authorizationHeader),
          ...options.rateLimit,
        });
  if (checkRateLimit !== undefined) {
    void app.register(fastifyRateLimit, { global: false });
  }

  const assertHasPermission: AssertHasPermission = async (request, route) => {
    const apiKey = readApiKey(request, apiKeyHeader);
    if (apiKey !== undefined) {
      await checkApiKeyPermission(
        request,
        route,
        apiKey,
        options.validator,
        brokerIdHeader,
        brokerIdMaxLength,
      );
      return;
    }

    const token = readBearerToken(request, authorizationHeader);
    if (token === undefined || route.acceptsSessionToken !== true) {
      throw new PermissionValidatorUnauthorizedError();
    }

    // Guaranteed non-`undefined` for any route reached through
    // `options.routes` (checked above, at registration time). A caller
    // invoking this returned function directly with its own ad hoc
    // `RouteProperties` — bypassing that map — is responsible for the same
    // guarantee itself.
    if (options.sessionTokenVerifier === undefined) {
      throw new Error('acceptsSessionToken route reached with no sessionTokenVerifier configured');
    }

    await authenticateWithSessionToken(
      request,
      route,
      token,
      options.sessionTokenVerifier,
      brokerIdHeader,
      brokerIdMaxLength,
    );
  };

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const routeUrl = request.routeOptions.url;
    if (isPublicPath(routeUrl ?? request.url, publicPaths)) {
      return;
    }

    if (checkRateLimit !== undefined) {
      await checkRateLimit(request);
    }

    const hasCredential =
      readApiKey(request, apiKeyHeader) !== undefined ||
      readBearerToken(request, authorizationHeader) !== undefined;
    if (!hasCredential) {
      throw new PermissionValidatorUnauthorizedError();
    }

    if (routeUrl === undefined) {
      // No Fastify route matched this path at all — nothing to authorize;
      // let the app's own not-found handling take over.
      return;
    }

    const route = findRoute(options.routes, `${request.method} ${routeUrl}`);
    if (route === undefined) {
      throw new PermissionDeniedError(`No permission is mapped for ${request.method} ${routeUrl}`);
    }

    await assertHasPermission(request, route);
  });

  return assertHasPermission;
}
