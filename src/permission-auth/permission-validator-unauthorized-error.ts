/**
 * The `validate` call answered `401`: the credential itself is invalid,
 * revoked or expired. Also thrown locally, before any network call, when the
 * inbound request carries no `x-api-key` at all — the body is opaque and
 * identical either way, since distinguishing the two would tell the bearer
 * whether the key they hold is recognised at all.
 *
 * Doesn't extend a consumer's own HTTP error hierarchy: this is a neutral
 * error owned by this module. Each consuming service maps it to its own
 * response shape once, in its global error handler.
 */
export class PermissionValidatorUnauthorizedError extends Error {
  constructor() {
    super('Permission validator rejected the API key as invalid, revoked or expired');
    this.name = 'PermissionValidatorUnauthorizedError';
  }
}
