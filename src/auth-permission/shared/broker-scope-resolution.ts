import type { BrokerContext } from '../broker-context';
import { PermissionDeniedError } from '../errors/permission-denied-error';
import { MalformedBrokerHeaderError } from '../errors/malformed-broker-header-error';
import { AmbiguousBrokerTargetError } from '../errors/ambiguous-broker-target-error';
import type { RouteProperties } from '../route-properties';
import { countRawHeader } from './raw-headers';
import type { WaveRequest } from './wave-request';

/**
 * Reads the broker id header, read from `rawHeaders` rather than `headers` —
 * see `countRawHeader`.
 */
export function readBrokerId(
  request: WaveRequest,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): string | undefined {
  const header = request.headers[brokerIdHeader];
  if (Array.isArray(header) || countRawHeader(request.rawHeaders, brokerIdHeader) > 1) {
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

function requiresSingleBroker(request: WaveRequest, route: RouteProperties): boolean {
  if (route.singleBrokerWhen) {
    return route.singleBrokerWhen(request);
  }
  return route.singleBroker ?? true;
}

/**
 * The shared tail of both credential paths — API key and session token:
 * empty scope -> deny, more than one broker on a route that requires exactly
 * one -> ambiguous, otherwise resolves to the frozen `BrokerContext` the
 * caller should attach to its own native request object.
 * `emptyScopeMessage` differs per caller because an empty API-key scope and
 * an empty session-token scope are different failures worth describing
 * differently.
 *
 * Pure — never touches the request object itself. Returns `undefined` for a
 * route with `brokerScoped: false`: nothing here applies to an operation
 * that isn't scoped to any particular broker in the first place. Each
 * framework-specific orchestrator is responsible for assigning the result
 * onto its own native request (conditionally — never writing `undefined`,
 * which would create the property where today it's simply absent).
 *
 * Takes `WaveRequest` rather than a pre-resolved `requiresSingleBroker`
 * boolean so `route.singleBrokerWhen` stays lazily invoked exactly as
 * before — only when `brokers.length > 1` and only when `brokerScoped !==
 * false` — instead of running on every request regardless of whether its
 * result would ever matter.
 */
export function resolveBrokerScope(
  request: WaveRequest,
  route: RouteProperties,
  brokers: readonly string[],
  emptyScopeMessage: string,
): BrokerContext | undefined {
  if (route.brokerScoped === false) {
    return undefined;
  }

  if (brokers.length === 0) {
    throw new PermissionDeniedError(emptyScopeMessage);
  }

  if (brokers.length > 1 && requiresSingleBroker(request, route)) {
    throw new AmbiguousBrokerTargetError(
      'This operation applies to a single broker: send the x-broker-id header to select one',
    );
  }

  return Object.freeze({ scope: Object.freeze([...brokers]) });
}
