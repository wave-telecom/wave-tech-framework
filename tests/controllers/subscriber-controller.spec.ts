import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SubscriberController } from '../../src/controllers/subscriber-controller';
import type { ControllerErrors } from '../../src/controllers/controller-errors';
import type { UseCase } from '../../src/core/use-case';
import { listen, type RunningServer } from '../support/express-server';

type ActivationError = 'unknown-line';

const activationSchema = z.object({ msisdn: z.string().regex(/^55\d{10,11}$/) });

const activateLine: UseCase<z.infer<typeof activationSchema>, unknown> = {
  execute: ({ msisdn }) =>
    msisdn === '5511999990000'
      ? { ok: true, value: undefined }
      : { ok: false, error: 'unknown-line', message: `Line ${msisdn} is unknown` },
};

const treatErrors: ControllerErrors<ActivationError> = ({ error, message }, res) =>
  res.status(422).json({ error, message });

function pubSubPush(payload: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { data: Buffer.from(JSON.stringify(payload)).toString('base64'), attributes: {} },
      subscription: 'projects/wave/subscriptions/line-activation',
    }),
  };
}

describe('SubscriberController on Express 5', () => {
  let server: RunningServer;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    const controller = new SubscriberController<ActivationError>(
      activationSchema,
      activateLine,
      treatErrors,
    );
    app.post('/subscriptions/line-activation', (req, res) => controller.execute(req, res));
    server = await listen(app);
  });

  afterEach(async () => {
    await server.close();
  });

  it('decodes the Pub/Sub message and acknowledges it with 200', async () => {
    const res = await fetch(`${server.baseUrl}/subscriptions/line-activation`, pubSubPush({ msisdn: '5511999990000' }));

    expect(res.status).toBe(200);
  });

  it('answers 400 when the decoded message is invalid', async () => {
    const res = await fetch(`${server.baseUrl}/subscriptions/line-activation`, pubSubPush({ msisdn: '11999990000' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Bad Request',
      errors: [{ field: 'msisdn', message: expect.any(String) }],
    });
  });

  it('delegates a failed result to the error handler', async () => {
    const res = await fetch(`${server.baseUrl}/subscriptions/line-activation`, pubSubPush({ msisdn: '5521988880000' }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'unknown-line', message: 'Line 5521988880000 is unknown' });
  });
});
