import type { FastifyRequest } from 'fastify';

/**
 * Declares what a single route (or a standalone `assertHasPermission` check)
 * requires: which permission wave-auth-api must grant, and whether the
 * resolved broker scope must collapse to exactly one broker.
 */
export interface RouteProperties {
  /** Opaque `resource.action` name — wave-auth-api compares it by exact equality, no hierarchy. */
  permissionName: string;
  /**
   * Requires the resolved scope to collapse to exactly one broker; a scope
   * with more than one broker answers `400`, asking the caller to select one
   * via the broker id header. Defaults to `true` — the safer default, since
   * a route that never considered multi-broker scope should not silently
   * accept it.
   */
  singleBroker?: boolean;
  /**
   * Same requirement as `singleBroker`, decided per request instead of
   * statically (e.g. only when a query parameter selects a broker-scoped
   * ordering). Takes precedence over `singleBroker` when present.
   */
  singleBrokerWhen?: (request: FastifyRequest) => boolean;
}
