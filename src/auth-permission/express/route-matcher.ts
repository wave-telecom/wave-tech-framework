import { match, type MatchFunction } from 'path-to-regexp';
import type { RouteProperties } from '../route-properties';

interface CompiledRoute {
  method: string;
  matchPath: MatchFunction<Record<string, string | string[]>>;
  route: RouteProperties;
}

export type CompiledRoutes = readonly CompiledRoute[];

/**
 * Compiles the `"METHOD path"` route map into matchers, using
 * `path-to-regexp`'s own `:param` syntax — the same syntax Express itself
 * accepts, but re-implemented here since nothing short of Express's own
 * internal, private router can answer "does this path match a route I
 * haven't registered yet" before the real route handlers run. Optional
 * (`:id?`), wildcard (`*`) and regex-constrained (`:id(\d+)`) segments throw
 * here — `path-to-regexp@8` rejects that syntax outright — so every
 * supported pattern has a fixed, `/`-delimited segment count.
 */
export function compileRoutes(routes: Readonly<Record<string, RouteProperties>>): CompiledRoutes {
  return Object.entries(routes).map(([key, route]) => {
    const { method, pattern } = splitRouteKey(key);
    return { method, matchPath: match(pattern), route };
  });
}

/**
 * Returns the first compiled route (in the map's own insertion order) whose
 * method and pattern match. This deliberately does **not** try to detect or
 * reject overlapping patterns: Express itself resolves an overlap by
 * registration order on the router (first-registered handler wins), and two
 * of this route map's own patterns can legitimately overlap the same way a
 * real Express router's can (e.g. `/accounts/by-external-code/:externalCode`
 * and `/accounts/:accountId/balances` both match
 * `/accounts/by-external-code/balances`). Replicating that exact tie-break
 * means the caller's `routes` map must list entries in the same relative
 * order the corresponding routes are registered on the actual Express
 * router — get that right and an overlap needs no special handling; get it
 * wrong and the wrong route's permission silently applies.
 */
export function matchRoute(
  compiled: CompiledRoutes,
  method: string,
  path: string,
): RouteProperties | undefined {
  for (const entry of compiled) {
    if (entry.method === method && entry.matchPath(path) !== false) {
      return entry.route;
    }
  }
  return undefined;
}

function splitRouteKey(key: string): { method: string; pattern: string } {
  const spaceIndex = key.indexOf(' ');
  if (spaceIndex === -1) {
    throw new Error(`Invalid route key "${key}" — expected "METHOD /path"`);
  }
  return { method: key.slice(0, spaceIndex), pattern: key.slice(spaceIndex + 1) };
}
