import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'node:http';
import { describe, it, expect, afterEach } from 'vitest';
import {
  expressRegisterPermissionAuth,
  API_KEY_HEADER,
  AUTHORIZATION_HEADER,
} from './express-register-permission-auth';
import { requireBrokerContext } from '../broker-context';
import { PermissionValidatorUnauthorizedError } from '../errors/permission-validator-unauthorized-error';
import { PermissionDeniedError } from '../errors/permission-denied-error';
import { AmbiguousBrokerTargetError } from '../errors/ambiguous-broker-target-error';
import { SessionTokenInvalidError } from '../errors/session-token-invalid-error';
import type {
  PermissionValidationRequest,
  PermissionValidationResult,
  PermissionValidator,
} from '../api-key/permission-validator';
import type { SessionTokenClaims, SessionTokenVerifier } from '../session-token/session-token-verifier';
import type { RouteProperties } from '../route-properties';

const API_KEY = 'test-secret-key';
const SESSION_TOKEN = 'test-session-token';
const PERMISSION = 'usage.balance.get';

class FakePermissionValidator implements PermissionValidator {
  public readonly calls: PermissionValidationRequest[] = [];

  constructor(
    private readonly resolve: (
      request: PermissionValidationRequest,
    ) => PermissionValidationResult | Error,
  ) {}

  validate(request: PermissionValidationRequest): Promise<PermissionValidationResult> {
    this.calls.push(request);
    const outcome = this.resolve(request);
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}

const authorizes = (brokers: string[] = ['tim']): FakePermissionValidator =>
  new FakePermissionValidator(() => ({ authorized: true, brokers }));

const denies = (): FakePermissionValidator =>
  new FakePermissionValidator(() => ({ authorized: false, brokers: [] }));

class FakeSessionTokenVerifier implements SessionTokenVerifier {
  public readonly calls: string[] = [];

  constructor(private readonly resolve: (token: string) => SessionTokenClaims | Error) {}

  verify(token: string): Promise<SessionTokenClaims> {
    this.calls.push(token);
    const outcome = this.resolve(token);
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}

const verifiesAs = (claims: SessionTokenClaims): FakeSessionTokenVerifier =>
  new FakeSessionTokenVerifier(() => claims);

function testErrorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof PermissionValidatorUnauthorizedError) {
    res.status(401).json({ type: 'unauthorized', message: error.message });
    return;
  }
  if (error instanceof PermissionDeniedError) {
    res.status(403).json({ type: 'forbidden', message: error.message });
    return;
  }
  if (error instanceof AmbiguousBrokerTargetError) {
    res.status(400).json({ type: 'ambiguous-broker-target', message: error.message });
    return;
  }
  if (error instanceof SessionTokenInvalidError) {
    res.status(401).json({ type: 'session-token-invalid', message: error.message });
    return;
  }
  res.status(500).json({ type: 'unexpected', message: error.message });
}

interface BuildAppOptions {
  validator: PermissionValidator;
  sessionTokenVerifier?: SessionTokenVerifier;
  routes: Readonly<Record<string, RouteProperties>>;
  publicPaths?: string[];
}

function buildTestApp(options: BuildAppOptions): Express {
  const app = express();

  const { middleware } = expressRegisterPermissionAuth({
    validator: options.validator,
    sessionTokenVerifier: options.sessionTokenVerifier,
    routes: options.routes,
    publicPaths: options.publicPaths,
  });

  app.use(middleware);

  app.get('/public', (req, res) => res.json({ status: 'ok' }));
  app.get('/balances', (req, res) => res.json({ scope: requireBrokerContext(req).scope }));
  app.get('/tenant-wide', (req, res) =>
    res.json({ hasBrokerContext: req.brokerContext !== undefined }),
  );
  app.get('/session-scoped', (req, res) => res.json({ scope: requireBrokerContext(req).scope }));

  app.use(testErrorHandler);

  return app;
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the Express server to bind to a TCP port.');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function inject(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; json: () => Promise<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { statusCode: res.status, json: () => res.json() };
}

