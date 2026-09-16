import type { FastifyRequest } from 'fastify';
import type { SessionTokenClaims, SessionTokenVerifier } from './session-token-verifier';
import type { RouteProperties } from './route-properties';
import { readBrokerId, resolveBrokerContext } from './broker-scope-resolution';

/**
 * The session-token counterpart to `checkApiKeyPermission`. There is no
 * permission verdict to ask for — wave-auth-api's session tokens
 * deliberately carry no `permissions` claim — so a route only reaches this
 * path by opting in via `acceptsSessionToken`, and the token's `brokers`
 * claim (optionally narrowed by `x-broker-id`, the same as an API key's
 * scope) becomes the resolved broker context directly.
 */
export async function authenticateWithSessionToken(
  request: FastifyRequest,
  route: RouteProperties,
  token: string,
  verifier: SessionTokenVerifier,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): Promise<void> {
  const claims: SessionTokenClaims = await verifier.verify(token);
  const brokerId = route.brokerScoped === false
    ? undefined
    : readBrokerId(request, brokerIdHeader, brokerIdMaxLength);
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
