/**
 * The `wave-auth-api` `POST /auth/permissions/validate` contract: check
 * whether a given API key holds a given permission (and, optionally, that
 * permission for a subset of the key's brokers).
 */
export interface PermissionValidationRequest {
  /** The caller's own API key, forwarded as-is — never transformed or logged. */
  apiKey: string;
  /** The permission being checked, in wave-auth-api's `resource.action` format. */
  permission: string;
  /** Restricts the check to this subset of the key's brokers; omitted means every broker it has. */
  brokers?: readonly string[];
}

export interface PermissionValidationResult {
  authorized: boolean;
  brokers: readonly string[];
}

export interface PermissionValidator {
  /**
   * Resolves with the verdict on success. Throws
   * `PermissionValidatorUnauthorizedError` when the credential itself is
   * invalid, revoked or expired, and `PermissionValidatorUnavailableError`
   * when no verdict could be obtained at all (timeout, 5xx, malformed
   * response) — callers must fail closed on the latter.
   */
  validate: (request: PermissionValidationRequest) => Promise<PermissionValidationResult>;
}
