import type { BrokerContext } from '../broker-context';
import type { SessionTokenClaims, SessionTokenVerifier } from './session-token-verifier';
import type { RouteProperties } from '../route-properties';
import { readBrokerId, resolveBrokerScope } from '../shared/broker-scope-resolution';
import type { WaveRequest } from '../shared/wave-request';

/**
 * The session-token counterpart to `checkApiKeyPermission`. There is no
 * permission verdict to ask for — wave-auth-api's session tokens
 * deliberately carry no `permissions` claim — so a route only reaches this
 * path by opting in via `acceptsSessionToken`, and the token's `brokers`
 * claim (optionally narrowed by `x-broker-id`, the same as an API key's
 * scope) becomes the resolved broker scope directly.
 *
 * Pure — see `checkApiKeyPermission`'s doc comment on why this returns
 * rather than mutates.
 */
export async function authenticateWithSessionToken(
  request: WaveRequest,
  route: RouteProperties,
  token: string,
  verifier: SessionTokenVerifier,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): Promise<BrokerContext | undefined> {
  const claims: SessionTokenClaims = await verifier.verify(token);
  const brokerId = route.brokerScoped === false
    ? undefined
    : readBrokerId(request, brokerIdHeader, brokerIdMaxLength);
  const brokers =
    brokerId === undefined ? claims.brokers : restrictToBroker(claims.brokers, brokerId);

  return resolveBrokerScope(
    request,
    route,
    brokers,
    'The session token does not carry an authorized broker scope',
  );
}

function restrictToBroker(brokers: readonly string[], brokerId: string): readonly string[] {
  return brokers.includes(brokerId) ? [brokerId] : [];
}
