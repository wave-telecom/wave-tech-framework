/**
 * A session token (an `Authorization: Bearer` JWT) failed offline
 * verification — bad signature, unrecognised key, malformed compact JWT, or
 * expired. Also thrown when wave-auth-api's JWKS itself couldn't be fetched,
 * since that too means no verdict on the signature could be reached.
 *
 * Doesn't extend a consumer's own HTTP error hierarchy: this is a neutral
 * error owned by this module. Each consuming service maps it to its own
 * response shape once, in its global error handler (typically `401`).
 */
export class SessionTokenInvalidError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SessionTokenInvalidError';
  }
}
