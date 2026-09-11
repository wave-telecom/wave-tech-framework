/**
 * Registers a service's permission catalogue on the Wave Auth API of the
 * environment it is being deployed to.
 *
 * Meant for a service's `scripts/bootstrap.js`, which `wave-foundation-iac`
 * runs as a Cloud Run job after each deploy. `PUT /permissions` is idempotent:
 * it registers the names the platform registry is missing and leaves the rest
 * as they are, so sending the full list the code declares on every deploy
 * creates nothing after the first.
 *
 * Registering only makes a name grantable. Handing it to a broker and minting
 * keys that name it stay separate operations, outside any pipeline.
 */

const CATALOGUE_PATH = '/permissions';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RegisterPermissionCatalogueParams {
  /** Base URL of the Wave Auth API, e.g. `https://api.dev.acme.example/auth`. */
  authApiUrl: string
  /** A managed API key holding `auth.permission.upsert`. */
  apiKey: string
  /** Every permission name the service declares. */
  permissions: readonly string[]
  timeoutMs?: number
}

/** What the call registered, and what it found already there. */
export interface PermissionCatalogueResult {
  created: string[]
  unchanged: string[]
}

export async function registerPermissionCatalogue(
  params: RegisterPermissionCatalogueParams,
): Promise<PermissionCatalogueResult> {
  const { authApiUrl, apiKey, permissions, timeoutMs = DEFAULT_TIMEOUT_MS } = params;

  // These three reach this function from a deploy job's environment and its
  // build output. Unchecked, a missing URL requests `undefined/permissions`, a
  // missing key answers an opaque 401, and an empty list answers 200 having
  // registered nothing — which is a broken import far more often than it is a
  // service that declares no permission.
  if (authApiUrl.length === 0) {
    throw new Error('registerPermissionCatalogue: authApiUrl is required');
  }
  if (apiKey.length === 0) {
    throw new Error('registerPermissionCatalogue: apiKey is required');
  }
  if (permissions.length === 0) {
    throw new Error('registerPermissionCatalogue: permissions is empty, so nothing would be registered');
  }

  const url = `${authApiUrl.replace(/\/+$/, '')}${CATALOGUE_PATH}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ permissions: permissions.map((name) => ({ name })) }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // The body carries the problem detail. A deploy log saying only "403" would
    // not say which key was refused, nor which name the schema rejected.
    const detail = await response.text();
    throw new Error(`registerPermissionCatalogue: ${url} answered ${response.status} — ${detail}`);
  }

  return await response.json() as PermissionCatalogueResult;
}
