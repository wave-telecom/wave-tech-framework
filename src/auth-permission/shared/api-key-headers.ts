import type { RouteProperties } from '../route-properties';

export function resolveApiKeyHeaders(
  apiKeyHeader: string | readonly string[],
  authorizationHeader: string,
  routes: Readonly<Record<string, RouteProperties>>,
  registrar: string,
): readonly string[] {
  const configured = typeof apiKeyHeader === 'string' ? [apiKeyHeader] : apiKeyHeader;
  // Node exposes `request.headers` with lowercased names, so a header
  // configured as `'Authorization'` would otherwise never match.
  const headers = [...new Set(configured.map((header) => header.toLowerCase()))];
  if (headers.length === 0) {
    throw new Error(`${registrar} was given an empty apiKeyHeader list`);
  }

  // A `Bearer <jwt>` would be read as an API key first and sent to the
  // validator, so the session token path could never be reached.
  if (headers.includes(authorizationHeader.toLowerCase())) {
    for (const [routeKey, route] of Object.entries(routes)) {
      if (route.acceptsSessionToken === true) {
        throw new Error(
          `${routeKey} sets acceptsSessionToken but ${registrar} reads the API key from the authorization header "${authorizationHeader}"`,
        );
      }
    }
  }

  return headers;
}
