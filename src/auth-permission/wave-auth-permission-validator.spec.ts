import { describe, it, expect, afterEach, vi } from 'vitest';
import { setHookContext, setHookCorrelationId } from '../core';
import { WaveAuthPermissionValidator } from './wave-auth-permission-validator';
import { PermissionValidatorUnauthorizedError } from './errors/permission-validator-unauthorized-error';
import { PermissionValidatorUnavailableError } from './errors/permission-validator-unavailable-error';
import type { PermissionValidationRequest } from './permission-validator';

const BASE_URL = 'https://auth.internal.example';
const VALIDATE_URL = `${BASE_URL}/auth/permissions/validate`;
const TIMEOUT_MS = 300;
const CALLER_KEY = 'managed-api-key-secret-value';

const REQUEST: PermissionValidationRequest = {
  apiKey: CALLER_KEY,
  permission: 'tickets.ticket.create',
};

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: unknown;
}

interface RecordedFetch {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
  signal: unknown;
}

function stubFetch(responder: () => Response | Promise<Response>): RecordedFetch[] {
  const calls: RecordedFetch[] = [];

  vi.stubGlobal('fetch', async (input: unknown, init?: FetchInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers ?? {}),
      body: parseBody(init?.body),
      signal: init?.signal,
    });
    return responder();
  });

  return calls;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const textResponse = (text: string, status: number): Response =>
  new Response(text, { status, headers: { 'content-type': 'text/plain' } });

const authorizedResponse = (): Response => jsonResponse({ authorized: true, brokers: ['tim'] });

const buildValidator = (): WaveAuthPermissionValidator =>
  new WaveAuthPermissionValidator(BASE_URL, TIMEOUT_MS);

/** Only what went out over the wire matters here, not how the call settled. */
const attempt = async (validator: WaveAuthPermissionValidator): Promise<void> => {
  await validator.validate(REQUEST).then(
    () => undefined,
    () => undefined,
  );
};

