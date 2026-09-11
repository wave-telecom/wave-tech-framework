import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PermissionValidationResult, PermissionValidator } from './permission-validator';
import { PermissionValidatorUnauthorizedError } from './permission-validator-unauthorized-error';
import { PermissionDeniedError } from './permission-denied-error';
import { MalformedBrokerHeaderError } from './malformed-broker-header-error';
import { AmbiguousBrokerTargetError } from './ambiguous-broker-target-error';
import type { RouteProperties } from './route-properties';

/** Header clients must send carrying their API key. */
export const API_KEY_HEADER = 'x-api-key';
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

function requiresSingleBroker(request: FastifyRequest, route: RouteProperties): boolean {
  if (route.singleBrokerWhen) {
    return route.singleBrokerWhen(request);
  }
  return route.singleBroker ?? true;
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

  if (!result.authorized || result.brokers.length === 0) {
    throw new PermissionDeniedError(`The API key does not have the ${route.permissionName} permission`);
  }

  if (result.brokers.length > 1 && requiresSingleBroker(request, route)) {
    throw new AmbiguousBrokerTargetError(
      'This operation applies to a single broker: send the x-broker-id header to select one',
    );
  }

  request.brokerContext = Object.freeze({ scope: Object.freeze([...result.brokers]) });
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
 * 2. `x-api-key` missing or empty -> `401`, even before routing decides,
 *    so a caller with no credential can't tell an existing route from a
 *    nonexistent one by omitting it;
 * 3. path didn't match any route Fastify knows about -> returns without
 *    throwing, letting Fastify's own 404 handling take over;
 * 4. route matched but has no entry in `routes` -> `403` (deny by
 *    default), without ever reaching the network;
 * 5. broker id header malformed -> `400`, also without reaching the
 *    network;
 * 6. `validate()`;
 * 7. denied verdict or empty scope -> `403`;
 * 8. scope spans more than one broker on a route that requires exactly
 *    one -> `400`. This one comes *after* `validate()` because only the
 *    verdict reveals how many brokers the scope actually has.
 */
export function registerPermissionAuth(
  app: FastifyInstance,
  options: PermissionAuthOptions,
): AssertHasPermission {
  const publicPaths = options.publicPaths ?? PUBLIC_PATHS;
  const apiKeyHeader = options.apiKeyHeader ?? API_KEY_HEADER;
  const brokerIdHeader = options.brokerIdHeader ?? BROKER_ID_HEADER;
  const brokerIdMaxLength = options.brokerIdMaxLength ?? BROKER_ID_MAX_LENGTH;

  const assertHasPermission: AssertHasPermission = async (request, route) => {
    const apiKey = request.headers[apiKeyHeader];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new PermissionValidatorUnauthorizedError();
    }
    await checkRoutePermission(
      request,
      route,
      apiKey,
      options.validator,
      brokerIdHeader,
      brokerIdMaxLength,
    );
  };

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const routeUrl = request.routeOptions.url;
    if (isPublicPath(routeUrl ?? request.url, publicPaths)) {
      return;
    }

    const apiKey = request.headers[apiKeyHeader];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
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

    await checkRoutePermission(
      request,
      route,
      apiKey,
      options.validator,
      brokerIdHeader,
      brokerIdMaxLength,
    );
  });

  return assertHasPermission;
}
