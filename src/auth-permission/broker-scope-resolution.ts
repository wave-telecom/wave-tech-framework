import type { FastifyRequest } from 'fastify';
import { PermissionDeniedError } from './errors/permission-denied-error';
import { MalformedBrokerHeaderError } from './errors/malformed-broker-header-error';
import { AmbiguousBrokerTargetError } from './errors/ambiguous-broker-target-error';
import type { RouteProperties } from './route-properties';
import { countRawHeader } from './raw-headers';

/**
 * Reads the broker id header, read from `rawHeaders` rather than `headers` —
 * see `countRawHeader`.
 */
export function readBrokerId(
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

function requiresSingleBroker(request: FastifyRequest, route: RouteProperties): boolean {
  if (route.singleBrokerWhen) {
    return route.singleBrokerWhen(request);
  }
  return route.singleBroker ?? true;
}

/**
 * The shared tail of both credential paths — API key and session token:
 * empty scope -> deny, more than one broker on a route that requires exactly
 * one -> ambiguous, otherwise resolve `request.brokerContext`.
 * `emptyScopeMessage` differs per caller because an empty API-key scope and
 * an empty session-token scope are different failures worth describing
 * differently.
 */
export function resolveBrokerContext(
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
