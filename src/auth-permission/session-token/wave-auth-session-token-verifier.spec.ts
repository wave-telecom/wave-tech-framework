import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { WaveAuthSessionTokenVerifier } from './wave-auth-session-token-verifier';
import { SessionTokenInvalidError } from '../errors/session-token-invalid-error';

const BASE_URL = 'https://auth.internal.example';
const JWKS_URL = `${BASE_URL}/.well-known/jwks.json`;
const KID = 'test-kid';

function stubJwks(jwk: JWK): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    expect(String(input)).toBe(JWKS_URL);
    return Promise.resolve(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WaveAuthSessionTokenVerifier', () => {
  it('verifies a validly signed token and returns sub and brokers', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    stubJwks(await exportJWK(publicKey));

    const token = await new SignJWT({ brokers: ['tim'] })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setSubject('key-id-1')
      .setExpirationTime('5m')
      .sign(privateKey);

    const claims = await new WaveAuthSessionTokenVerifier(BASE_URL).verify(token);

    expect(claims).toEqual({ sub: 'key-id-1', brokers: ['tim'] });
  });

  it('rejects an expired token', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    stubJwks(await exportJWK(publicKey));

    const token = await new SignJWT({ brokers: ['tim'] })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setSubject('key-id-1')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);

    await expect(new WaveAuthSessionTokenVerifier(BASE_URL).verify(token)).rejects.toBeInstanceOf(
      SessionTokenInvalidError,
    );
  });

  it('rejects a token signed by a key other than the one published in the JWKS', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    const { privateKey: forgedPrivateKey } = await generateKeyPair('RS256');
    stubJwks(await exportJWK(publicKey));

    const token = await new SignJWT({ brokers: ['tim'] })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setSubject('key-id-1')
      .setExpirationTime('5m')
      .sign(forgedPrivateKey);

    await expect(new WaveAuthSessionTokenVerifier(BASE_URL).verify(token)).rejects.toBeInstanceOf(
      SessionTokenInvalidError,
    );
  });

  it('rejects a validly signed token missing the brokers claim', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    stubJwks(await exportJWK(publicKey));

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setSubject('key-id-1')
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(new WaveAuthSessionTokenVerifier(BASE_URL).verify(token)).rejects.toBeInstanceOf(
      SessionTokenInvalidError,
    );
  });

  it('rejects a token signed with HS256 even if the JWKS only publishes an RS256 key — algorithm confusion', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    stubJwks(await exportJWK(publicKey));

    const token = await new SignJWT({ brokers: ['tim'] })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setSubject('attacker')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-guessed-or-derived-secret'));

    await expect(new WaveAuthSessionTokenVerifier(BASE_URL).verify(token)).rejects.toBeInstanceOf(
      SessionTokenInvalidError,
    );
  });

  it('rejects a string that is not a compact JWT at all', async () => {
    await expect(
      new WaveAuthSessionTokenVerifier(BASE_URL).verify('not-a-jwt'),
    ).rejects.toBeInstanceOf(SessionTokenInvalidError);
  });
});