function onlyCall(calls: readonly RecordedFetch[]): RecordedFetch {
  expect(calls).toHaveLength(1);
  return calls[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WaveAuthPermissionValidator — downstream failures', () => {
  it('401 from wave-auth-api throws PermissionValidatorUnauthorizedError', async () => {
    stubFetch(() => textResponse('{"message":"unauthorized"}', 401));

    await expect(buildValidator().validate(REQUEST)).rejects.toBeInstanceOf(
      PermissionValidatorUnauthorizedError,
    );
  });

  it.each([500, 502, 503, 504])(
    'status %i from wave-auth-api throws PermissionValidatorUnavailableError',
    async (status) => {
      stubFetch(() => textResponse('upstream failure', status));

      await expect(buildValidator().validate(REQUEST)).rejects.toBeInstanceOf(
        PermissionValidatorUnavailableError,
      );
    },
  );

  it.each([400, 403, 404, 429])(
    'status %i — any 4xx other than 401 is an absent verdict, not a denial',
    async (status) => {
      stubFetch(() => textResponse('refused', status));

      await expect(buildValidator().validate(REQUEST)).rejects.toBeInstanceOf(
        PermissionValidatorUnavailableError,
      );
    },
  );

  it('a 4xx never produces a verdict, authorized or not', async () => {
    stubFetch(() => jsonResponse({ authorized: true, brokers: ['tim'] }, 403));

    await expect(buildValidator().validate(REQUEST)).rejects.toBeInstanceOf(
      PermissionValidatorUnavailableError,
    );
  });

  it.each(['/', '//', '///'])(
    'a base URL ending in %j still reaches the same path, without a double slash',
    async (suffix) => {
      const calls = stubFetch(() => authorizedResponse());

      await new WaveAuthPermissionValidator(`${BASE_URL}${suffix}`, TIMEOUT_MS).validate(REQUEST);

      expect(calls[0]?.url).toBe(VALIDATE_URL);
    },
  );

  it('the AbortSignal timeout is the configured value, not a fixed one', async () => {
    stubFetch(() => authorizedResponse());
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await new WaveAuthPermissionValidator(BASE_URL, 12_345).validate(REQUEST);

    expect(timeout).toHaveBeenCalledWith(12_345);
  });

  it('a timed-out call throws PermissionValidatorUnavailableError', async () => {
    const timeout = Object.assign(new Error('This operation was aborted'), {
      name: 'TimeoutError',
    });
    stubFetch(() => Promise.reject(timeout));

    await expect(buildValidator().validate(REQUEST)).rejects.toBeInstanceOf(
      PermissionValidatorUnavailableError,
    );
  });

  it('the call carries an AbortSignal — the timeout is explicit and finite', async () => {
    const calls = stubFetch(authorizedResponse);

    await attempt(buildValidator());

    expect(onlyCall(calls).signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { label: 'empty body', response: () => textResponse('', 200) },
    { label: 'non-JSON body', response: () => textResponse('OK', 200) },
    { label: 'empty object', response: () => jsonResponse({}) },
    { label: 'missing authorized', response: () => jsonResponse({ brokers: ['tim'] }) },
    { label: 'missing brokers', response: () => jsonResponse({ authorized: true }) },
    {
      label: 'authorized with the wrong type',
      response: () => jsonResponse({ authorized: 'yes', brokers: ['tim'] }),
    },
    {
      label: 'brokers with the wrong type',
      response: () => jsonResponse({ authorized: true, brokers: 'tim' }),
    },
  ])(
    '200 with $label throws PermissionValidatorUnavailableError, never assumes authorized',
    async ({ response }) => {
      stubFetch(response);

      await expect(buildValidator().validate(REQUEST)).rejects.toBeInstanceOf(
        PermissionValidatorUnavailableError,
      );
    },
  );
});

describe('WaveAuthPermissionValidator — the verdict comes from the body, not the status', () => {
  it.each(['PERMISSION_NOT_GRANTED', 'BROKER_NOT_IN_SCOPE'])(
    '200 with authorized false and reason %s resolves as a denial, not an error',
    async (reason) => {
      stubFetch(() => jsonResponse({ authorized: false, reason, brokers: [] }));

      await expect(buildValidator().validate(REQUEST)).resolves.toMatchObject({
        authorized: false,
        brokers: [],
      });
    },
  );

  it('200 with authorized true resolves with exactly the brokers from the body', async () => {
    stubFetch(() => jsonResponse({ authorized: true, brokers: ['tim-broker'] }));

    await expect(buildValidator().validate(REQUEST)).resolves.toMatchObject({
      authorized: true,
      brokers: ['tim-broker'],
    });
  });
});

describe('WaveAuthPermissionValidator — what goes out in the call', () => {
  it('brokers, when present, goes in the body as-is', async () => {
    const calls = stubFetch(authorizedResponse);

    await buildValidator()
      .validate({ ...REQUEST, brokers: ['tim'] })
      .then(
        () => undefined,
        () => undefined,
      );

    expect(onlyCall(calls).body).toEqual({
      permission: REQUEST.permission,
      brokers: ['tim'],
    });
  });

  it('without brokers, the body does not carry the brokers key', async () => {
    const calls = stubFetch(authorizedResponse);

    await attempt(buildValidator());

    const body = onlyCall(calls).body as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('brokers');
    expect(body).toEqual({ permission: REQUEST.permission });
  });

  it('an in-scope x-correlation-id is propagated', async () => {
    const calls = stubFetch(authorizedResponse);

    await setHookContext(async () => {
      setHookCorrelationId('corr-abc-123');
      await attempt(buildValidator());
    });

    expect(onlyCall(calls).headers.get('x-correlation-id')).toBe('corr-abc-123');
  });

  it('without an in-scope correlation id, the header is omitted — never empty', async () => {
    const calls = stubFetch(authorizedResponse);

    await attempt(buildValidator());

    expect(onlyCall(calls).headers.has('x-correlation-id')).toBe(false);
  });

  it('the received x-api-key is forwarded unchanged and never lands in the body', async () => {
    const calls = stubFetch(authorizedResponse);

    await attempt(buildValidator());

    const call = onlyCall(calls);
    expect(call.headers.get('x-api-key')).toBe(CALLER_KEY);
    expect(JSON.stringify(call.body)).not.toContain(CALLER_KEY);
    expect(call.headers.has('authorization')).toBe(false);
  });

  it('validate is a single POST to the validate path, nothing else', async () => {
    const calls = stubFetch(authorizedResponse);

    await attempt(buildValidator());

    const call = onlyCall(calls);
    expect(call.url).toBe(VALIDATE_URL);
    expect(call.method).toBe('POST');
  });
});
