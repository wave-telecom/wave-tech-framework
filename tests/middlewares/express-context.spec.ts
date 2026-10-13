import express, { type ErrorRequestHandler } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getHookCorrelationId,
  getHookRequestChannel,
  getHookTenantId,
  getHookUserId,
} from '../../src/core/hooks';
import { setContext, setCorrelationId, setRequestChannel, setTenantId, setUserId } from '../../src/middlewares/context';
import { listen, type RunningServer } from '../support/express-server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const exposeError: ErrorRequestHandler = (error: Error, req, res, next) => {
  res.status(500).json({ error: error.message });
};

describe('Express 5 context middlewares', () => {
  let server: RunningServer;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use(setContext);
    app.use(setCorrelationId);
    app.use(setUserId);
    app.use(setRequestChannel);

    app.get('/context', async (req, res) => {
      await delay(Number(req.query.delayMs ?? 0));
      res.json({
        correlationId: getHookCorrelationId(),
        userId: getHookUserId() ?? null,
        requestChannel: getHookRequestChannel() ?? null,
      });
    });
    app.post('/pubsub', (req, res) => {
      res.json({ correlationId: getHookCorrelationId() });
    });
    app.get('/tenant', setTenantId(), (req, res) => {
      res.json({ tenantId: getHookTenantId() });
    });
    app.get('/default-tenant', setTenantId('wave'), (req, res) => {
      res.json({ tenantId: getHookTenantId() });
    });

    app.use(exposeError);
    server = await listen(app);
  });

  afterEach(async () => {
    await server.close();
  });

  it('exposes the request headers to the code running inside the request', async () => {
    const res = await fetch(`${server.baseUrl}/context`, {
      headers: { 'x-correlation-id': 'corr-123', 'x-user-id': 'user-9', 'x-request-channel': 'app' },
    });

    expect(await res.json()).toEqual({ correlationId: 'corr-123', userId: 'user-9', requestChannel: 'app' });
  });

  it('generates a correlation id when the header is absent and the request has no body', async () => {
    const res = await fetch(`${server.baseUrl}/context`);

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.correlationId).toMatch(UUID_PATTERN);
    expect(body.userId).toBeNull();
    expect(body.requestChannel).toBeNull();
  });

  it('prefers the Pub/Sub message attribute over the header', async () => {
    const res = await fetch(`${server.baseUrl}/pubsub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'from-header' },
      body: JSON.stringify({ message: { data: '', attributes: { correlationId: 'from-attribute' } } }),
    });

    expect(await res.json()).toEqual({ correlationId: 'from-attribute' });
  });

  it('keeps each concurrent request in its own context', async () => {
    const [slow, fast] = await Promise.all([
      fetch(`${server.baseUrl}/context?delayMs=50`, { headers: { 'x-correlation-id': 'slow', 'x-user-id': 'a' } }),
      fetch(`${server.baseUrl}/context?delayMs=0`, { headers: { 'x-correlation-id': 'fast', 'x-user-id': 'b' } }),
    ]);

    expect(await slow.json()).toEqual({ correlationId: 'slow', userId: 'a', requestChannel: null });
    expect(await fast.json()).toEqual({ correlationId: 'fast', userId: 'b', requestChannel: null });
  });

  it('uses the x-tenant-id header', async () => {
    const res = await fetch(`${server.baseUrl}/tenant`, { headers: { 'x-tenant-id': 'tim' } });

    expect(await res.json()).toEqual({ tenantId: 'tim' });
  });

  it('falls back to the default tenant', async () => {
    const res = await fetch(`${server.baseUrl}/default-tenant`);

    expect(await res.json()).toEqual({ tenantId: 'wave' });
  });

  it('forwards a missing tenant to the error handler', async () => {
    const res = await fetch(`${server.baseUrl}/tenant`);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Tenant ID is required, but it is not present in the request headers',
    });
  });
});
