/**
 * The credential (or, absent one, the caller's IP) presented on this request
 * has exceeded `PermissionAuthOptions.rateLimit`'s configured budget.
 *
 * Doesn't extend a consumer's own HTTP error hierarchy: this is a neutral
 * error owned by this module. Each consuming service maps it to its own
 * response shape once, in its global error handler (`429 Too Many Requests`).
 */
export class TooManyRequestsError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'TooManyRequestsError';
  }
}
