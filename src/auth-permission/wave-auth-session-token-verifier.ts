import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { SessionTokenInvalidError } from './errors/session-token-invalid-error';
import type { SessionTokenClaims, SessionTokenVerifier } from './session-token-verifier';

/** Not version-prefixed: this is the path wave-auth-api itself publishes. */
const JWKS_PATH = '/.well-known/jwks.json';

/**
 * The only algorithms wave-auth-api ever signs with. Passed explicitly to
 * `jwtVerify` rather than trusting the token's own `alg` header — accepting
 * whatever the token claims would let a token signed with a weaker or
 * attacker-chosen algorithm (e.g. `HS256` keyed on the public key) pass.
 */
const ALGORITHMS = ['RS256', 'ES256'];

const claimsSchema = z.object({
  sub: z.string(),
  brokers: z.array(z.string()),
});

/**
 * Verifies a wave-auth-api session token entirely offline, against the
 * public key wave-auth-api publishes at `{baseUrl}/.well-known/jwks.json`.
 * No network call happens per verification beyond `jose`'s own JWKS
 * caching/refresh — this is the offline counterpart to
 * `WaveAuthPermissionValidator`, which is a live call instead.
 */
export class WaveAuthSessionTokenVerifier implements SessionTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(baseUrl: string) {
    this.jwks = createRemoteJWKSet(new URL(`${baseUrl.replace(/\/+$/, '')}${JWKS_PATH}`));
  }

  async verify(token: string): Promise<SessionTokenClaims> {
    const payload = await this.verifySignature(token);

    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SessionTokenInvalidError('the session token does not carry sub and brokers');
    }

    return { sub: parsed.data.sub, brokers: parsed.data.brokers };
  }

  private async verifySignature(token: string): Promise<unknown> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, { algorithms: ALGORITHMS });
      return payload;
    } catch (cause) {
      throw new SessionTokenInvalidError(
        `the session token failed verification — ${describeFailure(cause)}`,
      );
    }
  }
}

const describeFailure = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : 'unknown verification failure';
