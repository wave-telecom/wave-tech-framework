export type {
  PermissionValidationRequest,
  PermissionValidationResult,
  PermissionValidator,
} from './permission-validator';
export { WaveAuthPermissionValidator } from './wave-auth-permission-validator';
export { correlationHeaders } from './correlation-headers';

export type { RouteProperties } from './route-properties';
export type { BrokerContext } from './broker-context';
export { requireBrokerContext } from './broker-context';
export type { PermissionAuthOptions, AssertHasPermission } from './register-permission-auth';
export {
  registerPermissionAuth,
  API_KEY_HEADER,
  BROKER_ID_HEADER,
  BROKER_ID_MAX_LENGTH,
  PUBLIC_PATHS,
} from './register-permission-auth';

export {
  PermissionValidatorUnauthorizedError,
  PermissionValidatorUnavailableError,
  PermissionDeniedError,
  MalformedBrokerHeaderError,
  AmbiguousBrokerTargetError,
  BrokerContextNotResolvedError,
} from './errors';
