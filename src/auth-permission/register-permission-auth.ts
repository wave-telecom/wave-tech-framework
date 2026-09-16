import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PermissionValidationResult, PermissionValidator } from './permission-validator';
import type { SessionTokenClaims, SessionTokenVerifier } from './session-token-verifier';
import { PermissionValidatorUnauthorizedError } from './errors/permission-validator-unauthorized-error';
import { PermissionDeniedError } from './errors/permission-denied-error';
import { MalformedBrokerHeaderError } from './errors/malformed-broker-header-error';
import { AmbiguousBrokerTargetError } from './errors/ambiguous-broker-target-error';
import type { RouteProperties } from './route-properties';

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
 * Reads the broker id header, read from `rawHeaders` rather than `headers`:
 * Node folds a repeated header into `'b1, b2'` in `headers`, which would be
 * indistinguishable from a single opaque broker id that happens to contain a
 * comma — `rawHeaders` keeps each occurrence separate so a repeated header
 * is detected instead of silently accepted as one value.
 */
function readBrokerId(
  request: FastifyRequest,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): string | undefined {
  const header = request.headers[brokerIdHeader];
  if (Array.isArray(header) || countRawHeader(request.raw.rawHeaders, brokerIdHeader) > 1) {
    throw new MalformedBrokerHeaderError(`The ${brokerIdHeader} header must be sent at most once`);
  }

  if (header === undefined) {
    return undefined;
  }

  if (header.length === 0 || header.length > brokerIdMaxLength) {
    throw new MalformedBrokerHeaderError(
      `The ${brokerIdHeader} header must be between 1 and ${brokerIdMaxLength} characters`,
    );
  }

  return header;
}

function countRawHeader(rawHeaders: readonly string[] | undefined, headerName: string): number {
  const headers = rawHeaders ?? [];
  let count = 0;
  for (let index = 0; index + 1 < headers.length; index += 2) {
    if (headers[index].toLowerCase() === headerName) {
      count += 1;
    }
  }
  return count;
}

