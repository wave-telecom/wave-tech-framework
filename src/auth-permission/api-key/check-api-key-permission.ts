import type { BrokerContext } from '../broker-context';
import type { PermissionValidationResult, PermissionValidator } from './permission-validator';
import { PermissionDeniedError } from '../errors/permission-denied-error';
import type { RouteProperties } from '../route-properties';
import { readBrokerId, resolveBrokerScope } from '../shared/broker-scope-resolution';
import type { WaveRequest } from '../shared/wave-request';

/**
 * Authenticates and authorizes an `x-api-key` credential against
 * wave-auth-api: reads the broker id header (if any), calls `validate`, and
 * resolves the broker scope. Shared by the route-map hook and by the
 * standalone `assertHasPermission` it returns, so the two never drift on
 * this part of the contract.
 *
 * Pure — returns the resolved `BrokerContext` (or `undefined` for a
 * `brokerScoped: false` route) rather than assigning it onto `request`;
 * each framework-specific orchestrator does that assignment onto its own
 * native request object.
 */
export async function checkApiKeyPermission(
  request: WaveRequest,
  route: RouteProperties,
  apiKey: string,
  validator: PermissionValidator,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): Promise<BrokerContext | undefined> {
  const brokerId = route.brokerScoped === false
    ? undefined
    : readBrokerId(request, brokerIdHeader, brokerIdMaxLength);

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

  return resolveBrokerScope(
    request,
    route,
    result.brokers,
    `The API key does not have the ${route.permissionName} permission`,
  );
}
