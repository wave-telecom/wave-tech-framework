import express from 'express';
import type { OAuth2Client, TokenPayload } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gcpAuthenticationMiddleware } from '../../src/middlewares/gcp-authentication';
import { listen, type RunningServer } from '../support/express-server';

const AUDIENCE = 'https://wave-lines-api.run.app';
const SERVICE_ACCOUNT = 'pubsub-push@wave.iam.gserviceaccount.com';

const validPayload: TokenPayload = {
  iss: 'https://accounts.google.com',
  aud: AUDIENCE,
  email: SERVICE_ACCOUNT,
  email_verified: true,
  sub: '1',
  iat: 0,
  exp: 0,
};

const payloadsByToken: Partial<Record<string, TokenPayload>> = {
  'valid-token': validPayload,
  'other-issuer': { ...validPayload, iss: 'https://evil.example.com' },
  'other-audience': { ...validPayload, aud: 'https://other.run.app' },
  'other-account': { ...validPayload, email: 'someone@wave.iam.gserviceaccount.com' },
  'unverified-email': { ...validPayload, email_verified: false },
};

const fakeOAuth2Client = {
  verifyIdToken: ({ idToken, audience }: { idToken: string; audience: string }) => {
    const payload = payloadsByToken[idToken];
    if (payload === undefined || audience !== AUDIENCE) {
      return Promise.reject(new Error('Invalid token signature'));
    }
    return Promise.resolve({ getPayload: () => payload });
  },
} as unknown as OAuth2Client;

describe('gcpAuthenticationMiddleware on Express 5', () => {
  let server: RunningServer;

  beforeEach(async () => {
    const app = express();
    app.use(gcpAuthenticationMiddleware(fakeOAuth2Client, {
      audience: AUDIENCE,
      gcpServiceAccountEmail: SERVICE_ACCOUNT,
    }));
    app.post('/push', (req, res) => res.json({ accepted: true }));
    server = await listen(app);
  });

  afterEach(async () => {
    await server.close();
  });

  const push = async (authorization?: string): Promise<Response> =>
    fetch(`${server.baseUrl}/push`, {
      method: 'POST',
      headers: authorization === undefined ? {} : { authorization },
    });

  it('lets a valid Google-signed token through', async () => {
    const res = await push('Bearer valid-token');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });
  });

  it.each([
    [undefined, 'Unauthorized: No authorization header'],
    ['Bearer', 'Unauthorized: No token provided'],
    ['Bearer forged-token', 'Unauthorized: Token verification failed'],
    ['Bearer other-issuer', 'Unauthorized: Invalid token issuer'],
    ['Bearer other-audience', 'Unauthorized: Invalid token audience'],
    ['Bearer other-account', 'Unauthorized: Invalid token service account email'],
    ['Bearer unverified-email', 'Unauthorized: Email not verified'],
  ])('rejects authorization %j with 401', async (authorization, message) => {
    const res = await push(authorization);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(message);
  });
});