describe('expressRegisterPermissionAuth', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server?.close(() => {
          resolve();
        });
      });
      server = undefined;
    }
  });

  describe('public paths', () => {
    it('allows a public path without a key, without calling the validator', async () => {
      const validator = authorizes();
      const app = buildTestApp({
        validator,
        routes: { 'GET /balances': { permissionName: PERMISSION } },
        publicPaths: ['/public'],
      });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/public');

      expect(res.statusCode).toBe(200);
      expect(validator.calls).toHaveLength(0);
    });

    it('defaults publicPaths to empty — router-relative "/public" is never accidentally public', async () => {
      const validator = authorizes();
      const app = buildTestApp({ validator, routes: { 'GET /balances': { permissionName: PERMISSION } } });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/public');

      expect(res.statusCode).toBe(401);
    });
  });

  describe('authentication', () => {
    it('rejects a mapped route without a key (401), without calling the validator', async () => {
      const validator = authorizes();
      const app = buildTestApp({ validator, routes: { 'GET /balances': { permissionName: PERMISSION } } });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/balances');

      expect(res.statusCode).toBe(401);
      expect(validator.calls).toHaveLength(0);
    });

    it('answers a mapped route once authorized', async () => {
      const validator = authorizes(['tim']);
      const app = buildTestApp({ validator, routes: { 'GET /balances': { permissionName: PERMISSION } } });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/balances', { [API_KEY_HEADER]: API_KEY });

      expect(res.statusCode).toBe(200);
      expect(await res.json()).toEqual({ scope: ['tim'] });
      expect(validator.calls).toEqual([{ apiKey: API_KEY, permission: PERMISSION }]);
    });

    it('rejects a denied verdict (403)', async () => {
      const validator = denies();
      const app = buildTestApp({ validator, routes: { 'GET /balances': { permissionName: PERMISSION } } });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/balances', { [API_KEY_HEADER]: API_KEY });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('deny by default', () => {
    it('answers 403 (not 404) for a path with a credential but no entry in routes', async () => {
      const validator = authorizes();
      const app = buildTestApp({ validator, routes: { 'GET /balances': { permissionName: PERMISSION } } });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/unmapped', { [API_KEY_HEADER]: API_KEY });

      expect(res.statusCode).toBe(403);
      expect(validator.calls).toHaveLength(0);
    });
  });

  describe('brokerScoped: false', () => {
    it('allows an empty broker scope and sets no broker context', async () => {
      const validator = authorizes([]);
      const app = buildTestApp({
        validator,
        routes: { 'GET /tenant-wide': { permissionName: PERMISSION, brokerScoped: false } },
      });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/tenant-wide', { [API_KEY_HEADER]: API_KEY });

      expect(res.statusCode).toBe(200);
      expect(await res.json()).toEqual({ hasBrokerContext: false });
    });
  });

  describe('acceptsSessionToken', () => {
    it('authenticates via a bearer session token, never calling the permission validator', async () => {
      const validator = authorizes();
      const sessionTokenVerifier = verifiesAs({ sub: 'key-1', brokers: ['tim'] });
      const app = buildTestApp({
        validator,
        sessionTokenVerifier,
        routes: {
          'GET /session-scoped': { permissionName: PERMISSION, acceptsSessionToken: true },
        },
      });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/session-scoped', {
        [AUTHORIZATION_HEADER]: `Bearer ${SESSION_TOKEN}`,
      });

      expect(res.statusCode).toBe(200);
      expect(await res.json()).toEqual({ scope: ['tim'] });
      expect(sessionTokenVerifier.calls).toEqual([SESSION_TOKEN]);
      expect(validator.calls).toHaveLength(0);
    });

    it('rejects a bearer-only request on a route that does not accept session tokens', async () => {
      const validator = authorizes();
      const app = buildTestApp({ validator, routes: { 'GET /balances': { permissionName: PERMISSION } } });
      const listening = await listen(app);
      server = listening.server;

      const res = await inject(listening.baseUrl, '/balances', {
        [AUTHORIZATION_HEADER]: `Bearer ${SESSION_TOKEN}`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('throws synchronously at registration if a route opts in without a sessionTokenVerifier', () => {
      expect(() =>
        expressRegisterPermissionAuth({
          validator: authorizes(),
          routes: {
            'GET /session-scoped': { permissionName: PERMISSION, acceptsSessionToken: true },
          },
        }),
      ).toThrow(/sessionTokenVerifier/);
    });
  });
});