function readApiKey(request: FastifyRequest, apiKeyHeader: string): string | undefined {
  const header = request.headers[apiKeyHeader];
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

/**
 * Reads the session token out of `Authorization: Bearer <token>`. Anything
 * that doesn't conform — a repeated header, a different scheme, an empty
 * token — resolves as `undefined`, the same as the header being absent
 * entirely: this is a credential lookup, not validation, and a caller with a
 * malformed header must not be told anything more than one with no header
 * at all.
 */
function readBearerToken(request: FastifyRequest, authorizationHeader: string): string | undefined {
  const header = request.headers[authorizationHeader];
  if (Array.isArray(header) || countRawHeader(request.raw.rawHeaders, authorizationHeader) > 1) {
    return undefined;
  }

  const match = typeof header === 'string' ? /^Bearer (.+)$/i.exec(header) : null;
  return match?.[1];
}

function requiresSingleBroker(request: FastifyRequest, route: RouteProperties): boolean {
  if (route.singleBrokerWhen) {
    return route.singleBrokerWhen(request);
  }
  return route.singleBroker ?? true;
}

/**
 * The shared tail of both credential paths: empty scope -> deny, more than
 * one broker on a route that requires exactly one -> ambiguous, otherwise
 * resolve `request.brokerContext`. `emptyScopeMessage` differs per caller
 * because an empty API-key scope and an empty session-token scope are
 * different failures worth describing differently.
 */
function resolveBrokerContext(
  request: FastifyRequest,
  route: RouteProperties,
  brokers: readonly string[],
  emptyScopeMessage: string,
): void {
  if (brokers.length === 0) {
    throw new PermissionDeniedError(emptyScopeMessage);
  }

  if (brokers.length > 1 && requiresSingleBroker(request, route)) {
    throw new AmbiguousBrokerTargetError(
      'This operation applies to a single broker: send the x-broker-id header to select one',
    );
  }

  request.brokerContext = Object.freeze({ scope: Object.freeze([...brokers]) });
}

/**
 * Everything after the API key is known to be present: reads the broker id
 * header (if any), calls `validate`, and resolves `request.brokerContext`.
 * Shared by the route-map hook and by the standalone `assertHasPermission`
 * it returns, so the two never drift on this part of the contract.
 */
async function checkRoutePermission(
  request: FastifyRequest,
  route: RouteProperties,
  apiKey: string,
  validator: PermissionValidator,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): Promise<void> {
  const brokerId = readBrokerId(request, brokerIdHeader, brokerIdMaxLength);

  // The key is forwarded byte for byte: this module never stores, derives or
  // compares a key's secret — authorization is wave-auth-api's job alone.
  const result: PermissionValidationResult = await validator.validate({
    apiKey,
    permission: route.permissionName,
    ...(brokerId === undefined ? {} : { brokers: [brokerId] }),
  });

  if (!result.authorized) {
    throw new PermissionDeniedError(`The API key does not have the ${route.permissionName} permission`);
  }

  resolveBrokerContext(
    request,
    route,
    result.brokers,
    `The API key does not have the ${route.permissionName} permission`,
  );
}

/**
 * The session-token counterpart to `checkRoutePermission`. There is no
 * permission verdict to ask for — wave-auth-api's session tokens
 * deliberately carry no `permissions` claim — so a route only reaches this
 * path by opting in via `acceptsSessionToken`, and the token's `brokers`
 * claim (optionally narrowed by `x-broker-id`, the same as an API key's
 * scope) becomes the resolved broker context directly.
 */
async function authenticateWithSessionToken(
  request: FastifyRequest,
  route: RouteProperties,
  token: string,
  verifier: SessionTokenVerifier,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): Promise<void> {
  const claims: SessionTokenClaims = await verifier.verify(token);
  const brokerId = readBrokerId(request, brokerIdHeader, brokerIdMaxLength);
  const brokers =
    brokerId === undefined ? claims.brokers : restrictToBroker(claims.brokers, brokerId);

  resolveBrokerContext(
    request,
    route,
    brokers,
    'The session token does not carry an authorized broker scope',
  );
}

function restrictToBroker(brokers: readonly string[], brokerId: string): readonly string[] {
  return brokers.includes(brokerId) ? [brokerId] : [];
}

/**
 * Registers an `onRequest` hook that authenticates and authorizes every
 * request against wave-auth-api, and returns the same check bound to
 * `validator` for use outside the route map (e.g. a vendor webhook whose
 * permission isn't one of this app's own routes).
 *
 * The order of checks is contractual, not stylistic:
 *
 * 1. public path -> passes without touching the network;
 * 2. neither `x-api-key` nor a valid `Authorization: Bearer` present ->
 *    `401`, even before routing decides, so a caller with no credential
 *    can't tell an existing route from a nonexistent one by omitting it;
 * 3. path didn't match any route Fastify knows about -> returns without
 *    throwing, letting Fastify's own 404 handling take over;
 * 4. route matched but has no entry in `routes` -> `403` (deny by
 *    default), without ever reaching the network;
 * 5. `x-api-key` present -> the existing validate-against-wave-auth-api
 *    path, unconditionally, regardless of `acceptsSessionToken`;
 * 6. otherwise only a bearer token was presented -> `401` unless the route
 *    set `acceptsSessionToken: true`, in which case the token is verified
 *    offline instead and never reaches `validate()` — see
 *    `authenticateWithSessionToken`;
 * 7. broker id header malformed -> `400`, also without reaching the
 *    network;
 * 8. denied verdict or empty scope -> `403`;
 * 9. scope spans more than one broker on a route that requires exactly
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

  const assertHasPermission: AssertHasPermission = async (request, route) => {
    const apiKey = readApiKey(request, apiKeyHeader);
    if (apiKey !== undefined) {
      await checkRoutePermission(
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
