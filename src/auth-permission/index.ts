export type {
  PermissionValidationRequest,
  PermissionValidationResult,
  PermissionValidator,
} from './api-key/permission-validator';
export { WaveAuthPermissionValidator } from './api-key/wave-auth-permission-validator';
export type { SessionTokenClaims, SessionTokenVerifier } from './session-token/session-token-verifier';
export { WaveAuthSessionTokenVerifier } from './session-token/wave-auth-session-token-verifier';
export { correlationHeaders } from './shared/correlation-headers';

export type { RouteProperties } from './route-properties';
export type { BrokerContext } from './broker-context';
export { requireBrokerContext } from './broker-context';
export type { PermissionAuthOptions, AssertHasPermission } from './register-permission-auth';
export {
  registerPermissionAuth,
  API_KEY_HEADER,
  AUTHORIZATION_HEADER,
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
  SessionTokenInvalidError,
  TooManyRequestsError,
} from './errors';
