import type { Request, RequestHandler } from 'express';
import type { PermissionValidator } from '../api-key/permission-validator';
import type { SessionTokenVerifier } from '../session-token/session-token-verifier';
import { PermissionValidatorUnauthorizedError } from '../errors/permission-validator-unauthorized-error';
import { PermissionDeniedError } from '../errors/permission-denied-error';
import type { RouteProperties } from '../route-properties';
import { checkApiKeyPermission } from '../api-key/check-api-key-permission';
import { authenticateWithSessionToken } from '../session-token/authenticate-with-session-token';
import { readApiKey, readBearerToken } from '../shared/read-credentials';
import { isPublicPath } from '../shared/is-public-path';
import { compileRoutes, matchRoute } from './route-matcher';
import './express-request';

/** Header clients must send carrying their API key. */
export const API_KEY_HEADER = 'x-api-key';
/** Header clients may send a session token in, as `Bearer <token>`. */
export const AUTHORIZATION_HEADER = 'authorization';
/** Header a caller sends to restrict a multi-broker scope to a single target. */
export const BROKER_ID_HEADER = 'x-broker-id';
/** Shape limit on `BROKER_ID_HEADER`'s value, matching wave-auth-api's own `brokerId` contract. */
export const BROKER_ID_MAX_LENGTH = 100;

export interface ExpressPermissionAuthOptions {
  validator: PermissionValidator;
  /**
   * `"METHOD path"` (a `path-to-regexp` pattern, plain `:param` segments
   * only — no `:id?`, `*`, or `:id(\d+)`, which `path-to-regexp@8` rejects
   * outright) -> what it requires. **Must list entries in the same relative
   * order the corresponding routes are registered on the actual Express
   * router** — see `matchRoute`'s doc comment for why this matters whenever
   * two patterns can overlap the same request.
   */
  routes: Readonly<Record<string, RouteProperties>>;
  /**
   * Paths that bypass authentication, matched by exact value or as a
   * prefix. Defaults to `[]` — **not** the Fastify hook's defaults: this
   * middleware is meant to be mounted on an Express sub-router, where
   * `req.path` is router-relative (`GET /api` arrives as `req.path === '/'`
   * from inside a router mounted at `/api`), so reusing a default that
   * includes `'/'` would silently make that router's own root path public.
   */
  publicPaths?: string[];
  apiKeyHeader?: string;
  /** Required when any route in `routes` sets `acceptsSessionToken: true`. */
  sessionTokenVerifier?: SessionTokenVerifier;
  authorizationHeader?: string;
  brokerIdHeader?: string;
  brokerIdMaxLength?: number;
}

/** Checks a single `RouteProperties` requirement for an already-authenticated request. */
export type ExpressAssertHasPermission = (
  request: Request,
  route: RouteProperties,
) => Promise<void>;

export interface ExpressPermissionAuth {
  middleware: RequestHandler;
  assertHasPermission: ExpressAssertHasPermission;
}

/**
 * The Express counterpart to `registerPermissionAuth`, for services that
 * can't be Fastify (see `@wave-tech/framework/auth-permission`'s own
 * `registerPermissionAuth`, which this deliberately mirrors wherever the two
 * frameworks allow it). Returns a middleware to `.use()` on the router it
 * protects — **before** any `.get/.post/.put/...` calls on that router —
 * plus the same standalone `assertHasPermission` for checking a permission
 * outside the route map.
 *
 * Two behaviors are deliberately different from the Fastify hook, both a
 * consequence of Express giving a `.use()`-mounted middleware no equivalent
 * to Fastify's `request.routeOptions.url` (the already-resolved matched
 * route) before the real route handlers run:
 *
 * 1. Route resolution is done by this module's own `route-matcher`, not
 *    Express's real router — see its doc comment on the ordering
 *    requirement this places on `routes`.
 * 2. A path not found in `routes` answers `403` (`PermissionDeniedError`),
 *    never a synthetic `404` — letting a miss fall through unauthenticated
 *    (`next()`) would defeat deny-by-default for any real, registered route
 *    the caller forgot to map. Fail-closed, but a real, intentional
 *    difference from the Fastify hook's own contract.
 *
 * No rate-limiting option: `@fastify/rate-limit` is Fastify-only.
 */
export function expressRegisterPermissionAuth(
  options: ExpressPermissionAuthOptions,
): ExpressPermissionAuth {
  const publicPaths = options.publicPaths ?? [];
  const apiKeyHeader = options.apiKeyHeader ?? API_KEY_HEADER;
  const authorizationHeader = options.authorizationHeader ?? AUTHORIZATION_HEADER;
  const brokerIdHeader = options.brokerIdHeader ?? BROKER_ID_HEADER;
  const brokerIdMaxLength = options.brokerIdMaxLength ?? BROKER_ID_MAX_LENGTH;

  for (const [routeKey, route] of Object.entries(options.routes)) {
    if (route.acceptsSessionToken === true && options.sessionTokenVerifier === undefined) {
      throw new Error(
        `${routeKey} sets acceptsSessionToken but expressRegisterPermissionAuth was not given a sessionTokenVerifier`,
      );
    }
  }

  const compiledRoutes = compileRoutes(options.routes);

  const assertHasPermission: ExpressAssertHasPermission = async (request, route) => {
    const apiKey = readApiKey(request, apiKeyHeader);
    if (apiKey !== undefined) {
      const ctx = await checkApiKeyPermission(
        request,
        route,
        apiKey,
        options.validator,
        brokerIdHeader,
        brokerIdMaxLength,
      );
      if (ctx !== undefined) {
        request.brokerContext = ctx;
      }
      return;
    }

    const token = readBearerToken(request, authorizationHeader);
    if (token === undefined || route.acceptsSessionToken !== true) {
      throw new PermissionValidatorUnauthorizedError();
    }

    if (options.sessionTokenVerifier === undefined) {
      throw new Error('acceptsSessionToken route reached with no sessionTokenVerifier configured');
    }

    const ctx = await authenticateWithSessionToken(
      request,
      route,
      token,
      options.sessionTokenVerifier,
      brokerIdHeader,
      brokerIdMaxLength,
    );
    if (ctx !== undefined) {
      request.brokerContext = ctx;
    }
  };

  const middleware: RequestHandler = (request, response, next) => {
    if (isPublicPath(request.path, publicPaths)) {
      next();
      return;
    }

    const hasCredential =
      readApiKey(request, apiKeyHeader) !== undefined ||
      readBearerToken(request, authorizationHeader) !== undefined;
    if (!hasCredential) {
      next(new PermissionValidatorUnauthorizedError());
      return;
    }

    const route = matchRoute(compiledRoutes, request.method, request.path);
    if (route === undefined) {
      next(new PermissionDeniedError(`No permission is mapped for ${request.method} ${request.path}`));
      return;
    }

    // Express 4 does not catch a rejected promise thrown inside a
    // middleware on its own — failures must be funneled through `next`
    // explicitly.
    void runAssertion(request, route, next);
  };

  async function runAssertion(
    request: Request,
    route: RouteProperties,
    next: Parameters<RequestHandler>[2],
  ): Promise<void> {
    try {
      await assertHasPermission(request, route);
      next();
    } catch (error) {
      next(error);
    }
  }

  return { middleware, assertHasPermission };
}
