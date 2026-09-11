import { request as httpRequest } from 'node:http';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { describe, it, expect, afterEach } from 'vitest';
import { registerPermissionAuth, API_KEY_HEADER, BROKER_ID_HEADER } from './register-permission-auth';
import { requireBrokerContext } from './broker-context';
import { PermissionValidatorUnauthorizedError } from './permission-validator-unauthorized-error';
import { PermissionValidatorUnavailableError } from './permission-validator-unavailable-error';
import { PermissionDeniedError } from './permission-denied-error';
import { MalformedBrokerHeaderError } from './malformed-broker-header-error';
import { AmbiguousBrokerTargetError } from './ambiguous-broker-target-error';
import { BrokerContextNotResolvedError } from './broker-context-not-resolved-error';
import type {
  PermissionValidationRequest,
  PermissionValidationResult,
  PermissionValidator,
} from './permission-validator';
import type { RouteProperties } from './route-properties';

const API_KEY = 'test-secret-key';
const PERMISSION = 'carrier.delivery_order.create';

/** Records every call and resolves each one through a caller-supplied function. */
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

const denies = (brokers: string[] = []): FakePermissionValidator =>
  new FakePermissionValidator(() => ({ authorized: false, brokers }));

const throwing = (error: Error): FakePermissionValidator =>
  new FakePermissionValidator(() => error);

/** Mirrors what a consuming app's own global error handler does: one instanceof per error class. */
function testErrorHandler(error: Error, request: unknown, reply: FastifyReply): void {
  if (error instanceof PermissionValidatorUnauthorizedError) {
    reply.status(401).send({ type: 'unauthorized', message: error.message });
    return;
  }
  if (error instanceof PermissionDeniedError) {
    reply.status(403).send({ type: 'forbidden', message: error.message });
    return;
  }
  if (error instanceof MalformedBrokerHeaderError) {
    reply.status(400).send({ type: 'malformed-broker-header', message: error.message });
    return;
  }
  if (error instanceof AmbiguousBrokerTargetError) {
    reply.status(400).send({ type: 'ambiguous-broker-target', message: error.message });
    return;
  }
  if (error instanceof PermissionValidatorUnavailableError) {
    reply.status(503).send({ type: 'unavailable', message: error.message });
    return;
  }
  if (error instanceof BrokerContextNotResolvedError) {
    reply.status(500).send({ type: 'broker-context-not-resolved', message: error.message });
    return;
  }
  reply.status(500).send({ type: 'unexpected', message: error.message });
}

interface BuildAppOptions {
  validator: PermissionValidator;
  routes?: Readonly<Record<string, RouteProperties>>;
  publicPaths?: string[];
  brokerIdMaxLength?: number;
}

function buildTestApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setErrorHandler(testErrorHandler);

  const routes: Record<string, RouteProperties> = {
    'POST /protected': { permissionName: PERMISSION },
    'GET /multi-broker-ok': { permissionName: PERMISSION, singleBroker: false },
    'GET /multi-broker-conditional': {
      permissionName: PERMISSION,
      singleBrokerWhen: (request) => (request.query as { orderBy?: string }).orderBy === 'manual',
    },
    ...options.routes,
  };

  const assertHasPermission = registerPermissionAuth(app, {
    validator: options.validator,
    routes,
    publicPaths: options.publicPaths,
    brokerIdMaxLength: options.brokerIdMaxLength,
  });

  app.get('/', () => ({ status: 'ok' }));
  app.get('/management/health', () => ({ status: 'ok' }));
  app.post('/protected', () => ({ ok: true }));
  app.get('/multi-broker-ok', (request) => ({ scope: requireBrokerContext(request).scope }));
  app.get('/multi-broker-conditional', (request) => ({
    scope: requireBrokerContext(request).scope,
  }));
  // Registered with Fastify but deliberately absent from `routes` above.
  app.get('/registered-but-unmapped', () => ({ ok: true }));
  // A path the global hook treats as public (via publicPaths), whose own
  // separate hook stands in for something like a vendor webhook checking a
  // permission outside the route map — the scenario `assertHasPermission`
  // exists for.
  app.register((webhook, opts, done) => {
    webhook.addHook('onRequest', async (request) => {
      await assertHasPermission(request, { permissionName: 'toutbox.delivery_order.webhook' });
    });
    webhook.post('/webhook', (request) => ({ scope: requireBrokerContext(request).scope }));
    done();
  });
  // Public, but its handler still (incorrectly) tries to read a broker
  // context that the hook never resolved for it.
  app.get('/public-misuse', (request) => ({ scope: requireBrokerContext(request).scope }));

  return app;
}

