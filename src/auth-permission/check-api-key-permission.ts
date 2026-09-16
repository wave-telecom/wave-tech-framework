import type { FastifyRequest } from 'fastify';
import type { PermissionValidationResult, PermissionValidator } from './permission-validator';
import { PermissionDeniedError } from './errors/permission-denied-error';
import type { RouteProperties } from './route-properties';
import { readBrokerId, resolveBrokerContext } from './broker-scope-resolution';

/**
 * Authenticates and authorizes an `x-api-key` credential against
 * wave-auth-api: reads the broker id header (if any), calls `validate`, and
 * resolves `request.brokerContext`. Shared by the route-map hook and by the
 * standalone `assertHasPermission` it returns, so the two never drift on
 * this part of the contract.
 */
export async function checkApiKeyPermission(
  request: FastifyRequest,
  route: RouteProperties,
  apiKey: string,
  validator: PermissionValidator,
  brokerIdHeader: string,
  brokerIdMaxLength: number,
): Promise<void> {
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

  resolveBrokerContext(
    request,
    route,
    result.brokers,
    `The API key does not have the ${route.permissionName} permission`,
  );
}
