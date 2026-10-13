import express, { type Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpController } from '../../src/controllers/http-controller';
import type { ControllerErrors } from '../../src/controllers/controller-errors';
import type { UseCase } from '../../src/core/use-case';
import { listen, type RunningServer } from '../support/express-server';

type LineError = 'line-not-found';

const lineSchema = z.object({
  id: z.string(),
  status: z.enum(['active', 'suspended']).optional(),
  name: z.string().optional(),
});

type LineInput = z.infer<typeof lineSchema>;

const echoUseCase: UseCase<LineInput, unknown> = {
  execute: (input) => {
    if (input.id === 'missing') return { ok: false, error: 'line-not-found', message: 'Line missing not found' };
    if (input.id === 'empty') return undefined;
    if (input.id === 'paged') return { ok: true, value: { total: 2, data: [{ id: 'a' }, { id: 'b' }] } };
    if (input.id === 'broken') throw new Error('database is down');
    return { ok: true, value: input };
  },
};

const treatErrors: ControllerErrors<LineError> = ({ error, message }, res) =>
  res.status(404).json({ error, message });

function buildApp(options: { parseJson: boolean; isAsyncResponse?: boolean }): Express {
  const app = express();
  if (options.parseJson) app.use(express.json());
  const controller = new HttpController<LineError>(
    lineSchema,
    echoUseCase,
    treatErrors,
    options.isAsyncResponse,
  );
  app.all('/lines/:id', (req, res) => controller.execute(req, res));
  return app;
}

describe('HttpController on Express 5', () => {
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function start(options: Parameters<typeof buildApp>[0]): Promise<string> {
    server = await listen(buildApp(options));
    return server.baseUrl;
  }

  it('validates body, route params and query string together', async () => {
    const baseUrl = await start({ parseJson: true });

    const res = await fetch(`${baseUrl}/lines/5511999990000?status=active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'main line' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ id: '5511999990000', status: 'active', name: 'main line' });
  });

  it('handles a request without a body parser, where Express 5 leaves req.body undefined', async () => {
    const baseUrl = await start({ parseJson: false });

    const res = await fetch(`${baseUrl}/lines/5511999990000?status=suspended`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: '5511999990000', status: 'suspended' });
  });

  it('answers 400 with the validation errors', async () => {
    const baseUrl = await start({ parseJson: false });

    const res = await fetch(`${baseUrl}/lines/5511999990000?status=cancelled`);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Bad Request',
      errors: [{ field: 'status', message: expect.any(String) }],
    });
  });

  it('delegates a failed result to the error handler', async () => {
    const baseUrl = await start({ parseJson: false });

    const res = await fetch(`${baseUrl}/lines/missing`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'line-not-found', message: 'Line missing not found' });
  });

  it('answers 204 when the use case returns nothing', async () => {
    const baseUrl = await start({ parseJson: false });

    const res = await fetch(`${baseUrl}/lines/empty`);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('exposes the total in x-total-count and answers only the page data', async () => {
    const baseUrl = await start({ parseJson: false });

    const res = await fetch(`${baseUrl}/lines/paged`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-total-count')).toBe('2');
    expect(await res.json()).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('answers 202 for asynchronous controllers', async () => {
    const baseUrl = await start({ parseJson: false, isAsyncResponse: true });

    const res = await fetch(`${baseUrl}/lines/5511999990000`);

    expect(res.status).toBe(202);
  });

  it('answers 500 when the use case throws', async () => {
    const baseUrl = await start({ parseJson: false });

    const res = await fetch(`${baseUrl}/lines/broken`);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: 'An unexpected error occurred', error: 'database is down' });
  });
});