describe('registerPermissionAuth', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  describe('public paths', () => {
    it.each(['/', '/management/health'])('allows %s without a key, without calling the validator', async (path) => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({ method: 'GET', url: path });

      expect(res.statusCode).toBe(200);
      expect(validator.calls).toHaveLength(0);
    });

    it('honours an explicit publicPaths list over the defaults', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator, publicPaths: ['/webhook'] });

      // `/` is only public by default; an explicit list replaces the defaults.
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('authentication', () => {
    it('rejects a mapped route without a key (401), without calling the validator', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({ method: 'POST', url: '/protected' });

      expect(res.statusCode).toBe(401);
      expect(validator.calls).toHaveLength(0);
    });

    it('treats an empty x-api-key the same as a missing one', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: '' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects a genuinely unmatched path without a key (401) before routing decides', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

      expect(res.statusCode).toBe(401);
    });

    it('lets a genuinely unmatched path fall through to a 404 once a key is present', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'GET',
        url: '/does-not-exist',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(404);
      expect(validator.calls).toHaveLength(0);
    });

    it('rejects when the validator itself rejects the key (401), even though it looked well-formed', async () => {
      const validator = throwing(new PermissionValidatorUnauthorizedError());
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(401);
    });

    it('answers 503 when the validator is unavailable — fails closed, never open', async () => {
      const validator = throwing(new PermissionValidatorUnavailableError('timeout'));
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe('deny by default', () => {
    it('rejects a route Fastify knows about but that has no entry in `routes` (403), without calling the validator', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'GET',
        url: '/registered-but-unmapped',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(403);
      expect(validator.calls).toHaveLength(0);
    });
  });

  describe('authorization verdict', () => {
    it('allows a mapped route once authorized, checking exactly the mapped permission', async () => {
      const validator = authorizes(['tim']);
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(200);
      expect(validator.calls).toEqual([{ apiKey: API_KEY, permission: PERMISSION }]);
    });

    it('rejects a denied verdict (403)', async () => {
      const validator = denies();
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects an authorized verdict with an empty broker scope (403)', async () => {
      const validator = authorizes([]);
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('broker id header', () => {
    it('forwards a present x-broker-id as the brokers filter', async () => {
      const validator = authorizes(['broker-a']);
      app = buildTestApp({ validator });

      await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY, [BROKER_ID_HEADER]: 'broker-a' },
      });

      expect(validator.calls).toEqual([
        { apiKey: API_KEY, permission: PERMISSION, brokers: ['broker-a'] },
      ]);
    });

    it('omits brokers from the call entirely when the header is absent', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(Object.keys(validator.calls[0])).not.toContain('brokers');
    });

    it('rejects an empty x-broker-id (400), without calling the validator', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY, [BROKER_ID_HEADER]: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(validator.calls).toHaveLength(0);
    });

    it('rejects a x-broker-id longer than the configured maximum (400)', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator, brokerIdMaxLength: 5 });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY, [BROKER_ID_HEADER]: 'this-is-too-long' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects a genuinely repeated x-broker-id (400) — detected via rawHeaders, not the comma-joined value', async () => {
      // `light-my-request`'s `inject()` collapses an array header value into
      // a single occurrence before it ever reaches the request, so this one
      // needs a real socket: Node's `http.request` sends an array header
      // value as two separate header lines, which is what `rawHeaders`
      // actually needs to contain for the repeated-header check to matter.
      const validator = authorizes();
      app = buildTestApp({ validator });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected the Fastify server to bind to a TCP port.');
      }

      const statusCode = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          {
            method: 'POST',
            host: '127.0.0.1',
            port: address.port,
            path: '/protected',
            headers: {
              [API_KEY_HEADER]: API_KEY,
              [BROKER_ID_HEADER]: ['broker-a', 'broker-b'],
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => {
              resolve(res.statusCode);
            });
          },
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(400);
      expect(validator.calls).toHaveLength(0);
    });
  });

  describe('single-broker requirement (default true)', () => {
    it('rejects a multi-broker scope on a route with no explicit override (400), after actually calling validate', async () => {
      const validator = authorizes(['broker-a', 'broker-b']);
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(400);
      expect(validator.calls).toHaveLength(1);
    });

    it('accepts a single-broker scope with or without x-broker-id sent', async () => {
      const validator = authorizes(['tim']);
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(200);
    });

    it('accepts a multi-broker scope once x-broker-id narrows it back to one', async () => {
      const validator = new FakePermissionValidator((request) => ({
        authorized: true,
        brokers: request.brokers ?? ['broker-a', 'broker-b'],
      }));
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'POST',
        url: '/protected',
        headers: { [API_KEY_HEADER]: API_KEY, [BROKER_ID_HEADER]: 'broker-a' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('routes that opt out of the single-broker default', () => {
    it('singleBroker: false accepts a multi-broker scope outright', async () => {
      const validator = authorizes(['broker-a', 'broker-b']);
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'GET',
        url: '/multi-broker-ok',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ scope: ['broker-a', 'broker-b'] });
    });

    it('singleBrokerWhen enforces the requirement only when the predicate matches', async () => {
      const validator = authorizes(['broker-a', 'broker-b']);
      app = buildTestApp({ validator });

      const withoutManualOrdering = await app.inject({
        method: 'GET',
        url: '/multi-broker-conditional',
        headers: { [API_KEY_HEADER]: API_KEY },
      });
      expect(withoutManualOrdering.statusCode).toBe(200);

      const withManualOrdering = await app.inject({
        method: 'GET',
        url: '/multi-broker-conditional?orderBy=manual',
        headers: { [API_KEY_HEADER]: API_KEY },
      });
      expect(withManualOrdering.statusCode).toBe(400);
    });
  });

  describe('broker context', () => {
    it('freezes both the resolved context and its scope array', async () => {
      const validator = authorizes(['broker-a', 'broker-b']);
      app = buildTestApp({ validator });

      const res = await app.inject({
        method: 'GET',
        url: '/multi-broker-ok',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      // The route handler itself calls `requireBrokerContext` and returns its
      // scope — reaching a 200 with the right payload already proves the
      // object was usable; freezing is exercised directly in the use-case
      // layer of a real consumer, not observable over HTTP.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ scope: ['broker-a', 'broker-b'] });
    });

    it('requireBrokerContext throws when the hook never ran for this request (500)', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator, publicPaths: ['/', '/management/health', '/public-misuse'] });

      const res = await app.inject({ method: 'GET', url: '/public-misuse' });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('assertHasPermission returned by registerPermissionAuth', () => {
    it('authenticates and authorizes a permission outside the route map', async () => {
      const validator = authorizes(['tim']);
      app = buildTestApp({ validator, publicPaths: ['/', '/management/health', '/webhook'] });

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: { [API_KEY_HEADER]: API_KEY },
      });

      expect(res.statusCode).toBe(200);
      expect(validator.calls).toEqual([
        { apiKey: API_KEY, permission: 'toutbox.delivery_order.webhook' },
      ]);
    });

    it('rejects it the same way the main hook would (401 without a key)', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator, publicPaths: ['/', '/management/health', '/webhook'] });

      const res = await app.inject({ method: 'POST', url: '/webhook' });

      expect(res.statusCode).toBe(401);
    });

    it('still enforces the broker id header shape (400)', async () => {
      const validator = authorizes();
      app = buildTestApp({ validator, publicPaths: ['/', '/management/health', '/webhook'] });

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: { [API_KEY_HEADER]: API_KEY, [BROKER_ID_HEADER]: '' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
