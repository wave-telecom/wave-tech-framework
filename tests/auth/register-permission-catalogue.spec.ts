import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPermissionCatalogue } from '../../src/auth/register-permission-catalogue';

const params = {
  authApiUrl: 'https://api.dev.acme.example/auth',
  apiKey: 'an-upsert-key',
  permissions: ['acme.widget.create', 'acme.widget.list'],
};

const respondWith = (
  body: unknown,
  init: { status?: number, text?: string } = {},
): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(init.text ?? JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerPermissionCatalogue', () => {
  it('puts the declared names to the catalogue endpoint', async () => {
    const fetchMock = respondWith({ created: ['acme.widget.create'], unchanged: ['acme.widget.list'] });

    const result = await registerPermissionCatalogue(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.dev.acme.example/auth/permissions');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ 'x-api-key': 'an-upsert-key' });
    expect(JSON.parse(init.body as string)).toEqual({
      permissions: [{ name: 'acme.widget.create' }, { name: 'acme.widget.list' }],
    });
    expect(result).toEqual({ created: ['acme.widget.create'], unchanged: ['acme.widget.list'] });
  });

  it('does not double the slash when the base URL carries a trailing one', async () => {
    const fetchMock = respondWith({ created: [], unchanged: [] });

    await registerPermissionCatalogue({ ...params, authApiUrl: 'https://api.dev.acme.example/auth/' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.dev.acme.example/auth/permissions');
  });

  it('raises with the status and the body when the API refuses', async () => {
    respondWith(null, { status: 403, text: '{"title":"Forbidden"}' });

    await expect(registerPermissionCatalogue(params)).rejects.toThrow(
      /answered 403 — \{"title":"Forbidden"\}/,
    );
  });

  // The guard that matters most: a broken import reaches here as an empty list,
  // and the endpoint would answer 200 having registered nothing.
  it('refuses an empty catalogue instead of reporting a successful no-op', async () => {
    const fetchMock = respondWith({ created: [], unchanged: [] });

    await expect(
      registerPermissionCatalogue({ ...params, permissions: [] }),
    ).rejects.toThrow(/permissions is empty/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['authApiUrl', { ...params, authApiUrl: '' }],
    ['apiKey', { ...params, apiKey: '' }],
  ])('refuses a missing %s before reaching the network', async (field, broken) => {
    const fetchMock = respondWith({ created: [], unchanged: [] });

    await expect(registerPermissionCatalogue(broken)).rejects.toThrow(new RegExp(`${field} is required`));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
