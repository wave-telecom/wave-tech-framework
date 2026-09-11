/**
 * The `validate` call failed to produce a verdict at all: a timeout, a
 * non-2xx response other than `401` (a `403` — the caller's own key lacks
 * `auth.api_key.validate` — a `5xx`, a malformed `400`), or a 2xx body that
 * doesn't carry `authorized`/`brokers`. Callers must treat this as "the
 * validator is unavailable" and fail closed — never as "not authorized".
 *
 * Doesn't extend a consumer's own HTTP error hierarchy — see
 * {@link PermissionValidatorUnauthorizedError}.
 */
export class PermissionValidatorUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`Permission validator unavailable: ${detail}`);
    this.name = 'PermissionValidatorUnavailableError';
  }
}
