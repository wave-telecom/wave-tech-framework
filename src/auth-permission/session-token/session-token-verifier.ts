/** What a verified wave-auth-api session token carries — identity and broker scope only. */
export interface SessionTokenClaims {
  /** The issuing API key's id. */
  sub: string;
  /** Every broker the issuing API key acts for. */
  brokers: readonly string[];
}

export interface SessionTokenVerifier {
  /**
   * Resolves with the token's claims once its signature and expiry are
   * verified. Never a permission verdict — wave-auth-api's session tokens
   * carry no `permissions` claim by design. Throws `SessionTokenInvalidError`
   * when the token is malformed, unsigned by a recognised key, or expired.
   */
  verify: (token: string) => Promise<SessionTokenClaims>;
}
